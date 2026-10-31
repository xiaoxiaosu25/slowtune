import {test} from 'node:test';
import assert from 'node:assert/strict';
import {audioSelection,audioSelector,sameAudioSelection} from '../dist/server/audio-selection.js';
import {audioQualityLabel,prepareBestAudio} from '../dist/server/audio-quality.js';
import {DesktopPlayback} from '../dist/server/desktop-playback.js';
import {SearchSettingsStore} from '../dist/server/search-settings.js';
import {MusicSearch} from '../dist/server/music-search.js';
const ref={provider:'bilibili',kind:'video',id:'BV0000000001',part:'7'},aac={id:'high',codec:'mp4a.40.2',container:'mp4',mimeType:'audio/mp4',bitrate:192000},low={...aac,id:'low',bitrate:64000},flac={...aac,id:'lossless',codec:'fLaC',bitrate:1000000};
const formats=[flac,aac,low,{...aac,id:'opus',codec:'opus',bitrate:32000}];
test('quality preferences choose compatible families before bitrate and never infer unknown specifications',()=>{
  assert.equal(audioSelector(audioSelection()),undefined);assert.equal(audioSelector(audioSelection({preference:'compatible'}))(formats),aac.id);assert.equal(audioSelector(audioSelection({preference:'economy'}))(formats),low.id);
  assert.equal(audioSelector(audioSelection({preference:'auto',formatId:'missing'}))(formats),undefined);
  assert.equal(audioQualityLabel({...flac,sampleRate:96000,channels:2,bitDepth:24}),'FLAC 无损 · 1000 kbps · 96 kHz · 24 bit · 2 声道');assert(!audioQualityLabel(flac).includes('kHz'));assert(!audioQualityLabel(flac).includes('声道'));
  for(const value of [null,[],{preference:'invalid'},{preference:['auto']},{preference:{value:'auto'}},{preference:'auto',url:'private'},{preference:'auto',formatId:''}])assert.throws(()=>audioSelection(value),{code:'invalid-input'});
  const input={preference:'economy'},snapshot=audioSelection(input);input.preference='auto';assert.equal(snapshot.preference,'economy');assert(Object.isFrozen(snapshot));assert(sameAudioSelection(undefined,{preference:'auto'}));
});
test('search verification and match cache retain policy identity without changing song data',async t=>{
  const store=new SearchSettingsStore(':memory:','quality');t.after(()=>store.close());const entry={ref,resourceId:'fixture',title:'杨丞琳《雨爱》',url:'https://www.bilibili.com/video/'+ref.id},seen=[];let searches=0;
  const search=new MusicSearch(store,{search:async()=>{searches++;return {items:[entry]};},metadata:async()=>entry},async()=>({tid_v2:2024}),()=>false,()=> 'one',Date.now,async(candidate,_signal,_support,_accept,selection)=>{seen.push(selection);return {ref:candidate.ref,format:selection.preference==='economy'?low:aac,selection};});t.after(()=>search.dispose());
  const query={title:'雨爱',artists:['杨丞琳'],searchMode:'title-artists'},signal=new AbortController().signal;
  assert.equal((await search.resolve(query,signal)).verifiedAudio.format.id,'high');await search.resolve(query,signal);assert.equal(searches,1);
  const economy=audioSelection({preference:'economy'});assert.equal((await search.resolve({...query,audioSelection:economy},signal)).verifiedAudio.format.id,'low');assert.equal(searches,2);await search.resolve({...query,audioSelection:economy},signal);assert.equal(searches,2);
  assert.deepEqual(seen.map(row=>row.preference),['auto','auto','economy','economy']);assert.equal(entry.verifiedAudio,undefined);assert(Object.isFrozen(seen[2]));
});
test('preparation tokens and shared source work cannot cross audio selection snapshots',async()=>{
  const prepared=[],api={capabilities:()=>({operations:['formats']}),formats:async()=>formats,prepare:async request=>{prepared.push(request.formatId);return {entry:{ref,title:'fixture'},resourceId:'fixture',format:formats.find(format=>format.id===request.formatId),delivery:{url:'https://fixture.bilivideo.com/audio',requiresHost:true}};}};
  const desktop=new DesktopPlayback(()=> 'one'),signal=new AbortController().signal,support=['audio/mp4; codecs="mp4a.40.2"','audio/mp4; codecs="fLaC"'];
  try{await desktop.run('owner','test',signal,async signal=>{
    const automatic=await prepareBestAudio(api,{ref},{signal},()=>true),token=desktop.verified(automatic,{preference:'auto'});
    const compatible=await desktop.prepare(api,{ref},{signal},support,token,{preference:'compatible'});assert.equal(compatible.format.id,'high');assert.equal(prepared.length,2,'An old auto ticket must not satisfy compatible policy');
    const selectedToken=desktop.verified(compatible,{preference:'compatible'}),reused=await desktop.prepare(api,{ref},{signal},support,selectedToken,{preference:'compatible'});assert.equal(reused.format.id,'high');assert.equal(prepared.length,2);
    const result=await Promise.all([desktop.prepare(api,{ref},{signal},support,undefined,{preference:'auto'}),desktop.prepare(api,{ref},{signal},support,undefined,{preference:'economy'})]);assert.deepEqual(result.map(row=>row.format.id),['lossless','low']);
    await assert.rejects(desktop.prepare(api,{ref},{signal},support,undefined,{preference:'compatible',formatId:'missing'}),{code:'unsupported'});
  });}finally{desktop.dispose();}
});
