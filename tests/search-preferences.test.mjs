import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {MusicSources,MusicSourceError} from '@studio/music-sources';
import {createNodeHost} from '@studio/music-sources/node';
import {BilibiliCatalogue} from '@studio/music-sources/discovery';

const root=resolve(process.env.MUSIC_APP_TEST_BUILD??'.');
const policy=await import(pathToFileURL(join(root,'dist/server/search-policy.js')));
const {SearchSettingsStore,validateSearchConfig}=await import(pathToFileURL(join(root,'dist/server/search-settings.js')));
const {MusicSearch}=await import(pathToFileURL(join(root,'dist/server/music-search.js')));
const {AccountBilibiliProvider}=await import(pathToFileURL(join(root,'dist/server/bilibili-recommendations.js')));
const {defaultSearchConfig,bilibiliSearchPartition,searchFilterReasons,songMatchReasons,preferredSong}=policy;
const signal=()=>new AbortController().signal;
const track=(n,title='加木《两难》',extra={})=>({ref:{provider:'bilibili',kind:'video',id:'BV'+String(n).padStart(10,'0'),part:String(900+n)},resourceId:'bili:'+n,title,url:'https://www.bilibili.com/video/BV'+String(n).padStart(10,'0'),...extra});
const storeFor=t=>{const store=new SearchSettingsStore(':memory:','user');t.after(()=>store.close());return store;};
const sourceError=code=>new MusicSourceError({code,provider:'bilibili',retryable:false});

test('song search text keeps complete distinct artists within the query budget',()=>{
  assert.equal(policy.songSearchText({title:'  恋人  ',artists:[' 李荣浩 ','李荣浩','G.E.M. 邓紫棋','Ｇ．Ｅ．Ｍ．邓紫棋']}),'恋人 李荣浩 G.E.M. 邓紫棋');
  assert.equal(policy.songSearchText({title:'长'.repeat(510),artists:['歌手']}),'长'.repeat(510));
  assert.equal(policy.songSearchText({title:'长'.repeat(508),artists:['歌手']}),'长'.repeat(508)+' 歌手');
});
test('real example partition IDs use the current taxonomy, even when legacy disagrees',()=>{
  for(const raw of [{tid:130,tid_v2:2024},{tid:130,tidv2:2024},{tid:2024}])assert.equal(bilibiliSearchPartition(raw),'radio');
  assert.equal(bilibiliSearchPartition({tid:130}),'other');
  assert.equal(bilibiliSearchPartition({tid:130,tid_v2:2025}),'tutorial');
  assert.equal(bilibiliSearchPartition({tid:130,tid_v2:2037}),'nonmusic');
  assert.equal(bilibiliSearchPartition({}),'unknown');
});
test('filtering keeps upstream order, version opt-ins and every original item',()=>{
  const config=defaultSearchConfig(),items=[track(1,'两难 教学',{searchPartition:'tutorial'}),track(2,undefined,{searchPartition:'radio'}),track(3,'加木《两难》官方MV',{searchPartition:'mv'})];
  assert.deepEqual(items.filter(item=>!searchFilterReasons(item,config,'两难').length).map(item=>item.ref.id),[items[1].ref.id,items[2].ref.id]);
  assert.equal(items.length,3);
  assert(searchFilterReasons(track(4,'两难 现场',{searchPartition:'live'}),config,'两难').length);
  assert.deepEqual(searchFilterReasons(track(4,'两难 现场',{searchPartition:'live'}),config,'两难 现场'),[]);
  assert.deepEqual(searchFilterReasons(track(5,'郑伊健《Discover》',{searchPartition:'radio'}),config,'Discover'),[]);
  config.partitions.tutorial='allow';config.excludeTerms=[];
  assert.deepEqual(searchFilterReasons(items[0],config,'两难'),[]);
});
test('song matching checks singers and short titles without reordering or treating uploaders as singers',()=>{
  const config=defaultSearchConfig(),song={title:'两难',artists:['加木']};
  assert.deepEqual(songMatchReasons(track(1,'加木《两 难》',{searchPartition:'radio'}),config,song),[]);
  assert(songMatchReasons(track(2,'《两难》',{uploader:{name:'加木'},searchPartition:'radio'}),config,song).includes('歌手不符'));
  assert(songMatchReasons(track(1,undefined,{searchPartition:'radio'}),config,{title:'两难'}).includes('短歌名缺少歌手信息'));
  config.strictMatch=false;assert.deepEqual(songMatchReasons(track(1,undefined,{searchPartition:'radio'}),config,{title:'两难'}),[]);
});
test('settings are scoped, persistent, conditional, validated and reset independently of preferred versions',t=>{
  const file=join(mkdtempSync(join(tmpdir(),'slowtune-search-')),'settings.sqlite');
  let store=new SearchSettingsStore(file,'a');t.after(()=>store.close());
  const first=store.read(),entry=track(1,undefined,{delivery:{url:'secret'},leaseId:'private'});
  const pinned=store.prefer(first.revision,{title:'两难',artists:['加木']},entry);
  assert(!JSON.stringify(pinned).includes('secret'));assert(!JSON.stringify(pinned).includes('private'));assert.equal(pinned.preferred[0].entry.ref.part,'901');
  assert.throws(()=>store.saveConfig(first.revision,first.config),error=>error.code==='conflict');
  const config=structuredClone(pinned.config);config.partitions.radio='manual';config.excludeTerms=[];
  const saved=store.saveConfig(pinned.revision,config);store.close();store=new SearchSettingsStore(file,'a');assert.deepEqual(store.read(),saved);
  const reset=store.saveConfig(saved.revision,saved.defaults.config);assert.deepEqual(reset.config,defaultSearchConfig());assert.equal(reset.preferred.length,1);
  const other=new SearchSettingsStore(file,'b');assert.equal(other.read().preferred.length,0);other.close();
  for(const invalid of [{...config,unexpected:1},{...config,filterByDefault:'yes'},{...config,partitions:{...config.partitions,radio:'score'}},{...config,versions:{}},{...config,excludeTerms:['']}])assert.throws(()=>validateSearchConfig(invalid),error=>error.code==='invalid-input');
});
test('exact singer bindings beat explicit title-wide bindings; identity is exact after typography normalization',t=>{
  const store=storeFor(t);let state=store.read();
  state=store.prefer(state.revision,{title:'两难'},track(1));
  state=store.prefer(state.revision,{title:'两 难',artists:['加木']},track(2));
  assert.equal(preferredSong(state.preferred,{title:'《两难》',artists:['加木']}).entry.ref.id,track(2).ref.id);
  assert.equal(preferredSong(state.preferred,{title:'两难',artists:['别人']}).entry.ref.id,track(1).ref.id);
  assert.equal(preferredSong(state.preferred,{title:'两难 Live',artists:['加木']}),undefined);
  state=store.remove(state.revision,state.preferred[0].key);assert.equal(preferredSong(state.preferred,{title:'两难',artists:['别人']}),undefined);
});
test('search retains raw pagination/order, reports facts for all items, and limits concurrent metadata reads',async t=>{
  const store=storeFor(t),items=Array.from({length:8},(_,i)=>track(i+1));let active=0,max=0,reads=0;
  const service=new MusicSearch(store,{search:async(provider,request)=>{assert.equal(request.mode,'video');assert.equal(request.cursor,'page-2');return {items,nextCursor:'page-3'};},metadata:async ref=>items.find(item=>item.ref.id===ref.id)},async()=>{reads++;max=Math.max(max,++active);await new Promise(resolve=>setTimeout(resolve,2));active--;return {tid:130,tid_v2:2024};},()=>false,()=> 'same');
  const page=await service.search({provider:'bilibili',query:'两难',cursor:'page-2'},signal());assert.equal(page.items.length,8);assert.equal(page.nextCursor,'page-3');assert.deepEqual(page.items.map(x=>x.ref.id),items.map(x=>x.ref.id));assert.equal(max,3);
  await service.search({provider:'bilibili',query:'两难',cursor:'page-2'},signal());assert.equal(reads,8);
});
test('manual platform order is forwarded without changing automatic matching defaults',async t=>{
  const store=storeFor(t),requests=[],items=[track(1)];
  const service=new MusicSearch(store,{search:async(_provider,request)=>{requests.push(request);return {items};},metadata:async()=>items[0]},async()=>({tid_v2:2024}),()=>false,()=> 'same');
  await service.search({provider:'bilibili',query:'两难',order:'favorites'},signal());assert.equal(requests.at(-1).order,'favorites');
  await service.resolve({title:'两难',artists:['加木']},signal());assert.equal(requests.at(-1).order,undefined);
  const count=requests.length;await assert.rejects(service.search({provider:'bilibili',query:'两难',order:'invalid'},signal()),{code:'invalid-input'});assert.equal(requests.length,count);
});
test('automatic playback selects the first eligible upstream item and invalidates cached choices when settings change',async t=>{
  const store=storeFor(t),items=[track(1,'两难 教学'),track(2),track(3,'加木《两难》官方MV')],calls=[];
  const service=new MusicSearch(store,{search:async(provider,request)=>{calls.push({provider,request});return {items};},metadata:async()=>items[0]},async ref=>({tid_v2:ref.id===items[0].ref.id?2025:2024}),()=>false,()=> 'same');
  assert.equal((await service.resolve({title:'两难',artists:['加木']},signal())).ref.id,items[1].ref.id);
  assert.equal((await service.resolve({title:'两难',artists:['加木']},signal())).ref.id,items[1].ref.id);assert.equal(calls.length,1);assert.equal(calls[0].request.query,'两难');
  const state=store.read(),config=structuredClone(state.config);config.partitions.radio='manual';store.saveConfig(state.revision,config);
  await assert.rejects(service.resolve({title:'两难',artists:['加木']},signal()),error=>error.code==='no-match');assert.equal(calls.length,2);
});
test('manual and automatic title searches survive Bilibili course cards using the fixed source adapter',async t=>{
  const store=storeFor(t),queries=[],items=[
    {type:'video',bvid:'BV1d1bnzVErx',title:'李荣浩《<em>恋人</em>》百万豪装录音棚大声听',duration:'4:34'},
    {type:'ketang',bvid:'',title:'挽回恋人的课程',duration:''},
    {type:'video',bvid:'BV1pE421N7Vi',title:'李荣浩《恋人》MV',duration:'4:37'},
  ];
  const api=new MusicSources(createNodeHost({fetch:async input=>{
    const url=new URL(input);
    if(url.pathname.endsWith('/spi'))return Response.json({code:0,data:{b_3:'visitor3',b_4:'visitor4'}});
    assert.equal(url.pathname,'/x/web-interface/search/type');queries.push(url.searchParams.get('keyword'));
    return Response.json({code:0,data:{numPages:2,result:items}});
  }}),{bilibili:new AccountBilibiliProvider()});t.after(()=>api.dispose());
  const service=new MusicSearch(store,api,async()=>({tid_v2:2024}),()=>false,()=> 'same');
  const song={title:'恋人',artists:['李荣浩']},page=await service.search({provider:'bilibili',query:song.title,song},signal());
  assert.deepEqual(page.items.map(entry=>entry.ref.id),[items[0].bvid,items[2].bvid]);assert(page.nextCursor);
  const selected=await service.resolve(song,signal());
  assert.equal(selected.ref.id,items[0].bvid);assert.equal(selected.title,'李荣浩《恋人》百万豪装录音棚大声听');
  assert.deepEqual(queries,['恋人','恋人']);
});
test('desktop automatic search prefers title and artists, preserves platform order and isolates legacy cached matches',async t=>{
  const store=storeFor(t),calls=[],legacy=track(1,'李荣浩《恋人》分享'),joint=track(2,'李荣浩《恋人》MV');
  const service=new MusicSearch(store,{search:async(provider,request,options)=>{
    assert.equal(options.credentialRef,undefined);calls.push(request.query);
    return {items:request.query==='恋人'?[legacy]:[track(3,'其他歌手《恋人》'),joint,legacy]};
  },metadata:async()=>legacy},async()=>({tid_v2:2024}),()=>false,()=> 'same');
  const song={title:'恋人',artists:['李荣浩']};
  assert.equal((await service.resolve(song,signal())).ref.id,legacy.ref.id);
  assert.equal((await service.resolve({...song,searchMode:'title-artists'},signal())).ref.id,joint.ref.id);
  assert.equal((await service.resolve({...song,searchMode:'title-artists'},signal())).ref.id,joint.ref.id);
  assert.deepEqual(calls,['恋人','恋人 李荣浩']);
});
test('desktop fallback tries title only before the next provider and still rejects wrong singers',async t=>{
  const store=storeFor(t),calls=[],match=track(1,'李荣浩《恋人》');
  const service=new MusicSearch(store,{search:async(provider,request)=>{
    calls.push([provider,request.query]);
    return {items:provider==='youtube'&&request.query==='恋人'?[{...match,ref:{provider:'youtube',kind:'video',id:'kK0CRZ0wvvc'}}]:[track(2,'其他歌手《恋人》')]};
  },metadata:async()=>match},async()=>({tid_v2:2024}),()=>true,()=> 'same');
  assert.equal((await service.resolve({title:'恋人',artists:['李荣浩'],searchMode:'title-artists'},signal())).ref.provider,'youtube');
  assert.deepEqual(calls,[['bilibili','恋人 李荣浩'],['bilibili','恋人'],['youtube','恋人 李荣浩'],['youtube','恋人']]);
});
test('a successful title fallback keeps Bilibili priority without requesting YouTube',async t=>{
  const store=storeFor(t),calls=[],match=track(1,'李荣浩《恋人》');
  const service=new MusicSearch(store,{search:async(provider,request)=>{calls.push([provider,request.query]);return {items:request.query==='恋人'?[match]:[]};},metadata:async()=>match},async()=>({tid_v2:2024}),()=>true,()=> 'same');
  assert.equal((await service.resolve({title:'恋人',artists:['李荣浩'],searchMode:'title-artists'},signal())).ref.id,match.ref.id);
  assert.deepEqual(calls,[['bilibili','恋人 李荣浩'],['bilibili','恋人']]);
});
test('desktop fallback never retries source errors, partial classification, cancellation or changed settings',async t=>{
  const store=storeFor(t),song={title:'恋人',artists:['李荣浩'],searchMode:'title-artists'};
  for(const kind of ['network','rate-limited','upstream','classification','cancelled','conflict']){
    const calls=[],controller=new AbortController();
    const service=new MusicSearch(store,{search:async(provider,request)=>{
      calls.push([provider,request.query]);
      if(['network','rate-limited','upstream'].includes(kind))throw sourceError(kind);
      if(kind==='cancelled')controller.abort();
      if(kind==='conflict'){const state=store.read();store.saveConfig(state.revision,state.config);}
      return {items:[track(1,'李荣浩《恋人》')]};
    },metadata:async()=>track(1)},async()=>{if(kind==='classification')throw sourceError('upstream');return {tid_v2:2024};},()=>true,()=> 'same');
    await assert.rejects(service.resolve(song,controller.signal),error=>kind==='cancelled'?error.name==='AbortError':error.code===(kind==='classification'?'upstream':kind));
    assert.deepEqual(calls,[['bilibili','恋人 李荣浩']]);
  }
});
test('desktop search without artist information uses one query and explicit pins still bypass searching',async t=>{
  const store=storeFor(t),calls=[],entry=track(1,'无歌手的长歌名');
  const service=new MusicSearch(store,{search:async(provider,request)=>{calls.push(request.query);return {items:[entry]};},metadata:async()=>entry},async()=>({tid_v2:2024}),()=>false,()=> 'same');
  await service.resolve({title:entry.title,searchMode:'title-artists'},signal());assert.deepEqual(calls,[entry.title]);
  const state=store.read();store.prefer(state.revision,{title:'恋人',artists:['李荣浩']},entry);
  assert.equal((await service.resolve({title:'恋人',artists:['李荣浩'],searchMode:'title-artists'},signal())).ref.id,entry.ref.id);assert.equal(calls.length,1);
  await assert.rejects(service.resolve({title:'恋人',searchMode:'account'},signal()),{code:'invalid-input'});
});
test('desktop automatic playback skips unreadable matching audio while preserving ranking and singer checks',async t=>{
  const store=storeFor(t),wrong=track(1,'其他歌手《雨爱》'),blocked=track(2,'杨丞琳《雨爱》分享'),good=track(3,'杨丞琳《雨爱》MV'),checked=[],queries=[];
  const service=new MusicSearch(store,{search:async(_provider,request)=>{queries.push(request.query);return {items:[wrong,blocked,good]};},metadata:async()=>good},async()=>({tid_v2:2024}),()=>false,()=> 'same',Date.now,async entry=>{
    checked.push(entry.ref.id);if(entry.ref.id===blocked.ref.id)throw sourceError('restricted');
  });
  const result=await service.resolve({title:'雨爱',artists:['杨丞琳'],searchMode:'title-artists'},signal());
  assert.equal(result.ref.id,good.ref.id);assert.deepEqual(checked,[blocked.ref.id,good.ref.id]);assert.deepEqual(queries,['雨爱 杨丞琳']);
});
test('desktop resolves the first reliable candidate without classifying unrelated tail results',async t=>{
  const store=storeFor(t),items=Array.from({length:20},(_,i)=>track(i+1,'李荣浩《恋人》')),reads=[],checked=[];
  const service=new MusicSearch(store,{search:async()=>({items}),metadata:async()=>items[0]},async ref=>{
    reads.push(ref.id);if(ref.id!==items[0].ref.id)throw sourceError('upstream');return {tid_v2:2024};
  },()=>false,()=> 'same',Date.now,async entry=>{checked.push(entry.ref.id);});
  const selected=await service.resolve({title:'恋人',artists:['李荣浩'],searchMode:'title-artists'},signal());
  assert.equal(selected.ref.id,items[0].ref.id);assert.deepEqual(reads,[items[0].ref.id]);assert.deepEqual(checked,reads);
});
test('desktop rejects known text mismatches before reading partitions but preserves uncertain earlier candidates',async t=>{
  const store=storeFor(t),items=[track(1,'其他歌手《恋人》'),track(2,'李荣浩《恋人》教学'),track(3,'李荣浩《恋人》'),track(4,'李荣浩《恋人》MV')],reads=[];
  let uncertain=false;
  const service=new MusicSearch(store,{search:async()=>({items}),metadata:async()=>items[0]},async ref=>{reads.push(ref.id);if(uncertain)throw sourceError('upstream');return {tid_v2:2024};},()=>false,()=>uncertain?'changed':'same');
  assert.equal((await service.resolve({title:'恋人',artists:['李荣浩'],searchMode:'title-artists'},signal())).ref.id,items[2].ref.id);
  assert.deepEqual(reads,[items[2].ref.id]);uncertain=true;reads.length=0;
  await assert.rejects(service.resolve({title:'恋人',artists:['李荣浩'],searchMode:'title-artists'},signal()),{code:'upstream'});
  assert.deepEqual(reads,[items[2].ref.id]);
});
test('desktop cached matches are checked again and rejected videos are not reprobed in title fallback',async t=>{
  const store=storeFor(t),first=track(1,'杨丞琳《雨爱》'),second=track(2,'杨丞琳《雨爱》MV'),checked=[];let blocked=false;
  const service=new MusicSearch(store,{search:async()=>({items:[first,second]}),metadata:async()=>first},async()=>({tid_v2:2024}),()=>false,()=> 'same',Date.now,async entry=>{
    checked.push(entry.ref.id);if(blocked&&entry.ref.id===first.ref.id)throw sourceError('not-found');
  });
  const song={title:'雨爱',artists:['杨丞琳'],searchMode:'title-artists'};
  assert.equal((await service.resolve(song,signal())).ref.id,first.ref.id);blocked=true;
  assert.equal((await service.resolve(song,signal())).ref.id,second.ref.id);assert.deepEqual(checked,[first.ref.id,first.ref.id,second.ref.id]);
  const unavailable=new MusicSearch(store,{search:async()=>({items:[first]}),metadata:async()=>first},async()=>({tid_v2:2024}),()=>false,()=> 'same',Date.now,async entry=>{checked.push(entry.ref.id);throw sourceError('restricted');});
  checked.length=0;await assert.rejects(unavailable.resolve(song,signal()),{code:'no-match'});assert.deepEqual(checked,[first.ref.id]);
});
test('desktop matches isolate decoder capabilities and recheck transient rendition choices on cache hits',async t=>{
  const store=storeFor(t),entry=track(1,'杨丞琳《雨爱》'),support=['audio/mp4; codecs="mp4a.40.2"'],checks=[];let searches=0,formatId='30280';
  const service=new MusicSearch(store,{search:async()=>{searches++;return {items:[entry]};},metadata:async()=>entry},async()=>({tid_v2:2024}),()=>false,()=> 'same',Date.now,async(candidate,_signal,types)=>{
    checks.push(types);return {ref:candidate.ref,format:{id:formatId,codec:'mp4a.40.2',mimeType:'audio/mp4',container:'mp4'}};
  });
  const query={title:'雨爱',artists:['杨丞琳'],searchMode:'title-artists',audioSupport:support};
  assert.equal((await service.resolve(query,signal())).verifiedAudio.format.id,'30280');formatId='30216';
  assert.equal((await service.resolve(query,signal())).verifiedAudio.format.id,'30216');assert.equal(searches,1);
  await service.resolve({...query,audioSupport:[...support,'audio/mp4; codecs="fLaC"']},signal());assert.equal(searches,2);
  assert.deepEqual(checks.slice(0,2),[support,support]);assert.equal(entry.verifiedAudio,undefined);
  await assert.rejects(service.resolve({...query,audioSupport:['invalid']},signal()),{code:'invalid-input'});
});
test('audio verification preserves explicit pins and legacy mobile selection and stops on global failures',async t=>{
  const store=storeFor(t),entries=[track(1,'杨丞琳《雨爱》'),track(2,'杨丞琳《雨爱》MV')],song={title:'雨爱',artists:['杨丞琳']};
  for(const kind of ['network','rate-limited','authentication','upstream','cancelled','conflict']){
    const checked=[],controller=new AbortController();
    const service=new MusicSearch(store,{search:async()=>({items:entries}),metadata:async()=>entries[0]},async()=>({tid_v2:2024}),()=>true,()=> 'same',Date.now,async entry=>{
      checked.push(entry.ref.id);
      if(kind==='cancelled'){controller.abort();throw sourceError('restricted');}
      if(kind==='conflict'){const state=store.read();store.saveConfig(state.revision,state.config);return;}
      throw sourceError(kind);
    });
    await assert.rejects(service.resolve({...song,searchMode:'title-artists'},controller.signal),error=>kind==='cancelled'?error.name==='AbortError':error.code===kind);
    assert.deepEqual(checked,[entries[0].ref.id]);
  }
  const service=new MusicSearch(store,{search:async()=>({items:entries}),metadata:async()=>entries[1]},async()=>({tid_v2:2024}),()=>false,()=> 'same',Date.now,async()=>assert.fail('legacy and pinned playback must not change'));
  assert.equal((await service.resolve(song,signal())).ref.id,entries[0].ref.id);
  const state=store.read();store.prefer(state.revision,song,entries[1]);
  assert.equal((await service.resolve({...song,searchMode:'title-artists'},signal())).ref.id,entries[1].ref.id);
});
test('manual preferred versions bypass filtering and search, and unavailable choices never silently substitute',async t=>{
  const store=storeFor(t),entry=track(1,'被手动指定的教程'),state=store.read();store.prefer(state.revision,{title:'两难',artists:['加木']},entry);let searches=0,failure=false;
  const service=new MusicSearch(store,{search:async()=>{searches++;return {items:[track(2)]};},metadata:async ref=>{assert.deepEqual(ref,entry.ref);if(failure)throw sourceError('not-found');return entry;}},async()=>({tid_v2:2025}),()=>false,()=> 'same');
  assert.deepEqual(await service.resolve({title:'两难',artists:['加木']},signal()),entry);assert.equal(searches,0);
  failure=true;await assert.rejects(service.resolve({title:'两难',artists:['加木']},signal()),error=>error.code==='preferred-unavailable');assert.equal(searches,0);assert.equal(store.read().preferred.length,1);
});
test('disabled sources, source failures and cancellation cannot trigger another source or apply late matches',async t=>{
  const store=storeFor(t);let state=store.read(),searches=0;
  state=store.prefer(state.revision,{title:'两难'},track(1,undefined,{ref:{provider:'youtube',kind:'video',id:'kK0CRZ0wvvc'}}));
  const disabled=new MusicSearch(store,{search:async()=>{searches++;return {items:[]};},metadata:async()=>track(1)},async()=>({}),()=>false,()=> 'same');
  await assert.rejects(disabled.resolve({title:'两难'},signal()),error=>error.code==='preferred-unavailable');assert.equal(searches,0);
  store.remove(state.revision,state.preferred[0].key);
  const fatal=new MusicSearch(store,{search:async()=>{searches++;throw sourceError('rate-limited');},metadata:async()=>track(1)},async()=>({}),()=>true,()=> 'same');
  await assert.rejects(fatal.resolve({title:'两难',artists:['加木']},signal()),error=>error.code==='rate-limited');assert.equal(searches,1);
  const c=new AbortController(),late=new MusicSearch(store,{search:async()=>{c.abort();return {items:[track(1)]};},metadata:async()=>track(1)},async()=>({tid_v2:2024}),()=>false,()=> 'same');
  await assert.rejects(late.resolve({title:'两难',artists:['加木']},c.signal),{name:'AbortError'});
});
test('classification failures retain every raw result for manual inspection and stop automatic fallback',async t=>{
  const store=storeFor(t),items=Array.from({length:8},(_,i)=>track(i+1));let reads=0,searches=0;
  const service=new MusicSearch(store,{search:async()=>{searches++;return {items,nextCursor:'next'};},metadata:async()=>items[0]},async()=>{reads++;throw sourceError('rate-limited');},()=>true,()=> 'same');
  const page=await service.search({provider:'bilibili',query:'两难'},signal());
  assert.deepEqual(page.items.map(entry=>entry.ref.id),items.map(entry=>entry.ref.id));assert.equal(page.nextCursor,'next');assert.equal(page.classificationIssue.code,'rate-limited');assert.equal(reads,3);
  const before=searches;await assert.rejects(service.resolve({title:'两难',artists:['加木']},signal()),error=>error.code==='rate-limited');assert.equal(searches,before+1);
});
test('catalogue HTTP 503 remains a source failure without a status code and is not cached as an unknown partition',async t=>{
  const store=storeFor(t),catalogue=new BilibiliCatalogue(),items=Array.from({length:8},(_,i)=>track(i+1)),calls=[];
  t.after(()=>catalogue.dispose());
  let reads=0,unavailable=true;
  const host={fetch:async()=>{reads++;return unavailable?new Response('unavailable',{status:503}):Response.json({code:0,data:{tid_v2:2024}});}};
  const service=new MusicSearch(store,{search:async provider=>{calls.push(provider);return {items};},metadata:async()=>items[0]},(ref,signal)=>catalogue.json('/x/web-interface/view',{bvid:ref.id},{host,signal,scope:'test'}),()=>true,()=> 'same');
  const page=await service.search({provider:'bilibili',query:'两难'},signal());
  assert.equal(page.classificationIssue?.code,'upstream');assert.equal(page.classificationIssue.upstreamCode,undefined);
  assert.deepEqual(page.items.map(entry=>entry.ref.id),items.map(entry=>entry.ref.id));assert.equal(reads,3);
  calls.length=0;
  await assert.rejects(service.resolve({title:'两难',artists:['加木']},signal()),error=>error.code==='upstream');
  assert.deepEqual(calls,['bilibili']);
  unavailable=false;
  const recovered=await service.search({provider:'bilibili',query:'两难'},signal());
  assert.equal(recovered.classificationIssue,undefined);assert(recovered.items.every(entry=>entry.searchPartition==='radio'));
});
