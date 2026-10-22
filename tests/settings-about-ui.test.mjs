import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync, truncateSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { chromium } from 'playwright-core';
import { createSettingsFixture } from './helpers/settings-fixture.mjs';
import { openSettingsPage } from '../scripts/browser-ui.mjs';
import {queueRecord,seedSongs} from './helpers/song-fixture.mjs';

test('Settings: offline notices, honest diagnostic states and reviewed backup recovery',{timeout:120000},async t=>{
  const fixture=await createSettingsFixture(),{state,base}=fixture;
  const artifacts=resolve('local/verification/settings-about');mkdirSync(artifacts,{recursive:true});
  const browser=await chromium.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});
  t.after(async()=>{await browser.close();await fixture.close();});
  const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[],remoteRequests=[];
  await page.addInitScript(record=>localStorage.setItem('slow-listening:playback:v3',JSON.stringify(record)),queueRecord([fixture.track],{volume:.4}));
  page.setDefaultTimeout(10000);page.on('pageerror',error=>errors.push(error.message));
  await page.route(/^https:\/\//,route=>{remoteRequests.push(route.request().url());return route.abort();});
  await page.goto(base);await page.locator('.app').waitFor();

  await t.test('licenses are lazy, retryable, local and include the installed copyright texts',async()=>{
    assert.equal(state.noticeReads,0);
    state.failNotices=true;
    await openSettingsPage(page,'音乐来源');
    await page.getByRole('button',{name:'查看来源与许可说明',exact:true}).click();
    const about=page.locator('[data-settings-section="about"]');
    await about.getByRole('alert').waitFor();
    assert.equal(await page.locator('[data-about-heading]').evaluate(el=>document.activeElement===el),true,'the disclosure shortcut moves keyboard focus to the destination');
    state.failNotices=false;await about.getByRole('button',{name:'重新读取许可清单',exact:true}).click();
    await about.locator('.license-list>summary').click();
    const youtube=about.locator('.license-list li').filter({has:page.locator('summary strong',{hasText:/^youtubei\.js$/})});
    await youtube.locator('summary').click();
    assert.match(await youtube.innerText(),/18\.1\.0/);assert.match(await youtube.locator('pre').innerText(),/Copyright \(c\) 2021 LuanRT/);
    const protobuf=about.locator('.license-list li').filter({has:page.locator('summary strong',{hasText:/^@bufbuild\/protobuf$/})});
    await protobuf.locator('summary').click();assert.equal(await protobuf.locator('pre').count(),2);assert.match(await protobuf.innerText(),/Copyright 2008 Google Inc/);
    await about.getByText('账号与数据保存',{exact:true}).waitFor();
    assert.match(await about.innerText(),/双向同步/);assert.match(await about.innerText(),/不保存在手机中/);
    assert.doesNotMatch(await about.innerText(),/@studio\/|自有组件|未声明开源许可证/,'internal implementation and licensing are not user-facing third-party notices');
    await about.getByRole('heading',{name:'免责声明',exact:true}).waitFor();
    assert.equal(await about.locator('.reference-projects a').count(),6);
    assert.equal(await about.getByRole('link',{name:'bili-music',exact:true}).getAttribute('href'),'https://github.com/YOUYUDAWANG/bili-music/blob/main/ARCHITECTURE.md');
    for(const link of await about.locator('a[target="_blank"]').all())assert.equal(await link.getAttribute('rel'),'noreferrer');
    const [download]=await Promise.all([page.waitForEvent('download'),about.getByRole('link',{name:'下载第三方许可全文',exact:true}).click()]);
    const text=readFileSync(await download.path(),'utf8');assert.match(text,/youtubei\.js — 18\.1\.0/);assert.doesNotMatch(text,/[CD]:\\|runtimeDirectory|\.dpapi\.json|@studio\//);
    const manifest=await page.request.get(base+'/legal/notices.json').then(response=>response.json());
    assert(manifest.entries.every(entry=>!entry.name.startsWith('@studio/')),'internal packages are excluded from downloadable JSON too');
    await about.locator('.license-list>summary').click();
    assert.deepEqual(remoteRequests,[],'reading disclosures and licenses does not contact external sites');
  });

  await t.test('both themes fit desktop and 320px screens; long license text stays inside the page',async()=>{
    for(const theme of ['light','dark'])for(const width of [1440,320]){
      await page.evaluate(theme=>{localStorage.setItem('slow-listening:theme',theme);document.documentElement.dataset.theme=theme;},theme);
      await page.setViewportSize({width,height:900});
      await page.waitForFunction(()=>{const nav=document.querySelector('.settings-nav'),current=nav.querySelector('[aria-current="true"]'),a=current.getBoundingClientRect(),b=nav.getBoundingClientRect();return nav.scrollWidth<=nav.clientWidth || a.left>=b.left-1&&a.right<=b.right+1;});
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>document.documentElement.clientWidth),false);
      await page.evaluate(()=>window.scrollTo(0,0));
      await page.screenshot({path:join(artifacts,`about-${theme}-${width}.png`),fullPage:true});
    }
    const about=page.locator('[data-settings-section="about"]');
    await about.locator('.license-list>summary').click();
    const youtube=about.locator('.license-list li').filter({has:page.locator('summary strong',{hasText:/^youtubei\.js$/})});
    await youtube.locator('pre').waitFor();
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>document.documentElement.clientWidth),false,'license text wraps on a narrow phone');
    await about.locator('.license-list>summary').click();
  });

  await t.test('diagnostic failure preserves the last result; refresh only reads status and can recover',async()=>{
    await openSettingsPage(page,'诊断与数据');const panel=page.locator('[data-settings-section="diagnostics"]');
    assert.equal(await panel.locator('.diagnostics-advanced').getAttribute('open'),null);
    const libraryReads=state.libraryReads;
    state.failStatus=true;await panel.getByRole('button',{name:'刷新诊断',exact:true}).click();
    await panel.getByRole('alert').waitFor();assert.match(await panel.locator('.diagnostics-checked-at').innerText(),/检查失败/);
    assert.equal(state.libraryReads,libraryReads,'diagnostic refresh does not reread the library');
    state.failStatus=false;await panel.getByRole('button',{name:'刷新诊断',exact:true}).click();
    await panel.getByRole('status').getByText('已更新服务状态。',{exact:false}).waitFor();
    await panel.getByRole('button',{name:'停止播放并释放来源',exact:true}).click();
    await panel.getByText('已停止当前播放器并释放播放资源，队列保留。',{exact:true}).waitFor();
    await panel.locator('.diagnostics-advanced>summary').click();assert.match(await panel.locator('.diagnostics').innerText(),/包含其他设备/);
    await page.screenshot({path:join(artifacts,'diagnostics-dark-320.png'),fullPage:true});
    await page.setViewportSize({width:1440,height:1000});await panel.locator('.diagnostics-advanced>summary').click();
    await page.evaluate(()=>window.scrollTo(0,0));
    await page.screenshot({path:join(artifacts,'diagnostics-dark-1440.png'),fullPage:true});
  });

  await t.test('invalid or oversized replacement files clear prior previews and never write; replacement needs a second review',async()=>{
    await page.getByRole('button',{name:'备份与恢复',exact:true}).click();
    const dialog=page.getByRole('dialog',{name:'备份与恢复',exact:true}),file=dialog.getByLabel('选择快照文件');
    const incoming=seedSongs({playlists:[{id:'restored',name:'备份歌单',createdAt:1,updatedAt:1,entries:[]}],favorites:[]});
    const choose=value=>file.setInputFiles({name:'restore.json',mimeType:'application/json',buffer:Buffer.from(value)});
    await choose(JSON.stringify(incoming));await dialog.getByRole('button',{name:'校验并预览影响'}).click();await dialog.locator('.backup-preview').waitFor();
    await choose('{invalid');await dialog.getByRole('alert').waitFor();assert.equal(await dialog.locator('.backup-preview').count(),0);assert.equal(await dialog.getByRole('button',{name:'确认导入',exact:true}).count(),0);
    const large=join(artifacts,'large.json');writeFileSync(large,'');truncateSync(large,64*1024*1024+1);await file.setInputFiles(large);
    await dialog.getByText('快照超过 64 MiB 上限。',{exact:true}).waitFor();assert.equal(state.imports.length,0);
    await choose(JSON.stringify(incoming));await dialog.getByLabel('导入方式').selectOption('replace');await dialog.getByRole('button',{name:'校验并预览影响'}).click();
    assert.equal(state.imports.length,0);assert(await dialog.getByRole('button',{name:'确认导入',exact:true}).isDisabled());
    await dialog.getByLabel('我已导出需要保留的资料，确认按备份完整替换').check();
    await page.setViewportSize({width:320,height:900});assert.equal(await dialog.evaluate(el=>el.scrollWidth>el.clientWidth),false);
    await page.screenshot({path:join(artifacts,'backup-confirm-dark-320.png'),fullPage:true});
    state.failImport=true;const before=fixture.libraryFixture.library.read().snapshot;
    await dialog.getByRole('button',{name:'确认导入',exact:true}).click();
    await dialog.getByText('资料已被另一页面修改。',{exact:false}).waitFor();assert.deepEqual(fixture.libraryFixture.library.read().snapshot,before,'a failed import preserves the current library');
    assert.equal(await dialog.getByRole('button',{name:'重试保留编辑',exact:true}).count(),0,'the generic retry cannot bypass the replacement review');
    assert.equal(await dialog.getByRole('group',{name:'确认替换资料',exact:true}).count(),0,'a retry must review replacement again');
    state.failImport=false;await dialog.getByRole('button',{name:'校验并预览影响'}).click();await dialog.getByLabel('我已导出需要保留的资料，确认按备份完整替换').check();
    await dialog.getByRole('button',{name:'确认导入',exact:true}).click();await page.waitForFunction(()=>document.querySelector('textarea[aria-label="新资料库快照内容"]').value==='');assert.deepEqual(fixture.libraryFixture.library.read().snapshot,incoming);await page.keyboard.press('Escape');
  });

  await t.test('logout reports a failure and remains retryable',async()=>{
    const panel=page.locator('[data-settings-section="diagnostics"]');state.failLogout=true;
    await panel.getByRole('button',{name:'退出当前浏览器登录',exact:true}).click();await panel.getByRole('alert').waitFor();
    assert(await panel.getByRole('button',{name:'退出当前浏览器登录',exact:true}).isEnabled());
    await page.locator('.playbar').getByRole('button',{name:'播放',exact:true}).click();
    await page.waitForFunction(()=>{const audio=document.querySelector('audio[data-product-media]');return audio&&!audio.paused&&audio.currentTime>0;}).catch(async()=>assert.fail(JSON.stringify({feedback:await page.locator('.feedback').allTextContents(),playbar:await page.locator('.playbar').innerText()})));
    state.failLogout=false;await panel.getByRole('button',{name:'退出当前浏览器登录',exact:true}).click();await page.getByRole('textbox',{name:'服务访问码',exact:true}).waitFor();
  });
  assert.deepEqual(errors,[]);
});
