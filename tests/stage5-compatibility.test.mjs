import test from 'node:test';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import {AccountBilibiliProvider as Current} from '../dist/server/bilibili-recommendations.js';
const before='D:/Workspace/studio/local/artifacts/audio-video/recommendation-stage5-2026-10-11/music-app-before/dist/server/bilibili-recommendations.js';
test('fixed old provider and current shared music classification have the same default native collection',async()=>{
 const {AccountBilibiliProvider:Old}=await import(pathToFileURL(before).href);
 const cases=[{tid:31},{tid:130},{tid:17},{tid:0,tid_v2:2027},{tid:2021},{tid:243,tname:'音乐'},{tid:244},{tid:31,tid_v2:2025},{tid:0,tid_v2:2026},{tid:0,tname:'原创音乐'},{tid:0,tname:'音乐教学'},{tid:0,tname:'乐评'},{tid:0,tname:'MV'},{tid:0,tname:'mv'},{tid:0,tname:'ＭＶ'},{tid:0,tname:' MV '},{tid:0,tname:'MV Show'},{tid:0,tname:'电台'},{tid:0,tname:'VOCALOID'},{tid:31,tname:'乐评',tname_v2:'翻唱'},{tid:31,tname_v2:'盘点'},{}];
 for(const [i,fields]of cases.entries()){
  const id='BV'+String(i+1).padStart(10,'0'),raw={bvid:id,title:'Music '+i,tid:0,tname:'',tname_v2:'',owner:{mid:10,name:'Author'},pages:[{cid:1000+i,duration:240}],...fields};
  const host={now:Date.now,md5:()=> 'fixture-signature',fetch:async input=>{const url=new URL(input);let data;
   if(url.pathname.endsWith('/nav'))data={isLogin:true,wbi_img:{img_url:'https://i/'+ 'a'.repeat(32)+'.png',sub_url:'https://i/'+ 'b'.repeat(32)+'.png'}};
   else if(url.pathname.endsWith('/index/top/feed/rcmd'))data={item:[{goto:'av',id:i+1,bvid:id,title:'Music'}]};
   else if(url.pathname.endsWith('/view'))data=raw;
   else if(url.pathname.endsWith('/all_period'))data={list:{2026:[{ID:1,priod:1,publish_time:1}]}};
   else data={list:[]};return Response.json({code:0,data});
  }};
  const c={host,scope:'fixture',signal:new AbortController().signal,credential:{revision:'fixture',cookie:'fixture'}};
  const old=new Old(),current=new Current();try{const a=(await old.discover(c))[0].page.items,b=(await current.discover(c))[0].page.items;assert.deepEqual(b.map(t=>({ref:t.ref,title:t.title,duration:t.durationSeconds})),a.map(t=>({ref:t.ref,title:t.title,duration:t.durationSeconds})),JSON.stringify(fields));}finally{await old.dispose();await current.dispose();}
 }
});
