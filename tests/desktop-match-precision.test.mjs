import {test} from 'node:test';
import assert from 'node:assert/strict';
import {loadSongModule} from './helpers/song-services.mjs';
import {matchLabels} from './fixtures/desktop-match-labels.mjs';
import {mp4Prefix} from './fixtures/audio-prefix.mjs';
const {desktopSongMatchReasons,defaultSearchConfig,songMatchReasons}=await loadSongModule('search-policy');
const {MusicSearch}=await loadSongModule('music-search');
const {SearchSettingsStore}=await loadSongModule('search-settings');
const {verifySearchPlayback}=await loadSongModule('search-playback');
for(const sample of matchLabels)test('labelled desktop match: '+sample.id,()=>{
  const found=sample.candidates.findIndex(entry=>!desktopSongMatchReasons(entry,defaultSearchConfig(),sample.query).length);
  assert.equal(found<0?null:found,sample.expected);
});
test('explicit preference bypasses automatic rejection without searching',async t=>{
  const store=new SearchSettingsStore(':memory:','precision');t.after(()=>store.close());
  const entry=matchLabels.find(row=>row.id==='intro').candidates[0];
  store.prefer(store.read().revision,{title:'晴天',artists:['周杰伦']},entry);
  let searches=0;const api={search:async()=>{searches++;return {items:[]};},metadata:async()=>entry};
  const search=new MusicSearch(store,api,async()=>({tid:3}),()=>false,()=>'',Date.now);
  assert.equal((await search.resolve({title:'晴天',artists:['周杰伦'],searchMode:'title-artists'},new AbortController().signal)).ref.id,entry.ref.id);
  assert.equal(searches,0);
});
test('mobile legacy policy remains unchanged for desktop-only exclusions',()=>{
  const sample=matchLabels.find(row=>row.id==='style');
  assert.deepEqual(songMatchReasons(sample.candidates[0],defaultSearchConfig(),sample.query),[]);
});
test('explicit AI allow preferences retain their existing meaning in desktop strict mode',()=>{
  const config=defaultSearchConfig();config.versions.ai='allow';config.partitions.ai='allow';
  const sample=matchLabels.find(row=>row.id==='ai-voice-prefix');assert.deepEqual(desktopSongMatchReasons(sample.candidates[0],config,sample.query),[]);
});
test('prepared performer, version and duration facts are rechecked before media reads without losing generic part titles',async t=>{
  for(const patch of [{durationSeconds:35},{artists:['其他歌手']},{title:'周杰伦《晴天》前奏片段'}]){
    const store=new SearchSettingsStore(':memory:','prepared-facts');t.after(()=>store.close());let prepares=0,reads=0;
    const candidates=[0,1].map(index=>({ref:{provider:'bilibili',kind:'video',id:'BV'+String(index+1).padStart(10,'0')},resourceId:String(index),title:'周杰伦《晴天》',url:'https://www.bilibili.com'}));
    const host={now:Date.now,fetch:async()=>{reads++;return new Response(mp4Prefix(),{status:206,headers:{'Content-Range':'bytes 0-1023/2048'}});}};
    const matcher=new MusicSearch(store,{search:async()=>({items:candidates})},async()=>({tid:3}),()=>false,()=>'',Date.now,(entry,signal,support,accept)=>verifySearchPlayback({prepare:async()=>{prepares++;return {entry:{...entry,title:'P1',durationSeconds:270,...(entry===candidates[0]||entry.ref.id===candidates[0].ref.id?patch:{})},resourceId:entry.resourceId,format:{id:'aac',codec:'mp4a.40.2',container:'mp4',mimeType:'audio/mp4'},delivery:{url:'https://x.bilivideo.com/a',requiresHost:true}};}},host,entry.ref,{signal},support,undefined,accept));
    const found=await matcher.resolve({title:'晴天',artists:['周杰伦'],durationSeconds:270,searchMode:'title-artists'},new AbortController().signal);
    assert.equal(found.ref.id,candidates[1].ref.id);assert.equal(prepares,2);assert.equal(reads,1,'conflicting prepared facts do not consume media or another rendition');
  }
});
