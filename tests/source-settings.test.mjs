import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,writeFileSync,existsSync,readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join,resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
const built=resolve(process.env.MUSIC_APP_TEST_BUILD??'.','dist/server');
const {SourceSettingsStore}=await import(pathToFileURL(join(built,'source-settings.js')));
const {YoutubeRuntime}=await import(pathToFileURL(join(built,'youtube-runtime.js')));
const {PlaybackDelivery}=await import(pathToFileURL(join(built,'playback-delivery.js')));
const until=async predicate=>{const end=Date.now()+5000;while(!predicate()){if(Date.now()>end)throw Error('condition timeout');await new Promise(done=>setTimeout(done,20));}};

test('source settings default closed, CAS, validation, failed storage, user isolation and restart',()=>{
  const dir=mkdtempSync(join(tmpdir(),'source-settings-')),path=join(dir,'settings.sqlite');
  let store=new SourceSettingsStore(path,'personal');
  assert.deepEqual(store.read(),{revision:'initial',youtube:{enabled:false,disabledDisplay:'dim'}});
  const enabled=store.save({revision:'initial',youtube:{enabled:true,disabledDisplay:'hide'}});
  assert.throws(()=>store.save({revision:'initial',youtube:{enabled:false,disabledDisplay:'dim'}}),error=>error.code==='conflict');
  for(const youtube of [{enabled:'true',disabledDisplay:'dim'},{enabled:true,disabledDisplay:'bad'}])assert.throws(()=>store.save({revision:enabled.revision,youtube}),error=>error.code==='invalid-input');
  const lock=new DatabaseSync(path);lock.exec('BEGIN IMMEDIATE');
  try{assert.throws(()=>store.save({revision:enabled.revision,youtube:{enabled:false,disabledDisplay:'show'}}));assert.deepEqual(store.read(),enabled);}finally{lock.exec('ROLLBACK');lock.close();}
  store.close();store=new SourceSettingsStore(path,'personal');assert.deepEqual(store.read(),enabled);store.close();
  store=new SourceSettingsStore(path,'other');assert.equal(store.read().youtube.enabled,false);store.close();
});

test('YouTube tools initialize only on enable; disabled and superseded checks cannot revive the runtime',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'youtube-switch-')),marker=join(dir,'checks'),script=join(dir,'tool.mjs');
  writeFileSync(script,`import {appendFileSync} from 'node:fs';appendFileSync(${JSON.stringify(marker)},'check\\n');setTimeout(()=>console.log('test-tool'),250);`);
  const host={fetch:()=>{throw Error('unexpected network');},now:Date.now};
  const changes=[],runtime=new YoutubeRuntime({executable:process.execPath,prefixArgs:[script],nodeRuntime:process.execPath},host,()=>changes.push(runtime.status()));
  try{
    assert.equal(runtime.status().enabled,false);assert.equal(existsSync(marker),false);
    assert.throws(()=>runtime.assertAvailable(),error=>error.code==='unsupported');
    runtime.setEnabled(true);await until(()=>existsSync(marker));const previousSignal=runtime.signal;
    runtime.setEnabled(false);assert.equal(previousSignal.aborted,true);assert.equal(runtime.api,undefined);
    runtime.setEnabled(true);await until(()=>runtime.status().available);
    assert.equal(runtime.status().toolVersion,'test-tool');assert.equal(runtime.api.capabilities('youtube').operations.includes('formats'),true);
    assert.equal(readFileSync(marker,'utf8').trim().split('\n').length,2);
    runtime.setEnabled(false);assert.equal(runtime.api,undefined);assert.equal(runtime.status().checking,false);
    assert(changes.some(state=>state.checking));
  }finally{await runtime.dispose();}
});

test('missing tools preserve enabled preference and report a retryable configuration state',async()=>{
  let changed;const runtime=new YoutubeRuntime(undefined,{fetch:()=>{throw Error('network');},now:Date.now},()=>changed=runtime.status());
  runtime.setEnabled(true);await until(()=>changed&&!changed.checking);
  assert.equal(changed.enabled,true);assert.equal(changed.available,false);assert.match(changed.issue,/取源工具/);
  runtime.setEnabled(false);assert.equal(runtime.status().enabled,false);await runtime.dispose();
});

test('closing YouTube revokes only its media leases and rejects stale publications',async()=>{
  const delivery=new PlaybackDelivery({now:Date.now,fetch:async()=>new Response(new Uint8Array([1,2,3]))});
  const prepared=provider=>({entry:{ref:{provider,kind:'video',id:provider==='youtube'?'kK0CRZ0wvvc':'BV1tX4y1W7Xm'},resourceId:provider,title:provider,url:'https://example.com'},resourceId:provider,format:{codec:'mp4a.40.2',container:'mp4',mimeType:'audio/mp4'},delivery:{url:'https://example.com/media',requiresHost:true}});
  let enabled=true;delivery.enabled=provider=>provider!=='youtube'||enabled;
  try{
    const youtube=await delivery.publish(prepared('youtube'),'http://localhost'),bilibili=await delivery.publish(prepared('bilibili'),'http://localhost');
    assert.equal(delivery.diagnostics().leases,2);enabled=false;await delivery.releaseProvider('youtube');
    assert.equal(delivery.provider(youtube.leaseId),undefined);assert.equal(delivery.provider(bilibili.leaseId),'bilibili');assert.equal(delivery.diagnostics().leases,1);
    await assert.rejects(delivery.publish(prepared('youtube'),'http://localhost'),error=>error.code==='unsupported');
    enabled=true;delivery.canPublish=()=>false;await assert.rejects(delivery.publish(prepared('youtube'),'http://localhost'),error=>error.code==='unsupported');assert.equal(delivery.diagnostics().leases,1);
  }finally{await delivery.dispose();}
});
