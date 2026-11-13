import {test} from 'node:test';
import assert from 'node:assert/strict';
import {groupPartTracks,queueDisplayRows} from '../src/queue-groups.ts';
const parts=[1,2,3].map(index=>({resourceId:'p'+index,ref:{provider:'bilibili',kind:'video',id:'BV0000000001',part:String(index)},title:'分曲 '+index}));
test('explicit parts batches get separate groups while individual songs keep their occurrences',()=>{
  const first=groupPartTracks(parts,'一张专辑',()=> 'g1'),second=groupPartTracks(parts.map(part=>({...part,resourceId:'again-'+part.resourceId})),'一张专辑',()=> 'g2');
  const rows=queueDisplayRows([...first,parts[0],...second],new Set());
  assert.deepEqual(rows.map(row=>row.kind),['group','track','group']);
  assert.equal(rows[0].groupId,'g1');assert.equal(rows[2].groupId,'g2');assert.equal(rows[0].title,'一张专辑');
  assert.equal(queueDisplayRows(first,new Set(['g1'])).length,4);
  const mixed=[parts[0],{...parts[1],ref:{...parts[1].ref,id:'BV0000000002'}}];
  assert.equal(groupPartTracks(mixed,'不同视频',()=> 'bad'),mixed);
});
test('collapsing never hides an insertion between group members or changes input order',()=>{
  const grouped=groupPartTracks(parts,'专辑',()=> 'g'),single={...parts[0],resourceId:'single'};
  const input=[grouped[0],single,...grouped.slice(1)],before=structuredClone(input);
  const rows=queueDisplayRows(input,new Set());assert.deepEqual(rows.map(row=>row.key),['p1','single','group:g:p2']);
  assert.deepEqual(queueDisplayRows(input,new Set(['g'])).filter(row=>row.kind==='track').map(row=>row.track.resourceId),input.map(track=>track.resourceId));
  assert.deepEqual(input,before);
});
