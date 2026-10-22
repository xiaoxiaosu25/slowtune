import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { AccountBilibiliProvider } from '../dist/server/bilibili-recommendations.js';


const bv=n=>'BV'+String(n).padStart(10,'0');
const json=data=>Response.json({code:0,data});
const video=(n,extras={})=>({bvid:bv(n),title:'视频 '+n,pic:'http://i1.hdslb.com/bfs/archive/'+n+'.jpg',tid:17,tname:'',tname_v2:'',pages:[{cid:1000+n,duration:240}],...extras});
const candidate=n=>({goto:'av',id:n,bvid:bv(n),title:'视频 '+n});
function context(fetcher){return {host:{fetch:fetcher,now:Date.now,md5:s=>createHash('md5').update(s).digest('hex')},scope:'fixture-account',signal:new AbortController().signal,credential:{revision:'fixture',cookie:'SESSDATA=fixture'}};}
function publicReply(url){
  if(url.pathname.endsWith('/nav'))return json({isLogin:true,wbi_img:{img_url:'https://i0.hdslb.com/'+ 'a'.repeat(32)+'.png',sub_url:'https://i0.hdslb.com/'+ 'b'.repeat(32)+'.png'}});
  if(url.pathname.endsWith('/toplist/all_period'))return json({list:{2026:[{ID:439,priod:226,publish_time:1791540001}]}});
  if(url.pathname.endsWith('/toplist/music_list')||url.pathname.endsWith('/new/music'))return json({list:[]});
  if(url.pathname.endsWith('/region/feed/rcmd'))return json({archives:[]});
}

test('account discovery recognizes empty category names, music after video 12, and subsequent feed batches',async()=>{
  let batch=0,active=0,maxActive=0;const feedQueries=[];
  const provider=new AccountBilibiliProvider();
  const c=context(async(input,options)=>{
    const url=new URL(input);const common=publicReply(url);if(common)return common;
    if(url.pathname.endsWith('/index/top/feed/rcmd')){
      feedQueries.push(url.searchParams);batch++;
      return json({item:batch===1?Array.from({length:14},(_,i)=>candidate(i+1)):batch===2?[candidate(15),candidate(16),candidate(17)]:[candidate(13),candidate(15)]});
    }
    if(url.pathname.endsWith('/view')){
      active++;maxActive=Math.max(active,maxActive);await new Promise(r=>setTimeout(r,2));active--;
      const n=Number(url.searchParams.get('bvid').slice(2));
      return json(video(n,n===13?{tid:31,tid_v2:2027}:n===14?{tid:244,tid_v2:2025}:n===15?{tid:130,tid_v2:2024}:n===16?{tid:0,tid_v2:2021}:n===17?{tid:243,tid_v2:2026}:{}));
    }
    throw new Error('Unexpected '+url.pathname);
  });
  const first=(await provider.discover(c))[0];
  assert.deepEqual(first.page.items.map(t=>t.ref.id),[bv(13),bv(15),bv(16)]);
  assert(first.page.items.every(t=>t.artwork?.startsWith('https:')),'HTTP video covers are upgraded for the browser img-src policy');
  assert.deepEqual(feedQueries.map(q=>q.get('fresh_idx')),['1','2','3']);
  assert(feedQueries[1].get('last_showlist').includes('av_13'));
  assert(maxActive<=4&&maxActive>1,'metadata reads have bounded concurrency');
  const repeated=(await provider.discover(c))[0];
  assert(repeated.page.items.length>0,'deduplication must not erase valid repeated music');
});

test('discovery bounds upstream requests and advances anonymous music pages',async()=>{
  let batch=0,views=0;const displays=[];
  const provider=new AccountBilibiliProvider();
  const c=context(async(input)=>{
    const url=new URL(input);
    if(url.pathname.endsWith('/index/top/feed/rcmd')){const start=(batch++)*30;return json({item:Array.from({length:30},(_,i)=>candidate(start+i+1))});}
    if(url.pathname.endsWith('/view')){views++;return json(video(Number(url.searchParams.get('bvid').slice(2))));}
    if(url.pathname.endsWith('/region/feed/rcmd')){displays.push(url.searchParams.get('display_id'));return json({archives:[video(Number(url.searchParams.get('display_id')),{tid:31})]});}
    const common=publicReply(url);if(common)return common;throw new Error('Unexpected '+url.pathname);
  });
  assert.equal((await provider.discover(c))[0].page.items.length,0);
  assert(batch<=3);assert.equal(views,60);
  const anonymous={...c,credential:undefined,scope:'anonymous'};
  const one=await provider.discover(anonymous),two=await provider.discover(anonymous);
  assert.deepEqual(displays,['1','2']);
  assert.notEqual(one[0].page.items[0].ref.id,two[0].page.items[0].ref.id);
});

test('anonymous discovery reads only recommendation endpoints',async()=>{
 const calls=[],provider=new AccountBilibiliProvider();const c={...context(async input=>{const u=new URL(input);calls.push(u.pathname);return publicReply(u);}),credential:undefined,scope:'anonymous'};
 const shelves=await provider.discover(c);assert.deepEqual(shelves.map(s=>s.id),['music-recommendation']);
 assert(calls.every(p=>p.endsWith('/region/feed/rcmd')));await provider.dispose();
});
test('shared candidate cancellation waits for physical release and does not cancel another browser',async()=>{
 let active=0;const provider=new AccountBilibiliProvider();
 const host={now:Date.now,fetch:async(input,options)=>{active++;try{await new Promise((resolve,reject)=>{const timer=setTimeout(resolve,25);options.signal.addEventListener('abort',()=>{clearTimeout(timer);reject(options.signal.reason);},{once:true});});return publicReply(new URL(input));}finally{active--;}}};
 const c=owner=>({host,signal:new AbortController().signal,scope:JSON.stringify(['anonymous','shared',owner])});
 const one=provider.discoverCandidates(c('first'),[]),rejection=assert.rejects(one,{code:'cancelled'}),two=provider.discoverCandidates(c('second'),[]);
 await new Promise(r=>setTimeout(r,5));provider.cancelCandidates('first');await rejection;const result=await two;assert.equal(result.length,1);assert.equal(active,0);assert.equal(provider.candidateDiagnostics().active,0);await provider.dispose();
});
test('account refill continues past twelve musical videos until current rules have twelve eligible results',async()=>{
 let feeds=0,views=0;const provider=new AccountBilibiliProvider();
 const c=context(async input=>{
  const url=new URL(input);
  if(url.pathname.endsWith('/index/top/feed/rcmd')){const start=feeds++*30;return json({item:Array.from({length:30},(_,i)=>candidate(start+i+1))});}
  if(url.pathname.endsWith('/view')){views++;const n=Number(url.searchParams.get('bvid').slice(2));return json(video(n,{tid:31,title:n>=35?'qualified '+n:'rejected '+n}));}
  return publicReply(url);
 });
 try{
  const shelf=(await provider.discoverCandidates(c,[],items=>items.filter(item=>item.title.startsWith('qualified')).length>=12))[0];
  assert.equal(feeds,2);assert(views<=60);assert(shelf.page.items.filter(item=>item.title.startsWith('qualified')).length>=12);
 }finally{await provider.dispose();}
});
test('anonymous refill is bounded to three pages and partial failure retains current candidates',async()=>{
 let pages=0,fail=false;const provider=new AccountBilibiliProvider();
 const c={...context(async input=>{const url=new URL(input);if(url.pathname.endsWith('/region/feed/rcmd')){pages++;if(fail&&pages===2)throw new Error('offline');return json({archives:[video(pages,{tid:31})]});}return publicReply(url);}),credential:undefined};
 try{
  const complete=(await provider.discoverCandidates(c,[],()=>false))[0];assert.equal(pages,3);assert.equal(complete.page.items.length,3);
  pages=0;fail=true;const partial=(await provider.discoverCandidates(c,[],()=>false))[0];assert.equal(pages,2);assert.equal(partial.page.items.length,1);assert(partial.candidateIssue);
 }finally{await provider.dispose();}
});
test('each browser next batch continues the startup page independently',async()=>{
 const pages=[],provider=new AccountBilibiliProvider();
 const base={...context(async input=>{const url=new URL(input);if(url.pathname.endsWith('/region/feed/rcmd')){const page=Number(url.searchParams.get('display_id'));pages.push(page);return json({archives:[video(page,{tid:31})]});}return publicReply(url);}),credential:undefined,scope:'startup'};
 try{
  await provider.discoverCandidates(base,[],()=>true);
  provider.inheritCandidates('startup','browser-a');provider.inheritCandidates('startup','browser-b');
  await provider.discoverCandidates({...base,scope:'browser-a'},[],()=>true);await provider.discoverCandidates({...base,scope:'browser-b'},[],()=>true);
  provider.inheritCandidates('startup','browser-a');await provider.discoverCandidates({...base,scope:'browser-a'},[],()=>true);
  assert.deepEqual(pages,[1,2,2,3]);
 }finally{await provider.dispose();}
});
