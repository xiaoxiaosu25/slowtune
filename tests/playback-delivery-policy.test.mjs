import {test} from 'node:test';
import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
const root=resolve(process.env.MUSIC_APP_TEST_BUILD??'.');
const {PlaybackDelivery}=await import(pathToFileURL(resolve(root,'dist/server/playback-delivery.js')));
const {PlaybackLineHistory}=await import(pathToFileURL(resolve(root,'dist/server/playback-policy.js')));
const ref={provider:'bilibili',kind:'video',id:'BV0000000001',part:'1'},playback={entry:{ref,title:'fixture'},resourceId:'fixture',format:{id:'aac',codec:'mp4a.40.2',container:'mp4',mimeType:'audio/mp4'},delivery:{url:'https://first.bilivideo.com/media',requiresHost:true}};
test('failure facts bind to session, generation and lease and retain rate-limit semantics',async()=>{
  let owner='left',generation='one';const delivery=new PlaybackDelivery({now:Date.now,fetch:async()=>new Response(null,{status:429,headers:{'Retry-After':'2'}})});
  delivery.desktopContext=()=>true;delivery.ownerContext=()=>owner;delivery.generation=()=>generation;
  const lease=await delivery.publish(playback,'http://localhost');
  try{await assert.rejects(delivery.read(lease.leaseId,new Request(lease.delivery.url)),{code:'rate-limited'});const fact=delivery.failure(lease.leaseId,owner);assert.equal(fact.code,'rate-limited');assert.equal(fact.status,429);assert(fact.retryAfterMs<=2000&&fact.retryAfterMs>0);assert.equal(delivery.failure(lease.leaseId,'right'),null);generation='two';assert.equal(delivery.failure(lease.leaseId,owner),null);assert(!JSON.stringify(fact).includes('bilivideo'));await delivery.release(lease.leaseId);assert.equal(delivery.failure(lease.leaseId,owner),null);}finally{await delivery.dispose();}
});
test('late failure of an older Range request cannot overwrite a newer successful attempt',async()=>{
  let resume;const held=new Promise(done=>resume=done);let calls=0;
  const delivery=new PlaybackDelivery({now:Date.now,fetch:async(_url,options)=>{if(options.method==='HEAD')return new Response(null);if(++calls===1){await held;return new Response(null,{status:403});}return new Response(new Uint8Array([1]));}});
  delivery.desktopContext=()=>true;delivery.ownerContext=()=> 'owner';const lease=await delivery.publish(playback,'http://localhost');
  try{const old=delivery.read(lease.leaseId,new Request(lease.delivery.url)).catch(error=>error);await(await delivery.read(lease.leaseId,new Request(lease.delivery.url))).arrayBuffer();resume();assert.equal((await old).code,'restricted');const fact=delivery.failure(lease.leaseId,'owner');assert.equal(fact.state,'complete');assert.equal(fact.code,undefined);await delivery.read(lease.leaseId,new Request(lease.delivery.url,{method:'HEAD'}));assert.deepEqual(delivery.failure(lease.leaseId,'owner'),fact,'HEAD must not replace a GET fact');}finally{resume();await delivery.dispose();}
});
test('line observations are bounded and account-scoped; permission failures do not penalize nodes',()=>{
  let now=0,generation='one';const history=new PlaybackLineHistory(()=>generation,()=>now),policy=history.policy(),items=[{index:0,hostname:'first'},{index:1,hostname:'second'}];
  assert.deepEqual(policy.order(items),[0,1]);policy.observe({hostname:'first',ready:false,elapsedMs:5,errorCode:'restricted'});assert.deepEqual(policy.order(items),[0,1]);
  policy.observe({hostname:'first',ready:false,elapsedMs:50,errorCode:'timeout'});policy.observe({hostname:'second',ready:true,elapsedMs:4});assert.deepEqual(policy.order(items),[1,0]);
  now=300001;assert.deepEqual(history.policy().order(items),[0,1]);generation='two';const fresh=history.policy();policy.observe({hostname:'second',ready:true,elapsedMs:1});assert.deepEqual(fresh.order(items),[0,1]);
});
test('only 32 node observations remain eligible for ranking',()=>{
  const history=new PlaybackLineHistory(()=> 'one'),policy=history.policy();
  for(let index=0;index<33;index++)policy.observe({hostname:'host-'+index,ready:true,elapsedMs:index});
  assert.deepEqual(policy.order([{index:0,hostname:'host-0'},{index:1,hostname:'host-32'}]),[1,0],'The evicted fast node must return to unknown status');
});
