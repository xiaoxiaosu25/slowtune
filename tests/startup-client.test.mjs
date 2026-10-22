import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { resolve } from 'node:path';

test('startup overlaps requests, hands pending results to the workspace once, and cancels owned work',async()=>{
  const calls=[],pending=new Map();
  globalThis.__slowtuneStartupRequest=(path,body,signal)=>{
    calls.push({path,signal});
    return new Promise((resolve,reject)=>{const abort=()=>reject(signal.reason);signal?.addEventListener('abort',abort,{once:true});pending.set(path,{resolve:value=>{signal?.removeEventListener('abort',abort);resolve(value);},reject});});
  };
  try {
    const output=await build({stdin:{contents:"export {StartupPreload} from './src/startup.ts';",resolveDir:resolve('.')},bundle:true,platform:'node',format:'esm',write:false,plugins:[{name:'controlled-api',setup(build){build.onResolve({filter:/^\.\/api$/},()=>({path:'api',namespace:'controlled'}));build.onLoad({filter:/.*/,namespace:'controlled'},()=>({contents:'export const request=(...args)=>globalThis.__slowtuneStartupRequest(...args);',loader:'js'}));}}]});
    const {StartupPreload}=await import('data:text/javascript;base64,'+Buffer.from(output.outputFiles[0].text).toString('base64'));
    const preload=new StartupPreload();assert.equal(calls.length,5,'all startup requests begin before any source resolves');
    let ready=false;const preparation=preload.ready().then(()=>{ready=true;});
    const library={revision:'original',snapshot:{favorites:[],playlists:[]}};
    pending.get('/api/status').resolve({version:'fixture'});await preparation;assert(ready,'library and remote recommendation requests do not block entry');
    pending.get('/api/song-library').resolve(library);
    assert.equal(await preload.take('/api/song-library'),library);assert.equal(calls.filter(call=>call.path==='/api/song-library').length,1);
    const discovery=preload.take('/api/discovery/bilibili?refresh=0');pending.get('/api/discovery/bilibili?refresh=0').resolve([{id:'shared-result'}]);assert.deepEqual(await discovery,[{id:'shared-result'}]);assert.equal(calls.length,5,'handoff of pending content does not issue a second request');
    const consumer=new AbortController(),account=preload.take('/api/bilibili/account',consumer.signal);consumer.abort();await assert.rejects(account,{name:'AbortError'});assert.equal(calls.find(call=>call.path==='/api/bilibili/account').signal.aborted,false,'one consumer cannot cancel shared startup work');
    preload.dispose();assert(calls.every(call=>call.signal.aborted),'leaving startup cancels all requests it owns');
    const failedLibrary=new StartupPreload();
    pending.get('/api/song-library').reject(new Error('library unavailable'));
    pending.get('/api/status').resolve({version:'fixture'});
    await failedLibrary.ready();
    await assert.rejects(failedLibrary.take('/api/song-library'),/library unavailable/);
    failedLibrary.dispose();
  }finally{delete globalThis.__slowtuneStartupRequest;}
});

test('desktop startup and refresh select the desktop policy while mobile keeps its existing URL',async()=>{
  const calls=[],previousWindow=globalThis.window;
  globalThis.__slowtuneStartupRequest=async path=>{calls.push(path);return [{id:'fixture'}];};
  try{
    const output=await build({stdin:{contents:"export {StartupPreload,bilibiliDiscoveryPath} from './src/startup.ts';",resolveDir:resolve('.')},bundle:true,platform:'node',format:'esm',write:false,plugins:[{name:'controlled-api',setup(build){build.onResolve({filter:/^\.\/api$/},()=>({path:'api',namespace:'controlled'}));build.onLoad({filter:/.*/,namespace:'controlled'},()=>({contents:'export const request=(...args)=>globalThis.__slowtuneStartupRequest(...args);',loader:'js'}));}}]});
    const {StartupPreload,bilibiliDiscoveryPath}=await import('data:text/javascript;base64,'+Buffer.from(output.outputFiles[0].text).toString('base64'));
    for(const desktop of [true,false]){
      globalThis.window={matchMedia:query=>{assert.equal(query,'(min-width:761px)');return {matches:desktop};}};
      const path='/api/discovery/bilibili?refresh=0'+(desktop?'&surface=desktop':'');
      const before=calls.length,preload=new StartupPreload();assert(calls.slice(before).includes(path));
      assert.equal(bilibiliDiscoveryPath(),path);assert.equal(bilibiliDiscoveryPath(true),path.replace('refresh=0','refresh=1'));
      assert.deepEqual(await preload.take(path),[{id:'fixture'}]);assert.equal(calls.length-before,5,'startup result is consumed without another request');preload.dispose();
    }
  }finally{if(previousWindow===undefined)delete globalThis.window;else globalThis.window=previousWindow;delete globalThis.__slowtuneStartupRequest;}
});
