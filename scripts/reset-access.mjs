import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { resolveConfigFile } from './instance-path.mjs';
import { StartupSettingsStore } from '../dist/server/startup-settings.js';
const file=resolveConfigFile();
const config=JSON.parse(readFileSync(file,'utf8'));
const state=resolve(dirname(file),config.runtimeDirectory,'service.json');
if(existsSync(state)){
  const {pid}=JSON.parse(readFileSync(state,'utf8'));let running=false;
  try{process.kill(pid,0);running=true;}catch(error){if(error.code!=='ESRCH')throw error;}
  if(running)throw new Error('请先运行 npm run stop 停止此服务，再恢复访问码。');
}
const store=new StartupSettingsStore(resolve(dirname(file),config.database)+'.settings.sqlite',config.userSpace,config.accessKey);
try{store.resetAccess(config.accessKey);}finally{store.close();}
console.log('访问码已恢复为 config.local.json 中的 accessKey，并已开启访问验证。重新启动后可进入设置修改。');
