import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createServer } from 'node:net';
import { request as httpRequest } from 'node:http';
import { spawn, spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
const project=resolve('.'),root=resolve(process.env.MUSIC_APP_TEST_BUILD??'.');
const {StartupSettingsStore,decodeWelcomeImage}=await import(pathToFileURL(join(root,'dist/server/startup-settings.js')));
const {defaultWelcome}=await import(pathToFileURL(join(root,'dist/server/startup-types.js')));
const image='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=';

test('access codes are hashed, persistent, revision checked and scoped; welcome backup carries validated raster data',()=>{
  const directory=mkdtempSync(join(tmpdir(),'slowtune-settings-')),file=join(directory,'settings.sqlite');
  let store=new StartupSettingsStore(file,'personal','initial-private-code');
  const initial=store.access();assert.equal(initial.authenticationRequired,true);assert(store.verify('initial-private-code'));
  assert.throws(()=>store.changeAccess(null),{code:'invalid-input'});assert.throws(()=>store.saveWelcome(null),{code:'invalid-input'});
  assert.throws(()=>store.changeAccess({...initial,currentAccessKey:'wrong'}),{code:'access-code-invalid'});
  assert.throws(()=>store.changeAccess({...initial,currentAccessKey:'initial-private-code',newAccessKey:'short'}),{code:'access-code-format'});
  const changed=store.changeAccess({...initial,currentAccessKey:'initial-private-code',newAccessKey:'new-private-code',authenticationRequired:false});
  assert.equal(changed.authenticationRequired,false);assert(!store.verify('initial-private-code'));assert(store.verify('new-private-code'));
  assert.throws(()=>store.changeAccess({...initial,currentAccessKey:'new-private-code'}),{code:'conflict'});
  const welcome=store.saveWelcome({revision:'initial',welcome:{...defaultWelcome(),background:'custom'},image});
  assert(welcome.welcome.imageId);assert.equal(store.image(welcome.welcome.imageId).mime,'image/png');
  assert.throws(()=>store.saveWelcome({revision:'initial',welcome:defaultWelcome()}),{code:'conflict'});
  assert.throws(()=>store.saveWelcome({revision:welcome.revision,welcome:{...defaultWelcome(),shade:200}}),{code:'invalid-input'});
  assert.throws(()=>decodeWelcomeImage('data:image/svg+xml;base64,PHN2Zz48L3N2Zz4='),{code:'welcome-image-invalid'});
  assert.throws(()=>decodeWelcomeImage('data:image/png;base64,'+Buffer.from('not an image').toString('base64')),{code:'welcome-image-invalid'});
  const exported=store.exportWelcome();assert.equal(exported.image,image);assert(!JSON.stringify(exported).includes('private-code'));
  store.close();store=new StartupSettingsStore(file,'personal','obsolete-config-code');assert(store.verify('new-private-code'));assert(!store.verify('obsolete-config-code'));assert.deepEqual(store.welcome(),welcome);store.close();
  const other=new StartupSettingsStore(file,'other','other-private-code');assert(other.verify('other-private-code'));assert.equal(other.welcome().revision,'initial');assert.equal(other.image(welcome.welcome.imageId),undefined);other.close();
  const db=new DatabaseSync(file);const secrets=JSON.stringify(db.prepare('SELECT value FROM startup_access').all());assert(!secrets.includes('initial-private-code'));assert(!secrets.includes('new-private-code'));assert(secrets.includes('digest'));db.close();
});

test('HTTP startup: public bootstrap, independent guest sessions, protected code changes, revocation and restart persistence',{timeout:35000},async()=>{
  const directory=mkdtempSync(join(tmpdir(),'slowtune-startup-http-')),listener=createServer();await new Promise(resolve=>listener.listen(0,'127.0.0.1',resolve));const port=listener.address().port;await new Promise(resolve=>listener.close(resolve));
  const configFile=join(directory,'config.json'),config={host:'127.0.0.1',port,allowedHosts:['127.0.0.1'],accessKey:'initial-private-code',userSpace:'personal',database:join(directory,'library.sqlite'),runtimeDirectory:directory,mediaLeaseTtlMs:85000};writeFileSync(configFile,JSON.stringify(config));
  let child,logs='';const base='http://127.0.0.1:'+port;
  const api=async(path,body,cookie='')=>{const response=await fetch(base+path,{method:body===undefined?'GET':'POST',headers:{'X-Music-App':'1','Content-Type':'application/json',Cookie:cookie},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(10000)});return {status:response.status,data:response.headers.get('content-type')?.includes('json')?await response.json():undefined,cookie:response.headers.get('set-cookie')?.split(';')[0]};};
  const preload=new URL('./helpers/session-revocation-preload.mjs',import.meta.url).href;
  const start=async()=>{logs='';child=spawn(process.execPath,['--import',preload,join(project,'scripts/start.mjs')],{cwd:directory,windowsHide:true,env:{...process.env,MUSIC_APP_CONFIG:configFile,MUSIC_APP_REVOCATION_FIXTURE:directory},stdio:['ignore','pipe','pipe']});child.stdout.on('data',data=>logs+=data);child.stderr.on('data',data=>logs+=data);for(let i=0;i<150;i++){if(child.exitCode!==null)throw new Error(logs);try{if((await api('/api/bootstrap')).status===200)return;}catch{}await new Promise(resolve=>setTimeout(resolve,40));}throw new Error('server not ready: '+logs);};
  const stop=async()=>{const state=JSON.parse(readFileSync(join(directory,'service.json'),'utf8')),exited=new Promise(resolve=>child.once('exit',resolve));await fetch(base+'/internal/stop',{method:'POST',headers:{'X-Control-Key':state.key}});await exited;};
  const waitForFile=async name=>{for(let i=0;i<200;i++){if(existsSync(join(directory,name)))return;await new Promise(resolve=>setTimeout(resolve,10));}throw new Error('fixture did not reach '+name+'\n'+logs);};
  const holdBody=(path,body,cookie)=>{
    const encoded=JSON.stringify(body);let outgoing;
    const response=new Promise((resolve,reject)=>{
      outgoing=httpRequest(base+path,{method:'POST',headers:{'X-Music-App':'1','Content-Type':'application/json',Cookie:cookie}},incoming=>{
        let text='';incoming.setEncoding('utf8');incoming.on('data',chunk=>text+=chunk);incoming.on('end',()=>resolve({status:incoming.statusCode,data:JSON.parse(text)}));incoming.on('error',reject);
      });
      outgoing.on('error',error=>error.code==='ECONNRESET'?resolve({status:408,data:{error:{code:'cancelled'}}}):reject(error));
    });
    const sent=new Promise((resolve,reject)=>outgoing.write(encoded.slice(0,-1),error=>error?reject(error):resolve()));
    return {response,sent,finish:()=>outgoing.end(encoded.slice(-1))};
  };
  try {
    await start();const boot=await api('/api/bootstrap');assert.equal(boot.data.authenticated,false);assert.equal(boot.data.authenticationRequired,true);assert(!JSON.stringify(boot.data).includes('digest'));
    const blockedReset=spawnSync(process.execPath,[join(project,'scripts/reset-access.mjs')],{cwd:root,env:{...process.env,MUSIC_APP_CONFIG:configFile},windowsHide:true,encoding:'utf8'});assert.notEqual(blockedReset.status,0);assert.match(blockedReset.stderr,/请先运行 npm run stop/);
    assert.equal((await api('/api/session',{})).status,401);assert.equal((await api('/api/settings/access')).status,401);
    const owner=(await api('/api/login',{accessKey:'initial-private-code'})).cookie,old=(await api('/api/login',{accessKey:'initial-private-code'})).cookie;
    let access=(await api('/api/settings/access',undefined,owner)).data;
    assert.equal((await api('/api/settings/access',{...access,currentAccessKey:'incorrect',authenticationRequired:false},owner)).status,400);
    const originalLibrary=(await api('/api/song-library',undefined,owner)).data;
    const lateFavorite=api('/api/song-library/sources',{revision:originalLibrary.revision,save:{target:'favorite',refs:[{provider:'bilibili',kind:'video',id:'BV1tX4y1W7Xm'}]}},old).catch(issue=>{if(issue.cause?.code==='ECONNRESET')return {status:408};throw issue;});
    await waitForFile('metadata-started');
    const held=[
      holdBody('/api/song-library/edits',{revision:originalLibrary.revision,edits:[{type:'create-playlist',name:'revoked write'}]},old),
      holdBody('/api/settings/welcome',{revision:'initial',welcome:{...defaultWelcome(),shade:65}},old),
      holdBody('/api/settings/sources',{revision:'initial',youtube:{enabled:false,disabledDisplay:'hide'}},old),
      holdBody('/api/song-library/maintenance/preview',{revision:originalLibrary.revision,action:{type:'delete-song',songId:'missing'}},old),
      holdBody('/v1/call/metadata',{protocol:2,ref:{provider:'bilibili',kind:'video',id:'BV1tX4y1W7Xm'}},old),
    ];
    await Promise.all(held.map(request=>request.sent));
    await new Promise(resolve=>setTimeout(resolve,100));
    assert.equal((await api('/api/settings/access',{...access,currentAccessKey:'initial-private-code',authenticationRequired:false},owner)).status,200);
    // These requests must finish without waiting for the revoked sender's body.
    try{for(const request of held)assert.notEqual((await request.response).status,200);}finally{for(const request of held)request.finish();}
    writeFileSync(join(directory,'metadata-release'),'release');
    assert.equal((await lateFavorite).status,408);await waitForFile('metadata-aborted');assert.equal(readFileSync(join(directory,'metadata-aborted'),'utf8'),'true');
    assert.deepEqual((await api('/api/song-library',undefined,owner)).data,originalLibrary);
    assert.equal((await api('/api/settings/welcome',undefined,owner)).data.revision,'initial');
    assert.equal((await api('/api/settings/sources',undefined,owner)).data.revision,'initial');
    assert.equal((await api('/api/status',undefined,old)).status,401);
    const guestA=(await api('/api/session',{})).cookie,guestB=(await api('/api/session',{})).cookie;assert(guestA&&guestB&&guestA!==guestB);
    await api('/api/logout',{},guestA);assert.equal((await api('/api/status',undefined,guestB)).status,200);
    const saved=await api('/api/settings/welcome',{revision:'initial',welcome:{...defaultWelcome(),background:'custom',mobileFocus:{x:10,y:75}},image},owner);assert.equal(saved.status,200);
    const publicImage=await fetch(base+'/api/welcome/image/'+saved.data.welcome.imageId);assert.equal(publicImage.status,200);assert.equal(publicImage.headers.get('content-type'),'image/png');
    access=(await api('/api/settings/access',undefined,owner)).data;
    const updated=await api('/api/settings/access',{...access,currentAccessKey:'initial-private-code',newAccessKey:'changed-in-settings',authenticationRequired:true},owner);assert.equal(updated.status,200);
    assert.equal((await api('/api/status',undefined,owner)).status,200);assert.equal((await api('/api/status',undefined,guestB)).status,401);
    assert.equal((await api('/api/login',{accessKey:'initial-private-code'})).status,401);assert.equal((await api('/api/login',{accessKey:'changed-in-settings'})).status,200);
    await stop();await start();const restored=await api('/api/bootstrap');assert.equal(restored.data.authenticationRequired,true);assert.equal(restored.data.welcome.imageId,saved.data.welcome.imageId);assert.equal((await api('/api/login',{accessKey:'changed-in-settings'})).status,200);assert.equal((await api('/api/login',{accessKey:'initial-private-code'})).status,401);await stop();
    const reset=spawnSync(process.execPath,[join(project,'scripts/reset-access.mjs')],{cwd:root,env:{...process.env,MUSIC_APP_CONFIG:configFile},windowsHide:true,encoding:'utf8'});assert.equal(reset.status,0,reset.stderr);
    await start();assert.equal((await api('/api/login',{accessKey:'initial-private-code'})).status,200);assert.equal((await api('/api/login',{accessKey:'changed-in-settings'})).status,401);assert.equal((await api('/api/bootstrap')).data.welcome.imageId,saved.data.welcome.imageId);await stop();
  }finally{if(child?.exitCode===null)child.kill();}
});
