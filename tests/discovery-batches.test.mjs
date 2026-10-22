import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {BrowseCache} from '../dist/server/browse-cache.js';
import {DiscoveryBatches} from '../dist/server/discovery-batches.js';
import {MusicRecommendations,RecommendationStore} from '../dist/server/recommendation.js';
import {MusicCharts} from '../dist/server/charts.js';

const signal=()=>new AbortController().signal;
const track=(id,title='Music '+id)=>({ref:{provider:'bilibili',kind:'video',id:'BV'+String(id).padStart(10,'0')},resourceId:'bilibili:'+id,title,url:'https://www.bilibili.com/video/BV'+String(id).padStart(10,'0')});
const ids=shelf=>shelf.page.items.map(item=>JSON.stringify([item.ref.provider,item.ref.id,null]));
function fixture(file=join(mkdtempSync(join(tmpdir(),'music-batches-')),'browse.sqlite')){
  const cache=new BrowseCache(file,'isolated'),store=new RecommendationStore(file+'.settings','isolated');let auth='account-a',calls=0,loader;
  const recommendations=new MusicRecommendations(store,()=>auth),column='music-recommendation';
  const batches=new DiscoveryBatches({cache,recommendations,column:()=>column,signature:key=>JSON.stringify([key,auth,store.read(column).epoch]),context:()=>auth,load:async(key,options)=>{
    const call=++calls;if(loader)return loader(key,options,call);
    return {shelf:{id:column,title:'推荐',kind:'recommendation',page:{items:Array.from({length:20},(_,i)=>track(call*100+i))}}};
  }});
  return {file,cache,store,recommendations,batches,column,get calls(){return calls;},setAuth:value=>auth=value,setLoader:value=>loader=value,close:async()=>{await batches.dispose();store.close();cache.close();}};
}

test('startup selection is unseen; reload freezes order and token, and browsers own their next batch',async()=>{
  const f=fixture();try{
    await f.batches.warm('bilibili');assert.equal(f.calls,1);assert.equal(f.recommendations.diagnostics().histories,0);
    const a=(await f.batches.read('bilibili','a',signal())).shelf,b=(await f.batches.read('bilibili','b',signal())).shelf;
    assert.equal(a.page.items.length,12);assert.deepEqual(ids(a),ids(b));assert.notEqual(a.recommendation.token,b.recommendation.token);
    assert.deepEqual(f.recommendations.confirm('a',a.id,a.recommendation.token,ids(a)),{accepted:true,count:12});
    const reload=(await f.batches.read('bilibili','a',signal())).shelf;
    assert.deepEqual(ids(reload),ids(a));assert.equal(reload.recommendation.batchId,a.recommendation.batchId);assert.equal(reload.recommendation.token,a.recommendation.token);assert.equal(f.calls,1);
    assert.deepEqual(f.recommendations.confirm('a',a.id,a.recommendation.token,ids(a)),{accepted:true,count:0});
    const next=(await f.batches.read('bilibili','a',signal(),true)).shelf;
    assert.equal(f.calls,2);assert.equal(next.page.items.length,12);assert.notEqual(next.recommendation.batchId,a.recommendation.batchId);
    assert.equal(f.recommendations.confirm('a',a.id,a.recommendation.token,ids(a)).accepted,false);
    assert.deepEqual(ids((await f.batches.read('bilibili','a',signal())).shelf),ids(next));
    assert.deepEqual(ids((await f.batches.read('bilibili','b',signal())).shelf),ids(b));
    f.batches.cancelOwner('a');f.recommendations.invalidate('a');
    assert.deepEqual(ids((await f.batches.read('bilibili','new-login',signal())).shelf),ids(b));assert.equal(f.calls,2);
    const preview=f.recommendations.preview('b',b.id,{},signal());assert.equal(preview.recommendation.pool,20);assert.equal(preview.recommendation.token,undefined);
  }finally{await f.close();}
});

test('fresh qualified songs are filled by old qualified songs, without duplicates or relaxed filters',async()=>{
  const f=fixture();try{
    f.setLoader(async()=>({shelf:{id:f.column,title:'推荐',kind:'recommendation',page:{items:Array.from({length:12},(_,i)=>track(i))}}}));
    const first=(await f.batches.read('bilibili','a',signal())).shelf;f.recommendations.confirm('a',first.id,first.recommendation.token,ids(first));
    f.setLoader(async()=>({shelf:{id:f.column,title:'推荐',kind:'recommendation',page:{items:[track(100),track(100),track(101)]}}}));
    const next=(await f.batches.read('bilibili','a',signal(),true)).shelf;
    assert.equal(next.page.items.length,12);assert.equal(new Set(ids(next)).size,12);assert.deepEqual(next.page.items.slice(0,2).map(item=>item.ref.id),[track(100).ref.id,track(101).ref.id]);
    f.store.update(f.column,f.store.read(f.column),{overrides:{include:{mode:'any',groups:[{id:'only',fields:['title'],mode:'any',terms:['unique']}]} }},signal());
    f.setLoader(async()=>({shelf:{id:f.column,title:'推荐',kind:'recommendation',page:{items:[track(200,'unique'),track(201,'rejected')]}}}));
    const filtered=(await f.batches.read('bilibili','a',signal())).shelf;
    assert.equal(filtered.page.items.length,1);assert.equal(filtered.page.items[0].title,'unique');assert(filtered.recommendation.shortage.includes('insufficient-eligible'));
    assert.equal(f.recommendations.confirm('a',next.id,next.recommendation.token,ids(next)).accepted,false);
    const saved=f.cache.entries('recommendation');assert(saved.length);assert(!JSON.stringify(saved).includes('"token"'));
  }finally{await f.close();}
});

test('desktop Bilibili refill counts displayed songs against Bilibili history',async()=>{
  const f=fixture(),key='bilibili:desktop',items=Array.from({length:12},(_,i)=>track(i));
  try{
    f.setLoader(async()=>({shelf:{id:f.column,title:'推荐',kind:'recommendation',page:{items}}}));
    const first=(await f.batches.read(key,'a',signal())).shelf;
    assert.equal(f.recommendations.confirm('a',first.id,first.recommendation.token,ids(first)).accepted,true);
    f.setLoader(async(_key,options)=>{
      assert.equal(options.seen.length,12);
      assert.equal(options.enough(items),false,'already displayed Bilibili songs cannot satisfy the fresh-song target');
      assert.equal(options.filled([]),true,'the previous qualified batch can still fill all positions');
      return {shelf:{id:f.column,title:'推荐',kind:'recommendation',page:{items:Array.from({length:12},(_,i)=>track(100+i))}}};
    });
    const next=(await f.batches.read(key,'a',signal(),true)).shelf;
    assert.equal(next.page.items.length,12);assert(next.page.items.every(item=>!ids(first).includes(JSON.stringify([item.ref.provider,item.ref.id,null]))));
  }finally{await f.close();}
});

test('source failure preserves the batch and persistence supplies content while startup prepares',async()=>{
  const f=fixture();const original=(await f.batches.read('bilibili','a',signal())).shelf;
  f.setLoader(async()=>{throw Object.assign(new Error('offline'),{code:'network'});});
  const retained=(await f.batches.read('bilibili','a',signal(),true)).shelf;
  assert.deepEqual(ids(retained),ids(original));assert.equal(retained.recommendation.batchId,original.recommendation.batchId);assert.equal(retained.recommendation.issue,'network');
  await f.close();
  const restarted=fixture(f.file);let release;
  restarted.setLoader(async(key,options)=>{await new Promise((resolve,reject)=>{release=resolve;options.signal.addEventListener('abort',()=>reject(options.signal.reason),{once:true});});return {shelf:{id:restarted.column,title:'推荐',kind:'recommendation',page:{items:Array.from({length:12},(_,i)=>track(500+i))}}};});
  try{
    const warming=restarted.batches.warm('bilibili');
    const early=(await restarted.batches.read('bilibili','a',signal())).shelf;
    assert.deepEqual(ids(early),ids(original));assert.equal(early.recommendation.updating,true);
    restarted.batches.cancelOwner('a');release();await warming;
    const ready=(await restarted.batches.read('bilibili','a',signal())).shelf;
    assert.notEqual(ready.recommendation.batchId,early.recommendation.batchId);assert.equal(ready.recommendation.updating,false);assert.equal(restarted.calls,1);
  }finally{await restarted.close();}
});

test('reader cancellation does not stop shared startup; cancelled manual work cannot replace a batch',async()=>{
  const f=fixture();let release;
  f.setLoader(async(key,options,call)=>{await new Promise((resolve,reject)=>{release=resolve;options.signal.addEventListener('abort',()=>reject(options.signal.reason),{once:true});});return {shelf:{id:f.column,title:'推荐',kind:'recommendation',page:{items:[track(call)]}}};});
  try{
    const c=new AbortController(),read=f.batches.read('bilibili','a',c.signal),rejected=assert.rejects(read);c.abort();await rejected;
    assert.equal(f.batches.diagnostics().warming,1);release();const first=(await f.batches.read('bilibili','b',signal())).shelf;
    const cancel=new AbortController(),next=f.batches.read('bilibili','b',cancel.signal,true),failed=assert.rejects(next);cancel.abort();await failed;
    assert.equal((await f.batches.read('bilibili','b',signal())).shelf.recommendation.batchId,first.recommendation.batchId);
    f.setAuth('account-b');f.setLoader(async()=>({shelf:{id:f.column,title:'推荐',kind:'recommendation',page:{items:[track(99)]}}}));
    const changed=(await f.batches.read('bilibili','b',signal())).shelf;assert.notEqual(changed.recommendation.batchId,first.recommendation.batchId);
  }finally{await f.close();}
});

test('startup scheduler limits concurrency, starts without readers and releases queued work on shutdown',async()=>{
  const f=fixture();let active=0,max=0,started=0;const releases=[];
  f.batches.start(Array.from({length:6},()=>async()=>{started++;max=Math.max(max,++active);try{await new Promise(resolve=>releases.push(resolve));}finally{active--;}}));
  assert.equal(started,3);assert.equal(max,3);
  const closing=f.batches.dispose();releases.forEach(resolve=>resolve());await closing;
  assert.equal(started,3);assert.equal(active,0);f.store.close();f.cache.close();
});

test('chart snapshots survive restart, fetch only when due, and failed refresh retains the persisted result',async()=>{
  const file=join(mkdtempSync(join(tmpdir(),'music-chart-cache-')),'browse.sqlite');let now=100000000,calls=0,fail=false;
  const host={now:()=>now,fetch:async()=>{calls++;if(fail)throw new Error('offline');return Response.json({code:200,result:{updateTime:now,tracks:[{name:'Real title'}]}});}};
  let cache=new BrowseCache(file,'isolated'),charts=new MusicCharts(host,cache);
  const first=await charts.read({},signal());await charts.dispose();cache.close();
  cache=new BrowseCache(file,'isolated');charts=new MusicCharts(host,cache);
  assert.deepEqual(await charts.read({},signal()),first);assert.equal(calls,1);
  now=first.refreshAfter;fail=true;const stale=await charts.read({},signal());assert.equal(stale.issue,'network');assert.equal(stale.fetchedAt,first.fetchedAt);assert.equal(calls,2);
  fail=false;const updated=await charts.read({},signal());assert.equal(updated.fetchedAt,now);assert.equal(calls,3);await charts.dispose();cache.close();
});
test('a timed out chart read can fall back to persisted content while user cancellation still cancels',async()=>{
  const file=join(mkdtempSync(join(tmpdir(),'music-chart-timeout-')),'browse.sqlite');let now=100000000,slow=false;
  const cache=new BrowseCache(file,'isolated'),charts=new MusicCharts({now:()=>now,fetch:async(_url,options)=>{
    if(slow)await new Promise((_resolve,reject)=>options.signal.addEventListener('abort',()=>reject(options.signal.reason),{once:true}));
    return Response.json({code:200,result:{updateTime:now,tracks:[{name:'Last successful chart'}]}});
  }},cache);
  try{
    const first=await charts.read({},signal());now=first.refreshAfter;slow=true;
    const timeout=new AbortController(),reading=charts.read({},timeout.signal);timeout.abort(new DOMException('Timed out','TimeoutError'));
    const retained=await reading;assert.equal(retained.issue,'timeout');assert.deepEqual(retained.items,first.items);
    const cancel=new AbortController(),cancelled=charts.read({},cancel.signal),rejected=assert.rejects(cancelled,{code:'cancelled'});cancel.abort();await rejected;
  }finally{await charts.dispose();cache.close();}
});

test('a newly published Bilibili edition failing after restart retains the newest successful edition',async()=>{
 const file=join(mkdtempSync(join(tmpdir(),'music-chart-edition-fallback-')),'browse.sqlite');
 const published=1791540001000,week=7*86400000;let now=published+3600000,newEdition=false,failed=true;
 const host={now:()=>now,fetch:async input=>{
  const url=new URL(input);
  if(url.pathname.endsWith('/all_period'))return Response.json({code:0,data:{list:{2026:[{ID:439,priod:226,publish_time:published/1000},{ID:437,priod:225,publish_time:(published-week)/1000},...(newEdition?[{ID:441,priod:227,publish_time:(published+week)/1000}]:[])]}}});
  const id=Number(url.searchParams.get('list_id'));
  return Response.json({code:0,data:{list:failed&&id===441?[]:[{music_title:'Edition '+id,rank:1}]}});
 }};
 let cache=new BrowseCache(file,'isolated'),charts=new MusicCharts(host,cache);
 try{
  const latest=await charts.read({source:'bilibili'},signal());assert.equal(latest.period.id,439);
  // Reading an older edition most recently must not make it the latest fallback.
  await charts.read({source:'bilibili',period:'437'},signal());
  await charts.dispose();cache.close();
  cache=new BrowseCache(file,'isolated');charts=new MusicCharts(host,cache);
  now=published+week;newEdition=true;
  for(const input of [{source:'bilibili'},{source:'bilibili',period:'latest'}]){
   const retained=await charts.read(input,signal());
   assert.equal(retained.period.id,439);assert.equal(retained.fetchedAt,latest.fetchedAt);assert.deepEqual(retained.items,latest.items);assert.equal(retained.issue,'upstream');
  }
  await assert.rejects(charts.read({source:'bilibili',period:'441'},signal()),{code:'upstream'});
  await assert.rejects(charts.read({source:'bilibili',period:'999'},signal()),{code:'not-found'});
  failed=false;const recovered=await charts.read({source:'bilibili'},signal());assert.equal(recovered.period.id,441);assert.equal(recovered.issue,undefined);
 }finally{await charts.dispose();cache.close();}
});
