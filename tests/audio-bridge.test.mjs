import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import ts from 'typescript';

// Exercise the actual browser adapter with the same built shared policy as the host.
const built=resolve(process.env.MUSIC_APP_TEST_BUILD??'.','dist/server');
const imports={
  '@studio/music-sources/player':import.meta.resolve('@studio/music-sources/player'),
  '../server/audio-quality':pathToFileURL(resolve(built,'audio-quality.js')).href,
  '../server/search-policy':pathToFileURL(resolve(built,'search-policy.js')).href,
  './song-search':'data:text/javascript,'+encodeURIComponent('export const desktopSurface=()=>false;'),
};
const diagnostics=ts.transpileModule(readFileSync(new URL('../src/playback-diagnostics.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText
  .replace(/from\s+(['"])([^'"]+)\1/g,(_match,_quote,name)=>{assert(imports[name],'unmapped diagnostic import: '+name);return 'from '+JSON.stringify(imports[name]);});
imports['./playback-diagnostics']='data:text/javascript;base64,'+Buffer.from(diagnostics).toString('base64');
const source=ts.transpileModule(readFileSync(new URL('../src/audio-quality.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
const module=source.replace(/from\s+(['"])([^'"]+)\1/g,(_match,_quote,name)=>'from '+JSON.stringify(imports[name]??name));
const {BestAudioBridge,retainVerifiedAudio}=await import('data:text/javascript;base64,'+Buffer.from(module).toString('base64'));
const ref={provider:'bilibili',kind:'video',id:'BV118411B7XU',part:'900'};
const aac={id:'30280',codec:'mp4a.40.2',mimeType:'audio/mp4',container:'mp4'},flac={...aac,id:'30251',codec:'fLaC'};
const entry={ref,resourceId:'rain',title:'杨丞琳《雨爱》',url:'https://www.bilibili.com/video/'+ref.id};

test('a checked desktop rendition survives cancellation of another selection and repeated live URL refreshes',async t=>{
  const prepared=[],api={
    capabilities:()=>({operations:['formats','prepare']}),formats:async()=>[aac,flac],
    metadata:async requested=>({...entry,ref:{...requested}}),
    prepare:async(request,options)=>{
      options?.signal?.throwIfAborted();prepared.push(request);
      return {entry,resourceId:entry.resourceId,format:[aac,flac].find(format=>format.id===request.formatId),delivery:{url:'https://example.com/audio.mp4',requiresHost:false}};
    },
  };
  const bridge=new BestAudioBridge(api,{canPlayType:()=> 'probably'});t.after(()=>bridge.dispose());
  const signal=new AbortController().signal,checked={ref,format:aac};
  const current=await bridge.sourceFrom({...entry,verifiedAudio:checked});
  const controller=new AbortController(),pending=await bridge.sourceFrom({...entry,verifiedAudio:{ref,format:flac}},{signal:controller.signal});
  controller.abort();await assert.rejects(pending.prepare({signal:controller.signal}),error=>error.name==='AbortError');
  let plan=await current.prepare({signal});assert.equal(plan.metadata.format.id,aac.id);assert.deepEqual(plan.metadata.verifiedAudio,checked);
  for(let attempt=0;attempt<2;attempt++){
    const source=await bridge.sourceForPlan(ref,plan,{signal});
    plan=retainVerifiedAudio(plan,await bridge.resolver.resolveUrl(source.resourceId,plan,'retry',{signal}));
    assert.equal(plan.metadata.format.id,aac.id);assert.deepEqual(plan.metadata.verifiedAudio,checked);
  }
  assert.deepEqual(prepared.map(request=>request.formatId),[aac.id,aac.id,aac.id]);
  const fresh=await bridge.sourceFrom(entry),freshPlan=await fresh.prepare({signal});
  assert.equal(freshPlan.metadata.format.id,flac.id,'a new ordinary selection still chooses the current best audio');
  assert.equal(freshPlan.metadata.verifiedAudio,undefined);
});
