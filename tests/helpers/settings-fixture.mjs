import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fromMusicRef } from './song-fixture.mjs';
import {installSearchFixture} from './search-fixture.mjs';

export async function createSettingsFixture(buildRoot = resolve(process.env.MUSIC_APP_TEST_BUILD ?? '.'),searchOptions={}) {
  const track = {ref:{provider:'bilibili',kind:'video',id:'BV1tX4y1W7Xm',part:'900'},resourceId:'settings-queue-track',title:'界面验证音轨',durationSeconds:8,url:'https://www.bilibili.com/video/BV1tX4y1W7Xm'};
  const ref = fromMusicRef(track.ref);
  const audio=Buffer.alloc(44+16000*8*2);audio.write('RIFF');audio.writeUInt32LE(audio.length-8,4);audio.write('WAVEfmt ',8);audio.writeUInt32LE(16,16);audio.writeUInt16LE(1,20);audio.writeUInt16LE(1,22);audio.writeUInt32LE(16000,24);audio.writeUInt32LE(32000,28);audio.writeUInt16LE(2,32);audio.writeUInt16LE(16,34);audio.write('data',36);audio.writeUInt32LE(audio.length-44,40);
  const state = {
    failStatus:false, failNotices:false, failImport:false, failLogout:false, authenticated:true, imports:[], statusCalls:0, libraryReads:0, noticeReads:0,
    snapshot:{playlists:[{id:'original',name:'原有歌单',createdAt:1,updatedAt:1,entries:[{id:'original-track',ref,metadata:{title:'原有音乐'},availability:{state:'unknown'},addedAt:1}]}],favorites:[]},
    revision:1,searchItems:[],searchPage2:[],searchQueries:[],chartItems:[],unavailable:undefined,preparations:[],prepareRequests:[],audioFormats:undefined,rejectedAudioFormats:[],
  };
  const sourceState = {revision:'source-1',sequence:1,youtube:{enabled:false,available:false,checking:false,disabledDisplay:'dim',issue:'YouTube 已关闭'}};
  const streams = new Set();
  const staticRoot = resolve(buildRoot,'dist/client');
  const server = createServer(async(req,res) => {
    res.setHeader('Content-Security-Policy',"default-src 'self'; img-src 'self' https: data:; media-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self'; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'");
    const url = new URL(req.url,'http://127.0.0.1');
    const json = (value,status=200) => {res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(value));};
    if (['/api/bootstrap','/api/settings/welcome','/api/settings/access'].includes(url.pathname)) return json({...((await import('./startup-fixture.mjs')).startupFixture(url.pathname)),...(url.pathname==='/api/bootstrap'?{authenticated:state.authenticated}:{})});
    if (url.pathname === '/api/status') {
      state.statusCalls++;
      return state.failStatus ? json({error:{code:'network'}},503) : json({version:'fixture',node:process.version,sourceSettings:sourceState,providers:{bilibili:{available:true},youtube:sourceState.youtube},delivery:{leases:2,activeReads:1},tool:{active:0},build:{startedAt:1,stale:false,changed:[],started:{server:1,client:1},current:{server:1,client:1}}});
    }
    if(url.pathname==='/api/settings/sources/events') {res.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-cache'});streams.add(res);res.write('event: sources\ndata: '+JSON.stringify(sourceState)+'\n\n');req.on('close',()=>streams.delete(res));return;}
    if(url.pathname==='/api/settings/sources')return json(sourceState);
    if(url.pathname==='/api/bilibili/account')return json({state:'anonymous'});
    if(url.pathname==='/api/bilibili/cancel')return json({cancelled:true});
    if(url.pathname==='/api/follows')return json({revision:'f1',creators:[]});
    if(url.pathname==='/api/charts')return json({source:'netease',chart:'hot',title:'搜索匹配验证榜单',items:state.chartItems,fetchedAt:Date.now(),sourceUrl:'https://example.com'});
    if(url.pathname==='/api/discovery/bilibili')return json([]);
    if(url.pathname==='/api/recommendation/confirm')return json({accepted:true,count:0});
    if(url.pathname==='/api/logout'){if(state.failLogout)return json({error:{code:'network'}},503);state.authenticated=false;return json({ok:true});}
    if(url.pathname==='/v1/handshake')return json({protocol:2,capabilities:[{provider:'bilibili',operations:['metadata','search','prepare',...(state.audioFormats?['formats']:[])],anonymous:true,limitations:[]}]});
    if(url.pathname==='/v1/call/formats')return json({protocol:2,result:state.audioFormats??[]});
    if(url.pathname==='/v1/call/search'){
      let text='';for await(const chunk of req)text+=chunk;const input=JSON.parse(text);state.searchQueries.push(input);
      return json({protocol:2,result:{items:input.request.cursor?state.searchPage2:state.searchItems,...(!input.request.cursor&&state.searchPage2.length?{nextCursor:'next'}:{})}});
    }
    if(url.pathname==='/v1/call/metadata'||url.pathname==='/v1/call/prepare'){
      let text='';for await(const chunk of req)text+=chunk;const input=JSON.parse(text),requested=input.ref??input.request.ref;
      if(requested.id===state.unavailable)return json({protocol:2,error:{code:'not-found',provider:requested.provider,retryable:false}},400);
      const video=[...state.searchItems,...state.searchPage2].find(item=>item.ref.id===requested.id)??track;
      const entry=requested.part?video.parts?.find(part=>part.ref.part===requested.part)??video:video;
      if(url.pathname.endsWith('/metadata'))return json({protocol:2,result:{...entry,parts:video.parts??[entry]}});
      state.preparations.push(entry.ref);
      state.prepareRequests.push(input.request);
      const format=state.audioFormats?.find(format=>format.id===input.request.formatId)??{id:'wav',codec:'pcm',mimeType:'audio/wav',container:'wav'};
      return json({protocol:2,result:{entry,resourceId:entry.resourceId,format,delivery:{url:'http://'+req.headers.host+'/settings-test.wav'+(state.audioFormats?'?format='+encodeURIComponent(format.id):''),requiresHost:false}}});
    }
    if(url.pathname==='/settings-test.wav'){if(state.rejectedAudioFormats.includes(url.searchParams.get('format'))){res.writeHead(403);return res.end();}res.writeHead(200,{'Content-Type':'audio/wav','Content-Length':audio.length});return res.end(audio);}
    if(url.pathname==='/legal/notices.json'){state.noticeReads++;if(state.failNotices)return json({error:'fixture failure'},503);}
    if(url.pathname.startsWith('/api/')||url.pathname.startsWith('/v1/'))return json({error:{code:'not-found'}},404);
    try {
      const file=resolve(staticRoot,'.'+decodeURIComponent(url.pathname==='/'?'/index.html':url.pathname));
      if(!file.startsWith(staticRoot+sep))throw Error('path');
      res.setHeader('Content-Type',({'.html':'text/html; charset=utf-8','.js':'text/javascript','.css':'text/css','.json':'application/json','.txt':'text/plain; charset=utf-8','.png':'image/png','.woff2':'font/woff2'})[extname(file)]??'application/octet-stream');
      res.end(readFileSync(file));
    }catch{res.writeHead(404);res.end();}
  });
  const searchFixture=installSearchFixture(server,{youtubeAvailable:()=>false,librarySeed:()=>state.snapshot,onLibraryRead:()=>state.libraryReads++,beforeLibraryWrite:(path,input)=>{if(path.endsWith('/commit'))state.imports.push(input);return state.failImport&&path.endsWith('/commit')?{code:'conflict'}:undefined;},...searchOptions});
  await new Promise(done=>server.listen(0,'127.0.0.1',done));
  return {base:'http://127.0.0.1:'+server.address().port,state,track,searchStore:searchFixture.store,libraryFixture:searchFixture.libraryFixture,close:async()=>{for(const stream of streams)stream.end();server.closeAllConnections();await new Promise(done=>server.close(done));}};
}

if(process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const fixture=await createSettingsFixture();
  console.log(JSON.stringify({base:fixture.base,kind:'isolated settings UI fixture'}));
}
