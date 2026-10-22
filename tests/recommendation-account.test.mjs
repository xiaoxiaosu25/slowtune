import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createServer} from 'node:net';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';

const root=fileURLToPath(new URL('..',import.meta.url));
test('stale account discovery authentication errors preserve newer credentials while current errors expire them',async()=>{
 const parent=resolve(root,'../local/artifacts/music-app/account-race-tests');mkdirSync(parent,{recursive:true});
 const output=mkdtempSync(join(parent,'run-')),preload=join(output,'preload.mjs');
 const moduleUrl=path=>JSON.stringify(pathToFileURL(join(root,path)).href);
 // Replace only isolated credential/account dependencies; exercise the actual HTTP route.
 writeFileSync(preload,`
 import {BilibiliCredentials} from ${moduleUrl('dist/server/bilibili-credentials.js')};
 import {BilibiliAccounts} from ${moduleUrl('dist/server/bilibili-accounts.js')};
 import {AccountBilibiliProvider} from ${moduleUrl('dist/server/bilibili-recommendations.js')};
 import {MusicSourceError} from ${moduleUrl('node_modules/@studio/music-sources/dist/index.js')};
 let credentials,calls=0;
 BilibiliCredentials.prototype.open=async function(){credentials=this;this.value={provider:'bilibili',revision:'old-account',cookie:'fixture-only'};return this;};
 BilibiliCredentials.prototype.remove=async function(){this.value=undefined;};
 BilibiliAccounts.prototype.status=async function(){return credentials.revision?{state:'authenticated',account:{provider:'bilibili',id:credentials.revision,name:credentials.revision}}:{state:'expired'};};
 AccountBilibiliProvider.prototype.discoverCandidates=async function(context){
  if(++calls===1)return [{id:'account-recommendation',title:'账号推荐',kind:'recommendation',page:{items:[]}}];
  if(calls===2){if(context.credential.revision!=='old-account')throw new Error('Expected old request credentials');credentials.value={provider:'bilibili',revision:'new-account',cookie:'fixture-only-new'};}
  throw new MusicSourceError({code:'authentication',provider:'bilibili',retryable:false});
 };
 `);
 const listener=createServer();await new Promise(r=>listener.listen(0,'127.0.0.1',r));const port=listener.address().port;await new Promise(r=>listener.close(r));
 const configFile=join(output,'config.json');
 writeFileSync(configFile,JSON.stringify({host:'127.0.0.1',port,allowedHosts:['127.0.0.1'],accessKey:'isolated-test-access',userSpace:'isolated',database:join(output,'library.sqlite'),runtimeDirectory:output,mediaLeaseTtlMs:85000}));
 const child=spawn(process.execPath,['--import',pathToFileURL(preload).href,join(root,'scripts/start.mjs')],{cwd:output,env:{...process.env,MUSIC_APP_CONFIG:configFile},windowsHide:true,stdio:['ignore','pipe','pipe']});
 let logs='';child.stdout.on('data',b=>logs+=b);child.stderr.on('data',b=>logs+=b);const base='http://127.0.0.1:'+port;
 try{
  let ready=false;for(let i=0;i<100;i++){if(child.exitCode!==null)throw new Error(logs);try{if((await fetch(base)).ok){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,100));}assert(ready,logs);
  const login=await fetch(base+'/api/login',{method:'POST',headers:{'Content-Type':'application/json','X-Music-App':'1'},body:JSON.stringify({accessKey:'isolated-test-access'})});assert.equal(login.status,200);const cookie=login.headers.get('set-cookie').split(';')[0];
  const request=path=>fetch(base+path,{headers:{Cookie:cookie}});
  assert.equal((await request('/api/discovery/bilibili?refresh=1')).status,401);
  const account=await request('/api/bilibili/account').then(r=>r.json());assert.equal(account.state,'authenticated');assert.equal(account.account.id,'new-account');
  assert.equal((await request('/api/discovery/bilibili?refresh=1')).status,401);
  assert.equal((await request('/api/bilibili/account').then(r=>r.json())).state,'expired','failure of the active revision still removes that revision');
  const state=JSON.parse(readFileSync(join(output,'service.json'),'utf8')),exited=new Promise(r=>child.once('exit',r));
  assert((await fetch(base+'/internal/stop',{method:'POST',headers:{'X-Control-Key':state.key}})).ok);await exited;
 }finally{if(child.exitCode===null)child.kill();}
});
