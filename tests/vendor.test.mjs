import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
test('Fixed vendor paths, versions and locked dependencies',()=>{
  const manifest=JSON.parse(readFileSync(new URL('../package.json',import.meta.url),'utf8'));
  const provenance=JSON.parse(readFileSync(new URL('../vendor/provenance.json',import.meta.url),'utf8'));
  const lock=JSON.parse(readFileSync(new URL('../package-lock.json',import.meta.url),'utf8'));
  const dependencies=Object.entries(manifest.dependencies).filter(([name])=>name.startsWith('@studio/'));
  assert.equal(provenance.entries.length,dependencies.length,'provenance describes only current fixed dependencies');
  for(const [name,input] of dependencies){
    const records=provenance.entries.filter(entry=>entry.name===name);
    assert.equal(records.length,1,'one provenance record per dependency: '+name);
    const record=records[0],locked=lock.packages['node_modules/'+name];
    assert.equal(input,'file:vendor/'+record.file);
    assert.equal(lock.packages[''].dependencies[name],input);
    assert.equal(locked.resolved,input);
    assert.equal(record.version,locked.version);
    assert.equal(JSON.parse(readFileSync(new URL('../node_modules/'+name+'/package.json',import.meta.url),'utf8')).version,locked.version);
    assert(existsSync(new URL('../vendor/'+record.file,import.meta.url)));
    assert.equal(record.source,'sources/'+record.file.replace(/\.tgz$/,'.tar.gz'));
    assert(existsSync(new URL('../vendor/'+record.source,import.meta.url)),'corresponding source is included: '+name);
  }
});
