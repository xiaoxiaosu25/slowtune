import { MusicSourceError, type Credential, type MusicHost } from '@studio/music-sources';
import { SongLibraryError as LibraryError } from './song-library-errors.js';
import type { BilibiliAccounts } from './bilibili-accounts.js';
import type { BilibiliCredentials } from './bilibili-credentials.js';
import type { BilibiliFolder } from './song-library-sync-types.js';

export interface FavoriteContext { accountId: string; credential: Credential; credentialRef?: string; signal: AbortSignal }
export interface FavoriteVideo { bvid: string; aid: string }
const numeric = (value: unknown) => /^(?:[1-9]\d{0,19})$/.test(String(value));
export class BilibiliFavorites {
  constructor(private host: MusicHost, private accounts: BilibiliAccounts, private credentials: BilibiliCredentials) {}
  async context(signal: AbortSignal): Promise<FavoriteContext> {
    const revision=this.credentials.revision;
    const status=await this.accounts.status(signal);
    if(status.state!=='authenticated')throw new MusicSourceError({code:'authentication',provider:'bilibili',retryable:false});
    const credential=await this.credentials.read(this.credentials.ref,signal);
    if(credential.revision!==revision||this.credentials.revision!==revision)throw new MusicSourceError({code:'cancelled',provider:'bilibili',retryable:false});
    return {accountId:status.account.id,credential,credentialRef:this.credentials.ref,signal};
  }
  check(c: FavoriteContext) {
    c.signal.throwIfAborted();
    if(this.credentials.revision!==c.credential.revision)throw new MusicSourceError({code:'cancelled',provider:'bilibili',retryable:false});
  }
  private async api(path: string, params: Record<string,string>, c: FavoriteContext, write=false): Promise<any> {
    this.check(c);
    const fields=new URLSearchParams(params);
    if(write) {
      const csrf=c.credential.cookie?.match(/(?:^|;\s*)bili_jct=([^;]+)/)?.[1];
      if(!csrf)throw new MusicSourceError({code:'authentication',provider:'bilibili',retryable:false});
      fields.set('csrf',csrf);
    }
    const signal=AbortSignal.any([c.signal,AbortSignal.timeout(15000)]);
    try {
      const response=await this.host.fetch('https://api.bilibili.com'+path+(write?'':'?'+fields),{
        method:write?'POST':'GET',redirect:'error',signal,
        headers:{'User-Agent':'Mozilla/5.0',Referer:'https://www.bilibili.com/',Cookie:c.credential.cookie??'',...(write?{'Content-Type':'application/x-www-form-urlencoded'}:{})},
        ...(write?{body:fields.toString()}:{})
      });
      if(!response.ok) {await response.body?.cancel();throw new MusicSourceError({code:response.status===429?'rate-limited':[403,412].includes(response.status)?'restricted':'upstream',provider:'bilibili',retryable:true});}
      const reader=response.body?.getReader();if(!reader)throw new Error('body');
      const chunks:Uint8Array[]=[];let size=0;
      try {while(true){signal.throwIfAborted();const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>2*1024*1024){await reader.cancel();throw new Error('size');}chunks.push(value);}}
      finally {reader.releaseLock();}
      const value=JSON.parse(Buffer.concat(chunks).toString('utf8'));
      this.check(c);
      if(value.code!==0)throw new MusicSourceError({code:[-101,-111].includes(value.code)?'authentication':[-403,-352,-412,-102].includes(value.code)?'restricted':value.code===-509?'rate-limited':[-404,11010,11201].includes(value.code)?'not-found':'upstream',provider:'bilibili',retryable:true,upstreamCode:typeof value.code==='number'?String(value.code):undefined});
      return value.data;
    } catch(error) {
      if(error instanceof MusicSourceError){if(error.code==='authentication')await this.accounts.expire(c.credential.revision);throw error;}
      throw new MusicSourceError({code:signal.aborted?signal.reason?.name==='TimeoutError'?'timeout':'cancelled':error instanceof TypeError?'network':'upstream',provider:'bilibili',retryable:true});
    }
  }
  async folders(c: FavoriteContext): Promise<BilibiliFolder[]> {
    const data=await this.api('/x/v3/fav/folder/created/list-all',{up_mid:c.accountId},c);
    if(!data || !Number.isInteger(data.count) || data.count<0 || data.count>1000 || !(Array.isArray(data.list)||data.count===0&&data.list===null))throw new MusicSourceError({code:'upstream',provider:'bilibili',retryable:true});
    const list:any[]=data.list??[];
    if(list.length!==data.count)throw new MusicSourceError({code:'upstream',provider:'bilibili',retryable:true});
    return list.map(row=>{
      if(!numeric(row.id)||String(row.mid)!==c.accountId||typeof row.title!=='string'||!Number.isInteger(row.media_count)||row.media_count<0)throw new MusicSourceError({code:'upstream',provider:'bilibili',retryable:true});
      return {id:String(row.id),title:row.title,count:row.media_count,private:!!(row.attr&1)};
    });
  }
  async videos(folder: string, c: FavoriteContext): Promise<FavoriteVideo[]> {
    const items=new Map<string,FavoriteVideo>();
    let total:number|undefined,read=0;
    for(let page=1;page<=500;page++) {
      const data=await this.api('/x/v3/fav/resource/list',{media_id:folder,pn:String(page),ps:'20',order:'mtime',type:'0',tid:'0',platform:'web'},c);
      if(!data?.info || String(data.info.id)!==folder || String(data.info.upper?.mid)!==c.accountId || ![true,false,0,1].includes(data.has_more) || !(Array.isArray(data.medias)||data.medias===null&&data.info.media_count===0))throw new MusicSourceError({code:'upstream',provider:'bilibili',retryable:true});
      const rows:any[]=data.medias??[];
      if(!Number.isInteger(data.info.media_count)||data.info.media_count<0||total!==undefined&&total!==data.info.media_count)throw new MusicSourceError({code:'upstream',provider:'bilibili',retryable:true});
      total=data.info.media_count;read+=rows.length;
      if(data.has_more&&!rows.length)throw new MusicSourceError({code:'upstream',provider:'bilibili',retryable:true});
      let added=0;
      for(const row of rows)if(row.type===2) {
        // Do not interpret malformed/unavailable IDs as remote deletions.
        if(!/^BV[0-9A-Za-z]{10}$/.test(row.bvid)||!numeric(row.id))throw new MusicSourceError({code:'upstream',provider:'bilibili',retryable:true});
        if(items.has(row.bvid))throw new MusicSourceError({code:'upstream',provider:'bilibili',retryable:true});
        added++;
        items.set(row.bvid,{bvid:row.bvid,aid:String(row.id)});
      }
      if(!data.has_more){if(read!==total)throw new MusicSourceError({code:'upstream',provider:'bilibili',retryable:true});return [...items.values()];}
      if(!added&&rows.every(row=>row.type===2))throw new MusicSourceError({code:'upstream',provider:'bilibili',retryable:true});
    }
    throw new MusicSourceError({code:'upstream',provider:'bilibili',retryable:true});
  }
  async createFolder(title: string, privateFolder: boolean, c: FavoriteContext): Promise<BilibiliFolder> {
    if(!title.trim()||[...title].length>20||typeof privateFolder!=='boolean')throw new LibraryError('invalid-input');
    const data=await this.api('/x/v3/fav/folder/add',{title:title.trim(),privacy:privateFolder?'1':'0'},c,true);
    if(!numeric(data?.id)||String(data.mid)!==c.accountId||typeof data.title!=='string'||!Number.isInteger(data.media_count)||data.media_count<0||typeof data.attr!=='number'||!!(data.attr&1)!==privateFolder)throw new MusicSourceError({code:'upstream',provider:'bilibili',retryable:false});
    return {id:String(data.id),title:data.title,count:data.media_count,private:!!(data.attr&1)};
  }
  async aid(bvid: string, c: FavoriteContext): Promise<string> {
    const data=await this.api('/x/web-interface/view',{bvid},c);
    if(data?.bvid!==bvid||!numeric(data.aid))throw new MusicSourceError({code:'upstream',provider:'bilibili',retryable:true});
    return String(data.aid);
  }
  async change(folder: string, aid: string, add: boolean, c: FavoriteContext) {
    if(!numeric(folder)||!numeric(aid))throw new LibraryError('invalid-input');
    await this.api('/x/v3/fav/resource/deal',{rid:aid,type:'2',[add?'add_media_ids':'del_media_ids']:folder,platform:'web'},c,true);
  }
}
