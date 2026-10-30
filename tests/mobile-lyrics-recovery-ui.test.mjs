import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from './helpers/browser.mjs';
import { queueRecord } from './helpers/song-fixture.mjs';
import { createMobileFixture } from './helpers/mobile-fixture.mjs';
import { developmentPaths } from '../scripts/workspace-paths.mjs';

async function recoveryFixture(t, { stateError = false, resolveError = false, instrumental = false, saved = false, queued = true } = {}) {
  const fixture = await createMobileFixture(), browser = await chromium.launch({ headless:true });
  t.after(async () => { await browser.close(); await fixture.close(); });
  const context = await browser.newContext({ viewport:{ width:320, height:568 }, hasTouch:true, colorScheme:'light' });
  await context.addInitScript(record => localStorage.setItem('slow-listening:playback:v3', JSON.stringify(record)), queueRecord(queued ? fixture.tracks : []));
  const page = await context.newPage(), calls = [], writes = [], errors = [];
  page.setDefaultTimeout(8000); page.on('pageerror', error => errors.push(error.message));
  const document = { provider:'lrclib', id:'42', title:'恢复演示', artists:['演示歌手'], synced:true, instrumental, lines:instrumental ? [] : [{ startMs:0, text:'恢复后继续听' }, { startMs:12000, text:'留住这一段旋律' }] };
  const candidate = { provider:'lrclib', id:'42', title:document.title, artists:document.artists, durationSeconds:24, synced:true };
  const control = { stateError, resolveError };
  let state = { ref:fixture.tracks[0].ref, revision:'first', offsetMs:saved ? 1250 : 0, document:instrumental || saved ? document : null };
  await page.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url());
    if (url.origin !== fixture.base) return route.abort();
    if (!url.pathname.startsWith('/api/lyrics/')) return route.continue();
    const body = request.postDataJSON(); calls.push({ path:url.pathname, body });
    const reply = json => route.fulfill({ json });
    if (url.pathname.endsWith('/state')) return control.stateError ? route.fulfill({ status:503, json:{ error:{ code:'upstream' } } }) : reply(state);
    if (url.pathname.endsWith('/resolve')) return control.resolveError ? route.fulfill({ status:503, json:{ error:{ code:'upstream' } } }) : reply({ state, matched:false, candidates:[candidate], issues:[] });
    if (url.pathname.endsWith('/search')) return reply({ candidates:[candidate], issues:[] });
    if (url.pathname.endsWith('/document')) return reply(document);
    if (url.pathname.endsWith('/select') || url.pathname.endsWith('/import')) {
      writes.push({ path:url.pathname, body });
      assert.deepEqual(body.ref, fixture.tracks[0].ref); assert.equal(body.revision, state.revision);
      state = { ...state, revision:'saved-' + writes.length, document:url.pathname.endsWith('/import') ? { ...document, provider:'local', id:'imported', lines:[{ startMs:0, text:'导入后第一行' }] } : document };
      return reply(state);
    }
    return route.fulfill({ status:404, json:{ error:{ code:'not-found' } } });
  });
  await page.goto(fixture.base);
  await page.getByRole('button', { name:'打开正在播放', exact:true }).click();
  if (queued) {
    await page.getByRole('button', { name:'播放', exact:true }).click();
    await page.waitForFunction(() => { const audio = document.querySelector('audio'); return audio && !audio.paused && audio.currentTime > .1; });
    await page.evaluate(() => { window.__recoveryAudio = document.querySelector('audio'); });
  }
  await page.getByRole('button', { name:'查看歌词', exact:true }).click();
  const panel = page.getByRole('region', { name:'当前版本歌词', exact:true });
  return { ...fixture, page, panel, calls, writes, errors, control };
}

test('mobile empty lyrics open existing search and selection directly without restarting playback', { timeout:60000 }, async t => {
  const { page, panel, calls, writes, preparations, errors } = await recoveryFixture(t);
  const recover = panel.getByRole('button', { name:'查找或导入歌词', exact:true });
  await recover.waitFor();
  const count = preparations.length;
  const artifacts = join(developmentPaths().artifacts, 'mobile-lyrics-recovery'); mkdirSync(artifacts, { recursive:true });
  for (const viewport of [{ width:320, height:568 }, { width:360, height:640 }, { width:390, height:844 }, { width:430, height:932 }, { width:568, height:320 }, { width:667, height:375 }]) {
    await page.setViewportSize(viewport);
    await recover.scrollIntoViewIfNeeded();
    const button = await recover.boundingBox(), bounds = await panel.boundingBox();
    assert(button.height >= 48 && button.y >= bounds.y && button.y + button.height <= bounds.y + bounds.height + 1, JSON.stringify({ viewport, button, bounds }));
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.screenshot({ path:join(artifacts, `empty-${viewport.width}-${viewport.height}.png`) });
  }
  await page.setViewportSize({ width:320, height:568 });
  await page.getByRole('button', { name:'暂停', exact:true }).click();
  const position = await page.locator('audio').evaluate(audio => audio.currentTime);
  await recover.click();
  let dialog = page.getByRole('dialog', { name:'选择歌词', exact:true });
  await dialog.waitFor();
  assert.equal(await dialog.getByLabel('歌词歌名', { exact:true }).inputValue(), '风从远方来');
  await page.goBack(); await dialog.waitFor({ state:'detached' });
  await page.goForward();
  assert.equal(await dialog.count(), 0, 'Forward does not reopen a closed recovery dialog');
  await recover.click(); await dialog.waitFor();
  await dialog.getByRole('button',{name:'修改搜索',exact:true}).click();
  await dialog.getByLabel('歌词歌名', { exact:true }).fill('恢复演示');
  await dialog.getByRole('button', { name:'查找歌词', exact:true }).click();
  await dialog.getByRole('button', { name:'预览 LRCLIB 恢复演示 42', exact:true }).click();
  assert.equal(writes.length, 0, 'preview never selects lyrics');
  await dialog.getByRole('button', { name:'使用这份歌词', exact:true }).click();
  await dialog.waitFor({ state:'detached' });
  await panel.getByRole('button', { name:'恢复后继续听', exact:true }).waitFor();
  assert.equal(writes.length, 1); assert(calls.some(call => call.path.endsWith('/search') && call.body.title === '恢复演示'));
  assert.equal(preparations.length, count);
  assert.equal(await page.evaluate(() => window.__recoveryAudio === document.querySelector('audio') && window.__recoveryAudio.paused), true);
  assert.equal(await page.locator('audio').evaluate(audio => audio.currentTime), position);
  await page.getByRole('button', { name:'播放队列', exact:true }).click();
  const queue = page.getByRole('dialog', { name:'播放队列', exact:true }); await queue.waitFor();
  assert.equal(await queue.locator('.queue-track').count(), 2);
  await queue.getByRole('button', { name:'关闭播放队列', exact:true }).click();
  assert.deepEqual(errors, []);
});

test('mobile failed lyric reads recover the revision for manual import and offer an in-place retry', { timeout:60000 }, async t => {
  const { page, panel, control, calls, writes, preparations, errors } = await recoveryFixture(t, { stateError:true });
  await panel.getByText('歌词暂不可用', { exact:true }).waitFor();
  const actions = await panel.locator('.lyrics-recovery-actions').boundingBox(), bounds = await panel.boundingBox();
  assert(actions.y >= bounds.y && actions.y + actions.height <= bounds.y + bounds.height + 1, 'both error recovery actions fit the reading area');
  const artifacts = join(developmentPaths().artifacts, 'mobile-lyrics-recovery'); mkdirSync(artifacts, { recursive:true });
  await page.screenshot({ path:join(artifacts, 'failed-320-568.png') });
  const count = preparations.length, reads = calls.filter(call => call.path.endsWith('/state')).length;
  await panel.getByRole('button', { name:'查找或导入歌词', exact:true }).click();
  const dialog = page.getByRole('dialog', { name:'选择歌词', exact:true });
  await dialog.getByRole('alert').waitFor();
  assert(calls.filter(call => call.path.endsWith('/state')).length > reads, 'the recovery entry rereads a missing revision');
  await dialog.getByText('导入歌词', { exact:true }).click();
  await dialog.getByLabel('粘贴歌词正文').fill('[00:00]导入后第一行');
  assert.equal(await dialog.getByRole('button', { name:'使用导入歌词', exact:true }).isDisabled(), true, 'a missing revision cannot be saved');
  await dialog.getByRole('button', { name:'返回上一级', exact:true }).click();
  await dialog.waitFor({ state:'detached' });
  control.stateError = false;
  await panel.getByRole('button', { name:'查找或导入歌词', exact:true }).click();
  await dialog.waitFor();
  await dialog.getByText('导入歌词', { exact:true }).click();
  assert.equal(await dialog.getByLabel('粘贴歌词正文').inputValue(), '[00:00]导入后第一行', 'the cancelled recovery keeps its draft');
  await page.waitForFunction(() => !document.querySelector('.lyric-picker-footer .btn-primary').disabled);
  await dialog.getByLabel('导入歌词文件').setInputFiles({ name:'recovered.lrc', mimeType:'text/plain', buffer:Buffer.from('[00:00]导入后第一行') });
  await dialog.getByRole('button', { name:'使用导入歌词', exact:true }).click(); await dialog.waitFor({ state:'detached' });
  await panel.getByRole('button', { name:'导入后第一行', exact:true }).waitFor();
  assert.equal(writes.length, 1); assert.equal(writes[0].body.revision, 'first');
  assert.equal(preparations.length, count);
  assert.equal(await page.evaluate(() => window.__recoveryAudio === document.querySelector('audio') && !window.__recoveryAudio.paused), true);
  assert.deepEqual(errors, []);

  // A separate session exercises the inline retry without opening the selector.
  const retry = await recoveryFixture(t, { resolveError:true });
  await retry.panel.getByText('歌词暂不可用', { exact:true }).waitFor();
  retry.control.resolveError = false;
  await retry.panel.getByRole('button', { name:'重试读取歌词', exact:true }).click();
  await retry.panel.getByText('暂无匹配歌词', { exact:true }).waitFor();
  assert.equal(await retry.page.getByRole('dialog').count(), 0);
  assert.equal(await retry.panel.getByRole('button', { name:'查找或导入歌词', exact:true }).isVisible(), true);
  assert.equal(retry.preparations.length, 1);
  assert.deepEqual(retry.errors, []);
});

test('mobile instrumental and no-track lyric states stay distinct from recoverable failures', { timeout:60000 }, async t => {
  for (const options of [{ instrumental:true }, { queued:false }]) {
    const { page, panel, calls, errors } = await recoveryFixture(t, options);
    await panel.getByText(options.instrumental ? '纯音乐，安心听' : '播放音乐后查看歌词', { exact:true }).waitFor();
    assert.equal(await panel.getByRole('button').count(), 0);
    assert.equal(calls.filter(call => call.path.endsWith('/resolve')).length, 0);
    assert.equal(await page.getByRole('button', { name:'播放队列', exact:true }).isVisible(), true);
    assert.deepEqual(errors, []);
  }
});

test('mobile recovery of a failed first read restores the saved lyric timing without changing playback intent', { timeout:60000 }, async t => {
  const { page, panel, control, writes, preparations, errors } = await recoveryFixture(t, { stateError:true, saved:true });
  await panel.getByText('歌词暂不可用', { exact:true }).waitFor();
  await page.getByRole('button', { name:'暂停', exact:true }).click();
  control.stateError = false;
  await panel.getByRole('button', { name:'查找或导入歌词', exact:true }).click();
  const dialog = page.getByRole('dialog', { name:'选择歌词', exact:true });
  await dialog.getByRole('button', { name:'预览 LRCLIB 恢复演示 42', exact:true }).waitFor();
  await dialog.getByRole('button', { name:'返回上一级', exact:true }).click();
  await panel.getByRole('button', { name:'恢复后继续听', exact:true }).click();
  await page.waitForFunction(() => Math.abs(document.querySelector('audio').currentTime - 1.25) < .05);
  assert.equal(await page.evaluate(() => window.__recoveryAudio === document.querySelector('audio') && window.__recoveryAudio.paused), true);
  assert.equal(preparations.length, 1); assert.equal(writes.length, 0); assert.deepEqual(errors, []);
});
