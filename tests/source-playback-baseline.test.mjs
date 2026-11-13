import {test} from 'node:test';
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdir,mkdtemp,readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {developmentPaths} from '../scripts/workspace-paths.mjs';

const execute=promisify(execFile),root=fileURLToPath(new URL('..',import.meta.url));

test('source baseline retains failed attempts, separates component and native evidence, and closes controlled reads', {timeout:30000},async()=>{
  const runtime=developmentPaths().testRuntime;await mkdir(runtime,{recursive:true});
  const directory=await mkdtemp(join(runtime,'source-baseline-test-')),output=join(directory,'report');
  await execute(process.execPath,['scripts/verify-source-playback-baseline.mjs'],{cwd:root,windowsHide:true,timeout:25000,maxBuffer:1024*1024,env:{...process.env,MUSIC_APP_SOURCE_BASELINE_OUTPUT:output,MUSIC_APP_SOURCE_BASELINE_SAMPLES:'1',MUSIC_APP_SOURCE_BASELINE_FAULT_SAMPLES:'1',MUSIC_APP_SOURCE_BASELINE_DEADLINE_MS:'100'}});
  const text=await readFile(join(output,'report.json'),'utf8'),report=JSON.parse(text);
  assert.equal(report.measurement.timeoutMode,'external-deadline-clamped');
  assert.equal(report.componentCases.length,30);
  for(const item of report.componentCases){
    assert.equal(item.summary.attempts,1);
    assert.equal(item.summary.successes+item.summary.failures,item.summary.attempts);
    assert.equal(item.summary.allAttempts.samples,item.summary.attempts);
    assert.equal(item.summary.successfulAttempts.samples,item.summary.successes);
    assert.equal(item.rows[0].resources.activeFetches,0);
    assert.equal(item.rows[0].resources.openBodies,0);
    if(item.path==='desktop-delivery'){
      assert.equal(item.rows[0].resources.delivery.leases,0);
      assert.equal(item.rows[0].resources.delivery.activeReads,0);
    }else assert.equal(item.rows[0].resources.delivery,null,'Private probe lease state is not directly observable');
  }
  for(const path of ['search-probe','desktop-delivery']){
    const find=scenario=>report.componentCases.find(item=>item.path===path&&item.scenario===scenario);
    assert.equal(find('healthy').summary.successes,1);
    assert.equal(find('cancel').summary.cancellations,1);
    assert.equal(find('deadline').summary.timeouts,1);
    assert.equal(find('http-429').rows[0].retryAfterMs,2000);
  }
  const healthy=report.native.cases.find(item=>item.scenario==='healthy');
  assert.equal(healthy.summary.advance.samples,1,'Native success requires actual time advance');
  for(const item of report.native.cases)assert.equal(item.rows[0].mediaElements,1);
  assert(report.native.scope.includes('not the product player'));
  assert(report.unverified.some(value=>value.includes('/api/search/resolve')));
  assert(report.unverified.some(value=>value.includes('Real Bilibili')));
  assert(!/bilivideo\.com|https?:\/\/|credentialRef|leaseId|rawError|stack/.test(text),'Reports contain neutral facts rather than raw requests or errors');
});
