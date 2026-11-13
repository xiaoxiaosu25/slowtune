import {test} from 'node:test';
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdir,mkdtemp,readFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {developmentPaths} from '../scripts/workspace-paths.mjs';
const execute=promisify(execFile),root=fileURLToPath(new URL('..',import.meta.url));

test('actual service search, prepared lease, media playback, rejection and natural queue transition retain neutral evidence', {timeout:90000},async()=>{
  const runtime=developmentPaths().testRuntime;await mkdir(runtime,{recursive:true});const directory=await mkdtemp(join(runtime,'source-app-test-')),output=join(directory,'report');
  await execute(process.execPath,['scripts/verify-source-playback-app.mjs','--smoke'],{cwd:root,windowsHide:true,timeout:85000,maxBuffer:1024*1024,env:{...process.env,MUSIC_APP_SOURCE_APP_OUTPUT:output,MUSIC_APP_SOURCE_APP_BUILD:process.env.MUSIC_APP_SOURCE_APP_BUILD??resolve(process.env.MUSIC_APP_TEST_BUILD??root)}});
  const text=await readFile(join(output,'report.json'),'utf8'),report=JSON.parse(text);
  assert.equal(report.mode,'controlled');assert.equal(report.cases.length,6);
  const healthy=report.cases[0];assert.equal(healthy.outcome,'playing');assert(healthy.observed.position>.1);
  for(const path of ['/api/search/resolve','/v1/call/prepare','/v1/media/:lease'])assert(healthy.http.some(event=>event.path===path&&event.status<300),path);
  const playing=healthy.diagnostics.find(event=>event.operation==='player'&&event.code==='playback-started');assert(playing);
  assert(healthy.diagnostics.some(event=>event.operation==='source-prepare'&&event.operationId===playing.operationId&&event.code==='complete'));
  assert(healthy.diagnostics.some(event=>event.operation==='/api/search/resolve'&&event.operationId===playing.operationId&&event.serverOperation));
  assert(healthy.upstream.events.some(event=>event.kind==='media'&&event.probe===true));
  assert(healthy.upstream.events.some(event=>event.kind==='media'&&event.probe===false));
  const denied=report.cases.find(item=>item.scenario==='probe-http429');assert.equal(denied.outcome,'product-error');assert(denied.http.some(event=>event.path==='/api/search/resolve'&&event.status===429));
  const restricted=report.cases.find(item=>item.scenario==='delivery-http403');assert.equal(restricted.outcome,'product-error');
  assert.equal(restricted.http.filter(event=>event.path==='/v1/call/prepare').length,1,'Permission rejection must not automatically prepare the same source again');
  assert.equal(restricted.upstream.events.filter(event=>event.kind==='media'&&!event.probe).length,1);
  assert(restricted.diagnostics.some(event=>event.operation==='recovery'&&event.code==='blocked'&&event.errorCode==='restricted'));
  assert.equal(report.manualRetry.outcome,'playing');assert.equal(report.manualRetry.http.filter(event=>event.path==='/v1/call/prepare').length,2);
  assert.equal(report.queue.naturalTransition.observed,true);assert(report.queue.naturalTransition.gapMs>=0);
  for(const item of report.cases){assert.equal(item.observed.elements,1);assert.equal(item.upstream.activeFetches,0);assert.equal(item.upstream.openBodies,0);assert.equal(item.resources.reads,0);assert.equal(item.resources.pending,0);}
  assert(Object.values(report.shutdown).every(value=>value===0));
  assert(!/https?:\/\/|BV[0-9A-Za-z]{10}|leaseId|credentialRef|SESSDATA|bili_jct/.test(text),'Diagnostic report must not contain source identity, URLs, leases or cookies');
});
