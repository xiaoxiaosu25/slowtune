import {execFile,execFileSync,fork} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdir,copyFile,symlink,readFile,writeFile,access} from 'node:fs/promises';
import {createServer} from 'node:net';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
const execute=promisify(execFile),root=fileURLToPath(new URL('../..',import.meta.url));
const pause=ms=>new Promise(done=>setTimeout(done,ms));

export async function buildSourceBaseline(directory){
  directory=resolve(directory);if(directory===resolve(root))throw Error('Baseline requires an isolated build');
  await mkdir(directory,{recursive:true});
  for(const file of ['package.json','package-lock.json'])await copyFile(join(root,file),join(directory,file));
  try{await access(join(directory,'node_modules'));}catch{await symlink(join(root,'node_modules'),join(directory,'node_modules'),'junction');}
  await execute(process.execPath,[join(root,'node_modules/vite/bin/vite.js'),'build','--outDir',join(directory,'dist/client')],{cwd:root,windowsHide:true,maxBuffer:4*1024*1024});
  await execute(process.execPath,[join(root,'node_modules/typescript/bin/tsc'),'-p','tsconfig.server.json','--outDir',join(directory,'dist/server')],{cwd:root,windowsHide:true,maxBuffer:4*1024*1024});
  await writeFile(join(directory,'source-baseline-build.json'),JSON.stringify({sourceCommit:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8',windowsHide:true}).trim(),workingTree:execFileSync('git',['status','--porcelain'],{cwd:root,encoding:'utf8',windowsHide:true}).trim()?'modified':'clean',builtAt:new Date().toISOString()},null,2));
  return directory;
}

export async function sourceBaselineService({buildRoot,runtime,mode='controlled',audioFile,quality=false}){
  await mkdir(runtime,{recursive:true});
  const reservation=createServer();await new Promise(done=>reservation.listen(0,'127.0.0.1',done));const port=reservation.address().port;await new Promise(done=>reservation.close(done));
  const config={host:'127.0.0.1',port,allowedHosts:['127.0.0.1'],accessKey:'source-baseline-only',userSpace:'source-baseline',database:join(runtime,'library.sqlite'),runtimeDirectory:join(runtime,'service'),mediaLeaseTtlMs:85000};
  const configFile=join(runtime,'config.json');await writeFile(configFile,JSON.stringify(config),{flag:'wx'});
  const child=fork(join(buildRoot,'dist/server/index.js'),[],{cwd:runtime,execArgv:['--import',new URL('./source-baseline-upstream.mjs',import.meta.url).href],windowsHide:true,env:{...process.env,MUSIC_APP_CONFIG:configFile,MUSIC_APP_SOURCE_BASELINE_MODE:mode,MUSIC_APP_SOURCE_BASELINE_AUDIO:audioFile??'',MUSIC_APP_SOURCE_QUALITY_FIXTURE:quality?'1':''},stdio:['ignore','pipe','pipe','ipc']});
  child.stdout.resume();let startupErrors='';child.stderr.on('data',chunk=>{startupErrors=(startupErrors+chunk.toString()).slice(-8192);});
  let sequence=0;const pending=new Map();
  child.on('message',message=>{const work=pending.get(message.id);if(work){pending.delete(message.id);clearTimeout(work.timer);work.resolve(message.result);}});
  const rpc=(type,data={})=>new Promise((resolve,reject)=>{const id=++sequence,timer=setTimeout(()=>{pending.delete(id);reject(Error('Baseline control timed out'));},5000);pending.set(id,{resolve,timer});child.send({id,type,...data});});
  const base='http://127.0.0.1:'+port;
  try{
    let ready=false;
    for(let i=0;i<150;i++){if(child.exitCode!==null)throw Error('Isolated product service exited before readiness: '+(startupErrors.match(/ERR_[A-Z_]+/)?.[0]??startupErrors.match(/(?:Error|TypeError|SyntaxError):[^\r\n]+/)?.[0]??'unknown').replace(/https?:\/\/\S+/g,'[url]'));try{if((await fetch(base+'/api/bootstrap',{signal:AbortSignal.timeout(500)})).ok){ready=true;break;}}catch{}await pause(100);}
    if(!ready)throw Error('Isolated product service failed to start');
  }catch(error){child.kill();throw error;}
  return {base,config,rpc,async close(){
    const exited=new Promise(done=>child.once('exit',done));
    try{const control=JSON.parse(await readFile(join(config.runtimeDirectory,'service.json'),'utf8'));await fetch(base+'/internal/stop',{method:'POST',headers:{'X-Control-Key':control.key},signal:AbortSignal.timeout(3000)});}catch{child.kill();}
    for(let i=0;i<100&&child.exitCode===null;i++){try{await access(join(config.runtimeDirectory,'last-shutdown.json'));break;}catch{await pause(50);}}
    if(child.connected)child.disconnect();
    let timer;await Promise.race([exited,new Promise(done=>{timer=setTimeout(()=>{child.kill();done();},8000);})]);clearTimeout(timer);
    for(const work of pending.values())clearTimeout(work.timer);pending.clear();
    const state=JSON.parse(await readFile(join(config.runtimeDirectory,'last-shutdown.json'),'utf8'));
    return {leases:state.delivery.leases,activeReads:state.delivery.activeReads,sourcePending:state.sources.pending,desktopActive:state.desktopPlayback.active,desktopPending:state.desktopPlayback.pending,desktopInflight:state.desktopPlayback.inflight,tickets:state.desktopPlayback.tickets};
  }};
}
