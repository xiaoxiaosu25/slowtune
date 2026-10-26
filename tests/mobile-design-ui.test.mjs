import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from './helpers/browser.mjs';
import { createMobileFixture } from './helpers/mobile-fixture.mjs';
import { createMobileSecondaryFixture } from './helpers/mobile-secondary-fixture.mjs';
import { RecommendationStore } from '../dist/server/recommendation.js';
import { SearchSettingsStore } from '../dist/server/search-settings.js';
import { developmentPaths } from '../scripts/workspace-paths.mjs';

const artifacts = join(developmentPaths().artifacts, 'mobile-design');
const navigation = page => page.getByRole('navigation', { name: '手机导航', exact: true });
async function setup(t, fixture, viewport = { width: 390, height: 844 }) {
  const browser = await chromium.launch({ headless: true });
  t.after(async () => { await browser.close(); await fixture.close(); });
  const page = await browser.newPage({ viewport, hasTouch: true, colorScheme: 'light' });
  page.setDefaultTimeout(8000);
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  mkdirSync(artifacts, { recursive: true });
  return { page, errors };
}
async function touchTarget(locator) {
  const box = await locator.boundingBox();
  assert(box && box.width >= 48 && box.height >= 48, JSON.stringify(box));
}

test('mobile touch targets, search focus and playback sheet remain usable without replacing audio', { timeout: 60000 }, async t => {
  const fixture = await createMobileFixture({ preview: true, discovery: true });
  const { page, errors } = await setup(t, fixture);
  await page.goto(fixture.base); await navigation(page).waitFor();
  for (const width of [320, 360, 390, 430]) {
    await page.setViewportSize({ width, height: 844 });
    const first = page.locator('.mobile-shelf-covers .music-card').first();
    for (const selector of ['.creator-link', '.card-title', '.cover-favorite']) await touchTarget(first.locator(selector));
    await touchTarget(page.getByRole('navigation', { name: '发现栏目' }).getByRole('button', { name: '推荐', exact: true }));
  }
  await page.getByRole('button', { name: '搜索歌曲或视频', exact: true }).click();
  const search = page.getByRole('searchbox', { name: '搜索关键词', exact: true });
  await search.focus(); await touchTarget(search);
  const focus = await search.evaluate(e => { const s = getComputedStyle(e.closest('form')); return { outline: s.outlineStyle, shadow: s.boxShadow }; });
  assert(focus.outline !== 'none' || focus.shadow !== 'none', 'focused search has a visible focus indicator');
  await page.screenshot({ path: join(artifacts, 'search-focus-430.png') });
  await page.getByRole('button', { name: '关闭搜索', exact: true }).click();
  await page.locator('.mobile-mini-player').getByRole('button', { name: '播放', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('audio')?.currentTime > 0);
  const audio = await page.locator('audio').elementHandle(); await audio.evaluate(e => { e.loop = true; });
  await page.getByRole('button', { name: '打开正在播放', exact: true }).click();
  await page.getByRole('button', { name: '更多播放选项', exact: true }).click();
  const sheet = page.getByRole('dialog', { name: '更多播放选项', exact: true });
  await sheet.waitFor(); assert.equal(await sheet.locator('kbd').count(), 0);
  await sheet.getByRole('button', { name: '播放速度', exact: true }).click();
  await page.getByRole('menuitemradio', { name: '1.5×', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('audio')?.playbackRate === 1.5);
  assert(await sheet.isVisible(), 'changing rate leaves the playback sheet available');
  await page.screenshot({ path: join(artifacts, 'options-430.png') });
  await sheet.getByRole('button', { name: '歌词设置', exact: true }).click();
  const lyrics = page.getByRole('dialog', { name: '歌词设置', exact: true }); await lyrics.waitFor();
  assert.equal(await sheet.count(), 0);
  await page.goBack(); await lyrics.waitFor({ state: 'detached' });
  await page.goForward(); assert.equal(await page.getByRole('dialog').count(), 0);
  for (const size of [{ width: 320, height: 568 }, { width: 568, height: 320 }]) {
    await page.setViewportSize(size);
    await page.getByRole('button', { name: '更多播放选项', exact: true }).click();
    const stop = sheet.getByRole('button', { name: '停止播放', exact: true });
    await stop.scrollIntoViewIfNeeded();
    const stopBox = await stop.boundingBox(), close = sheet.getByRole('button', { name: '关闭', exact: true }), closeBox = await close.boundingBox();
    assert(stopBox.y >= 0 && stopBox.y + stopBox.height <= size.height, 'short-screen stop action is reachable');
    assert(closeBox.y >= 0 && closeBox.y + closeBox.height <= size.height, 'sheet close remains available after scrolling');
    await close.click();
  }
  assert(await audio.evaluate(e => e === document.querySelector('audio') && !e.paused));
  assert.deepEqual(errors, []);
});

test('compact author, collection and version selection show primary content before secondary editing', { timeout: 60000 }, async t => {
  const fixture = await createMobileSecondaryFixture();
  const { page, errors } = await setup(t, fixture, { width: 320, height: 568 });
  await page.goto(fixture.base); await navigation(page).waitFor();
  await page.getByRole('navigation', { name: '发现栏目' }).getByRole('button', { name: '关注', exact: true }).click();
  await page.getByRole('button', { name: '查看 ' + fixture.creators[0].name + ' 的合集', exact: true }).click();
  const firstCollection = page.getByRole('button', { name: '打开合集 ' + fixture.collections[0].title, exact: true });
  await firstCollection.waitFor();
  let mini = await page.locator('.mobile-mini-player').boundingBox();
  const collectionBox = await firstCollection.locator('.follow-collection-art').boundingBox();
  assert(collectionBox.y + collectionBox.height <= mini.y, 'first collection cover is visible above the player');
  assert.equal(await page.getByRole('navigation', { name: '发现栏目' }).count(), 0);
  await page.screenshot({ path: join(artifacts, 'author-320.png') });
  await firstCollection.click(); await page.locator('.follows-page .track-row').first().waitFor();
  mini = await page.locator('.mobile-mini-player').boundingBox();
  const play = await page.locator('.follows-page .track-row .row-cover').first().boundingBox();
  assert(play.y + play.height <= mini.y, 'first collection track can be played without scrolling');
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.screenshot({ path: join(artifacts, 'collection-320.png') });
  await page.getByRole('button', { name: '打开正在播放', exact: true }).click();
  await page.getByRole('button', { name: '选择播放版本 ' + fixture.longTitle, exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '歌曲与版本', exact: true });
  await dialog.waitFor();
  assert.equal(await dialog.getByRole('tab', { name: '播放版本', exact: true }).getAttribute('aria-selected'), 'true');
  for (const size of [{ width: 320, height: 568 }, { width: 568, height: 320 }, { width: 667, height: 375 }]) {
    await page.setViewportSize(size);
    const control = await dialog.getByRole('button', { name: '播放此版本', exact: true }).first().boundingBox();
    assert(control.y >= 0 && control.y + control.height <= size.height, JSON.stringify({ size, control }));
    const mini=await page.locator('.mobile-mini-player').boundingBox();
    await page.screenshot({path:join(artifacts,`versions-${size.width}.png`)});
    assert(control.y+control.height<=mini.y,JSON.stringify({size,control,mini}));
    assert(await dialog.evaluate(e => e.scrollWidth <= e.clientWidth + 1));
  }
  await dialog.getByRole('tab', { name: '歌曲资料', exact: true }).click();
  await dialog.getByRole('button', { name: '编辑资料', exact: true }).click();
  await dialog.getByRole('textbox', { name: '标准歌名', exact: true }).fill('保留未保存的歌曲资料');
  await dialog.getByRole('tab', { name: '播放版本', exact: true }).click();
  await dialog.getByRole('tab', { name: '歌曲资料', exact: true }).click();
  assert.equal(await dialog.getByRole('textbox', { name: '标准歌名', exact: true }).inputValue(), '保留未保存的歌曲资料');
  assert.equal(fixture.preparations.length, 0, 'browsing and editing do not prepare playback');
  assert.deepEqual(errors, []);
});

test('mobile recommendation keywords precede collapsed search rules and keep search drafts', { timeout: 60000 }, async t => {
  const fixture = await createMobileFixture({ preview: true });
  const { page, errors } = await setup(t, fixture);
  const recommendations = new RecommendationStore(':memory:', 'mobile-design'), search = new SearchSettingsStore(':memory:', 'mobile-design');
  t.after(() => { recommendations.close(); search.close(); });
  await page.route('**/api/recommendation/settings?*', route => route.fulfill({ json: recommendations.read(new URL(route.request().url()).searchParams.get('column')) }));
  await page.route('**/api/settings/search', route => route.fulfill({ json: search.read() }));
  await page.goto(fixture.base); await navigation(page).waitFor();
  await navigation(page).getByRole('button', { name: '我的', exact: true }).click();
  await page.getByRole('button', { name: '推荐偏好 推荐与选歌规则', exact: true }).click();
  const keywords = page.getByRole('textbox', { name: '偏好关键词', exact: true }); await keywords.waitFor();
  const box = await keywords.boundingBox(), mini = await page.locator('.mobile-mini-player').boundingBox();
  assert(box.y + box.height <= mini.y, 'main recommendation input is visible on the first screen');
  const rules = page.locator('.mobile-search-rules');
  assert.equal(await rules.evaluate(e => e.open), false);
  await page.screenshot({ path: join(artifacts, 'recommendation-390.png') });
  await rules.locator('summary').first().click();
  const excluded = rules.getByRole('textbox', { name: '搜索排除词', exact: true });
  await excluded.fill('保留搜索规则草稿');
  await rules.locator('summary').first().click(); await rules.locator('summary').first().click();
  assert.equal(await excluded.inputValue(), '保留搜索规则草稿');
  assert.deepEqual(errors, []);
});
