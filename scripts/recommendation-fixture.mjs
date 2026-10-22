// Explicit test preload. Never imported by a normal service.
import {writeFileSync} from 'node:fs';
import {BilibiliCredentials} from '../dist/server/bilibili-credentials.js';
import {YoutubeMusicDiscovery} from '../dist/server/youtube-discovery.js';
const bv=n=>'BV'+String(n).padStart(10,'0');
const metrics={calls:0,active:0,peak:0,views:0,feed:0,youtubeCalls:0,youtubeActive:0,youtubePeak:0,catalogues:[]};
const publish=()=>{if(process.env.STAGE5_METRICS)writeFileSync(process.env.STAGE5_METRICS,JSON.stringify(metrics));};
const realFetch=globalThis.fetch;
BilibiliCredentials.prototype.open=async function(){if(process.env.STAGE5_ACCOUNT==='1')this.value={provider:'bilibili',revision:'fixture-account-v1',cookie:'SESSDATA=fixture-only'};return this;};
globalThis.fetch=async(input,options)=>{
 const url=new URL(typeof input==='string'||input instanceof URL?input:input.url);if(url.hostname!=='api.bilibili.com')return realFetch(input,options);
 metrics.calls++;metrics.active++;metrics.peak=Math.max(metrics.peak,metrics.active);publish();
 try{await new Promise((resolve,reject)=>{const timer=setTimeout(resolve,3);options?.signal?.addEventListener('abort',()=>{clearTimeout(timer);reject(options.signal.reason);},{once:true});});
  let data;
  const video=n=>({bvid:bv(n),title:'Music '+n,tid:process.env.STAGE5_SPARSE==='1'?17:31,tname:'',tid_v2:process.env.STAGE5_SPARSE==='1'?0:2027,tname_v2:'',owner:{mid:n%7,name:'Author '+n%7},pages:[{cid:1000+n,duration:60}],pic:'https://i1.hdslb.com/bfs/archive/fixture.jpg',pubdate:1791600000});
  if(url.pathname.endsWith('/nav'))data={isLogin:true,mid:1,uname:'Fixture account',wbi_img:{img_url:'https://i/'+ 'a'.repeat(32)+'.png',sub_url:'https://i/'+ 'b'.repeat(32)+'.png'}};
  else if(url.pathname.endsWith('/feed/rcmd')&&url.pathname.includes('/wbi/')){metrics.feed++;data={item:Array.from({length:process.env.STAGE5_SPARSE==='1'?20:30},(_,i)=>({goto:'av',id:metrics.feed*30+i,bvid:bv(metrics.feed*30+i),title:'Music '+i}))};}
  else if(url.pathname.endsWith('/view')){metrics.views++;data=video(Number(url.searchParams.get('bvid').slice(2)));}
  else if(url.pathname.endsWith('/region/feed/rcmd'))data={archives:Array.from({length:20},(_,i)=>video(100+i))};
  else if(url.pathname.endsWith('/new/music'))data={list:Array.from({length:1000},(_,i)=>video(200+i))};
  else if(url.pathname.endsWith('/all_period'))data={list:{2026:[{ID:439,priod:226,publish_time:1791540001},{ID:437,priod:225,publish_time:1790935200}]}};
  else if(url.pathname.endsWith('/music_list'))data={list:Array.from({length:100},(_,i)=>({music_title:'Chart Music '+i,singer:'Author '+i%7,mv_bvid:bv(300+i),mv_cover:'https://i1.hdslb.com/bfs/archive/fixture.jpg'}))};
  else throw new Error('Unexpected fixture operation '+url.pathname);
  return Response.json({code:0,data});
 }finally{metrics.active--;publish();}
};
const originalRead=YoutubeMusicDiscovery.prototype.read;
YoutubeMusicDiscovery.prototype.read=function(region,scope,signal,refresh){
 this.dependencies.catalogue=async region=>{metrics.catalogues.push(region);publish();return {contents:['Mando Flow','Canto Flow','The Hit List','RELEASED','J-Pop','K-Pop','Bollywood'].map((title,i)=>({lockupViewModel:{contentType:'LOCKUP_CONTENT_TYPE_PLAYLIST',contentId:'RDCLfixture_'+String(i).padStart(12,'0'),metadata:{lockupMetadataViewModel:{title:{content:title}}}}}))};};
 this.dependencies.list=async(request,options)=>{metrics.youtubeCalls++;metrics.youtubeActive++;metrics.youtubePeak=Math.max(metrics.youtubePeak,metrics.youtubeActive);publish();try{await new Promise((resolve,reject)=>{const timer=setTimeout(resolve,3);options.signal.addEventListener('abort',()=>{clearTimeout(timer);reject(options.signal.reason);},{once:true});});const block=Number(request.ref.id.slice(-12)),start=Number(request.cursor??0);return {items:Array.from({length:12},(_,i)=>{const id=String(block*1000+start+i).padStart(11,'0'),ref={provider:'youtube',kind:'video',id};return {ref,resourceId:'youtube:video:'+id,title:region+' Music '+(start+i),url:'https://youtube.com/watch?v='+id,uploader:{name:'Author '+i%5},artwork:'https://i.ytimg.com/vi/'+id+'/hqdefault.jpg'};}),nextCursor:String(start+12)};}finally{metrics.youtubeActive--;publish();}};
 return originalRead.call(this,region,scope,signal,refresh);
};
