import { existsSync, readFileSync, mkdirSync, openSync, closeSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawn, execFile } from 'node:child_process';
import { createConnection } from 'node:net';
import { networkInterfaces } from 'node:os';
import { promisify } from 'node:util';
import { resolveConfigFile } from './instance-path.mjs';

const root=fileURLToPath(new URL('..',import.meta.url));
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const alive=pid=>{try{process.kill(pid,0);return true;}catch{return false;}};
const readState=path=>{try{return JSON.parse(readFileSync(path,'utf8'));}catch{return null;}};
function checkUpdate(){const file=join(root,'local','update.lock');if(!existsSync(file))return;const state=readState(file);if(!state||!Number.isInteger(state.pid)||state.pid<=0||typeof state.token!=='string'||alive(state.pid)&&state.token!==process.env.MUSIC_APP_UPDATE_TOKEN)throw new Error('正在更新构建，请等待一键更新完成后再启动。');}
async function portBusy(host,port){return new Promise(resolve=>{const socket=createConnection({host,port});socket.setTimeout(1000);const finish=used=>{socket.destroy();resolve(used);};socket.once('connect',()=>finish(true));socket.once('error',()=>finish(false));socket.once('timeout',()=>finish(true));});}

export async function openBrowser(url,run=promisify(execFile)){
  try{
    // Only the PowerShell helper is hidden; the requested browser must be visible.
    await run('powershell.exe',['-NoProfile','-NonInteractive','-Command',`Start-Process -FilePath '${url}' -WindowStyle Normal -ErrorAction Stop`],{windowsHide:true,timeout:10000,maxBuffer:65536});
  }catch(e){
    const reason=e.stderr?.trim()||e.message;
    throw new Error(`服务已就绪，但浏览器未能打开。请手动访问 ${url}。原因：${reason}`);
  }
}

async function main(){
  const args=process.argv.slice(2),desktopOwner=args.find(a=>a.startsWith('--desktop-owner='))?.slice('--desktop-owner='.length);
  if(args.some(a=>!['--no-open','--no-restart'].includes(a)&&!/^--desktop-owner=[a-f0-9]{64}$/.test(a)))throw new Error('仅支持 --no-open、--no-restart 与桌面宿主的 --desktop-owner。');
  checkUpdate();
  const [major,minor]=process.versions.node.split('.').map(Number);if(major<24||(major===24&&minor<15))throw new Error('需要 Node 24.15 或更新的兼容版本。');
  const entry=join(root,'dist/server/index.js'),configEntry=join(root,'dist/server/config.js');
  if(!existsSync(entry)||!existsSync(configEntry)||!existsSync(join(root,'dist/client/index.html')))throw new Error(`正式构建不存在。请在 ${root} 执行 npm ci 和 npm run build。`);
  try{for(const name of ['hono','@studio/music-sources'])if(!existsSync(fileURLToPath(import.meta.resolve(name))))throw new Error('missing');}catch{throw new Error(`运行依赖不存在。请在 ${root} 执行 npm ci（构建交付目录使用 npm ci --omit=dev --ignore-scripts）。`);}
  const file=resolveConfigFile();
  if(!existsSync(file))throw new Error(`配置不存在：${file}。请复制 config.example.json，填写访问码及工具、数据路径。`);
  process.env.MUSIC_APP_CONFIG=file;
  const {readConfig}=await import(pathToFileURL(configEntry).href),config=readConfig();
  const localHost=config.host==='::1'?'localhost':config.allowedHosts.includes('127.0.0.1')?'127.0.0.1':'localhost';
  if(!config.allowedHosts.includes(localHost))throw new Error('allowedHosts 需包含 localhost 或 127.0.0.1，以便校验本机服务。');
  const base=`http://${localHost}:${config.port}`,stateFile=join(config.runtimeDirectory,'service.json');
  mkdirSync(config.runtimeDirectory,{recursive:true});
  const logs=config.logDirectory??config.runtimeDirectory;mkdirSync(logs,{recursive:true});
  const stdout=join(logs,'service.stdout.log'),stderr=join(logs,'service.stderr.log');
  async function ready(){
    const state=readState(stateFile);if(!state||state.port!==config.port||!Number.isInteger(state.pid)||typeof state.key!=='string')return null;
    try{const r=await fetch(base+'/internal/diagnose',{headers:{'X-Control-Key':state.key},signal:AbortSignal.timeout(1200)});if(!r.ok)return null;const d=await r.json();if(d.sources?.disposed!==false||d.delivery?.disposed!==false)return null;
      const page=await fetch(base,{signal:AbortSignal.timeout(1200)});if(!page.ok||!(await page.text()).includes('assets/index-'))return null;return {...state,build:d.build};
    }catch{return null;}
  }
  async function stopRunning(state){
    try{await fetch(base+'/internal/stop',{method:'POST',headers:{'X-Control-Key':state.key},signal:AbortSignal.timeout(5000)});}catch{}
    // Shutdown disposes sources and the tool before it releases the state file, and on Windows a
    // successor can already bind the same port, so wait for the process itself to be gone.
    const deadline=Date.now()+30000;
    while(Date.now()<deadline){if(!alive(state.pid))return;await sleep(200);}
    throw new Error('运行中的旧构建没有退出。请检查运行日志，或使用 npm run stop 后重试。');
  }
  // The running server keeps its own build while pages are read from disk, so an instance that
  // predates the current dist (or cannot report one) is replaced instead of reported as running.
  async function currentInstance(){
    checkUpdate();
    const running=await ready();if(!running)return null;
    if(running.build&&!running.build.stale)return running;
    if(process.argv.includes('--no-restart'))throw new Error('运行中的服务构建已变化。请用原更新入口完成更新后重试；桌面入口没有停止共享服务。');
    replaced=true;
    console.log(JSON.stringify({action:'restarting',pid:running.pid,reason:running.build?'磁盘上的构建比运行中的服务新':'运行中的服务早于本版本，无法报告构建状态',changed:running.build?.changed??[]}));
    await stopRunning(running);return null;
  }
  async function show(state,action){
    const currentIPs=Object.values(networkInterfaces()).flat().filter(a=>a&&a.family==='IPv4'&&!a.internal).map(a=>a.address);
    const lanUrls=config.host==='0.0.0.0'?config.allowedHosts.filter(h=>currentIPs.includes(h)).map(h=>`http://${h}:${config.port}`):[];
    const url=config.allowedHosts.includes('localhost')?`http://localhost:${config.port}`:base;
    console.log(JSON.stringify({action,pid:state.pid,url,lanUrls,buildStale:state.build?.stale===true,stdoutLog:stdout,stderrLog:stderr}));
    if(!process.argv.includes('--no-open')&&process.platform==='win32'){
      await openBrowser(url);
    }
  }
  let replaced=false;
  const existing=await currentInstance();if(existing){await show(existing,'already-running');return;}
  const lock=join(config.runtimeDirectory,'launch.lock');let ownsLock=false;
  try{
    const deadline=Date.now()+30000;
    while(!ownsLock){
      try{const fd=openSync(lock,'wx');try{writeFileSync(fd,JSON.stringify({pid:process.pid}));}finally{closeSync(fd);}ownsLock=true;}
      catch(e){if(e.code!=='EEXIST')throw e;const previous=readState(lock);if(previous&&Number.isInteger(previous.pid)&&!alive(previous.pid)){try{unlinkSync(lock);}catch{}continue;}const running=await currentInstance();if(running){await show(running,'already-running');return;}if(Date.now()>deadline)throw new Error('另一个启动正在进行，请稍后重试。');await sleep(250);}
    }
    const running=await currentInstance();if(running){await show(running,'already-running');return;}
    if(await portBusy(config.host==='::1'?'::1':'127.0.0.1',config.port))throw new Error(`端口 ${config.port} 已被其它服务占用，未启动第二个实例。`);
    const out=openSync(stdout,'a'),err=openSync(stderr,'a');let child,exitCode;
    try{child=spawn(process.execPath,[join(root,'scripts/start.mjs')],{cwd:root,env:{...process.env,MUSIC_APP_CONFIG:file,MUSIC_APP_DESKTOP_OWNER:desktopOwner??''},detached:true,windowsHide:true,stdio:['ignore',out,err]});await new Promise((res,rej)=>{child.once('spawn',res);child.once('error',rej);});}
    finally{closeSync(out);closeSync(err);}
    // Record the newly spawned process before readiness can time out. Only the
    // desktop host supplies this identity; ordinary service launches stay unchanged.
    if(desktopOwner)writeFileSync(join(config.runtimeDirectory,'desktop-service.json'),JSON.stringify({identity:desktopOwner,pid:child.pid,starting:true}),{mode:0o600});
    child.once('exit',code=>{exitCode=code;});child.unref();
    const readyDeadline=Date.now()+30000;
    while(Date.now()<readyDeadline){const state=await ready();if(state?.pid===child.pid){await show(state,replaced?'restarted':'started');return;}if(exitCode!==undefined||!alive(child.pid))throw new Error(`服务启动失败（退出码 ${exitCode??'未知'}）。请查看 ${stderr}`);await sleep(200);}
    // Keep the process and its logs intact; a slow tool check can still complete.
    throw new Error(`30 秒内未就绪。请查看 ${stderr}，确认运行状态后再试。`);
  }finally{if(ownsLock)try{unlinkSync(lock);}catch{}}
}
if(import.meta.main)main().catch(e=>{console.error('慢听启动失败：'+e.message);process.exitCode=1;});
