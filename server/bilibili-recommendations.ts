import { BilibiliProvider } from '@studio/music-sources/bilibili';
import { MusicSourceError, type MusicEntry, type ProviderContext } from '@studio/music-sources';
import { BilibiliCatalogue, bilibiliCatalogueEntry as entry, cleanCatalogueText as clean, type CatalogueRow as Raw } from '@studio/music-sources/discovery';
import {compilePhraseRules} from '@studio/recommendation';

// Music policies stay in this product; fields come from the public protocol adapter.
const musicRegions = new Set([3, 28, 29, 30, 31, 54, 59, 130, 193, 194, 265, 266, 267]);
const musicRegionsV2 = new Set([1003, 2016, 2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024, 2027]);
const regionRule=(terms:string[])=>compilePhraseRules({algorithm:'literal-case-v1',include:{mode:'any',groups:[{id:'music-category',fields:['categories'],mode:'any',terms}]},exclude:[]});
const acceptedRegion=regionRule(['音乐','翻唱','演奏','VOCALOID','UTAU','说唱','电台']),excludedRegion=regionRule(['教学','乐评','盘点']);
export const desktopBilibiliRecommendationRevision = 'music-partitions-v2-first-1';
function music(r: Raw, desktop = false) {
  const tid = Number(r.tid), tidV2 = Number(r.tid_v2 ?? r.tidv2);
  const hasCurrent = Number.isSafeInteger(tidV2) && tidV2 > 0;
  const region = clean(desktop && hasCurrent ? r.tname_v2 : r.tname_v2 || r.tname);
  const facts={identity:{namespace:'bilibili',id:r.bvid},source:'bilibili',authorized:true,available:true,categories:region?[region]:[],provenance:'actual music partition'};
  if (desktop) {
    if (excludedRegion(facts).truth==='yes') return false;
    // A current non-music partition cannot be overridden by a stale legacy ID or a name hint.
    if (hasCurrent) return musicRegionsV2.has(tidV2);
    if (Number.isSafeInteger(tid) && tid > 0) return musicRegions.has(tid) || musicRegionsV2.has(tid);
    return acceptedRegion(facts).truth==='yes' || region.toLocaleLowerCase()==='mv';
  }
  if ([243, 244].includes(tid) || [2025, 2026].includes(tidV2) || excludedRegion(facts).truth==='yes') return false;
  return musicRegions.has(tid) || musicRegionsV2.has(tidV2) || musicRegionsV2.has(tid) || acceptedRegion(facts).truth==='yes' || region.toLocaleLowerCase()==='mv';
}

async function joined<T>(jobs:Promise<T>[]):Promise<T[]>{const results=await Promise.allSettled(jobs);const failed=results.find(r=>r.status==='rejected');if(failed?.status==='rejected')throw failed.reason;return results.map(r=>(r as PromiseFulfilledResult<T>).value);}

export class AccountBilibiliProvider extends BilibiliProvider {
  private feeds = new Map<string, { index: number; shown: string[]; seen: Set<string> }>();
  private catalogue = new BilibiliCatalogue();
  private videos = new Map<string, { data: Raw; until: number }>();
  private regionIndices = new Map<string,number>();
  private candidateWork = new Set<Promise<Awaited<ReturnType<BilibiliProvider['discover']>>>>();
  private candidateStop = new AbortController();
  private candidateOwners=new Map<AbortController,string>();
  inheritCandidates(from:string,to:string){
    if(from===to)return;
    const feed=this.feeds.get(from);
    if(feed&&!this.feeds.has(to)){
      if(this.feeds.size>=8){const oldest=[...this.feeds.keys()].find(key=>key!==from);if(oldest)this.feeds.delete(oldest);}
      this.feeds.set(to,{index:feed.index,shown:[...feed.shown],seen:new Set(feed.seen)});
    }
    if(!this.regionIndices.has(to)&&this.regionIndices.has(from)){
      if(this.regionIndices.size>=64){const oldest=[...this.regionIndices.keys()].find(key=>key!==from);if(oldest)this.regionIndices.delete(oldest);}
      this.regionIndices.set(to,this.regionIndices.get(from)!);
    }
  }
  private advanceRegion(scope:string){const next=(this.regionIndices.get(scope)??0)%100+1;if(this.regionIndices.size>=64&&!this.regionIndices.has(scope))this.regionIndices.delete(this.regionIndices.keys().next().value!);this.regionIndices.set(scope,next);return next;}
  private json(path: string, params: Record<string, string>, c: ProviderContext, signed = false) { return this.catalogue.json(path, params, c, signed); }
  async restoreDesktopRecommendations(c:ProviderContext, candidates:MusicEntry[], enough:(items:MusicEntry[])=>boolean):Promise<MusicEntry[]> {
    const ids=[...new Set(candidates.filter(item=>item?.ref?.provider==='bilibili'&&/^BV[a-zA-Z0-9]{10}$/.test(item.ref.id)).map(item=>item.ref.id))].slice(0,60),items:MusicEntry[]=[];
    for(let start=0;start<ids.length&&!enough(items);start+=4){
      c.signal.throwIfAborted();
      const group=await joined(ids.slice(start,start+4).map(async id=>{
        try{
          // Older snapshots are candidates only: re-read current partitions before admitting them.
          const video=await this.json('/x/web-interface/view',{bvid:id},c);
          return video.bvid===id&&clean(video.title)&&music(video,true)?entry(video):undefined;
        }catch(error){
          if(c.signal.aborted||error instanceof MusicSourceError&&error.code==='authentication')throw error;
          return undefined;
        }
      }));
      for(const item of group)if(item)items.push(item);
    }
    c.signal.throwIfAborted();
    return items;
  }
  private async recommended(c: ProviderContext, confirmed?: string[], enough?: (items: MusicEntry[]) => boolean, desktop = false): Promise<MusicEntry[]> {
    let state = this.feeds.get(c.scope);
    if (!state) {
      state = { index: 0, shown: [], seen: new Set() };
      if (this.feeds.size >= 8) this.feeds.delete(this.feeds.keys().next().value!);
      this.feeds.set(c.scope, state);
    }
    const checked = new Set<string>(), fresh: MusicEntry[] = [], repeated: MusicEntry[] = [];
    const seen = confirmed ? new Set(confirmed) : state.seen;
    let reads = 0;
    const complete=()=>enough?enough([...fresh,...repeated]):fresh.length>=12;
    // A homepage batch includes all categories. Scan beyond its first 12 videos and refill sparsely musical batches.
    for (let batch = 0; batch < 3 && !complete() && reads < 60; batch++) {
      state.index = state.index % 10000 + 1;
      const index = String(state.index);
      const data = await this.json('/x/web-interface/wbi/index/top/feed/rcmd', { fresh_type: '4', ps: '30', fresh_idx: index, fresh_idx_1h: index, brush: index, web_location: '1430650', ...(state.shown.length ? { last_showlist: state.shown.map(id => 'av_' + id).join(',') } : {}) }, c, true);
      if (!Array.isArray(data.item)) throw new MusicSourceError({ code: 'upstream', provider: 'bilibili', retryable: true });
      const candidates = [...new Map<string, Raw>(data.item.slice(0, 30).filter((r: Raw) => r?.goto === 'av' && /^BV[a-zA-Z0-9]{10}$/.test(r.bvid) && !r.business_info).map((r: Raw) => [r.bvid, r] as [string, Raw])).values()];
      state.shown = [...new Set([...state.shown, ...candidates.filter(r => Number.isSafeInteger(r.id)).map(r => String(r.id))])].slice(-60);
      const hint = (r: Raw) => /音乐|歌曲|翻唱|演奏|纯音|伴奏|MV|LIVE|爵士|歌单|单曲|《.+》/i.test(clean(r.title)) ? 1 : 0;
      const selected = candidates.filter(r => !checked.has(r.bvid)).sort((a, b) => Number(seen.has(a.bvid)) - Number(seen.has(b.bvid)) || hint(b) - hint(a));
      for (let start = 0; start < selected.length && !complete() && reads < 60; start += 4) {
        const group = selected.slice(start, start + Math.min(4, 60 - reads));
        // Four concurrent reads keep manual refresh responsive without an unbounded metadata fan-out.
        const results = await joined(group.map(async candidate => {
          checked.add(candidate.bvid);
          c.signal.throwIfAborted();
          const cacheKey=JSON.stringify([c.scope,candidate.bvid]);
          let video = this.videos.get(cacheKey);
          if (!video || video.until <= c.host.now()) {
            reads++;
            try { video = { data: await this.json('/x/web-interface/view', { bvid: candidate.bvid }, c), until: c.host.now() + 300000 }; }
            catch (e) { if (e instanceof MusicSourceError && e.code === 'upstream') return undefined; throw e; }
            if (this.videos.size >= 240) this.videos.delete(this.videos.keys().next().value!);
            this.videos.set(cacheKey, video);
          }
          return music(video.data, desktop) && video.data.bvid === candidate.bvid && clean(video.data.title) ? entry(video.data) : undefined;
        }));
        for (const item of results) if (item) (seen.has(item.ref.id) ? repeated : fresh).push(item);
      }
    }
    c.signal.throwIfAborted();
    // Deduplication must never erase a valid upstream batch. Prefer new tracks; keep actual repeats if exhausted.
    const items = confirmed ? [...fresh,...repeated] : [...fresh,...repeated].slice(0, 12);
    if (!confirmed) for (const item of items) state.seen.add(item.ref.id);
    while (state.seen.size > 100) state.seen.delete(state.seen.values().next().value!);
    return items;
  }
  private publicDiscovery(c: ProviderContext, includeRecommendation: boolean, enough?: (items: MusicEntry[]) => boolean): ReturnType<BilibiliProvider['discover']> {
    const definitions = [
      ...(includeRecommendation ? [{ id: 'music-recommendation', title: '音乐分区推荐', kind: 'recommendation' as const, path: '/x/web-interface/region/feed/rcmd', params: { display_id: String(this.advanceRegion(c.scope)), request_cnt: '20', from_region: '1003' }, field: 'archives' }] : []),
    ];
    return joined(definitions.map(async d => {
      try {
        const candidates=new Map<string,MusicEntry>();
        for(let round=0;round<(enough?3:1);round++){
          const params={...d.params,...(round?{display_id:String(this.advanceRegion(c.scope))}:{})} as Record<string,string>;
          try{
            const data=await this.json(d.path,params,c);
            if(!Array.isArray(data[d.field]))throw new MusicSourceError({code:'upstream',provider:'bilibili',retryable:true});
            for(const item of data[d.field].slice(0,20).filter((r:Raw)=>/^BV[a-zA-Z0-9]{10}$/.test(r?.bvid)).map(entry) as MusicEntry[])if(!candidates.has(item.resourceId))candidates.set(item.resourceId,item);
          }catch(error){
            if(c.signal.aborted||!candidates.size)throw error;
            return {id:d.id,title:d.title,kind:d.kind,page:{items:[...candidates.values()]},candidateIssue:error instanceof MusicSourceError?error.code:'network'};
          }
          if(!enough||enough([...candidates.values()]))break;
        }
        return {id:d.id,title:d.title,kind:d.kind,page:{items:[...candidates.values()]}};
      } catch (e) {
        if (c.signal.aborted) throw e;
        return { id: d.id, title: d.title, kind: d.kind, error: { ...(e instanceof MusicSourceError ? e.toJSON() : { code: 'network' as const, retryable: true }), provider: 'bilibili' as const } };
      }
    }));
  }
  override async discover(c: ProviderContext): ReturnType<BilibiliProvider['discover']> {
    return this.discoverCandidates(c);
  }
  async discoverCandidates(c: ProviderContext, confirmed?: string[], enough?: (items: MusicEntry[]) => boolean, desktop = false): ReturnType<BilibiliProvider['discover']> {
    if(this.candidateStop.signal.aborted)throw new MusicSourceError({code:'disposed',provider:'bilibili',retryable:false});
    if(this.candidateWork.size>=4)throw new MusicSourceError({code:'busy',provider:'bilibili',retryable:true});
    const owner=new AbortController();this.candidateOwners.set(owner,c.scope);const signal=AbortSignal.any([c.signal,this.candidateStop.signal,owner.signal]);
    const work=this.discoverCandidateShelves({...c,signal},confirmed,enough,desktop).catch(e=>{if(signal.aborted)throw new MusicSourceError({code:signal.reason?.name==='TimeoutError'?'timeout':'cancelled',provider:'bilibili',retryable:true});throw e;}).finally(()=>{this.candidateWork.delete(work);this.candidateOwners.delete(owner);});this.candidateWork.add(work);return work;
  }
  private async discoverCandidateShelves(c: ProviderContext, confirmed?: string[], enough?: (items: MusicEntry[]) => boolean, desktop = false): ReturnType<BilibiliProvider['discover']> {
    if (!c.credential?.cookie) return this.publicDiscovery(c, true,enough);
    const settled = await Promise.allSettled([
      this.publicDiscovery({ ...c, scope: 'anonymous', credential: undefined, credentialRef: undefined }, false),
      this.recommended(c, confirmed,enough,desktop).then(items => ({ id: 'account-recommendation', title: '为你推荐 · B站账号', kind: 'recommendation' as const, page: { items } })).catch(e => {
        if (c.signal.aborted || e instanceof MusicSourceError && e.code === 'authentication') throw e;
        const error = e instanceof MusicSourceError ? e.toJSON() : { code: 'network' as const, retryable: true };
        return { id: 'account-recommendation', title: '为你推荐 · B站账号', kind: 'recommendation' as const, error: { ...error, provider: 'bilibili' as const } };
      })
    ]);
    if(settled[0].status==='rejected')throw settled[0].reason;if(settled[1].status==='rejected')throw settled[1].reason;
    const publicShelves=settled[0].value,personalized=settled[1].value;
    return [personalized, ...publicShelves.filter(shelf => shelf.kind !== 'recommendation')];
  }
  override forgetCredentials(ref: string) {
    super.forgetCredentials(ref);
    const prefix = JSON.stringify([ref]).slice(0, -1) + ',';
    for (const key of this.feeds.keys()) if (key.startsWith(prefix)) this.feeds.delete(key);
    this.catalogue.forgetScope(prefix);
  }
  candidateDiagnostics(){return {active:this.candidateWork.size,disposed:this.candidateStop.signal.aborted};}
  cancelCandidates(session?:string){for(const [controller,scope]of this.candidateOwners){let matches=!session;try{matches ||= JSON.parse(scope).includes(session);}catch{}if(matches)controller.abort();}}
  override async dispose(){this.candidateStop.abort();await Promise.allSettled([...this.candidateWork]);await this.catalogue.dispose();await super.dispose();this.feeds.clear();this.videos.clear();this.regionIndices.clear();}
}
