import { MusicSourceError, type MusicHost } from '@studio/music-sources';
import { BilibiliCatalogue } from '@studio/music-sources/discovery';
import type { ChartItem, ChartKind, ChartPeriod, ChartSource, ChartUpdateFrequency, MusicChart } from './chart-types.js';
import { artworkUrl } from './artwork-url.js';
import type { BrowseCache } from './browse-cache.js';

const neteaseIds = { hot: 3778678, new: 3779629, rising: 19723756 };
const neteaseNames = { hot: '网易云热歌榜', new: '网易云新歌榜', rising: '网易云飙升榜' };
const hour = 60 * 60 * 1000, day = 24 * hour, week = 7 * day;
// Prefer the source's stated cadence; current song charts default to daily.
const frequency = (description: unknown): ChartUpdateFrequency => typeof description === 'string' && /每周|每星期|weekly|every\s+week/i.test(description) ? 'weekly' : 'daily';
function nextRefresh(now: number, updatedAt: number | undefined, cadence: ChartUpdateFrequency): number {
  const interval = cadence === 'weekly' ? week : day;
  const next = updatedAt !== undefined && updatedAt <= now ? updatedAt + interval : now + interval;
  // Publication can be delayed. Recheck hourly instead of on every visit.
  return next > now ? next : now + hour;
}
const fail = (code: 'invalid-input'|'upstream'|'not-found'|'network'|'timeout') => new MusicSourceError({code, retryable: code !== 'invalid-input' && code !== 'not-found'});
const timestamp = (value: unknown): number | undefined => {
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Date.parse(value) : NaN;
  return Number.isFinite(n) && n > 0 ? n : undefined;
};
const names = (rows: unknown): string[] | undefined => {
  const values = Array.isArray(rows) ? rows.flatMap(row => typeof row?.name === 'string' && row.name.trim() ? [row.name.trim()] : []) : [];
  return values.length ? values : undefined;
};
const singers = (value: unknown): string[] | undefined => {
  const values = typeof value === 'string' ? value.split(',').map(name => name.trim()).filter(Boolean) : [];
  return values.length ? values : undefined;
};
function songs(rows: unknown, fields: (row: any) => {title: unknown; artists?: string[]; artwork?: string}, ranked = false): ChartItem[] {
  if (!Array.isArray(rows)) throw fail('upstream');
  return rows.flatMap((row, index) => {
    const {title: name, artists, artwork} = fields(row);
    if (typeof name !== 'string' || !name.trim()) return [];
    return [{rank: ranked && Number.isSafeInteger(row.rank) && row.rank > 0 ? row.rank : index + 1, title: name, ...(artists ? {artists} : {}), ...(artwork ? {artwork} : {})}];
  });
}

/** Song names are catalogue facts, never inferred playable video references. */
export class MusicCharts {
  private catalogue = new BilibiliCatalogue();
  private cache = new Map<string, {value: MusicChart; until: number}>();
  private periods?: {items: ChartPeriod[]; until: number};
  private pending = new Map<string, {controller: AbortController; promise: Promise<MusicChart>; readers: number}>();
  constructor(private host: MusicHost, private store?: BrowseCache) {
    for(const [key,row] of store?.entries<{value:MusicChart;until:number|null}>('chart')??[]){
      if(row?.value?.items?.length&&Number.isFinite(row.value.fetchedAt)&&Number.isFinite(row.value.refreshAfter)&&(row.until===null||Number.isFinite(row.until)))this.cache.set(key,{value:row.value,until:row.until===null?Infinity:row.until});
    }
    const periods=store?.read<{items:ChartPeriod[];until:number}>('chart-periods','bilibili');
    if(periods?.items?.length&&periods.items.every(period=>Number.isSafeInteger(period.id)&&Number.isFinite(period.publishedAt))&&Number.isFinite(periods.until))this.periods=periods;
  }
  private async json(url: string, signal: AbortSignal) {
    try {
      const response = await this.host.fetch(url, {signal, headers: new URL(url).hostname === 'rss.marketingtools.apple.com' ? {} : {'User-Agent': 'Mozilla/5.0', Referer: new URL(url).origin + '/'}});
      if (!response.ok) throw fail('upstream');
      return await response.json();
    } catch (error) {
      if (signal.aborted) { signal.throwIfAborted(); }
      if (error instanceof MusicSourceError) throw error;
      throw fail(error instanceof SyntaxError ? 'upstream' : 'network');
    }
  }
  async read(input: {source?: string; chart?: string; period?: string}, signal: AbortSignal): Promise<MusicChart> {
    try {
      signal.throwIfAborted();
      const source = input.source ?? 'netease', chart = input.chart ?? (source === 'apple' ? 'most-played' : 'hot');
      const key = JSON.stringify([source, chart, source === 'bilibili' ? input.period ?? 'latest' : input.period]);
      let pending = this.pending.get(key);
      if (!pending || pending.controller.signal.aborted) {
        const controller = new AbortController();
        pending = {controller, promise: this.readChart(input, controller.signal), readers: 0};
        this.pending.set(key, pending);
        const operation = pending;
        void operation.promise.finally(() => {if (this.pending.get(key) === operation) this.pending.delete(key);}).catch(() => {});
      }
      const operation = pending;
      operation.readers++;
      return await new Promise<MusicChart>((resolve, reject) => {
        let settled = false;
        const finish = () => {
          if (settled) return false;
          settled = true; signal.removeEventListener('abort', abort);
          if (--operation.readers === 0 && this.pending.get(key) === operation) operation.controller.abort();
          return true;
        };
        const abort = () => {if (finish()) reject(signal.reason);};
        signal.addEventListener('abort', abort, {once: true});
        operation.promise.then(value => {if (finish()) resolve(structuredClone(value));}, error => {if (finish()) reject(error);});
        if (signal.aborted) abort();
      });
    }
    catch(error) {
      const timedOut=signal.aborted&&signal.reason?.name==='TimeoutError';
      if(signal.aborted&&!timedOut)throw new MusicSourceError({code:'cancelled',retryable:true});
      const source=input.source??'netease',chart=input.chart??(source==='apple'?'most-played':'hot'),period=source==='bilibili'?(!input.period||input.period==='latest'?this.periods?.items[0]?.id:Number(input.period)):undefined;
      let cached=this.cache.get(`${source}:${chart}:${period??''}`);
      if(!cached&&source==='bilibili'&&(!input.period||input.period==='latest')){
        // The refreshed catalogue can name an edition whose songs failed to load.
        // Reuse the newest successful edition, including snapshots restored on restart.
        for(const row of this.cache.values()){
          if(row.value.source===source&&row.value.chart===chart&&row.value.period&&(!cached||row.value.period.publishedAt>cached.value.period!.publishedAt))cached=row;
        }
      }
      if(this.store&&cached&&!(error instanceof MusicSourceError&&['invalid-input','not-found'].includes(error.code)))return structuredClone({...cached.value,issue:timedOut?'timeout':error instanceof MusicSourceError?error.code:'network'});
      if(timedOut)throw new MusicSourceError({code:'timeout',retryable:true});
      throw error;
    }
  }
  private async readChart(input: {source?: string; chart?: string; period?: string}, signal: AbortSignal): Promise<MusicChart> {
    const source = input.source ?? 'netease', chart = input.chart ?? (source === 'apple' ? 'most-played' : 'hot');
    if (!['netease','qq','bilibili','apple'].includes(source) || !(source === 'netease' ? ['hot','new','rising'].includes(chart) : chart === (source === 'apple' ? 'most-played' : 'hot')) || (input.period !== undefined && (source !== 'bilibili' || input.period !== 'latest' && !/^[1-9]\d{0,8}$/.test(input.period)))) throw fail('invalid-input');
    signal.throwIfAborted();
    let periods: ChartPeriod[] | undefined, period: ChartPeriod | undefined;
    if (source === 'bilibili') {
      if (!this.periods || this.periods.until <= this.host.now()) {
        const data = await this.catalogue.json('/x/copyright-music-publicity/toplist/all_period', {list_type:'1'}, {host:this.host,signal,scope:'anonymous'});
        if (!data.list || typeof data.list !== 'object') throw fail('upstream');
        const items = Object.values(data.list).flat().filter((row: any) => Number.isSafeInteger(row?.ID) && row.ID > 0 && Number.isSafeInteger(row.priod) && row.priod > 0 && typeof row.publish_time === 'number' && row.publish_time > 0).map((row: any) => ({id:row.ID,number:row.priod,publishedAt:row.publish_time*1000})).sort((a,b)=>b.publishedAt-a.publishedAt);
        if (!items.length) throw fail('upstream');
        signal.throwIfAborted(); this.periods = {items,until:nextRefresh(this.host.now(),items[0].publishedAt,'weekly')};
        this.store?.write('chart-periods','bilibili',this.periods,1);
      }
      periods = this.periods.items;
      period = !input.period || input.period === 'latest' ? periods[0] : periods.find(p=>p.id === Number(input.period));
      if (!period) throw fail('not-found');
    }
    const key = `${source}:${chart}:${period?.id ?? ''}`, cached = this.cache.get(key);
    if (cached && cached.until > this.host.now()) return structuredClone({...cached.value,...(periods ? {periods,refreshAfter:this.periods!.until} : {})});
    let items: ChartItem[], updatedAt: number | undefined, title: string, sourceUrl: string, updateFrequency: ChartUpdateFrequency = 'daily';
    if (source === 'netease') {
      const kind = chart as keyof typeof neteaseIds, id = neteaseIds[kind];
      const data = await this.json(`https://music.163.com/api/playlist/detail?id=${id}`, signal);
      if (data.code !== 200) throw fail('upstream');
      items = songs(data.result?.tracks, row=>({title:row?.name,artists:names(row?.artists),artwork:artworkUrl(row?.album?.picUrl)})); updatedAt = timestamp(data.result?.updateTime);
      updateFrequency = frequency(data.result?.description);
      title = neteaseNames[kind]; sourceUrl = `https://music.163.com/discover/toplist?id=${id}`;
    } else if (source === 'qq') {
      const data = await this.json('https://c.y.qq.com/v8/fcg-bin/fcg_v8_toplist_cp.fcg?format=json&topid=26', signal);
      if (data.code !== 0) throw fail('upstream');
      items = songs(data.songlist, row=>({title:row?.data?.songname,artists:names(row?.data?.singer),artwork:typeof row?.data?.albummid === 'string' && /^[A-Za-z0-9]+$/.test(row.data.albummid) ? `https://y.gtimg.cn/music/photo_new/T002R300x300M000${row.data.albummid}.jpg` : undefined})); updatedAt = timestamp(data.update_time ? data.update_time+'T00:00:00+08:00' : undefined);
      updateFrequency = frequency(data.topinfo?.info);
      title = 'QQ音乐热歌榜'; sourceUrl = 'https://y.qq.com/n/ryqq/toplist/26';
    } else if (source === 'apple') {
      const data = await this.json('https://rss.marketingtools.apple.com/api/v2/cn/music/most-played/100/songs.json', signal);
      items = songs(data.feed?.results, row=>({title:row?.name,artists:typeof row?.artistName === 'string' && row.artistName.trim() ? [row.artistName.trim()] : undefined,artwork:artworkUrl(row?.artworkUrl100)})); updatedAt = timestamp(data.feed?.updated);
      title = 'Apple Music 中国区热门歌曲'; sourceUrl = 'https://music.apple.com/cn/browse/top-charts';
    } else {
      const data = await this.catalogue.json('/x/copyright-music-publicity/toplist/music_list', {list_id:String(period!.id)}, {host:this.host,signal,scope:'anonymous'});
      items = songs(data.list, row=>({title:row?.music_title,artists:singers(row?.singer),artwork:artworkUrl(row?.mv_cover) ?? artworkUrl(row?.creation_cover)}), true); updatedAt = period!.publishedAt;
      updateFrequency = 'weekly';
      title = 'B站热歌榜'; sourceUrl = `https://music.bilibili.com/pc/rank?list_type=1&list_id=${period!.id}`;
    }
    // A malformed or empty upstream response must not replace a previously valid chart.
    if (!items.length) throw fail('upstream');
    signal.throwIfAborted();
    const now = this.host.now(), refreshAfter = periods ? this.periods!.until : nextRefresh(now,updatedAt,updateFrequency);
    const value: MusicChart = {source:source as ChartSource,chart:chart as ChartKind,title,items,fetchedAt:now,refreshAfter,updateFrequency,sourceUrl,...(updatedAt ? {updatedAt} : {}),...(period ? {period,periods} : {})};
    if (this.cache.size >= 32) this.cache.delete(this.cache.keys().next().value!);
    // Published B站 editions are immutable; only their edition catalogue expires.
    this.cache.set(key,{value,until:source === 'bilibili' ? Infinity : refreshAfter});
    this.store?.write('chart',key,{value,until:source==='bilibili'?null:refreshAfter},32);
    return structuredClone(value);
  }
  async dispose() { for (const operation of this.pending.values()) operation.controller.abort(); this.pending.clear(); await this.catalogue.dispose(); this.cache.clear(); this.periods = undefined; }
}
