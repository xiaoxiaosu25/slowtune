import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from './helpers/browser.mjs';
import { createMobileFixture } from './helpers/mobile-fixture.mjs';
import { queueRecord } from './helpers/song-fixture.mjs';

async function openDesktop(t, { reducedMotion = 'no-preference', queue } = {}) {
  const fixture = await createMobileFixture({ preview: true });
  t.after(fixture.close);
  const browser = await chromium.launch({ headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion });
  page.setDefaultTimeout(10000);
  if (queue) await page.addInitScript(record => localStorage.setItem('slow-listening:playback:v3', JSON.stringify(record)), queue);
  await page.route('**/*', route => new URL(route.request().url()).origin === fixture.base ? route.continue() : route.abort());
  await page.goto(fixture.base);
  await page.locator('.sidebar-nav').waitFor();
  return page;
}

test('command palette supports keyboard navigation and returns focus on Escape', async t => {
  const page = await openDesktop(t);
  const discover = page.locator('.sidebar-nav').getByRole('button', { name: '发现', exact: true });
  await discover.focus();
  await page.keyboard.press('Control+k');
  const palette = page.getByRole('dialog', { name: '快捷指令', exact: true });
  const input = palette.getByPlaceholder('查找操作或页面');
  await input.waitFor();
  assert(await input.evaluate(element => document.activeElement === element));
  await page.keyboard.press('Escape');
  await palette.waitFor({ state: 'detached' });
  await page.waitForFunction(() => document.activeElement?.matches('.sidebar-nav button.active'));

  await page.keyboard.press('Control+k');
  await input.fill('音乐榜单');
  await page.keyboard.press('Enter');
  await palette.waitFor({ state: 'detached' });
  await page.getByRole('tablist', { name: '榜单平台' }).waitFor();
  assert.equal(await page.locator('.sidebar-nav').getByRole('button', { name: '音乐榜单' }).getAttribute('aria-current'), 'page');

  await page.keyboard.press('Control+k');
  await input.fill('设置');
  await page.keyboard.press('Enter');
  await page.getByRole('button', { name: '返回浏览音乐', exact: true }).click();
  await page.getByRole('tablist', { name: '榜单平台' }).waitFor();
});

test('long queue renders a window and retains keyboard focus while scrolling', async t => {
  const tracks = Array.from({ length: 120 }, (_, i) => ({
    resourceId: 'test-queue-' + i,
    ref: { provider: 'bilibili', kind: 'video', id: 'BV' + String(i).padStart(10, '0') },
    title: '长队列歌曲 ' + (i + 1),
  }));
  const page = await openDesktop(t, { queue: queueRecord(tracks) });
  await page.getByRole('button', { name: '打开播放队列', exact: true }).click();
  const queue = page.getByRole('complementary', { name: '播放队列' });
  const first = queue.getByRole('button', { name: '播放队列歌曲 长队列歌曲 1', exact: true });
  await first.focus();
  assert((await queue.locator('.queue-track').count()) < 35);
  await queue.locator('.queue-content').evaluate(element => { element.scrollTop = element.scrollHeight; });
  await queue.getByRole('button', { name: '播放队列歌曲 长队列歌曲 120', exact: true }).waitFor();
  assert(await first.evaluate(element => document.activeElement === element));
  assert((await queue.locator('.queue-track').count()) < 35);
  const actions = queue.getByRole('button', { name: '队列操作 长队列歌曲 120', exact: true });
  await actions.click();
  const menu = queue.getByRole('menu', { name: '队列操作 长队列歌曲 120', exact: true });
  await menu.getByRole('menuitem', { name: '从播放队列移除', exact: true }).click();
  await queue.getByRole('button', { name: '播放队列歌曲 长队列歌曲 120', exact: true }).waitFor({ state: 'detached' });
  await queue.getByRole('heading', { name: '播放队列 119 首', exact: true }).waitFor();
});

test('reduced motion keeps the sidebar selection and reuses the audio on opening the player', async t => {
  const page = await openDesktop(t, { reducedMotion: 'reduce' });
  assert.equal(await page.locator('.sidebar-selection').count(), 0);
  assert.equal(await page.locator('.sidebar-nav .active').getAttribute('aria-current'), 'page');
  const audio = await page.locator('audio[data-product-media]').elementHandle();
  await page.getByRole('button', { name: '打开正在播放', exact: true }).click();
  await page.locator('.listening-stage .playing-art-switch').waitFor();
  assert(await audio.evaluate(element => element === document.querySelector('audio[data-product-media]')));
  assert.equal(await page.locator('.listening-stage .playing-art-switch').evaluate(element => getComputedStyle(element).transform), 'none');
});

test('Escape closes the rate menu before the mobile player drawer', async t => {
  const page = await openDesktop(t);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('.app[data-layout=mobile]').waitFor();
  await page.getByRole('button', { name: '打开正在播放', exact: true }).click();
  await page.getByRole('button', { name: '更多播放选项', exact: true }).click();
  const drawer = page.getByRole('dialog', { name: '更多播放选项', exact: true });
  await drawer.getByRole('button', { name: '播放速度', exact: true }).click();
  const rate = drawer.getByRole('menu', { name: '播放速度', exact: true });
  await rate.waitFor();
  await page.keyboard.press('Escape');
  await rate.waitFor({ state: 'hidden' });
  assert(await drawer.isVisible());
  await page.keyboard.press('Escape');
  await drawer.waitFor({ state: 'detached' });
  assert(await page.locator('.mobile-player').isVisible());
});
