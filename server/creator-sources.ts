import { Innertube } from 'youtubei.js';
import { randomUUID } from 'node:crypto';
import { MusicSourceError, type MusicHost, type MusicEntry } from '@studio/music-sources';
import { signWbi, wbiMixinKey } from '@studio/music-sources/bilibili';
import { bilibiliCatalogueEntry, cleanCatalogueText } from '@studio/music-sources/discovery';
import { SongLibraryError as LibraryError } from './song-library-errors.js';
import { artworkUrl } from './artwork-url.js';
import { validateCreator } from './follow-store.js';
import { creatorKey, type CreatorRef, type CreatorProfile, type CreatorCollection, type CreatorCollections, type CreatorVideos } from './follow-types.js';

const rows = (value: unknown): any[] => Array.isArray(value) ? value : [];
const seconds = (value: unknown) => typeof value === 'number' && value > 0 ? value * 1000 : undefined;
const pageNumber = (cursor?: string) => { if (cursor !== undefined && !/^[1-9]\d{0,3}$/.test(cursor)) throw new LibraryError('invalid-input'); return Number(cursor ?? 1); };
function sourceError(error: unknown, provider: CreatorRef['provider'], signal: AbortSignal): MusicSourceError {
  if (error instanceof MusicSourceError) return error;
  return new MusicSourceError({ code: signal.aborted ? signal.reason?.name === 'TimeoutError' ? 'timeout' : 'cancelled' : /fetch|network|connect/i.test(String(error)) ? 'network' : 'upstream', provider, retryable: true });
}
function xmlText(text: string) {
  return text.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g,'$1').replace(/&#(x[\da-f]+|\d+);/gi,(_,n:string) => {
    const value = n[0].toLowerCase() === 'x' ? parseInt(n.slice(1),16) : Number(n);
    return value > 0 && value <= 0x10ffff ? String.fromCodePoint(value) : '';
  }).replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&apos;/g,"'").replace(/&amp;/g,'&');
}
export function parseYoutubeUpdates(xml: string, creator: CreatorProfile): MusicEntry[] {
  if (!/<feed\b/.test(xml)) throw new MusicSourceError({code:'upstream',provider:'youtube',retryable:true});
  const text = (entry: string, tag: string) => xmlText(entry.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`))?.[1] ?? '');
  return [...xml.matchAll(/<entry\b[^>]*>([\s\S]*?)<\/entry>/g)].flatMap(match => {
    const entry=match[1],id=text(entry,'yt:videoId'),channel=text(entry,'yt:channelId'),title=text(entry,'title');
    if (!/^[\w-]{11}$/.test(id) || channel !== creator.id || !title) return [];
    const publishedAt=Date.parse(text(entry,'published'));
    const ref={provider:'youtube' as const,kind:'video' as const,id};
    return [{ref,resourceId:`youtube:video:${id}`,title,url:`https://www.youtube.com/watch?v=${id}`,
      artwork:artworkUrl(xmlText(entry.match(/<media:thumbnail\b[^>]*\burl="([^"]+)"/)?.[1] ?? '')),
      uploader:{id:creator.id,name:text(entry,'name') || creator.name},...(Number.isFinite(publishedAt)?{publishedAt}:{})}];
  });
}

interface YoutubeCursor { binding: string; until: number; context: {signal: AbortSignal}; feed: any; busy: boolean }
export class CreatorSources {
  private signing?: { key: string; until: number };
  private cursors = new Map<string,YoutubeCursor>();
  constructor(private host: MusicHost, private cookie: (signal: AbortSignal) => Promise<string | undefined>) {}

  private async text(response: Response, signal: AbortSignal) {
    if (!response.ok) { await response.body?.cancel(); throw new MusicSourceError({code:response.status===429?'rate-limited':[403,412].includes(response.status)?'restricted':response.status===404?'not-found':'upstream',retryable:true}); }
    const reader=response.body?.getReader(); if(!reader)throw new MusicSourceError({code:'upstream',retryable:true});
    let size=0;const chunks:Uint8Array[]=[];
    try { while(true) { signal.throwIfAborted();const result=await reader.read();if(result.done)break;size+=result.value.length;if(size>2*1024*1024){await reader.cancel();throw new MusicSourceError({code:'upstream',retryable:true});}chunks.push(result.value); } }
    finally {reader.releaseLock();}
    return Buffer.concat(chunks).toString('utf8');
  }
  private async bili(path: string, params: Record<string,string>, signal: AbortSignal, signed=false): Promise<any> {
    const headers:Record<string,string>={'User-Agent':'Mozilla/5.0',Referer:`https://space.bilibili.com/${params.mid ?? ''}`};
    const cookie=await this.cookie(signal);if(cookie)headers.Cookie=cookie;
    if (signed && !/(?:^|;\s*)buvid3=/.test(headers.Cookie ?? '')) {
      const visitor=JSON.parse(await this.text(await this.host.fetch('https://api.bilibili.com/x/frontend/finger/spi',{headers,signal,redirect:'error'}),signal));
      if(visitor.code===0&&typeof visitor.data?.b_3==='string'&&!/[;\r\n]/.test(visitor.data.b_3))headers.Cookie=[cookie,`buvid3=${visitor.data.b_3}`].filter(Boolean).join('; ');
    }
    let query=new URLSearchParams(params).toString();
    if(signed) {
      if(!this.host.md5)throw new MusicSourceError({code:'unsupported',provider:'bilibili',retryable:false});
      if(!this.signing || this.signing.until<=this.host.now()) {
        const nav=JSON.parse(await this.text(await this.host.fetch('https://api.bilibili.com/x/web-interface/nav',{headers,signal,redirect:'error'}),signal));
        const images=nav.data?.wbi_img;
        if(typeof images?.img_url!=='string'||typeof images?.sub_url!=='string')throw new MusicSourceError({code:'upstream',provider:'bilibili',retryable:true});
        this.signing={key:wbiMixinKey(images.img_url,images.sub_url),until:this.host.now()+3600000};
      }
      query=await signWbi(params,this.signing.key,this.host.now(),this.host.md5);
    }
    const value=JSON.parse(await this.text(await this.host.fetch('https://api.bilibili.com'+path+'?'+query,{headers,signal,redirect:'error'}),signal));
    signal.throwIfAborted();
    if(value.code!==0 || value.data?.v_voucher) {
      if(signed)this.signing=undefined;
      throw new MusicSourceError({code:value.code===-101?'authentication':[-403,-352,-412,-10403].includes(value.code)||value.data?.v_voucher?'restricted':value.code===-509?'rate-limited':[-404,62002].includes(value.code)?'not-found':'upstream',provider:'bilibili',retryable:true});
    }
    if(!value.data || typeof value.data!=='object')throw new MusicSourceError({code:'upstream',provider:'bilibili',retryable:true});return value.data;
  }
  private async youtube(context: {signal:AbortSignal}) {
    return Innertube.create({lang:'zh-CN',location:'HK',retrieve_player:false,enable_session_cache:false,
      fetch:(input,options) => this.host.fetch(input,{...options,signal:context.signal,redirect:'error'})});
  }
  async profile(input: CreatorRef | string, signal: AbortSignal): Promise<CreatorProfile> {
    let ref: CreatorRef | undefined, youtubeUrl: string | undefined;
    if(typeof input==='string') {
      if(/^[1-9]\d{0,19}$/.test(input.trim()))ref={provider:'bilibili',id:input.trim()};
      else {
        let url:URL;try{url=new URL(input.trim());}catch{throw new LibraryError('invalid-input');}
        if(!['https:','http:'].includes(url.protocol)||url.username||url.password||url.port)throw new LibraryError('invalid-input');
        const mid=url.pathname.match(/^\/(\d+)\/?$/);
        if(url.hostname==='space.bilibili.com'&&mid)ref=validateCreator({provider:'bilibili',id:mid[1]});
        else if(['www.youtube.com','youtube.com','m.youtube.com'].includes(url.hostname)&&/^\/(?:channel\/UC[\w-]{22}|@[^/]+)\/?$/.test(url.pathname))youtubeUrl='https://www.youtube.com'+url.pathname;
        else throw new LibraryError('invalid-input');
      }
    } else ref=validateCreator(input);
    const provider=ref?.provider ?? 'youtube';
    try {
      if(ref?.provider==='bilibili') {
        let data:any;
        try {data=await this.bili('/x/space/wbi/acc/info',{mid:ref.id},signal,true);}
        catch(error) {signal.throwIfAborted();if(error instanceof MusicSourceError&&['restricted','upstream','authentication'].includes(error.code))data=(await this.bili('/x/web-interface/card',{mid:ref.id},signal)).card;else throw error;}
        if(String(data?.mid)!==ref.id||typeof data.name!=='string'||!data.name.trim())throw new MusicSourceError({code:'upstream',provider,retryable:true});
        return {...ref,name:data.name,url:`https://space.bilibili.com/${ref.id}`,artwork:artworkUrl(data.face)};
      }
      const client=await this.youtube({signal});
      const id=ref?.id ?? (await client.resolveURL(youtubeUrl!)).payload.browseId;
      ref=validateCreator({provider:'youtube',id});
      const channel=await client.getChannel(ref.id),name=channel.metadata.title;
      if(!name)throw new MusicSourceError({code:'upstream',provider,retryable:true});
      return {...ref,name,url:`https://www.youtube.com/channel/${ref.id}`,artwork:artworkUrl((channel.metadata.avatar ?? channel.metadata.thumbnail)?.at(-1)?.url)};
    } catch(error) { if(error instanceof LibraryError)throw error;throw sourceError(error,provider,signal); }
  }
  private mapVideos(data: any[], creator: CreatorProfile): MusicEntry[] {
    return data.filter(row=>/^BV[\w]{10}$/.test(row.bvid)).map(row=>bilibiliCatalogueEntry({...row,pubdate:row.pubdate ?? row.created,duration:row.duration ?? row.length,
      author:{mid:creator.id,name:creator.name}}));
  }
  async videos(creator: CreatorProfile, signal: AbortSignal, cursor?: string): Promise<CreatorVideos> {
    try {
      if(creator.provider==='youtube') {
        if(cursor)throw new LibraryError('invalid-input');
        const xml=await this.text(await this.host.fetch(`https://www.youtube.com/feeds/videos.xml?channel_id=${creator.id}`,{signal,redirect:'error'}),signal);
        return {items:parseYoutubeUpdates(xml,creator)};
      }
      const page=pageNumber(cursor),data=await this.bili('/x/space/wbi/arc/search',{mid:creator.id,pn:String(page),ps:'30',order:'pubdate',platform:'web',web_location:'333.1387'},signal,true);
      if(!Array.isArray(data.list?.vlist))throw new MusicSourceError({code:'upstream',provider:'bilibili',retryable:true});
      const total=Number(data.page?.count);
      return {items:this.mapVideos(data.list.vlist,creator),...(Number.isSafeInteger(total)&&total>=0?{total}:{}),...(page*30<total?{cursor:String(page+1)}:{})};
    } catch(error) {if(error instanceof LibraryError)throw error;throw sourceError(error,creator.provider,signal);}
  }
  async collections(creator: CreatorProfile, owner: string, signal: AbortSignal, cursor?: string): Promise<CreatorCollections> {
    try {
      if(creator.provider==='bilibili') {
        const page=pageNumber(cursor),data=await this.bili('/x/polymer/web-space/seasons_series_list',{mid:creator.id,page_num:String(page),page_size:'20'},signal);
        const lists=data.items_lists;if(!lists||!Array.isArray(lists.seasons_list)||!Array.isArray(lists.series_list))throw new MusicSourceError({code:'upstream',provider:'bilibili',retryable:true});
        const items:CreatorCollection[]=[];
        for(const [kind,entries] of [['season',lists.seasons_list],['series',lists.series_list]] as const) for(const entry of entries) {
          const meta=entry.meta,id=String(kind==='season'?meta?.season_id:meta?.series_id);
          if(!/^[1-9]\d*$/.test(id)||String(meta?.mid)!==creator.id||!meta?.name)continue;
          items.push({id:`${kind}:${creator.id}:${id}`,kind,title:cleanCatalogueText(meta.name),artwork:artworkUrl(meta.cover ?? entry.archives?.[0]?.pic),count:typeof meta.total==='number'?meta.total:undefined,
            url:`https://space.bilibili.com/${creator.id}/lists/${id}?type=${kind}`,ref:kind==='season'?{provider:'bilibili',kind:'playlist',id:`season:${creator.id}:${id}`} : undefined});
        }
        return {items,...(page*20<Number(lists.page?.total)?{cursor:String(page+1)}:{})};
      }
      const binding=`${owner}:${creatorKey(creator)}`;
      for(const [key,state] of this.cursors)if(state.until<this.host.now())this.cursors.delete(key);
      let state:YoutubeCursor,feed:any;
      if(cursor) {
        const saved=this.cursors.get(cursor);if(!saved||saved.binding!==binding)throw new MusicSourceError({code:'stale-cursor',provider:'youtube',retryable:true});
        if(saved.busy)throw new MusicSourceError({code:'busy',provider:'youtube',retryable:true});state=saved;state.context.signal=signal;state.busy=true;
        try{feed=await state.feed.getContinuation();}finally{state.busy=false;}
      } else {
        const context={signal},client=await this.youtube(context),channel=await client.getChannel(creator.id);
        if(!channel.has_playlists)return {items:[]};feed=await channel.getPlaylists();state={binding,until:this.host.now()+600000,context,feed,busy:false};
      }
      const items:CreatorCollection[]=rows(feed.playlists).flatMap(node=>{
        const id=node.content_id ?? node.id,title=cleanCatalogueText(String(node.metadata?.title ?? node.title ?? ''));
        if(typeof id!=='string'||!/^([\w-]{10,150})$/.test(id)||!title)return [];
        return [{id,kind:'playlist' as const,title,url:`https://www.youtube.com/playlist?list=${encodeURIComponent(id)}`,artwork:artworkUrl((node.thumbnails ?? node.content_image?.image)?.at(-1)?.url),ref:{provider:'youtube' as const,kind:'playlist' as const,id}}];
      });
      signal.throwIfAborted();if(cursor)this.cursors.delete(cursor);
      if(!feed.has_continuation)return {items};
      if(this.cursors.size>=64)this.cursors.delete(this.cursors.keys().next().value!);
      const next=randomUUID();this.cursors.set(next,{...state,feed,until:this.host.now()+600000});return {items,cursor:next};
    } catch(error) {if(error instanceof LibraryError)throw error;throw sourceError(error,creator.provider,signal);}
  }
  async collectionVideos(creator: CreatorProfile, collection: string, signal: AbortSignal, cursor?: string): Promise<CreatorVideos> {
    const match=collection.match(/^(season|series):([1-9]\d*):([1-9]\d*)$/);
    if(creator.provider!=='bilibili'||!match||match[2]!==creator.id)throw new LibraryError('invalid-input');
    try {
      const page=pageNumber(cursor);let data:any,total:number;
      if(match[1]==='season') {
        data=await this.bili('/x/polymer/web-space/seasons_archives_list',{mid:creator.id,season_id:match[3],page_num:String(page),page_size:'30',sort_reverse:'false'},signal);
        if(String(data.meta?.mid)!==creator.id)throw new LibraryError('invalid-input');total=Number(data.page?.total);
      } else {
        const info=await this.bili('/x/series/series',{series_id:match[3]},signal);
        if(String(info.meta?.mid)!==creator.id)throw new LibraryError('invalid-input');
        data=await this.bili('/x/series/archives',{mid:creator.id,series_id:match[3],pn:String(page),ps:'30',only_normal:'true',sort:'asc'},signal);total=Number(data.page?.total);
      }
      if(!Array.isArray(data.archives))throw new MusicSourceError({code:'upstream',provider:'bilibili',retryable:true});
      return {items:this.mapVideos(data.archives,creator),...(Number.isSafeInteger(total)&&total>=0?{total}:{}),...(page*30<total?{cursor:String(page+1)}:{})};
    } catch(error) {if(error instanceof LibraryError)throw error;throw sourceError(error,creator.provider,signal);}
  }
  cancelOwner(owner?:string) {for(const [id,cursor] of this.cursors)if(!owner||cursor.binding.startsWith(owner+':'))this.cursors.delete(id);}
}
