import {test} from 'node:test';
import assert from 'node:assert/strict';
import {PartMetadataStore, planPartExpansion, readPartPreferences, partPreferenceKey} from '../src/multipart.ts';
import {build} from 'esbuild';
const bundled=await build({entryPoints:['src/chart-playback.ts'],bundle:true,write:false,format:'esm',platform:'node'});
const {savedQueueEntry,readSavedPlayback,playbackStorageKey}=await import('data:text/javascript;base64,'+Buffer.from(bundled.outputFiles[0].text).toString('base64'));

const video='BV0000000001';
const parts=['901','12','340'].map((part,index)=>({ref:{provider:'bilibili',kind:'video',id:video,part},resourceId:'part-'+part,title:'P'+(index+1),url:'https://www.bilibili.com/video/'+video}));
const other={ref:{provider:'youtube',kind:'video',id:'abcdefghijk'},resourceId:'other',title:'Other',url:'https://www.youtube.com/watch?v=abcdefghijk'};

test('part expansion preserves occurrences, original P order and unrelated repeats',()=>{
  let n=0;const makeId=()=>`new-${++n}`,anchor={...parts[1],resourceId:'anchor'},queue=[other,anchor,{...other,resourceId:'repeat'}];
  const result=planPartExpansion(queue,'anchor',parts,makeId);
  assert.deepEqual(result.items.map(item=>item.ref.part??item.resourceId),['other','901','12','340','repeat']);
  assert.equal(result.group[1].resourceId,'anchor');assert.equal(result.additions.length,2);
  const again=planPartExpansion(result.items,'anchor',parts,makeId);assert.equal(again.additions.length,0);assert.deepEqual(again.items,result.items);
  const removed=result.items.filter(item=>item.ref.part!=='340');assert.equal(planPartExpansion(removed,'anchor',parts,makeId).additions.length,1);
});
test('part expansion rejects unknown anchors, malformed groups and limits before editing input',()=>{
  const anchor={...parts[0],resourceId:'anchor'},queue=Array.from({length:500},(_,index)=>index?{...other,resourceId:'q'+index}:anchor);
  const before=structuredClone(queue);assert.throws(()=>planPartExpansion(queue,'anchor',parts,()=>crypto.randomUUID()),{code:'queue-limit'});assert.deepEqual(queue,before);
  assert.throws(()=>planPartExpansion([other],'other',parts,()=>''),{code:'cancelled'});
  assert.throws(()=>planPartExpansion([anchor],'missing',parts,()=>''),{code:'cancelled'});
  assert.throws(()=>planPartExpansion([anchor],'anchor',[{...parts[1],ref:{...parts[1].ref,id:'BV0000000002'}}],()=>''),{code:'not-found'});
});
test('metadata reads share a video, prioritize foreground and never exceed two workers',async()=>{
  const pending=[],started=[];let active=0,peak=0;
  const store=new PartMetadataStore({metadata:(ref,{signal})=>new Promise((resolve,reject)=>{
    active++;peak=Math.max(peak,active);started.push(ref.id);
    const finish=()=>{active--;resolve({...parts[0],ref:{...parts[0].ref,id:ref.id},parts:parts.map(part=>({...part,ref:{...part.ref,id:ref.id}}))});};
    signal.addEventListener('abort',()=>{active--;reject({code:'cancelled'});},{once:true});pending.push(finish);
  })});
  const ref=id=>({provider:'bilibili',kind:'video',id});
  const a=store.read(ref(video),undefined,false),same=store.read({...ref(video),part:'340'}),b=store.read(ref('BV0000000002'),undefined,false),c=store.read(ref('BV0000000003'),undefined,false),d=store.read(ref('BV0000000004'));
  assert.deepEqual(started,[video,'BV0000000002']);pending.shift()();assert.equal((await same).ref.part,'340');await a;
  await new Promise(resolve=>setImmediate(resolve));assert.equal(started[2],'BV0000000004');pending.shift()();await b;await new Promise(resolve=>setImmediate(resolve));pending.shift()();await d;pending.shift()();await c;
  assert.equal(peak,2);assert.equal((await store.read({...ref(video),part:'12'})).ref.part,'12');assert.equal(started.length,4);store.dispose();
});
test('cancelling one metadata reader keeps other readers alive; invalid upstream identity is rejected',async()=>{
  let finish,signal;const store=new PartMetadataStore({metadata:(_ref,options)=>{signal=options.signal;return new Promise(resolve=>{finish=resolve;});}});
  const controller=new AbortController(),a=store.read(parts[0].ref,controller.signal),b=store.read(parts[1].ref);const rejected=assert.rejects(a,{code:'cancelled'});controller.abort();await rejected;assert.equal(signal.aborted,false);finish({...parts[0],parts});assert.equal((await b).ref.part,'12');store.dispose();
  const invalid=new PartMetadataStore({metadata:async()=>({...parts[0],ref:{...parts[0].ref,id:'BV0000000002'},parts:parts.map(part=>({...part,ref:{...part.ref,id:'BV0000000002'}}))})});
  await assert.rejects(invalid.read(parts[0].ref),{code:'protocol'});assert.equal(invalid.peek(video),undefined);invalid.dispose();
});
test('part preferences accept only supported video choices and tolerate broken storage',()=>{
  assert.deepEqual(readPartPreferences({getItem:key=>{assert.equal(key,partPreferenceKey);return JSON.stringify({[video]:'all',BV0000000002:'single',bad:'all',BV0000000003:'random'});}}),{[video]:'all',BV0000000002:'single'});
  assert.deepEqual(readPartPreferences({getItem:()=>'{'}),{});assert.deepEqual(readPartPreferences({getItem:()=>{throw Error('blocked');}}),{});
});
test('group identity round-trips in the v3 queue',()=>{
  const entry=savedQueueEntry({...parts[0],partsGroupId:'group-1'});assert.equal(entry.partsGroupId,'group-1');
  const value={version:3,items:[entry,savedQueueEntry(other)],current:entry.instanceId,order:'sequential',repeat:'off',volume:.5,rate:1,muted:false};
  assert.equal(readSavedPlayback({getItem:key=>key===playbackStorageKey?JSON.stringify(value):null}).tracks[0].partsGroupId,'group-1');
  delete entry.partsGroupId;assert.equal(readSavedPlayback({getItem:()=>JSON.stringify(value)}).tracks.length,2);
});
