import { cpSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, join, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkDocumentation, checkLocalLinks } from './documentation.mjs';
import { workspaceRoot } from './instance-path.mjs';
const scriptRoot=fileURLToPath(new URL('..',import.meta.url)),root=resolve(process.env.MUSIC_APP_RELEASE_SOURCE??scriptRoot);
const version=JSON.parse(readFileSync(join(root,'package.json'),'utf8')).version;
const documentationErrors=checkDocumentation(root);
if(documentationErrors.length)throw new Error(documentationErrors.join('\n'));
const target=process.env.MUSIC_APP_RELEASE_DIRECTORY?resolve(process.env.MUSIC_APP_RELEASE_DIRECTORY):resolve(workspaceRoot,'local/artifacts/slowtune','slowtune-'+version+'-'+new Date().toISOString().replace(/[:.]/g,'-'));mkdirSync(dirname(target),{recursive:true});mkdirSync(target,{recursive:false});
for(const path of ['dist','vendor','package.json','package-lock.json','config.example.json','第三方声明.md','docs'])cpSync(join(root,path),join(target,path),{recursive:true,errorOnExist:true});
for(const path of ['README.md','LICENSE','NOTICE']){try{cpSync(join(root,path),join(target,path),{errorOnExist:true});}catch(error){if(error.code!=='ENOENT')throw error;}}
mkdirSync(join(target,'scripts'));for(const path of ['start.mjs','launch.mjs','control.mjs','reset-access.mjs','instance-path.mjs'])cpSync(join(root,'scripts',path),join(target,'scripts',path));
const deliveryDocumentationErrors=checkLocalLinks(target,{delivery:true});
if(deliveryDocumentationErrors.length)throw new Error(deliveryDocumentationErrors.join('\n'));
function walk(dir){return readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(join(dir,e.name)):[join(dir,e.name)]);}
const files=walk(target).sort().map(path=>({path:relative(target,path).replaceAll('\\','/')}));
writeFileSync(join(target,'delivery.json'),JSON.stringify({date:new Date().toISOString(),productName:'慢听',englishName:'SlowTune',productVersion:version,source:'SlowTune standalone product; public packages remain fixed artifacts',files},null,2)+'\n');
console.log(target);
