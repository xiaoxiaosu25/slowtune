import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { createNodeHost } from '@studio/music-sources/node';
import { MusicSourceError } from '@studio/music-sources';
const build=resolve(process.env.MUSIC_APP_TEST_BUILD ?? '.','dist/server');
const {FollowStore,validateCreator}=await import(pathToFileURL(join(build,'follow-store.js')));
const {Follows}=await import(pathToFileURL(join(build,'follows.js')));
const {CreatorSources,parseYoutubeUpdates}=await import(pathToFileURL(join(build,'creator-sources.js')));
const signal=()=>new AbortController().signal;
const author=(id='101',provider='bilibili')=>({provider,id,name:'作者 '+id,url:provider==='bilibili'?`https://space.bilibili.com/${id}`:`https://www.youtube.com/channel/${id}`,followedAt:1});
const track=(id,date,creator=author())=>({ref:{provider:creator.provider,kind:'video',id},resourceId:creator.provider+':video:'+id,title:id,url:'https://example.test',uploader:{id:creator.id,name:creator.name},...(date===undefined?{}:{publishedAt:date})});
const database=()=>join(mkdtempSync(join(tmpdir(),'slow-follows-')),'follows.sqlite');
const follow=(store,creator)=>store.change(store.read().revision,creator,true,signal());

test('follow records use source identity, conditional writes, restart persistence and isolated user spaces',()=>{
  const path=database(),store=new FollowStore(path,'a'),other=new FollowStore(path,'b');
  try {
    const initial=store.read();assert.equal(initial.creators.length,0);
    const saved=follow(store,author());assert.notEqual(saved.revision,initial.revision);
    assert.deepEqual(follow(store,author()),saved,'duplicate follow is idempotent');
    assert.throws(()=>store.change(initial.revision,author('102'),true,signal()),{code:'conflict'});
    const cancelled=new AbortController();cancelled.abort();assert.throws(()=>store.change(saved.revision,author('102'),true,cancelled.signal));assert.deepEqual(store.read(),saved);
    assert.equal(other.read().creators.length,0);
    store.remember(author(),[track('BV1234567890',2)],10);
    const second=new FollowStore(path,'a');try{assert.deepEqual(second.read(),saved);assert.equal(second.cached(author()).items.length,1);}finally{second.close();}
    store.change(saved.revision,author(),false,signal());assert.equal(store.read().creators.length,0);assert.equal(store.cached(author()),undefined);
    store.remember(author(),[track('BV1234567890',2)],20);assert.equal(store.cached(author()),undefined,'late reads cannot restore an unfollowed creator');
    for(const value of [null,{provider:'bilibili',id:'undefined'},{provider:'bilibili',id:'0'},{provider:'youtube',id:'@forged'},{provider:'other',id:'101'}])assert.throws(()=>validateCreator(value),{code:'invalid-input'});
  }finally{store.close();other.close();}
});

test('follow from a song reads the real uploader and rechecks revision after source requests',async()=>{
  const store=new FollowStore(database(),'a');let gate;
  const sources={cancelOwner(){},profile:async()=>author('103')};
  const app=new Follows(store,sources,async()=>{if(gate)await gate;return track('BV1234567890',1,author());});
  try {
    const value=await app.change({action:'follow',revision:store.read().revision,ref:{provider:'bilibili',kind:'video',id:'BV1234567890'},name:'伪造名字'},signal());
    assert.equal(value.creator.id,'101');assert.equal(value.creators[0].name,'作者 101');
    const first=store.read();let finish;gate=new Promise(r=>finish=r);
    const pending=app.change({action:'follow',revision:first.revision,ref:{provider:'bilibili',kind:'video',id:'BV1234567890'}},signal());
    follow(store,author('102'));finish();await assert.rejects(pending,{code:'conflict'});
    assert.equal(store.read().creators.length,2);
    for(const ref of [{provider:'bilibili',kind:'playlist',id:'season:1:2'},{provider:'youtube',kind:'video',id:'../bad'}])await assert.rejects(app.change({action:'follow',revision:store.read().revision,ref},signal()),{code:'invalid-input'});
  }finally{await app.dispose();}
});

test('viewing a song uploader exposes collections without following and remains viewable after unfollow',async()=>{
  const store=new FollowStore(database(),'a'),initial=store.read(),reads=[];
  const sources={cancelOwner(){},profile:async()=>{throw new Error('verified song authors do not require another profile lookup');},
    collections:async creator=>{reads.push(creator);return {items:[{id:'season:101:1',kind:'season',title:'作者合集',url:creator.url}]};},videos:async()=>({items:[track('BV1234567890',1)]})};
  const app=new Follows(store,sources,async()=>track('BV1234567890',1));
  try {
    const profile=await app.resolve({ref:{provider:'bilibili',kind:'video',id:'BV1234567890'},creator:{id:'999',name:'伪造作者'}},signal());
    assert.equal(profile.id,'101');assert.equal(profile.name,'作者 101');assert.deepEqual(store.read(),initial);
    assert.equal((await app.collections(profile,'browser',signal())).items.length,1);assert.equal(reads[0].id,'101');assert.deepEqual(store.read(),initial);
    assert.equal((await app.feed('browser',signal())).total,0,'previewed authors never enter the following updates feed');
    const saved=await app.change({revision:initial.revision,action:'follow',creator:{provider:profile.provider,id:profile.id,name:'伪造作者'}},signal());assert.equal(saved.creators[0].name,'作者 101');
    await app.change({revision:saved.revision,action:'unfollow',creator:profile},signal());
    assert.equal(store.read().creators.length,0);assert.equal((await app.collections(profile,'browser',signal())).items.length,1);assert.equal((await app.videos(profile,signal())).items.length,1);
  }finally{await app.dispose();}
});
test('user search does not follow and only an explicit revision-checked action saves the verified identity',async()=>{
  const store=new FollowStore(database(),'search'),profile={...author(),artwork:'https://i0.hdslb.com/avatar.jpg'},initial=store.read();
  const app=new Follows(store,{cancelOwner(){},profile:async()=>assert.fail('search supplies verified profile facts'),search:async request=>({items:[profile],page:request.page??1,pageSize:30,total:1,hasMore:false})},async()=>assert.fail('user search does not resolve video metadata'));
  try{
    const page=await app.search({provider:'bilibili',query:'作者'},signal());assert.equal(page.items[0].id,profile.id);assert.deepEqual(store.read(),initial);
    const saved=await app.change({revision:initial.revision,action:'follow',creator:{provider:'bilibili',id:profile.id,name:'客户端伪造名称'}},signal());
    assert.equal(saved.creators[0].name,profile.name);assert.equal(saved.creators[0].artwork,profile.artwork);
    await assert.rejects(app.change({revision:initial.revision,action:'unfollow',creator:profile},signal()),{code:'conflict'});
    await app.change({revision:saved.revision,action:'unfollow',creator:profile},signal());assert.equal(store.read().creators.length,0);
  }finally{await app.dispose();}
});

test('recent updates merge every followed source, sort real dates, preserve snapshots and limit concurrency',async()=>{
  const store=new FollowStore(database(),'a'),youtube=author('UCcvLSRIWJIAGFDyWtzkbiHA','youtube');
  for(const creator of [author(),author('102'),youtube])follow(store,creator);
  let active=0,maximum=0,calls=0,now=1000,failed=false;
  const sources={cancelOwner(){},videos:async creator=>{
    calls++;active++;maximum=Math.max(maximum,active);await new Promise(r=>setTimeout(r,5));active--;
    if(failed&&creator.id==='102')throw new MusicSourceError({code:'restricted',provider:'bilibili',retryable:true});
    return {items:[...Array.from({length:45},(_,i)=>track(`${creator.id}-${i}`,i+(creator.id==='102'?100:0),creator)),track(`${creator.id}-unknown`,undefined,creator)]};
  }};
  const app=new Follows(store,sources,async()=>track('BV1234567890',1),()=>now);
  try {
    const first=await app.feed('browser-a',signal());assert.equal(first.items.length,60);assert.equal(first.total,138);assert.equal(maximum,3);assert.equal(calls,3);
    assert(first.items[0].publishedAt>=first.items.at(-1).publishedAt);
    const second=await app.feed('browser-a',signal(),false,first.cursor),third=await app.feed('browser-a',signal(),false,second.cursor);
    const all=[...first.items,...second.items,...third.items];assert.equal(new Set(all.map(t=>t.resourceId)).size,138);assert.equal(all.at(-1).publishedAt,undefined);
    await assert.rejects(app.feed('browser-b',signal(),false,first.cursor),{code:'stale-cursor'});
    const youtubeFeed=await app.feed('browser-a',signal(),false,undefined,'youtube');assert.equal(youtubeFeed.total,46);assert(youtubeFeed.items.every(t=>t.ref.provider==='youtube'));assert.equal(calls,3);
    now+=300001;failed=true;const partial=await app.feed('browser-a',signal(),true);assert.equal(partial.total,138);assert.equal(partial.warnings[0].creator.id,'102');
    const state=store.read();await app.change({action:'unfollow',revision:state.revision,creator:author('102')},signal());
    await assert.rejects(app.feed('browser-a',signal(),false,first.cursor),{code:'stale-cursor'});
    const remaining=await app.feed('browser-a',signal());assert.equal(remaining.total,92);assert(!remaining.items.some(t=>t.uploader.id==='102'));
  }finally{await app.dispose();}
});

test('thousands of updates jump within a stable snapshot without re-reading sources and expire safely',async()=>{
  const store=new FollowStore(database(),'a');let now=1000,calls=0;
  const creators=Array.from({length:10},(_,index)=>author(String(101+index)));
  for(const creator of creators)follow(store,creator);
  const app=new Follows(store,{cancelOwner(){},videos:async creator=>{
    calls++;return {items:Array.from({length:240},(_,index)=>track(creator.id+'-'+index,Number(creator.id)*1000+index,creator))};
  }},async()=>track('unused',1),()=>now);
  try{
    const first=await app.feed('a',signal(),false,undefined,undefined,{page:1,pageSize:30});
    assert.equal(first.total,2400);assert.equal(first.items.length,30);assert.equal(calls,10);
    const tail=await app.feed('a',signal(),false,undefined,undefined,{page:80,pageSize:30,snapshot:first.snapshot});
    assert.equal(tail.page,80);assert.equal(tail.items.length,30);assert.equal(tail.cursor,undefined);assert.equal(calls,10);
    const changedSize=await app.feed('a',signal(),false,undefined,undefined,{page:24,pageSize:100,snapshot:first.snapshot});
    assert.equal(changedSize.items.length,100);assert.deepEqual(changedSize.items.slice(-30),tail.items);
    assert.equal(calls,10,'page and size changes use the original snapshot');
    await assert.rejects(app.feed('b',signal(),false,undefined,undefined,{page:2,pageSize:30,snapshot:first.snapshot}),{code:'stale-cursor'});
    await assert.rejects(app.feed('a',signal(),false,undefined,'youtube',{page:2,pageSize:30,snapshot:first.snapshot}),{code:'stale-cursor'});
    for(const options of [{page:0,pageSize:30},{page:1,pageSize:1000},{page:2,pageSize:30}])await assert.rejects(app.feed('a',signal(),false,undefined,undefined,options),{code:'invalid-input'});
    now+=600001;
    await assert.rejects(app.feed('a',signal(),false,undefined,undefined,{page:2,pageSize:30,snapshot:first.snapshot}),{code:'stale-cursor'});
  }finally{await app.dispose();}
});

test('author page jumps read only the required source pages, including different display sizes and the true tail',async()=>{
  const store=new FollowStore(database(),'a');follow(store,author());const calls=[];
  const items=Array.from({length:2368},(_,index)=>track('item-'+index,index));
  const app=new Follows(store,{cancelOwner(){},videos:async(_creator,_signal,cursor)=>{
    const page=Number(cursor??1);calls.push(page);return {items:items.slice((page-1)*30,page*30),total:items.length,...(page*30<items.length?{cursor:String(page+1)}:{})};
  }},async()=>track('unused',1));
  try{
    const tail=await app.videoPage(author(),undefined,signal(),79,30);
    assert.deepEqual(calls,[79]);assert.equal(tail.total,2368);assert.deepEqual(tail.items,items.slice(2340));
    calls.length=0;const middle=await app.videoPage(author(),undefined,signal(),41,20);
    assert.deepEqual(calls,[27,28]);assert.deepEqual(middle.items,items.slice(800,820));
    await assert.rejects(app.videoPage(author(),undefined,signal(),1,1000),{code:'invalid-input'});
  }finally{await app.dispose();}
});

test('cancellation prevents a delayed follow write and does not cancel another browser',async()=>{
  const store=new FollowStore(database(),'a');let finish;
  const wait=new Promise(r=>finish=r),app=new Follows(store,{cancelOwner(){}},async()=>{await wait;return track('BV1234567890',1);});
  try {
    const revision=store.read().revision,pending=app.run('a',signal(),s=>app.change({revision,action:'follow',ref:{provider:'bilibili',kind:'video',id:'BV1234567890'}},s));
    await Promise.resolve();app.cancelOwner('a');finish();await assert.rejects(pending,{code:'cancelled'});assert.equal(store.read().creators.length,0);
    assert.equal(await app.run('b',signal(),async()=>42),42);
  }finally{await app.dispose();}
});

test('the feed batch deadline returns successful updates, cached pages and warnings before the request timeout',async t=>{
  const timeout=AbortSignal.timeout.bind(AbortSignal);
  t.mock.method(AbortSignal,'timeout',milliseconds=>timeout(Math.ceil(milliseconds/100)));
  const store=new FollowStore(database(),'a');
  for(let id=101;id<=111;id++){
    const creator=author(String(id));follow(store,creator);
    store.remember(creator,Array.from({length:6},(_,i)=>track(`${id}-cached-${i}`,i,creator)),1);
  }
  let active=0,maximum=0,calls=0;
  const app=new Follows(store,{cancelOwner(){},videos:async(creator,readSignal)=>{
    calls++;active++;maximum=Math.max(maximum,active);
    try{
      if(creator.id==='111')return {items:[track('111-new',10000,creator)]};
      await delay(2000,undefined,{signal:readSignal});throw new Error('slow sources should be aborted');
    }finally{active--;}
  }},async()=>track('BV1234567890',1));
  try{
    const partial=await app.run('browser',signal(),s=>app.feed('browser',s,true));
    assert.equal(partial.total,67);assert.equal(partial.items.length,60);assert.equal(partial.items[0].title,'111-new');
    assert.equal(partial.warnings.length,10);assert.equal(new Set(partial.warnings.map(w=>w.creator.id)).size,10);
    assert(partial.warnings.every(w=>w.code==='timeout'));assert.equal(maximum,3);assert.equal(active,0);
    assert(calls<11,'authors beyond the batch deadline are warned without starting another source read');
    const next=await app.run('browser',signal(),s=>app.feed('browser',s,false,partial.cursor));
    assert.equal(next.items.length,7);assert.deepEqual(next.warnings,partial.warnings);
    assert.equal(new Set([...partial.items,...next.items].map(t=>t.resourceId)).size,67);
  }finally{await app.dispose();}
});

test('explicit cancellation of a feed rejects instead of returning a partial snapshot or changing cached updates',async()=>{
  const store=new FollowStore(database(),'a');follow(store,author());store.remember(author(),[track('cached',1)],1);
  let started;const begun=new Promise(resolve=>started=resolve);
  const app=new Follows(store,{cancelOwner(){},videos:async(creator,readSignal)=>{
    started();await delay(2000,undefined,{signal:readSignal});return {items:[track('late',2,creator)]};
  }},async()=>track('BV1234567890',1));
  try{
    const before=store.cached(author()),pending=app.run('browser',signal(),s=>app.feed('browser',s,true));
    await begun;app.cancelOwner('browser');await assert.rejects(pending,{code:'cancelled'});
    assert.deepEqual(store.cached(author()),before);
  }finally{await app.dispose();}
});

test('YouTube public updates reject other authors and keep absent dates unknown',()=>{
  const creator=author('UCcvLSRIWJIAGFDyWtzkbiHA','youtube');
  const entry=(channel,date='2026-10-12T10:00:00+00:00',id='abcdefghijk')=>`<entry><yt:videoId>${id}</yt:videoId><yt:channelId>${channel}</yt:channelId><title>音乐 &amp; 演奏</title><published>${date}</published><updated>2026-10-13T10:00:00Z</updated><author><name>真实作者</name></author><media:thumbnail url="http://i.ytimg.com/vi/${id}/hqdefault.jpg"/></entry>`;
  const items=parseYoutubeUpdates(`<feed>${entry(creator.id)}${entry('UCwrong')}${entry(creator.id,'invalid','lmnopqrstuv')}</feed>`,creator);
  assert.equal(items.length,2);assert.equal(items[0].title,'音乐 & 演奏');assert.equal(items[0].publishedAt,Date.parse('2026-10-12T10:00:00Z'));assert.equal(items[1].publishedAt,undefined);assert(items[0].artwork.startsWith('https:'));
  assert.throws(()=>parseYoutubeUpdates('<html>blocked</html>',creator),{code:'upstream'});
});

test('song authors and existing follows acquire HTTPS avatars without changing membership or follow revision',async()=>{
  const path=database(),store=new FollowStore(path,'a');follow(store,author());follow(store,author('102'));
  const before=store.read();let calls=0,failed=false,active=0,maximum=0;
  const sources={cancelOwner(){},profile:async ref=>{calls++;active++;maximum=Math.max(maximum,active);await new Promise(r=>setTimeout(r,2));active--;if(failed)throw new MusicSourceError({code:'restricted',retryable:true});return {...author(ref.id),artwork:`http://i0.hdslb.com/bfs/face/${ref.id}.jpg`};}};
  const app=new Follows(store,sources,async()=>track('BV1234567890',1));
  try {
    const preview=await app.resolve({ref:{provider:'bilibili',kind:'video',id:'BV1234567890'}},signal());assert.equal(preview.artwork,'https://i0.hdslb.com/bfs/face/101.jpg');
    const value=await app.readProfiles(signal());assert.equal(value.revision,before.revision);assert.equal(value.creators.length,2);assert(value.creators.every(c=>c.artwork.startsWith('https:')));assert.deepEqual(value.creators.map(c=>[c.id,c.name,c.followedAt]),before.creators.map(c=>[c.id,c.name,c.followedAt]));
    assert.equal(calls,2);await app.readProfiles(signal());assert.equal(calls,2,'cached profiles avoid repeated requests');assert(maximum<=3);
    failed=true;const preserved=await app.readProfiles(signal(),true);assert.deepEqual(preserved,value,'failed refresh keeps previously acquired avatars');
    const restored=new FollowStore(path,'a');try{assert.deepEqual(restored.read(),value);}finally{restored.close();}
  }finally{await app.dispose();}
});

test('late or cancelled avatar reads cannot restore an unfollowed author and a missing face cannot block content',async()=>{
  const store=new FollowStore(database(),'a');follow(store,author());let release,started;
  const waiting=new Promise(r=>release=r),begun=new Promise(r=>started=r);
  const app=new Follows(store,{cancelOwner(){},profile:async ref=>{started();await waiting;return {...author(ref.id),artwork:'http://i0.hdslb.com/face.jpg'};},collections:async()=>({items:[]})},async()=>track('BV1234567890',1));
  try{
    const pending=app.readProfiles(signal());await begun;store.change(store.read().revision,author(),false,signal());release();assert.equal((await pending).creators.length,0);
    assert.equal(store.read().creators.length,0);
    const controller=new AbortController();controller.abort();await assert.rejects(app.readProfiles(controller.signal));assert.equal(store.read().creators.length,0);
  }finally{await app.dispose();}
  const second=new FollowStore(database(),'a'),failing=new Follows(second,{cancelOwner(){},profile:async()=>{throw new MusicSourceError({code:'restricted',retryable:true});},collections:async()=>({items:[]})},async()=>track('BV1234567890',1));
  try{const preview=await failing.resolve({ref:{provider:'bilibili',kind:'video',id:'BV1234567890'}},signal());assert.equal(preview.artwork,undefined);assert.equal((await failing.collections(preview,'browser',signal())).items.length,0);}finally{await failing.dispose();}
});

test('known author collections and videos load while their missing avatar is still being refreshed',async()=>{
  const store=new FollowStore(database(),'a');follow(store,author());let release,started,profileCalls=0;
  const gate=new Promise(resolve=>release=resolve),begun=new Promise(resolve=>started=resolve);
  const app=new Follows(store,{cancelOwner(){},profile:async ref=>{profileCalls++;started();await gate;return {...author(ref.id),artwork:'https://i0.hdslb.com/face.jpg'};},
    collections:async creator=>({items:[{id:'season:101:1',kind:'season',title:creator.name,url:creator.url}]}),
    videos:async creator=>({items:[track('recent',2,creator)]}),collectionVideos:async creator=>({items:[track('collection',1,creator)]})},async()=>track('BV1234567890',1));
  const pending=app.creator(author(),signal(),true);
  try{
    await begun;const contentSignal=AbortSignal.timeout(1000);
    const [collections,videos,collection]=await Promise.all([app.collections(author(),'browser',contentSignal),app.videos(author(),contentSignal),app.collectionVideos(author(),'season:101:1',contentSignal)]);
    assert.equal(collections.items.length,1);assert.equal(videos.items[0].title,'recent');assert.equal(collection.items[0].title,'collection');
    assert.equal(profileCalls,1,'content requests reuse the known identity without starting avatar reads');
    assert.equal(store.read().creators[0].artwork,undefined,'avatar is still pending');
  }finally{release();await pending;await app.dispose();}
});

test('a slow full-list avatar refresh returns acquired and previous avatars within the batch budget',async t=>{
  const timeout=AbortSignal.timeout.bind(AbortSignal);
  t.mock.method(AbortSignal,'timeout',milliseconds=>timeout(Math.ceil(milliseconds/100)));
  const store=new FollowStore(database(),'a');
  for(let id=101;id<=124;id++)follow(store,{...author(String(id)),artwork:`https://i0.hdslb.com/old-${id}.jpg`});
  const before=store.read();let active=0,maximum=0;
  const app=new Follows(store,{cancelOwner(){},profile:async(ref,readSignal)=>{
    active++;maximum=Math.max(maximum,active);
    try{
      if(ref.id==='124')return {...author(ref.id),artwork:'https://i0.hdslb.com/new-124.jpg'};
      await delay(2000,undefined,{signal:readSignal});throw new Error('slow sources should be aborted');
    }finally{active--;}
  }},async()=>track('BV1234567890',1));
  try{
    const value=await app.run('browser',signal(),s=>app.readProfiles(s,true));
    assert.equal(value.revision,before.revision);assert.equal(value.creators.length,24);
    assert.equal(value.creators.find(c=>c.id==='124').artwork,'https://i0.hdslb.com/new-124.jpg');
    assert(value.creators.filter(c=>c.id!=='124').every(c=>c.artwork===`https://i0.hdslb.com/old-${c.id}.jpg`));
    assert.deepEqual(value.creators.map(c=>[c.id,c.followedAt]),before.creators.map(c=>[c.id,c.followedAt]));
    assert.equal(maximum,3);assert.equal(active,0);
  }finally{await app.dispose();}
});

test('public Bilibili card supplies avatar when the space profile is restricted',async()=>{
  const calls=[],host=createNodeHost({fetch:async input=>{const url=new URL(String(input));calls.push(url.pathname);if(url.pathname==='/x/web-interface/nav')return Response.json({code:0,data:{wbi_img:{img_url:'https://i0.hdslb.com/bfs/wbi/abcdefghijklmnopqrstuvwxyz012345.png',sub_url:'https://i0.hdslb.com/bfs/wbi/012345abcdefghijklmnopqrstuvwxyz.png'}}});if(url.pathname==='/x/space/wbi/acc/info')return Response.json({code:-352});if(url.pathname==='/x/web-interface/card')return Response.json({code:0,data:{card:{mid:'101',name:'真实 UP',face:'//i0.hdslb.com/bfs/face/101.jpg'}}});throw new Error('Unexpected endpoint');}});
  const sources=new CreatorSources(host,async()=>'buvid3=public-test');const profile=await sources.profile({provider:'bilibili',id:'101'},signal());assert.equal(profile.name,'真实 UP');assert.equal(profile.artwork,'https://i0.hdslb.com/bfs/face/101.jpg');assert(calls.includes('/x/web-interface/card'));
});

test('Bilibili creator directory signs public reads, paginates seasons and series, and validates ownership',async()=>{
  const calls=[],creator=author();
  const host=createNodeHost({fetch:async(input,options)=>{
    const url=new URL(String(input));calls.push({url,headers:options.headers});let data;
    if(url.pathname==='/x/web-interface/nav')data={wbi_img:{img_url:'https://i0.hdslb.com/bfs/wbi/abcdefghijklmnopqrstuvwxyz012345.png',sub_url:'https://i0.hdslb.com/bfs/wbi/012345abcdefghijklmnopqrstuvwxyz.png'}};
    else if(url.pathname==='/x/space/wbi/acc/info')data={mid:101,name:'真实作者',face:'http://i0.hdslb.com/face.png'};
    else if(url.pathname==='/x/space/wbi/arc/search')data={page:{count:61},list:{vlist:[{bvid:'BV1234567890',title:'视频',created:1700000000,pic:'http://i0.hdslb.com/cover.png',length:'3:20'}]}};
    else if(url.pathname==='/x/polymer/web-space/seasons_series_list')data={items_lists:{page:{total:21},seasons_list:[{meta:{mid:101,season_id:1,name:'合集',total:31},archives:[]}],series_list:[{meta:{mid:101,series_id:2,name:'系列',total:1}},{meta:{mid:999,series_id:3,name:'其他作者'}}]}};
    else if(url.pathname==='/x/polymer/web-space/seasons_archives_list')data={meta:{mid:101},page:{total:31},archives:[{bvid:'BV1234567890',title:'视频',pubdate:1700000000}]};
    else if(url.pathname==='/x/series/series')data={meta:{mid:101}};
    else if(url.pathname==='/x/series/archives')data={page:{total:1},archives:[{bvid:'BV1234567890',title:'视频'}]};
    else throw new Error('Unexpected '+url.pathname);
    return Response.json({code:0,data});
  }});
  const sources=new CreatorSources(host,async()=> 'buvid3=public-test');
  const profile=await sources.profile('https://space.bilibili.com/101',signal());assert.equal(profile.name,'真实作者');assert(profile.artwork.startsWith('https:'));
  const videos=await sources.videos(creator,signal(),'2');assert.equal(videos.cursor,'3');assert.equal(videos.items[0].durationSeconds,200);assert.equal(videos.items[0].publishedAt,1700000000000);
  assert(calls.find(c=>c.url.pathname.includes('arc/search')).url.searchParams.has('w_rid'));
  const collections=await sources.collections(creator,'browser',signal());assert.equal(collections.items.length,2);assert.equal(collections.cursor,'2');
  assert.equal((await sources.collectionVideos(creator,'season:101:1',signal())).cursor,'2');assert.equal((await sources.collectionVideos(creator,'series:101:2',signal())).items.length,1);
  await assert.rejects(sources.collectionVideos(creator,'season:999:1',signal()),{code:'invalid-input'});
  const before=calls.length;for(const input of ['https://evil.test/@name','http://127.0.0.1/101','https://space.bilibili.com.evil.test/101','https://www.youtube.com/watch?v=abcdefghijk'])await assert.rejects(sources.profile(input,signal()),{code:'invalid-input'});
  assert.equal(calls.length,before,'unsupported links never become arbitrary network requests');
});
