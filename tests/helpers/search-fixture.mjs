import {resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {MusicSourceError} from '@studio/music-sources';
import {installSongFixture} from './song-fixture.mjs';

const root=resolve(process.env.MUSIC_APP_TEST_BUILD??'.');
const {SearchSettingsStore}=await import(pathToFileURL(join(root,'dist/server/search-settings.js')));
const {MusicSearch}=await import(pathToFileURL(join(root,'dist/server/music-search.js')));

// Exercise the real product resolver against each browser fixture's existing source I/O.
export function installSearchFixture(server,{strictMatch=false,config,partition=()=>({tid_v2:2024}),youtubeAvailable=()=>true,librarySeed,beforeLibraryWrite,onLibraryRead,verifyPlayback}={}){
  const store=new SearchSettingsStore(':memory:','browser-fixture'),initial=store.read();
  // Older playback fixtures use arbitrary titles (e.g. 键盘点播 contains 盘点).
  // Dedicated search tests retain the real strict/default policy.
  store.saveConfig(initial.revision,config??{...initial.config,strictMatch,...(!strictMatch?{excludeTerms:[]}: {})});
  const originals=server.listeners('request');server.removeAllListeners('request');
  const call=async(operation,input,signal)=>{
    const response=await fetch('http://127.0.0.1:'+server.address().port+'/v1/call/'+operation,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({protocol:2,...input}),signal});
    const data=await response.json();if(data.error)throw new MusicSourceError(data.error);return data.result;
  };
  const service=new MusicSearch(store,{search:(provider,request,{signal})=>call('search',{provider,request},signal),metadata:(ref,{signal})=>call('metadata',{ref},signal)},partition,youtubeAvailable,()=> 'fixture',Date.now,verifyPlayback);
  server.on('request',async(req,res)=>{
    const path=new URL(req.url,'http://localhost').pathname;
    if(!['/api/search','/api/search/resolve','/api/settings/search'].includes(path))return originals.forEach(listener=>listener.call(server,req,res));
    const controller=new AbortController();res.on('close',()=>{if(!res.writableEnded)controller.abort();});
    const json=(value,status=200)=>{if(!res.destroyed){res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(value));}};
    try{
      if(path==='/api/settings/search'&&req.method==='GET')return json(store.read());
      let body='';for await(const chunk of req)body+=chunk;const input=JSON.parse(body);
      if(path==='/api/search')return json(await service.search(input,controller.signal));
      if(path==='/api/search/resolve')return json({entry:await service.resolve(input,controller.signal)});
      if(input.action==='config')return json(store.saveConfig(input.revision,input.config));
      if(input.action==='remove')return json(store.remove(input.revision,input.key));
      if(input.action==='prefer')return json(store.prefer(input.revision,input.song,await call('metadata',{ref:input.ref},controller.signal)));
      return json({error:{code:'invalid-input'}},400);
    }catch(error){return json({error:{code:error.code??(controller.signal.aborted?'cancelled':'network'),provider:error.provider,upstreamCode:error.upstreamCode}},error.code==='conflict'?409:400);}
  });
  server.once('close',()=>{service.dispose();store.close();});
  const libraryFixture=installSongFixture(server,{seed:librarySeed,beforeWrite:beforeLibraryWrite,onRead:onLibraryRead});
  return {store,service,libraryFixture};
}
