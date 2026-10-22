import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
test('Fixed vendor paths, versions and locked dependencies',()=>{
  const manifest=JSON.parse(readFileSync(new URL('../package.json',import.meta.url),'utf8'));
  const provenance=JSON.parse(readFileSync(new URL('../vendor/provenance.json',import.meta.url),'utf8'));
  const lock=JSON.parse(readFileSync(new URL('../package-lock.json',import.meta.url),'utf8'));
  for(const p of provenance.entries){assert(existsSync(new URL('../vendor/'+p.file,import.meta.url)));assert(Object.values(lock.packages).some(v=>v.resolved==='file:vendor/'+p.file));}
  for(const [name,input] of Object.entries(manifest.dependencies).filter(([name])=>name.startsWith('@studio/'))){assert.equal(lock.packages[''].dependencies[name],input);assert.equal(JSON.parse(readFileSync(new URL('../node_modules/'+name+'/package.json',import.meta.url),'utf8')).version,lock.packages['node_modules/'+name].version);}
  assert.equal(lock.packages['node_modules/@studio/player'].version,'0.12.5');
});
