import {readFile} from 'node:fs/promises';
const original=globalThis.fetch,real=process.env.MUSIC_APP_SOURCE_BASELINE_MODE==='real';
const quality=process.env.MUSIC_APP_SOURCE_QUALITY_FIXTURE==='1';
const audio=real?null:new Uint8Array(await readFile(process.env.MUSIC_APP_SOURCE_BASELINE_AUDIO));
let state={scenario:'healthy',serial:0,events:[],mediaBytes:0},serial=0,active=0,bodies=0;
const classify=url=>url.hostname.endsWith('.bilivideo.com')||url.hostname.endsWith('.bilivideo.cn')||url.hostname.endsWith('.bilivideo.net')?'media':url.pathname.includes('playurl')?'playurl':url.pathname.endsWith('/view')?'view':url.pathname.includes('search/type')?'search':url.pathname.endsWith('/nav')?'nav':url.pathname.endsWith('/spi')?'visitor':'other';
const allowed=new Set(['/x/web-interface/view','/x/web-interface/nav','/x/player/wbi/playurl','/x/frontend/finger/spi','/x/web-interface/search/type']);
const bvid='BV1000000001',title='基线测试歌曲 基线歌手';
const hang=signal=>new Promise((_,reject)=>{const abort=()=>reject(signal.reason);signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort();});
const json=data=>Response.json({code:0,data});
function observedBody(response,fact,signal,scope){
  if(!response.body)return response;
  const reader=response.body.getReader();let finished=false;bodies++;
  const finish=()=>{if(!finished){finished=true;bodies--;signal?.removeEventListener('abort',abort);}};
  const abort=()=>{void reader.cancel().catch(()=>{}).finally(finish);};signal?.addEventListener('abort',abort,{once:true});
  return new Response(new ReadableStream({async pull(controller){try{const part=await reader.read();if(part.done){controller.close();finish();return;}if(part.value.length){fact.firstBodyAt??=Date.now();fact.bytes+=part.value.length;if(real&&fact.kind==='media'){scope.mediaBytes+=part.value.length;if(scope.mediaBytes>4*1024*1024){fact.error='observation-budget';await reader.cancel();throw Error('Controlled media observation budget');}}}controller.enqueue(part.value);}catch(error){fact.error??=signal?.aborted?'cancelled':'network';controller.error(error);finish();}},async cancel(){await reader.cancel().catch(()=>{});finish();}},{highWaterMark:0}),{status:response.status,headers:response.headers});
}
globalThis.fetch=async(input,init={})=>{
  const url=new URL(typeof input==='string'||input instanceof URL?input:input.url),kind=classify(url),scope=state;
  const fact={id:++serial,case:scope.serial,kind,at:Date.now(),headersAt:null,firstBodyAt:null,status:null,bytes:0,error:null,slot:kind==='media'?(url.hostname.startsWith('backup.')?'backup':'primary'):null,probe:kind==='media'?new Headers(init.headers).get('range')==='bytes=0-1023':null};
  if(quality&&kind==='media')fact.formatId=/\/format\/(\d+)/.exec(url.pathname)?.[1]??null;
  if(scope.events.length<2000)scope.events.push(fact);active++;
  try{
    if(quality&&kind==='playurl'&&scope.scenario==='quality-prepare-hang')return await hang(init.signal);
    if(quality&&kind==='playurl'&&scope.scenario==='quality-prepare-delay')await new Promise((done,reject)=>{const timer=setTimeout(()=>{init.signal.removeEventListener('abort',abort);done();},250);const abort=()=>{clearTimeout(timer);reject(init.signal.reason);};init.signal.addEventListener('abort',abort,{once:true});if(init.signal.aborted)abort();});
    let response;
    if(real){
      if(kind!=='media'&&!(url.hostname==='api.bilibili.com'&&allowed.has(url.pathname)))response=new Response(null,{status:503});
      else response=await original(input,{...init,signal:AbortSignal.any([AbortSignal.timeout(20000),...(init.signal?[init.signal]:[])])});
    }else if(url.hostname==='passport.bilibili.com'&&url.pathname.endsWith('/qrcode/generate'))response=json({url:'https://passport.bilibili.com/synthetic-baseline',qrcode_key:'synthetic-key'});
    else if(url.hostname==='passport.bilibili.com'&&url.pathname.endsWith('/qrcode/poll')){response=json({code:0});response.headers.append('Set-Cookie','SESSDATA=synthetic-baseline-session; Path=/');response.headers.append('Set-Cookie','bili_jct=synthetic-baseline-csrf; Path=/');}
    else if(kind==='media'){
      const selected=scope.scenario,applies=fact.slot==='primary'&&(selected.startsWith('probe-')?fact.probe:!fact.probe);
      if(applies&&selected.endsWith('headers-hang'))return await hang(init.signal);
      const denied=applies&&/http-?(\d+)$/.exec(selected);
      if(denied)response=new Response(null,{status:Number(denied[1]),headers:Number(denied[1])===429?{'Retry-After':'2'}:{}});
      else{
        const range=new Headers(init.headers).get('range'),match=/^bytes=(\d+)-(\d*)$/.exec(range??''),start=Number(match?.[1]??0),end=match?.[2]?Math.min(Number(match[2]),audio.length-1):audio.length-1;
        if(start>=audio.length)response=new Response(null,{status:416,headers:{'Content-Range':`bytes */${audio.length}`}});
        else{
          const headers={'Content-Type':quality?'audio/mp4':'audio/webm','Content-Length':String(end-start+1),'Accept-Ranges':'bytes',...(range?{'Content-Range':`bytes ${applies&&selected.endsWith('bad-range')?start+1:start}-${end}/${audio.length}`}:{})};
          let body=audio.slice(start,end+1);
          if(applies&&selected==='probe-html'){
            headers['Content-Type']='text/html';
            body=new TextEncoder().encode('<html>'.padEnd(end-start+1,' '));
          }
          if(applies&&selected.endsWith('body-hang'))body=new ReadableStream({start(controller){const abort=()=>controller.error(init.signal.reason);init.signal.addEventListener('abort',abort,{once:true});if(init.signal.aborted)abort();}});
          if(applies&&selected.endsWith('truncated'))body=body.slice(0,20);
          response=new Response(body,{status:range?206:200,headers});
        }
      }
    }else if(kind==='view')response=json({bvid,aid:10001,cid:901,title,tid:130,tname:'音乐',owner:{mid:123,name:'基线歌手'},duration:4,pages:[{cid:901,part:'完整',duration:4},{cid:902,part:'第二段',duration:4}]});
    else if(kind==='playurl')response=json({dash:{audio:quality?[[30280,192000],[30232,128000],[30216,64000]].map(([id,bandwidth])=>({id,codecs:'mp4a.40.2',mimeType:'audio/mp4',bandwidth,audioSamplingRate:48000,channels:2,baseUrl:`https://primary.case${scope.serial}.bilivideo.com/format/${id}/fixture.m4a`,backupUrl:[`https://backup.case${scope.serial}.bilivideo.com/format/${id}/fixture.m4a`]})):[{id:30280,codecs:'opus',mimeType:'audio/webm',bandwidth:96000,baseUrl:`https://primary.case${scope.serial}.bilivideo.com/fixture.webm`,backupUrl:[`https://backup.case${scope.serial}.bilivideo.com/fixture.webm`]}]}});
    else if(kind==='nav')response=json({isLogin:new Headers(init.headers).get('Cookie')?.includes('SESSDATA=synthetic-baseline-session')??false,mid:123,uname:'基线账号',wbi_img:{img_url:'https://i.example/0123456789abcdef0123456789abcdef.png',sub_url:'https://i.example/abcdef0123456789abcdef0123456789.png'}});
    else if(kind==='visitor')response=json({b_3:'synthetic-visitor',b_4:'synthetic-visitor-four'});
    else if(kind==='search')response=json({numPages:1,result:[{bvid,title,author:'基线歌手',duration:'0:04',type:'video',typeid:'130'}]});
    else response=new Response(null,{status:503});
    fact.status=response.status;fact.headersAt=Date.now();return observedBody(response,fact,init.signal,scope);
  }catch(error){fact.error=init.signal?.aborted?'cancelled':error?.name==='TimeoutError'?'timeout':'network';throw error;}finally{active--;}
};
process.on('message',message=>{
  if(message.type==='set'){state={scenario:message.scenario,serial:message.serial,events:[],mediaBytes:0};process.send({id:message.id,result:{ok:true}});}
  if(message.type==='snapshot')process.send({id:message.id,result:{events:state.events,activeFetches:active,openBodies:bodies}});
  if(message.type==='change'){state.scenario=message.scenario;process.send({id:message.id,result:{ok:true}});}
});
