import {test} from 'node:test';
import assert from 'node:assert/strict';
import {resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';
const {MusicCharts}=await import(pathToFileURL(join(resolve(process.env.MUSIC_APP_TEST_BUILD??'.'),'dist/server/charts.js')));

test('all chart adapters return only real names and ranks, keep same-name songs and honor daily cache expiry',async()=>{
  let now=1800000000000,broken=false;const calls=[];
  const host={now:()=>now,fetch:async(input,options)=>{
    assert.equal(new Headers(options.headers).has('Cookie'),false);const url=new URL(input);calls.push(url);
    if(broken)return new Response('broken',{status:503});
    if(url.hostname==='music.163.com')return Response.json({code:200,result:{updateTime:1799999999999,tracks:[{name:'原歌名 (Live)',id:1},{name:'同名歌',id:2},{name:'同名歌',id:3},{name:''}]}});
    if(url.hostname==='c.y.qq.com')return new Response(JSON.stringify({code:0,update_time:'2026-10-13',songlist:[{data:{songname:'QQ原歌名'}}]}),{headers:{'Content-Type':'text/html'}});
    if(url.hostname==='rss.marketingtools.apple.com')return Response.json({feed:{updated:'Tue, 13 Oct 2026 10:58:09 +0000',results:[{name:'Apple原歌名'}]}});
    throw Error('unexpected '+url);
  }};
  const charts=new MusicCharts(host),signal=new AbortController().signal;
  for(const chart of ['hot','new','rising']){
    const result=await charts.read({source:'netease',chart},signal);
    assert.deepEqual(result.items,[{rank:1,title:'原歌名 (Live)'},{rank:2,title:'同名歌'},{rank:3,title:'同名歌'}]);
    assert.equal(result.updatedAt,1799999999999);
  }
  assert.deepEqual((await charts.read({source:'qq'},signal)).items,[{rank:1,title:'QQ原歌名'}]);
  assert.deepEqual((await charts.read({source:'apple'},signal)).items,[{rank:1,title:'Apple原歌名'}]);
  const before=calls.length;now=1799999999999+86400000-1;await charts.read({source:'netease'},signal);assert.equal(calls.length,before);
  now+=2;broken=true;await assert.rejects(charts.read({source:'netease'},signal),{code:'upstream'});
  broken=false;assert.equal((await charts.read({source:'netease'},signal)).items.length,3);
  for(const input of [{source:'bad'},{source:'qq',chart:'new'},{source:'apple',period:'latest'},{source:'bilibili',period:'-1'}])await assert.rejects(charts.read(input,signal),{code:'invalid-input'});
  const stop=new AbortController();stop.abort();await assert.rejects(charts.read({source:'netease'},stop.signal),{code:'cancelled'});
  const timeout=new AbortController();timeout.abort(new DOMException('timeout','TimeoutError'));await assert.rejects(charts.read({source:'netease'},timeout.signal),{code:'timeout'});
  await charts.dispose();
});

test('B站 uses original music ranks and names even without videos; latest and historical caches are independent',async()=>{
  let now=1791600000000,newPeriod=false,empty=false;const calls=[];
  const host={now:()=>now,fetch:async(input,options)=>{
    assert.equal(new Headers(options.headers).has('Cookie'),false);const url=new URL(input);calls.push(url);
    if(url.pathname.endsWith('/all_period'))return Response.json({code:0,data:{list:{2026:[{ID:439,priod:226,publish_time:1791540001},{ID:437,priod:225,publish_time:1790935200},...(newPeriod?[{ID:441,priod:227,publish_time:1792144800}]:[])]}}});
    return Response.json({code:0,data:{list:empty?[]:[{music_title:'无关联视频',rank:1,mv_bvid:'',creation_bvid:''},{music_title:'仅歌曲名',rank:2},{music_title:'同名',rank:3},{music_title:'同名',rank:4}]}});
  }};
  const charts=new MusicCharts(host),signal=new AbortController().signal;
  const latest=await charts.read({source:'bilibili'},signal);assert.equal(latest.period.number,226);
  assert.deepEqual(latest.items,[{rank:1,title:'无关联视频'},{rank:2,title:'仅歌曲名'},{rank:3,title:'同名'},{rank:4,title:'同名'}]);
  const history=await charts.read({source:'bilibili',period:'437'},signal);assert.equal(history.period.number,225);
  const count=id=>calls.filter(u=>u.pathname.endsWith('/music_list')&&u.searchParams.get('list_id')===id).length;
  await charts.read({source:'bilibili'},signal);assert.equal(count('439'),1);
  const catalogueCalls=()=>calls.filter(u=>u.pathname.endsWith('/all_period')).length;
  now+=2*86400000;await charts.read({source:'bilibili'},signal);assert.equal(count('439'),1);assert.equal(catalogueCalls(),1);
  newPeriod=true;now=1791540001000+7*86400000;assert.equal((await charts.read({source:'bilibili'},signal)).period.id,441);
  await charts.read({source:'bilibili',period:'437'},signal);assert.equal(count('437'),1);
  await assert.rejects(charts.read({source:'bilibili',period:'999'},signal),{code:'not-found'});
  now+=8*86400000;empty=true;await charts.read({source:'bilibili',period:'437'},signal);assert.equal(count('437'),1);
  assert(calls.every(u=>!u.pathname.includes('centralization')));await charts.dispose();
});

test('source update cadence sets the next check; overdue publication is checked hourly and missing dates use a full cycle',async()=>{
  const day=86400000,hour=3600000,updated=Date.parse('2026-10-12T08:00:00+08:00');let now=updated+day/2,description='每周更新',updatedAt=updated;
  let calls=0;
  const charts=new MusicCharts({now:()=>now,fetch:async()=>{calls++;return Response.json({code:200,result:{description,updateTime:updatedAt,tracks:[{name:'缓存歌曲'}]}});}}),signal=new AbortController().signal;
  const first=await charts.read({},signal);assert.equal(first.updateFrequency,'weekly');assert.equal(first.refreshAfter,updated+7*day);
  first.items[0].title='不能修改缓存';now=updated+6*day;assert.equal((await charts.read({},signal)).items[0].title,'缓存歌曲');assert.equal(calls,1);
  now=updated+7*day;const delayed=await charts.read({},signal);assert.equal(calls,2);assert.equal(delayed.refreshAfter,now+hour);
  now+=hour-1;await charts.read({},signal);assert.equal(calls,2);
  now++;description='每日更新';updatedAt=now;const daily=await charts.read({},signal);assert.equal(calls,3);assert.equal(daily.refreshAfter,now+day);assert.equal(daily.updateFrequency,'daily');
  description='每天更新';updatedAt=undefined;const undated=await charts.read({chart:'new'},signal);assert.equal(undated.refreshAfter,now+day);
  await charts.dispose();
});

test('QQ reads its stated weekly cadence instead of assuming a daily chart',async()=>{
  const updated=Date.parse('2026-10-12T00:00:00+08:00'),now=updated+3600000;
  const charts=new MusicCharts({now:()=>now,fetch:async()=>Response.json({code:0,update_time:'2026-10-12',topinfo:{info:'更新频率：每周更新。'},songlist:[{data:{songname:'周榜歌曲'}}]})});
  const result=await charts.read({source:'qq'},new AbortController().signal);assert.equal(result.refreshAfter,updated+7*86400000);assert.equal(result.updateFrequency,'weekly');await charts.dispose();
});

test('concurrent reads share one fetch; cancelling one reader keeps the other reader and cache valid',async()=>{
  let release,calls=0;const waiting=new Promise(resolve=>release=resolve);
  const charts=new MusicCharts({now:()=>1800000000000,fetch:async(_url,{signal})=>{calls++;await waiting;signal.throwIfAborted();return Response.json({code:200,result:{tracks:[{name:'共享榜单'}]}});}});
  const cancelled=new AbortController(),a=charts.read({},cancelled.signal),b=charts.read({source:'netease',chart:'hot'},new AbortController().signal);
  cancelled.abort();await assert.rejects(a,{code:'cancelled'});release();const result=await b;assert.equal(calls,1);assert.equal(result.items[0].title,'共享榜单');
  result.items.length=0;assert.equal((await charts.read({},new AbortController().signal)).items.length,1);assert.equal(calls,1);await charts.dispose();
});

test('a fully cancelled fetch cannot populate the chart cache and a later visit starts a new fetch',async()=>{
  let release,calls=0;const waiting=new Promise(resolve=>release=resolve);
  const charts=new MusicCharts({now:()=>1800000000000,fetch:async()=>{if(++calls===1)await waiting;return Response.json({code:200,result:{tracks:[{name:calls===1?'迟到榜单':'新榜单'}]}});}});
  const stop=new AbortController(),first=charts.read({},stop.signal);stop.abort();await assert.rejects(first,{code:'cancelled'});
  assert.equal((await charts.read({},new AbortController().signal)).items[0].title,'新榜单');release();await new Promise(resolve=>setImmediate(resolve));
  assert.equal((await charts.read({},new AbortController().signal)).items[0].title,'新榜单');assert.equal(calls,2);await charts.dispose();
});

test('chart adapters include only source-backed artists and HTTPS artwork without changing ranks or names',async()=>{
  const host={now:()=>1800000000000,fetch:async input=>{
    const url=new URL(input);
    if(url.hostname==='music.163.com')return Response.json({code:200,result:{tracks:[{name:'原名 (Live)',artists:[{name:'歌手甲'},{name:'歌手乙'},{name:''}],album:{picUrl:'http://p1.music.126.net/cover.jpg'}},{name:'同名歌',artists:null,album:{picUrl:'javascript:bad'}},{name:'同名歌'}]}});
    if(url.hostname==='c.y.qq.com')return Response.json({code:0,songlist:[{data:{songname:'QQ歌',singer:[{name:'QQ歌手'}],albummid:'004VSvF52mQoQp'}},{data:{songname:'缺封面',albummid:'bad/path'}}]});
    if(url.hostname==='rss.marketingtools.apple.com')return Response.json({feed:{results:[{name:'Apple歌',artistName:'歌手 & 合作者',artworkUrl100:'https://is1-ssl.mzstatic.com/cover.jpg'}]}});
    if(url.pathname.endsWith('/all_period'))return Response.json({code:0,data:{list:{2026:[{ID:439,priod:226,publish_time:1791540001}]}}});
    return Response.json({code:0,data:{list:[{rank:3,music_title:'B站原名',singer:'甲,乙',mv_cover:'http://i0.hdslb.com/mv.jpg',creation_cover:'https://i1.hdslb.com/video.jpg'},{rank:4,music_title:'无MV',creation_cover:'//i1.hdslb.com/video.jpg'},{rank:5,music_title:'缺资料'}]}});
  }};
  const charts=new MusicCharts(host),signal=new AbortController().signal;
  assert.deepEqual((await charts.read({source:'netease'},signal)).items,[{rank:1,title:'原名 (Live)',artists:['歌手甲','歌手乙'],artwork:'https://p1.music.126.net/cover.jpg'},{rank:2,title:'同名歌'},{rank:3,title:'同名歌'}]);
  assert.deepEqual((await charts.read({source:'qq'},signal)).items,[{rank:1,title:'QQ歌',artists:['QQ歌手'],artwork:'https://y.gtimg.cn/music/photo_new/T002R300x300M000004VSvF52mQoQp.jpg'},{rank:2,title:'缺封面'}]);
  assert.deepEqual((await charts.read({source:'apple'},signal)).items,[{rank:1,title:'Apple歌',artists:['歌手 & 合作者'],artwork:'https://is1-ssl.mzstatic.com/cover.jpg'}]);
  assert.deepEqual((await charts.read({source:'bilibili'},signal)).items,[{rank:3,title:'B站原名',artists:['甲','乙'],artwork:'https://i0.hdslb.com/mv.jpg'},{rank:4,title:'无MV',artwork:'https://i1.hdslb.com/video.jpg'},{rank:5,title:'缺资料'}]);
  await charts.dispose();
});
