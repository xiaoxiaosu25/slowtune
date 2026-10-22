import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import { startSongManagementFixture } from './helpers/song-management-fixture.mjs';
import { navigate } from '../scripts/browser-ui.mjs';

async function setup(t) {
  const fixture = await startSongManagementFixture(); t.after(fixture.close);
  const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--autoplay-policy=no-user-gesture-required'] }); t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } }); page.setDefaultTimeout(8000);
  await page.route('**/*', route => new URL(route.request().url()).origin === fixture.origin ? route.continue() : route.abort());
  await page.goto(fixture.origin);
  const search = async () => {
    await page.getByRole('button', { name: '开始搜索', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: '搜索音乐', exact: true });
    await dialog.getByLabel('弹窗搜索关键词', { exact: true }).fill('晴天');
    await dialog.getByRole('button', { name: '搜索', exact: true }).click();
    return dialog;
  };
  return { fixture, page, search };
}

test('favoriting during a metadata read clears the cancelled playback preparation', { timeout: 30000 }, async t => {
  const { page, search } = await setup(t);
  let release, started;
  const pending = new Promise(resolve => { started = resolve; }), gate = new Promise(resolve => { release = resolve; });
  t.after(() => release());
  await page.route('**/v1/call/metadata', async route => { started(); await gate; await route.continue().catch(() => {}); });
  const dialog = await search();
  await dialog.getByRole('button', { name: '播放 晴天 · 2026音乐会', exact: true }).click(); await pending;
  const heart = dialog.getByRole('button', { name: '收藏 晴天 · 2026音乐会', exact: true });
  await heart.click(); release();
  await page.waitForFunction(() => document.querySelector('[aria-label="收藏 晴天 · 2026音乐会"]')?.getAttribute('aria-pressed') === 'true');
  await page.waitForFunction(() => document.querySelector('.playbar .play-toggle')?.getAttribute('aria-busy') === 'false');
  assert.equal(await dialog.getByRole('button', { name: '取消播放准备', exact: true }).count(), 0);
  assert.equal(await page.locator('audio').getAttribute('src'), null);
  await dialog.getByRole('button', { name: '播放 晴天 · 2026音乐会', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('audio')?.currentTime > .1);
});

for (const entry of ['chart', 'queue', 'search-play-all']) {
  test(`a successful ${entry} play clears an earlier metadata error`, { timeout: 30000 }, async t => {
    const { page, search } = await setup(t);
    await navigate(page, '歌单');
    await page.getByRole('button', { name: '播放 晴天', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('audio')?.currentTime > .1);
    let fail = true;
    await page.route('**/v1/call/metadata', route => fail ? route.fulfill({ status: 503, json: { protocol: 2, error: { code: 'network' } } }) : route.continue());
    const dialog = await search();
    await dialog.getByRole('button', { name: '播放 晴天 · 2026音乐会', exact: true }).click();
    await dialog.getByRole('button', { name: '播放失败，查看详情', exact: true }).waitFor(); fail = false;
    if (entry === 'search-play-all') {
      await dialog.getByRole('button', { name: /播放全部/ }).click();
    } else {
      await dialog.getByRole('button', { name: '关闭', exact: true }).click();
      if (entry === 'chart') {
        await navigate(page, '音乐榜单');
        await page.getByRole('button', { name: '直接播放 晴天', exact: true }).click();
      } else {
        await page.getByRole('button', { name: '打开播放队列', exact: true }).click();
        await page.getByRole('button', { name: '播放队列歌曲 晴天', exact: true }).click();
      }
    }
    await page.waitForFunction(() => document.querySelector('.playbar .play-toggle')?.getAttribute('aria-busy') === 'false' && document.querySelector('audio')?.currentTime > .1 && !document.querySelector('audio').paused);
    await page.getByRole('button', { name: '播放失败，查看详情', exact: true }).waitFor({ state: 'detached' });
    assert.equal(await page.locator('.playbar .play-toggle').getAttribute('aria-busy'), 'false');
  });
}
