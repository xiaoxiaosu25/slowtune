import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openBrowser } from '../scripts/launch.mjs';

test('Browser launch requests a visible window and waits for the opener',async()=>{
  let finish,call,completed=false;
  const pending=openBrowser('http://localhost:4187',async(...args)=>{
    call=args;
    await new Promise(resolve=>{finish=resolve;});
  }).then(()=>{completed=true;});
  await Promise.resolve();
  assert.equal(completed,false);
  assert.equal(call[0],'powershell.exe');
  assert.match(call[1].at(-1),/http:\/\/localhost:4187/);
  assert.match(call[1].at(-1),/-WindowStyle Normal/);
  assert.match(call[1].at(-1),/-ErrorAction Stop/);
  assert.equal(call[2].windowsHide,true);
  assert.equal(call[2].timeout,10000);
  finish();await pending;
  assert.equal(completed,true);
});

test('Browser launch failures retain the service URL and actionable error',async()=>{
  for(const failure of [
    Object.assign(new Error('Command failed'),{stderr:'HTTP association is unavailable\n'}),
    new Error('spawn powershell.exe ENOENT'),
    new Error('Browser helper timed out'),
  ]){
    await assert.rejects(openBrowser('http://localhost:4187',async()=>{throw failure;}),error=>{
      assert.match(error.message,/服务已就绪/);
      assert.match(error.message,/http:\/\/localhost:4187/);
      assert(error.message.includes(failure.stderr?.trim()||failure.message));
      return true;
    });
  }
});
