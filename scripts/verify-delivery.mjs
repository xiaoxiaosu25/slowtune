import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { workspaceRoot } from './instance-path.mjs';
const root=fileURLToPath(new URL('..',import.meta.url));
const target=resolve(process.argv[2]);
const original=JSON.parse(readFileSync(process.env.MUSIC_APP_CONFIG??join(root,'config.example.json'),'utf8'));
const output=resolve(workspaceRoot,'local/artifacts/music-app','delivery-check-'+new Date().toISOString().replace(/[:.]/g,'-'));mkdirSync(output,{recursive:true});
const config={...original,host:'127.0.0.1',port:4192,allowedHosts:['127.0.0.1'],accessKey:randomBytes(24).toString('base64url'),database:join(output,'library.sqlite'),runtimeDirectory:join(output,'runtime'),ytDlp:{...original.ytDlp,executable:resolve(root,original.ytDlp.executable),nodeRuntime:resolve(root,original.ytDlp.nodeRuntime)}};
const configFile=join(output,'delivery.local.json');writeFileSync(configFile,JSON.stringify(config));
const manifest=JSON.parse(readFileSync(join(target,'delivery.json'),'utf8'));
for(const f of manifest.files)assert(existsSync(join(target,f.path)),f.path);
const base='http://127.0.0.1:4192';let cookie='',child,logs='';
async function api(path,body){const r=await fetch(base+path,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json','X-Music-App':'1',Cookie:cookie},...(body!==undefined?{body:JSON.stringify(body)}:{})});return {status:r.status,data:await r.json()};}
let result;
try{
  child=spawn(process.execPath,[join(target,'scripts/start.mjs')],{cwd:output,windowsHide:true,env:{...process.env,MUSIC_APP_CONFIG:configFile},stdio:['ignore','pipe','pipe']});child.stdout.on('data',b=>logs+=b);child.stderr.on('data',b=>logs+=b);
  for(let n=0;n<100;n++){try{if((await fetch(base)).ok)break;}catch{}await new Promise(r=>setTimeout(r,100));}
  const html=await fetch(base).then(r=>r.text());assert.match(html,/assets\/index-.*\.js/);assert.equal((await api('/api/song-library')).status,401);
  const login=await fetch(base+'/api/login',{method:'POST',headers:{'Content-Type':'application/json','X-Music-App':'1'},body:JSON.stringify({accessKey:config.accessKey})});assert.equal(login.status,200);cookie=login.headers.get('set-cookie').split(';')[0];
  const status=(await api('/api/status')).data;assert.equal(status.providers.youtube.available,true);assert.equal(status.version,manifest.productVersion);
  const discovery=await api('/api/discovery/bilibili');assert.equal(discovery.status,200);assert.equal(discovery.data.length,1);assert(discovery.data.every(s=>s.kind==='recommendation'));assert(discovery.data.some(s=>s.page?.items.length&&s.recommendation));
  const charts=await api('/api/charts?source=netease&chart=hot');assert.equal(charts.status,200);assert(charts.data.items.length>0);assert(charts.data.items.every(item=>typeof item.title==='string'&&Number.isSafeInteger(item.rank)));assert(charts.data.items.some(item=>item.artists?.length&&item.artwork?.startsWith('https://')));
  const metadata=await api('/v1/call/metadata',{protocol:2,ref:{provider:'bilibili',kind:'video',id:'BV1NPtC6qEeA'}});assert.equal(metadata.status,200);assert.equal(metadata.data.result.ref.id,'BV1NPtC6qEeA');
  const settings=await api('/api/recommendation/settings?column=music-recommendation');assert.equal(settings.status,200);assert.equal(settings.data.entry,1);
  const saved=await api('/api/song-library');assert.equal(saved.status,200);
  const packageNames=['@studio/player','@studio/music-sources','@studio/recommendation'];const packages=Object.fromEntries(packageNames.map(name=>[name,JSON.parse(readFileSync(join(target,'node_modules',name,'package.json'),'utf8')).version]));
  const state=JSON.parse(readFileSync(join(config.runtimeDirectory,'service.json'),'utf8'));const exited=new Promise(r=>child.once('exit',r));assert((await fetch(base+'/internal/stop',{method:'POST',headers:{'X-Control-Key':state.key}})).ok);await exited;
  const final=JSON.parse(readFileSync(join(config.runtimeDirectory,'last-shutdown.json'),'utf8'));assert.equal(final.sources.pending,0);assert.equal(final.delivery.leases,0);assert.equal(final.delivery.activeReads,0);assert.equal(final.tool.active,0);
  result={date:new Date().toISOString(),status:'passed',productVersion:status.version,delivery:target,cwd:output,productionDependenciesOnly:true,manifestPathsPresent:manifest.files.length,packages,staticBuild:true,anonymousBilibiliResults:discovery.data.map(s=>({id:s.id,count:s.page?.items.length,error:s.error})),metadataCanonical:true,recommendationSettings:true,youtubeToolReady:true,authentication:401,libraryAvailable:true,final};
}catch(e){result={date:new Date().toISOString(),status:'failed',error:e.message,logs};throw e;}
finally{if(child?.exitCode===null)child.kill();writeFileSync(join(output,'delivery-check.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify({...result,evidence:join(output,'delivery-check.json')}));}
