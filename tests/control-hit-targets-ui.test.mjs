import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from './helpers/browser.mjs';
import { createMobileFixture } from './helpers/mobile-fixture.mjs';
import { assertControlHitTarget, clickControlPoint, pressControlPoint, controlPoints } from './helpers/control-hit-target.mjs';
import { developmentPaths } from '../scripts/workspace-paths.mjs';

const artifacts = join(developmentPaths().artifacts, 'control-hit-targets');

async function setup(t, mobile = false) {
  const fixture = await createMobileFixture({ preview: true, discovery: true });
  const browser = await chromium.launch({ headless: true });
  t.after(async () => { await browser.close(); await fixture.close(); });
  const page = await browser.newPage({ viewport: mobile ? { width: 390, height: 844 } : { width: 1280, height: 800 }, hasTouch: mobile });
  page.setDefaultTimeout(8000);
  await page.route('https://**', route => route.abort());
  await page.goto(fixture.base);
  mkdirSync(artifacts, { recursive: true });
  return { page, fixture };
}

test('desktop dialog, queue, comments and dropdown controls respond across their visible targets', { timeout: 60000 }, async t => {
  const { page, fixture } = await setup(t);
  const search = page.getByRole('textbox', { name: '搜索歌曲或视频', exact: true });
  await search.fill('晚风'); await search.press('Enter');
  const searchDialog = page.getByRole('dialog', { name: '搜索音乐', exact: true });
  await searchDialog.waitFor();
  await assertControlHitTarget(searchDialog.getByRole('button', { name: '关闭', exact: true }), 40);
  await clickControlPoint(page, searchDialog.getByRole('button', { name: '关闭', exact: true }), [.5, .1]);
  await searchDialog.waitFor({ state: 'detached' });

  await page.getByRole('button', { name: '打开正在播放', exact: true }).click();
  for (const size of [{ width: 1280, height: 800 }, { width: 1000, height: 640 }]) {
    await page.setViewportSize(size);
    const title = page.getByRole('button', { name: '查看完整标题：' + fixture.tracks[0].title, exact: true });
    await title.click();
    const dialog = page.getByRole('dialog', { name: '完整标题', exact: true });
    const close = dialog.getByRole('button', { name: '关闭', exact: true });
    await assertControlHitTarget(close, 40);
    await pressControlPoint(page, close, [.9, .5]);
    await dialog.waitFor({ state: 'detached' });
    await page.waitForFunction(() => document.activeElement?.matches('.playing-title-trigger'));
    assert(await title.evaluate(e => e === document.activeElement));

    const rate = page.getByRole('button', { name: '播放速度', exact: true });
    await assertControlHitTarget(rate);
    await clickControlPoint(page, rate, [.9, .5]);
    const menu = page.getByRole('menu', { name: '播放速度', exact: true });
    await menu.waitFor();
    await assertControlHitTarget(menu.getByRole('menuitemradio', { name: '1.5×', exact: true }));
    await clickControlPoint(page, rate, [.1, .5]);
    await menu.waitFor({ state: 'hidden' });

    const more = page.getByRole('button', { name: '更多播放选项', exact: true });
    await assertControlHitTarget(more);
    await clickControlPoint(page, more, [.5, .1]);
    const options = page.locator('.listening-stage .player-options .control-popover-panel');
    await options.waitFor();
    await clickControlPoint(page, more, [.5, .9]);
    await options.waitFor({ state: 'detached' });
  }
  await page.getByRole('button', { name: '播放队列', exact: true }).click();
  const closeQueue = page.getByRole('button', { name: '关闭播放队列', exact: true });
  await assertControlHitTarget(closeQueue, 40);
  await page.getByRole('button', { name: '评论', exact: true }).click();
  const closeComments = page.getByRole('button', { name: '关闭评论', exact: true });
  await assertControlHitTarget(closeComments, 40);
  await clickControlPoint(page, closeComments, [.5, .1]);
  await closeComments.waitFor({ state: 'detached' });
  await page.screenshot({ path: join(artifacts, 'desktop.png') });
});

test('shared buttons preserve their hit boxes while pressed and disabled transport does not activate', { timeout: 30000 }, async t => {
  const { page, fixture } = await setup(t);
  await page.getByRole('button', { name: '打开正在播放', exact: true }).click();
  const previous = page.getByRole('button', { name: '上一首', exact: true });
  assert(await previous.isDisabled());
  await clickControlPoint(page, previous, [.5, .5]);
  assert.equal(fixture.preparations.length, 0);
  const play = page.getByRole('button', { name: '播放', exact: true });
  await pressControlPoint(page, play, [.5, .03]);
  await page.waitForFunction(() => document.querySelector('audio')?.currentTime > 0);
  assert.equal(fixture.preparations.length, 1);
  await pressControlPoint(page, page.getByRole('button', { name: '暂停', exact: true }), [.97, .5]);
  assert(await page.locator('audio').evaluate(audio => audio.paused));
  assert.equal(fixture.preparations.length, 1);
});

test('mobile close and collapse buttons keep 48px targets in portrait and short landscape', { timeout: 90000 }, async t => {
  const { page } = await setup(t, true);
  await page.getByRole('button', { name: '打开正在播放', exact: true }).click();
  const sheet = page.getByRole('dialog', { name: '更多播放选项', exact: true });
  for (const size of [{ width: 320, height: 568 }, { width: 390, height: 844 }, { width: 568, height: 320 }]) {
    await page.setViewportSize(size);
    for (const point of controlPoints.slice(0, 5)) {
      const more = page.getByRole('button', { name: '更多播放选项', exact: true });
      await assertControlHitTarget(more, 48);
      await clickControlPoint(page, more, point, true);
      const close = sheet.getByRole('button', { name: '关闭', exact: true });
      await sheet.waitFor();
      await sheet.getByRole('button', { name: '停止播放', exact: true }).scrollIntoViewIfNeeded();
      await assertControlHitTarget(close, 48);
      await clickControlPoint(page, close, point, true);
      await sheet.waitFor({ state: 'detached' });
    }
    await page.getByRole('button', { name: '播放队列', exact: true }).click();
    const closeQueue = page.getByRole('button', { name: '关闭播放队列', exact: true });
    await assertControlHitTarget(closeQueue, 48);
    await clickControlPoint(page, closeQueue, [.5, .1], true);
    await closeQueue.waitFor({ state: 'detached' });
    const back = page.getByRole('button', { name: '返回浏览音乐', exact: true });
    await assertControlHitTarget(back, 48);
    await clickControlPoint(page, back, [.1, .5], true);
    await page.locator('.mobile-player').waitFor({ state: 'detached' });
    await page.getByRole('button', { name: '打开正在播放', exact: true }).click();
    await page.screenshot({ path: join(artifacts, 'mobile-' + size.width + '.png') });
  }
});

test('mobile disclosures and dropdown padding respond to taps outside the glyph', { timeout: 45000 }, async t => {
  const { page } = await setup(t, true);
  const nav = page.getByRole('navigation', { name: '手机导航', exact: true });
  await nav.getByRole('button', { name: '我的', exact: true }).click();
  await page.getByRole('button', { name: /音乐来源/ }).click();
  const details = page.locator('.mobile-setting-details').first(), summary = details.locator('summary');
  await assertControlHitTarget(summary, 48);
  await clickControlPoint(page, summary, [.95, .5], true);
  assert(await details.evaluate(e => e.open));
  await clickControlPoint(page, summary, [.5, .9], true);
  assert.equal(await details.evaluate(e => e.open), false);
  await page.getByRole('button', { name: '打开正在播放', exact: true }).click();
  await page.getByRole('button', { name: '更多播放选项', exact: true }).click();
  const sheet = page.getByRole('dialog', { name: '更多播放选项', exact: true });
  const rate = sheet.getByRole('button', { name: '播放速度', exact: true });
  await assertControlHitTarget(rate, 48);
  await clickControlPoint(page, rate, [.95, .5], true);
  const choice = page.getByRole('menuitemradio', { name: '1.5×', exact: true });
  await assertControlHitTarget(choice, 48);
  await clickControlPoint(page, choice, [.95, .5], true);
  await page.getByRole('menu', { name: '播放速度', exact: true }).waitFor({ state: 'hidden' });
  assert(await sheet.isVisible());
  assert.match(await rate.innerText(), /1.5/);
  await sheet.getByRole('button', { name: '关闭', exact: true }).click();
});
