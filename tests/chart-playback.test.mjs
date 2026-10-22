import {test} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
const bundle=await build({entryPoints:['src/chart-playback.ts'],bundle:true,platform:'node',format:'esm',write:false});
const {readSavedPlayback,savedQueueEntry,pendingChartTrack,isTrack,fatalChartError}=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'));

const song={ref:{provider:'bilibili',kind:'video',id:'BV1234567890',part:'900'},resourceId:'bili-first',title:'七里香',url:'https://www.bilibili.com/video/BV1234567890'};
test('new queue persists selections and independent instances, excludes runtime data and never reads earlier formats',()=>{
  const pending=pendingChartTrack({rank:2,title:'待搜索',artists:['歌手'],artwork:'https://example.com/cover.jpg'},'chart-two');
  const resolved={...song,chartItem:{rank:1,title:'七里香'},delivery:{url:'secret'},lease:'private'};
  const stored=savedQueueEntry(resolved);assert(!('delivery' in stored));assert(!('lease' in stored));assert(!isTrack(pending));
  const values={'slow-listening:playback:v1':JSON.stringify({tracks:[song],current:song.resourceId,order:'sequential',repeat:'off',volume:.37,rate:1.5,muted:true})};
  const reads=[],storage={getItem:key=>{reads.push(key);return values[key]??null;}};assert.equal(readSavedPlayback(storage).tracks.length,0);
  values['slow-listening:playback:v3']=JSON.stringify({version:3,items:[stored,savedQueueEntry(pending)],current:pending.resourceId,order:'sequential',repeat:'off',volume:.6,rate:1.5});
  assert.deepEqual(readSavedPlayback(storage).tracks.map(track=>track.title),['七里香','待搜索']);assert.equal(readSavedPlayback(storage).current,'chart-two');assert.equal(readSavedPlayback(storage).rate,1.5);
  values['slow-listening:playback:v3']='bad';assert.equal(readSavedPlayback(storage).tracks.length,0);assert(reads.every(key=>key==='slow-listening:playback:v3'));
});
test('global failures suspend chart requests while per-song restrictions can be skipped',()=>{
  for(const code of ['authentication','network','rate-limited','stopping','version-mismatch'])assert(fatalChartError({code}));
  assert(fatalChartError({name:'NotAllowedError'}));assert(!fatalChartError({code:'not-found'}));assert(!fatalChartError({code:'restricted'}));
  for(const upstreamCode of ['500','502','503','504','599',undefined])assert(fatalChartError({code:'upstream',upstreamCode}));
  assert(fatalChartError({cause:{code:'upstream',upstreamCode:'503'}}));
  for(const upstreamCode of ['404','403','-400','invalid'])assert(!fatalChartError({code:'upstream',upstreamCode}));
});
