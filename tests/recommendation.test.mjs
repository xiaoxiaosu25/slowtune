import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {join,resolve} from 'node:path';
import {MusicRecommendations,RecommendationStore,projectMusic,translateLegacy,columns} from '../dist/server/recommendation.js';
const signal=()=>new AbortController().signal;
const root=resolve('..','local/artifacts/audio-video/recommendation-stage5-2026-10-11');mkdirSync(root,{recursive:true});
const track=(i,extra={})=>({ref:{provider:'youtube',kind:'video',id:String(i).padStart(11,'0')},resourceId:'youtube:'+i,title:'Music '+i,url:'https://youtube.com/watch?v='+String(i).padStart(11,'0'),...extra});
const id='youtube-music-selection';
const shelf=(items)=>({id,title:'YouTube 音乐精选',kind:'recommendation',page:{items}});
function fixture(){const dir=mkdtempSync(join(root,'settings-')),file=join(dir,'settings.sqlite'),store=new RecommendationStore(file,'isolated');let auth='a';const manager=new MusicRecommendations(store,()=>auth);return {dir,file,store,manager,setAuth:value=>auth=value};}
test('independent revision streams, complete CAS, legacy process editing, restart and explicit absorption',()=>{
 let {file,store,manager}=fixture();let state=store.read(id);
 const overrides={include:{mode:'any',groups:[{id:'new',fields:['title'],mode:'any',terms:['Music']}]}};
 const saved=store.update(id,state,{overrides},signal());assert.equal(saved.legacyRevision,state.legacyRevision);assert.notEqual(saved.sharedRevision,state.sharedRevision);
 assert.throws(()=>store.update(id,state,{entry:0},signal()),{code:'conflict'});
 const old=store.update(id,saved,{entry:0},signal());
 const reader=spawnSync(process.execPath,[resolve('scripts/recommendation-legacy-reader.mjs'),file,'isolated',id,JSON.stringify(old),JSON.stringify({include:['Music 2'],exclude:['never'],mode:'any',order:'upstream'})],{encoding:'utf8',windowsHide:true});assert.equal(reader.status,0,reader.stderr);
 const edited=store.read(id);assert.notEqual(edited.legacyRevision,old.legacyRevision);assert.equal(edited.sharedRevision,saved.sharedRevision);assert.deepEqual(edited.document.overrides,overrides);
 store.close();store=new RecommendationStore(file,'isolated');assert.deepEqual(store.read(id),edited);
 const returned=store.update(id,edited,{entry:1},signal());assert.deepEqual(returned.document.overrides,overrides);assert.deepEqual(returned.legacy,edited.legacy);
 const absorbed=store.update(id,returned,{overrides:translateLegacy(returned.legacy),absorbLegacy:true},signal());assert.deepEqual(absorbed.document.overrides,translateLegacy(edited.legacy));assert.equal(absorbed.legacyRevision,edited.legacyRevision);
 const cancelled=new AbortController();cancelled.abort();assert.throws(()=>store.update(id,absorbed,{entry:0},cancelled.signal));assert.deepEqual(store.read(id),absorbed);
 const afterWrite=store.update(id,absorbed,{entry:0},signal());cancelled.abort();assert.equal(store.read(id).epoch,afterWrite.epoch,'cancelled response does not undo an actual write');store.close();
});
test('preview executor, 36/all candidates, valid display only, stale context, missing fields and seed',()=>{
 const {store,manager,setAuth}=fixture();const items=Array.from({length:36},(_,i)=>track(i));const raw=shelf(items);manager.remember('browser',raw,'youtube:HK','fixed');
 const input=manager.begin('browser',id),result=manager.select('browser',raw,input,'fixed','youtube:HK',signal());assert.equal(result.page.items.length,36);
 const preview=manager.preview('browser',id,{},signal());assert.deepEqual(preview.page.items,result.page.items);assert.equal(preview.recommendation.token,undefined);assert.equal(manager.diagnostics().histories,0);assert.equal(manager.confirm('browser',id,result.recommendation.token,[]).accepted,false,'preview supersedes stale pending token');
 const current=manager.select('browser',raw,manager.begin('browser',id),'fixed','youtube:HK',signal());const keys=current.page.items.slice(0,12).map(t=>JSON.stringify([t.ref.provider,t.ref.id,null]));assert.equal(manager.confirm('browser',id,current.recommendation.token,keys).accepted,true);
 const changed=manager.select('browser',raw,manager.begin('browser',id),'fixed','youtube:HK',signal());assert.equal(changed.page.items[0].ref.id,items[12].ref.id);assert.equal(changed.page.items.length,36,'all eligible repeats follow fresh');
 setAuth('b');assert.equal(manager.confirm('browser',id,changed.recommendation.token,keys).accepted,false);
 manager.remember('browser',raw,'youtube:HK','fixed');const unknown=manager.preview('browser',id,{include:{mode:'any',groups:[{id:'tag',fields:['tags'],mode:'any',terms:['music']}]}},signal());assert.equal(unknown.page.items.length,0);assert(Object.keys(unknown.recommendation.diagnostics.rejected).some(k=>k.includes('unknown')));
 const begun=manager.begin('browser',id);manager.invalidate('browser');assert.throws(()=>manager.select('browser',raw,begun,'fixed','youtube:HK',signal()),{code:'conflict'});
 manager.remember('browser',raw,'youtube:HK','fixed');manager.begin('browser',id,'youtube:US');assert.throws(()=>manager.preview('browser',id,{},signal()),{code:'not-found'},'region switch invalidates a previous regional preview pool');
 const cancelled=new AbortController();const unshown=manager.select('browser',raw,manager.begin('browser',id),'s','youtube:US',cancelled.signal);cancelled.abort();assert.equal(manager.confirm('browser',id,unshown.recommendation.token,[]).accepted,false);
 store.close();
});
test('native videos deduplicate while part identity stays available and unsupported hearing history is rejected',()=>{
 const {store,manager}=fixture();const one=track(1,{ref:{provider:'bilibili',kind:'video',id:'BV0000000001',part:'101'}}),two={...one,ref:{...one.ref,part:'102'}};
 assert.notDeepEqual(projectMusic(one,'music-recommendation',true).identity,projectMusic(two,'music-recommendation',true).identity);
 const raw={id:'music-recommendation',title:'B站',kind:'recommendation',page:{items:[one,two]}};const result=manager.select('s',raw,manager.begin('s',raw.id),'fixed','bilibili',signal());assert.equal(result.page.items.length,1);assert.equal(result.page.items[0].ref.part,'101');
 const current=store.read(id);assert.throws(()=>store.update(id,current,{overrides:{scope:{...current.document.preset.config.scope,unheard:true}}},signal()),{code:'invalid-input'});
 for(const col of columns)assert.deepEqual(store.read(col).document.overrides,{});store.close();
});
test('account prefers qualified fresh tracks then fills with eligible repeats; all remains uncapped',()=>{
 const {store,manager}=fixture();const make=i=>({...track(i),ref:{provider:'bilibili',kind:'video',id:'BV'+String(i).padStart(10,'0')}}),raw={id:'account-recommendation',title:'账号',kind:'recommendation',page:{items:[make(1),make(2)]}};
 let shown=manager.select('b',raw,manager.begin('b',raw.id),'s','account',signal());assert.equal(manager.confirm('b',raw.id,shown.recommendation.token,[JSON.stringify(['bilibili',make(1).ref.id,null])]).accepted,true);
 shown=manager.select('b',raw,manager.begin('b',raw.id),'s','account',signal());assert.deepEqual(shown.page.items.map(t=>t.ref.id),[make(2).ref.id,make(1).ref.id]);
 const newRaw={id:'new-music',title:'新歌',kind:'new',page:{items:Array.from({length:1000},(_,i)=>make(i))}};assert.equal(manager.select('b',newRaw,manager.begin('b','new-music'),'s','new',signal()).page.items.length,1000);store.close();
});
test('default display history processing never claims the original source order',()=>{
 const {store,manager}=fixture(),raw=shelf([track(1),track(2),track(3)]);
 try{
  const first=manager.select('browser',raw,manager.begin('browser',id),'s','HK',signal());
  assert.equal(first.recommendation.processed,false);
  assert.equal(manager.confirm('browser',id,first.recommendation.token,[JSON.stringify(['youtube',raw.page.items[0].ref.id,null])]).accepted,true);
  const next=manager.select('browser',raw,manager.begin('browser',id),'s','HK',signal());
  assert.deepEqual(next.page.items.map(i=>i.ref.id),[raw.page.items[1].ref.id,raw.page.items[2].ref.id,raw.page.items[0].ref.id]);
  assert.equal(next.recommendation.processed,true);assert.equal(next.recommendation.order,'upstream');
  const s=store.read(id);store.update(id,s,{entry:0},signal());
  const old=manager.select('browser',raw,manager.begin('browser',id),'s','HK',signal());
  assert.equal(old.recommendation.processed,false,'unprocessed legacy defaults keep their original order');
  const duplicate=shelf([track(1),track(1),track(2)]);
  assert.equal(manager.select('browser',duplicate,manager.begin('browser',id),'s','HK',signal()).recommendation.processed,true);
 }finally{manager.invalidate();store.close();}
});
test('saving requires this browser preview of the same draft and complete active revisions',()=>{
 const {store,manager,setAuth}=fixture(),raw=shelf([track(1)]),scope='browser-a';
 const remember=()=>manager.remember(scope,raw,'youtube:HK','fixed');remember();let state=store.read(id);
 const overrides={include:{mode:'any',groups:[{id:'title',fields:['title'],mode:'all',terms:['Music','1']}]},preferences:[{id:'weighted',fields:['title'],mode:'any',terms:['Music'],weight:7}]};
 assert.throws(()=>manager.save(scope,id,state,{overrides},signal()),{code:'conflict'});
 manager.preview(scope,id,overrides,signal());assert.throws(()=>manager.save('browser-b',id,state,{overrides},signal()),{code:'conflict'});
 for(const key of ['entry','epoch','legacyRevision','sharedRevision'])assert.throws(()=>manager.save(scope,id,{...state,[key]:key==='entry'?0:key==='epoch'?1:'stale'},{overrides},signal()),{code:'conflict'});
 const saved=manager.save(scope,id,state,{overrides},signal());assert.deepEqual(saved.document.overrides,overrides);
 state=manager.save(scope,id,saved,{entry:0},signal());state=manager.save(scope,id,state,{legacy:{include:['Music'],exclude:[],mode:'any',order:'upstream'}},signal());
 const transferred=translateLegacy(state.legacy);remember();manager.preview(scope,id,transferred,signal(),true);
 assert.throws(()=>manager.save(scope,id,state,{overrides:transferred},signal()),{code:'conflict'});
 manager.begin(scope,id,'youtube:US');assert.throws(()=>manager.save(scope,id,state,{overrides:transferred,absorbLegacy:true},signal()),{code:'conflict'});
 remember();manager.preview(scope,id,transferred,signal(),true);setAuth('changed');assert.throws(()=>manager.save(scope,id,state,{overrides:transferred,absorbLegacy:true},signal()),{code:'conflict'});
 assert.deepEqual(store.read(id),state);store.close();
});
test('legal legacy multiline, repeated and significant whitespace terms execute without rewriting either stream',()=>{
 const {store,manager}=fixture();
 const raw=shelf([track(1,{title:'Music\nHK'}),track(2,{title:'Music HK'}),track(3,{title:'music\nhk blocked'}),track(4,{title:' Music '})]);
 const choose=()=>manager.select('legacy',raw,manager.begin('legacy',id),'seed','HK',signal()).page.items;
 try{
  const rules={include:['Music\nHK','Music\nHK'],exclude:['blocked','blocked'],mode:'all',order:'upstream'};
  const saved=store.update(id,store.read(id),{entry:0,legacy:rules},signal());
  assert.deepEqual(choose().map(t=>t.ref.id),[raw.page.items[0].ref.id]);
  assert.equal(choose()[0].title,'Music\nHK','matching preserves the literal newline and source title');
  const repeated=shelf([{...raw.page.items[0],title:'Music HK'},raw.page.items[0]]);
  assert.equal(manager.select('legacy',repeated,manager.begin('legacy',id),'seed','HK',signal()).page.items[0].title,'Music\nHK','the returned native entry is the one that actually matched');
  assert.deepEqual(store.read(id).legacy,rules);assert.deepEqual(store.read(id).document.overrides,{});
  const ordinary=shelf([track(1),track(2)]),duplicate={include:['Music','Music'],exclude:['Never','Never'],mode:'all',order:'upstream'};
  const edited=store.update(id,saved,{legacy:duplicate},signal());
  assert.equal(manager.select('legacy',ordinary,manager.begin('legacy',id),'seed','HK',signal()).page.items.length,2);
  assert.deepEqual(store.read(id).legacy,duplicate);
  const spaces={include:[' Music '],exclude:['Never\nold'],mode:'any',order:'upstream'};
  store.update(id,edited,{legacy:spaces},signal());
  assert.deepEqual(choose().map(t=>t.ref.id),[raw.page.items[3].ref.id],'significant whitespace is not trimmed or normalized');
  manager.remember('legacy',ordinary,'HK','seed');manager.preview('legacy',id,{},signal());
  assert.equal(manager.save('legacy',id,store.read(id),{overrides:{}},signal()).entry,0,'a shared draft stays independent from compatible legacy execution');
 }finally{manager.invalidate();store.close();}
});
test('expanding a current display appends history once and keeps all stale-token protections',()=>{
 const {store,manager,setAuth}=fixture(),raw=shelf(Array.from({length:36},(_,i)=>track(i)));
 const controller=new AbortController(),shown=manager.select('browser',raw,manager.begin('browser',id),'seed','HK',controller.signal);
 const keys=shown.page.items.map(t=>JSON.stringify([t.ref.provider,t.ref.id,null])),token=shown.recommendation.token;
 try{
  assert.deepEqual(manager.confirm('browser',id,token,keys.slice(0,12)),{accepted:true,count:12});
  controller.abort(new DOMException('Acquisition finished','TimeoutError'));
  assert.deepEqual(manager.confirm('browser',id,token,keys.slice(0,24)),{accepted:true,count:12});
  assert.deepEqual(manager.confirm('browser',id,token,keys.slice(0,24)),{accepted:true,count:0});
  assert.equal(manager.seen('browser',id,'HK').length,24);
  assert.equal(manager.confirm('another-browser',id,token,keys).accepted,false);
  assert.equal(manager.confirm('browser',id,token,['unknown']).accepted,false);
  const next=manager.select('browser',raw,manager.begin('browser',id),'seed','HK',signal());
  assert.equal(next.page.items[0].ref.id,raw.page.items[24].ref.id,'expanded items count as already displayed');
  assert.equal(manager.confirm('browser',id,token,keys).accepted,false,'a replacement batch rejects the original token');
  setAuth('new-account');assert.equal(manager.confirm('browser',id,next.recommendation.token,keys).accepted,false);
  setAuth('a');manager.invalidate('browser');assert.equal(manager.confirm('browser',id,next.recommendation.token,keys).accepted,false);
  const stale=manager.select('browser',raw,manager.begin('browser',id),'seed','HK',signal());
  store.update(id,store.read(id),{entry:0},signal());assert.equal(manager.confirm('browser',id,stale.recommendation.token,keys).accepted,false);
 }finally{manager.invalidate();store.close();}
});
