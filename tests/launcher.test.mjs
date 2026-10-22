import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const root=fileURLToPath(new URL('..',import.meta.url));
const launchRoot=resolve(process.env.MUSIC_APP_LAUNCH_ROOT??root);
const output=resolve(root,'../local/artifacts/music-app','launcher-'+new Date().toISOString().replace(/[:.]/g,'-'));mkdirSync(output,{recursive:true});
const wait=ms=>new Promise(r=>setTimeout(r,ms));
async function freePort(){const server=createServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));const port=server.address().port;await new Promise(r=>server.close(r));return port;}
function config(dir,port){return {host:'127.0.0.1',port,allowedHosts:['127.0.0.1','localhost'],accessKey:'launcher-test-123456',userSpace:'launcher-test',database:join(dir,'library.sqlite'),runtimeDirectory:join(dir,'runtime'),mediaLeaseTtlMs:85000};}
async function run(file,cwd,wrapper=false,target=launchRoot){
  const command=process.execPath,args=[join(target,'scripts/launch.mjs'),'--no-open'];
  const child=spawn(command,args,{cwd,env:{...process.env,MUSIC_APP_CONFIG:file},windowsHide:true,stdio:['ignore','pipe','pipe']});let stdout='',stderr='';child.stdout.on('data',b=>stdout+=b);child.stderr.on('data',b=>stderr+=b);
  // 'close' waits for stdout/stderr to drain; 'exit' can lose the final JSON under load.
  const code=await new Promise((res,rej)=>{child.once('error',rej);child.once('close',res);const timer=setTimeout(()=>rej(new Error('launcher timeout')),40000);timer.unref();child.once('close',()=>clearTimeout(timer));});
  return {code,stdout,stderr,result:stdout.split(/\r?\n/).filter(s=>s.startsWith('{')).map(s=>JSON.parse(s)).at(-1)};
}
// A throwaway copy of the built product keeps artifact timestamps out of the working tree, so
// simulating a rebuild cannot disturb another service running on this repository.
function isolatedRoot(label){
  const dir=mkdtempSync(join(output,label));
  cpSync(join(resolve(process.env.MUSIC_APP_TEST_BUILD??root),'dist'),join(dir,'dist'),{recursive:true});
  cpSync(join(root,'scripts'),join(dir,'scripts'),{recursive:true});
  copyFileSync(join(root,'package.json'),join(dir,'package.json'));
  symlinkSync(join(root,'node_modules'),join(dir,'node_modules'),'junction');
  return dir;
}
async function stop(c){const stateFile=join(c.runtimeDirectory,'service.json');if(!existsSync(stateFile))return;const state=JSON.parse(readFileSync(stateFile,'utf8'));assert((await fetch(`http://127.0.0.1:${c.port}/internal/stop`,{method:'POST',headers:{'X-Control-Key':state.key}})).ok);for(let n=0;n<100&&existsSync(stateFile);n++)await wait(100);assert.equal(existsSync(stateFile),false);const final=JSON.parse(readFileSync(join(c.runtimeDirectory,'last-shutdown.json'),'utf8'));for(const value of [final.sources.pending,final.delivery.leases,final.delivery.activeReads,final.tool.active])assert.equal(value,0);return final;}

test('Internal service launcher cold start, repeated/concurrent launch, login and restart preserve data',async()=>{
  const dir=mkdtempSync(join(output,'cwd with spaces-')),c=config(dir,await freePort()),file=join(dir,'config.local.json');writeFileSync(file,JSON.stringify(c));
  let detail;
  try{
    // An abandoned launcher lock can be recovered without touching the database.
    mkdirSync(c.runtimeDirectory);writeFileSync(join(c.runtimeDirectory,'launch.lock'),JSON.stringify({pid:99999999}));
    const first=await run(file,dir,process.platform==='win32');assert.equal(first.code,0,first.stderr);assert.equal(first.result.action,'started');assert(first.result.pid>0);assert(existsSync(first.result.stdoutLog));assert(existsSync(first.result.stderrLog));
    const repeated=await run(file,dir,true);assert.equal(repeated.code,0,repeated.stderr);assert.equal(repeated.result.action,'already-running');assert.equal(repeated.result.pid,first.result.pid);
    const base=`http://127.0.0.1:${c.port}`;assert.equal((await fetch(base)).status,200);assert.equal((await fetch(base+'/api/song-library')).status,401);
    const login=await fetch(base+'/api/login',{method:'POST',headers:{'Content-Type':'application/json','X-Music-App':'1'},body:JSON.stringify({accessKey:c.accessKey})});assert.equal(login.status,200);const cookie=login.headers.get('set-cookie').split(';')[0];
    const before=await fetch(base+'/api/song-library',{headers:{Cookie:cookie}}).then(r=>r.json());const stored=await fetch(base+'/api/song-library/edits',{method:'POST',headers:{Cookie:cookie,'Content-Type':'application/json','X-Music-App':'1'},body:JSON.stringify({revision:before.revision,edits:[{type:'create-playlist',name:'启动重开保留资料'}]})}).then(r=>r.json());assert.equal(stored.snapshot.playlists.length,1);
    const final=await stop(c);const concurrent=await Promise.all([run(file,dir),run(file,dir)]);for(const result of concurrent)assert.equal(result.code,0,result.stderr);assert.equal(concurrent[0].result.pid,concurrent[1].result.pid);assert.deepEqual(concurrent.map(r=>r.result.action).sort(),['already-running','started']);
    const reLogin=await fetch(base+'/api/login',{method:'POST',headers:{'Content-Type':'application/json','X-Music-App':'1'},body:JSON.stringify({accessKey:c.accessKey})});assert.equal(reLogin.status,200);const reCookie=reLogin.headers.get('set-cookie').split(';')[0];assert.deepEqual(await fetch(base+'/api/song-library',{headers:{Cookie:reCookie}}).then(r=>r.json()),stored);
    detail={status:'passed',launchRoot,wrapperColdStart:true,unrelatedCwdWithSpaces:true,repeatedPID:first.result.pid,concurrentSinglePID:concurrent[0].result.pid,staleLockRecovered:true,authentication:200,restartDataEqual:true,final};
  }finally{await stop(c);writeFileSync(join(output,'launcher.json'),JSON.stringify({date:new Date().toISOString(),...detail},null,2)+'\n');}
});

test('A running service whose build predates the dist is replaced instead of reported as running',async()=>{
  const target=isolatedRoot('stale-build-'),dir=mkdtempSync(join(target,'cwd-')),c=config(dir,await freePort()),file=join(dir,'config.local.json');writeFileSync(file,JSON.stringify(c));
  const artifact=join(target,'dist/client/index.html'),base=`http://127.0.0.1:${c.port}`;
  let detail;
  try{
    const first=await run(file,dir,false,target);assert.equal(first.code,0,first.stderr);assert.equal(first.result.action,'started');assert.equal(first.result.buildStale,false);
    // A rebuild after startup leaves the running process on its own frozen routes while the page on
    // disk moved on. The next one-click start must converge on the current build instead of
    // reporting the stale instance as running.
    utimesSync(artifact,new Date(),new Date(Date.now()+2000));
    const replaced=await run(file,dir,false,target);assert.equal(replaced.code,0,replaced.stderr);
    assert.equal(replaced.result.action,'restarted');assert.notEqual(replaced.result.pid,first.result.pid);assert.equal(replaced.result.buildStale,false);
    let previousGone=false;try{process.kill(first.result.pid,0);}catch{previousGone=true;}
    assert(previousGone,'the launcher waits for the replaced process to exit before binding the port again');
    const state=JSON.parse(readFileSync(join(c.runtimeDirectory,'service.json'),'utf8'));assert.equal(state.pid,replaced.result.pid);
    const diagnose=await fetch(base+'/internal/diagnose',{headers:{'X-Control-Key':state.key}}).then(r=>r.json());
    assert.equal(diagnose.build.stale,false);assert.deepEqual(diagnose.build.changed,[]);assert.equal(diagnose.sources.disposed,false);
    const repeated=await run(file,dir,false,target);assert.equal(repeated.result.action,'already-running');assert.equal(repeated.result.pid,replaced.result.pid);
    detail={status:'passed',replacedStaleBuild:true,previousPID:first.result.pid,currentPID:replaced.result.pid,repeatedReturnsCurrentInstance:true};
  }finally{
    await stop(c);
    writeFileSync(join(output,'stale-build.json'),JSON.stringify({date:new Date().toISOString(),...detail},null,2)+'\n');
  }
});

test('Launcher reports missing/invalid configuration and unrelated occupied port without opening a database',async()=>{
  const dir=mkdtempSync(join(output,'errors-')),port=await freePort(),c=config(dir,port),file=join(dir,'config.local.json');
  const missing=await run(file,dir);assert.equal(missing.code,1);assert.match(missing.stderr,/配置不存在/);assert.equal(existsSync(c.database),false);
  writeFileSync(file,JSON.stringify({...c,accessKey:'bad'}));const invalid=await run(file,dir);assert.equal(invalid.code,1);assert.match(invalid.stderr,/至少 6/);assert.equal(existsSync(c.database),false);
  writeFileSync(file,JSON.stringify(c));const server=createServer(socket=>socket.end());await new Promise(r=>server.listen(port,'127.0.0.1',r));
  try{const occupied=await run(file,dir);assert.equal(occupied.code,1);assert.match(occupied.stderr,/已被其它服务占用/);assert.equal(existsSync(c.database),false);assert.equal(existsSync(join(c.runtimeDirectory,'launch.lock')),false);writeFileSync(join(output,'errors.json'),JSON.stringify({status:'passed',missingConfig:true,invalidConfig:true,occupiedPort:true,databaseNotOpened:true},null,2)+'\n');}finally{await new Promise(r=>server.close(r));}
});
