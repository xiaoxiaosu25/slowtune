import { resolveConfigFile, workspaceRoot } from './instance-path.mjs';
import { join } from 'node:path';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { chromium } from 'playwright-core';
const config=JSON.parse(readFileSync(resolveConfigFile(),'utf8'));
const base=`http://127.0.0.1:${config.port}`;
const r=await fetch(base+'/api/login',{method:'POST',headers:{'Content-Type':'application/json','X-Music-App':'1'},body:JSON.stringify({accessKey:config.accessKey})});
const cookie=r.headers.get('set-cookie').split(';')[0];
async function call(op,data){const r=await fetch(base+'/v1/call/'+op,{method:'POST',headers:{'Content-Type':'application/json','X-Music-App':'1',Cookie:cookie},body:JSON.stringify({protocol:2,...data})});return r.json();}
for(const ref of [{provider:'bilibili',kind:'video',id:'BV1NPtC6qEeA'},{provider:'youtube',kind:'video',id:'kK0CRZ0wvvc'}]){const data=await call('metadata',{ref});console.log(JSON.stringify({ref,title:data.result?.title,error:data.error}));}
const browser=await chromium.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});
const context=await browser.newContext({viewport:{width:1440,height:1000}});
await context.addCookies([{name:'music_session',value:cookie.split('=')[1],url:base}]);
const page=await context.newPage();page.on('pageerror',e=>console.log('PAGE ERROR',e.message));await page.goto(base);await page.getByRole('heading',{name:'发现音乐',exact:true}).waitFor();
await page.waitForFunction(()=>document.querySelectorAll('.music-card').length>0,{},{timeout:60000});
await page.waitForTimeout(8000);console.log(await page.locator('.music-card img').evaluateAll(imgs=>imgs.slice(0,4).map(i=>({src:i.src,loaded:i.complete,width:i.naturalWidth,display:i.style.display}))));
const dir=join(workspaceRoot,'local/artifacts/music-app/initial');mkdirSync(dir,{recursive:true});await page.screenshot({path:join(dir,'pc.png'),fullPage:false});
console.log(await page.locator('main').innerText());await browser.close();
