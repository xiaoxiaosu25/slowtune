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

test('featured recommendations keep long multipart titles and independent touch targets on compact screens', { timeout: 60000 }, async t => {
  const fixture = await createMobileFixture({ discovery: true });
  const { page, errors } = await setup(t, fixture);
  const titles = ['【Hi-Res无损音质】盘点100首经典华语歌曲，神仙打架的黄金年代，每一首都值得单曲循环！', '【宝藏歌单】100首百听不厌的神仙歌曲合集，值得收藏的好听歌单'];
  await page.route('**/api/discovery/bilibili**', async route => {
    const response = await route.fetch(), shelves = await response.json();
    shelves[0].page.items = shelves[0].page.items.map((track, index) => index > 1 ? track : {
      ...track, title: titles[index], artists: undefined, uploader: { name: '实际长度的音乐分享频道' },
      parts: Array.from({ length: index ? 26 : 100 }, (_, part) => ({ ...track, ref: { ...track.ref, part: String(part + Number(track.ref.part ?? 1000)) }, resourceId: track.resourceId + '-' + part, title: '第 ' + (part + 1) + ' 首' })),
    });
    await route.fulfill({ response, json: shelves });
  });
  await page.goto(fixture.base); await navigation(page).waitFor();
  const shelf = page.locator('[data-shelf-id="account-recommendation"]'), cards = shelf.locator('.music-card');
  await cards.first().getByRole('button', { name: '查看分 P · ' + titles[0], exact: true }).waitFor();
  for (const width of [320, 360, 390, 430]) {
    await page.setViewportSize({ width, height: 844 });
    for (const index of [0, 1]) {
      const card = cards.nth(index);
      for (const selector of ['.card-title', '.creator-link', '.part-badge', '.card-menu']) await touchTarget(card.locator(selector));
      const rects = await card.evaluate(e => {
        const rect = selector => { const r = e.querySelector(selector).getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom }; };
        return { title: rect('.card-title'), parts: rect('.part-badge'), creator: rect('.creator-link'), menu: rect('.card-menu'), card: e.getBoundingClientRect().toJSON() };
      });
      const overlaps = (a, b) => a.left < b.right - 1 && a.right > b.left + 1 && a.top < b.bottom - 1 && a.bottom > b.top + 1;
      for (const other of ['title', 'creator', 'menu']) assert(!overlaps(rects.parts, rects[other]), JSON.stringify({ width, index, other, rects }));
      assert(rects.parts.left >= rects.card.left && rects.parts.right <= rects.card.right + 1);
    }
    assert(await shelf.evaluate(e => e.scrollWidth <= e.clientWidth));
  }
  assert.equal(await cards.count(), 6);
  assert.equal(await cards.first().getByText('100 个分 P', { exact: true }).count(), 1);
  await cards.first().getByRole('button', { name: '查看分 P · ' + titles[0], exact: true }).click();
  await page.getByRole('dialog', { name: '歌曲与分 P', exact: true }).waitFor();
  assert.equal(fixture.preparations.length, 0, 'opening multipart details does not start playback');
  await page.getByRole('dialog', { name: '歌曲与分 P', exact: true }).getByRole('button', { name: '关闭', exact: true }).click();
  await cards.first().locator('.card-title').click();
  await page.waitForFunction(() => document.querySelector('audio')?.currentTime > 0);
  assert.equal(fixture.preparations.length, 1, 'a multipart title directly starts its default part once');
  assert.equal(await page.getByRole('dialog').count(), 0, 'starting multipart playback does not interrupt browsing with a choice dialog');
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

test('follow updates, cover browsing, search, library and charts retain a consistent readable mobile hierarchy', { timeout: 60000 }, async t => {
  const fixture = await createMobileSecondaryFixture();
  const { page, errors } = await setup(t, fixture);
  await page.route('**/api/discovery/bilibili**', route => route.fulfill({ json: [{
    id: 'account-recommendation', title: '为你推荐 · B站账号', kind: 'recommendation',
    page: { items: Array.from({ length: 3 }, (_, index) => ({ ...fixture.tracks[0], resourceId: 'recommendation-' + index })) },
  }] }));
  await page.route('**/api/follows/feed**', async route => {
    const response = await route.fetch(), feed = await response.json();
    feed.items[0].parts = Array.from({ length: 26 }, (_, index) => ({ ...feed.items[0], ref: { ...feed.items[0].ref, part: String(index + 1000) }, resourceId: 'feed-part-' + index }));
    await route.fulfill({ response, json: feed });
  });
  await page.goto(fixture.base); await navigation(page).waitFor();
  const scale = locator => locator.evaluate(e => { const s = getComputedStyle(e); return [s.fontSize, s.lineHeight, s.fontWeight]; });
  const recommendationScale = await scale(page.locator('.mobile-shelf-featured .card-title').nth(1));
  const playStyle = locator => locator.evaluate(e => { const s = getComputedStyle(e); return [s.backgroundColor, s.color, s.borderRadius, s.fontSize]; });
  const recommendationPlayStyle = await playStyle(page.locator('[data-shelf-id="account-recommendation"] .mobile-shelf-play'));
  const overlaps = (a, b) => a.x < b.x + b.width - 1 && a.x + a.width > b.x + 1 && a.y < b.y + b.height - 1 && a.y + a.height > b.y + 1;
  async function readableRow(row) {
    const title = row.locator('.track-name'), info = row.locator('.row-info');
    assert.deepEqual(await scale(title), recommendationScale);
    assert((await info.boundingBox()).width >= 110, 'long titles retain a usable reading column');
    const controls = [row.locator('.row-cover'), title, ...await row.locator(':scope > .btn-icon').all()];
    for (const control of controls) await touchTarget(control);
    const boxes = await Promise.all(controls.map(control => control.boundingBox()));
    for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) assert(!overlaps(boxes[i], boxes[j]), 'play, title, favorite and more remain separate');
    assert(await row.evaluate(e => e.scrollWidth <= e.clientWidth + 1));
  }
  const homeUpdates = page.locator('[data-shelf-id="follow-updates"]');
  await homeUpdates.locator('.track-row').first().waitFor();
  for (const width of [320, 360, 390, 430]) {
    await page.setViewportSize({ width, height: 844 });
    await readableRow(homeUpdates.locator('.track-row').first());
    assert(await homeUpdates.locator('time').first().isVisible(), 'home updates retain publication time');
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('navigation', { name: '发现栏目' }).getByRole('button', { name: '关注', exact: true }).click();
  await page.getByRole('button', { name: '最近更新', exact: true }).click();
  const feed = page.locator('.follow-feed-pages');
  await readableRow(feed.locator('.track-row').first());
  const playPage = page.getByRole('button', { name: '播放本页', exact: true });
  assert.equal((await playPage.innerText()).trim(), '播放本页', 'follow playback has a visible scope label');
  await touchTarget(playPage);
  assert.deepEqual(await playStyle(playPage), recommendationPlayStyle);
  const firstListArtwork = await feed.locator('.row-cover').first().boundingBox();
  assert((await feed.locator('.track-row').nth(1).boundingBox()).height <= 106, 'ordinary updates retain compact rows');
  assert((await feed.locator('.track-row').first().boundingBox()).y < 250, 'tools and status leave room for the first update');
  await page.getByRole('button', { name: '关注页面操作', exact: true }).click();
  const menu = page.getByRole('dialog', { name: '关注页面操作', exact: true });
  await menu.getByRole('button', { name: '封面浏览', exact: true }).click();
  const card = feed.locator('.music-card').first();
  await card.waitFor();
  for (const width of [320, 390, 430]) {
    await page.setViewportSize({ width, height: 844 });
    assert.deepEqual(await scale(card.locator('.card-title')), recommendationScale);
    for (const selector of ['.card-title', '.creator-link', '.card-menu', '.cover-favorite']) await touchTarget(card.locator(selector));
    assert.equal(await card.locator('time').count(), 1);
    assert((await card.locator('.cover-button').boundingBox()).width > firstListArtwork.width * 2, 'cover browsing emphasizes artwork rather than repeating the list geometry');
    await touchTarget(card.locator('.part-badge'));
    const parts = await card.locator('.part-badge').boundingBox();
    for (const selector of ['.card-title', '.creator-link', '.card-menu', 'time']) assert(!overlaps(parts, await card.locator(selector).boundingBox()), 'publication time and multipart actions remain separate');
    assert(await feed.evaluate(e => e.scrollWidth <= e.clientWidth + 1));
  }
  await page.screenshot({ path: join(artifacts, 'follow-updates-cover-430.png') });
  await page.setViewportSize({ width: 1280, height: 800 });
  await feed.locator('.track-row').first().waitFor();
  assert.equal(await page.getByRole('button', { name: '关注的最近更新列表视图', exact: true }).getAttribute('aria-pressed'), 'true', 'mobile cover choice leaves the desktop preference unchanged');
  await page.setViewportSize({ width: 390, height: 844 });
  await card.waitFor();
  await page.getByRole('button', { name: '搜索歌曲或视频', exact: true }).click();
  await page.getByRole('searchbox', { name: '搜索关键词', exact: true }).fill('晚风');
  await page.getByRole('button', { name: '搜索', exact: true }).click();
  await page.setViewportSize({ width: 320, height: 844 });
  await readableRow(page.locator('.mobile-search-content .track-row').first());
  await page.getByRole('button', { name: '关闭搜索', exact: true }).click();
  await navigation(page).getByRole('button', { name: '音乐库', exact: true }).click();
  await page.getByRole('button', { name: '我的收藏 1 首歌曲', exact: true }).click();
  await readableRow(page.locator('.song-library-row').first());
  await page.getByRole('button', { name: '返回音乐库', exact: true }).click();
  await navigation(page).getByRole('button', { name: '发现', exact: true }).click();
  await page.getByRole('navigation', { name: '发现栏目' }).getByRole('button', { name: '音乐榜单', exact: true }).click();
  const chart = page.locator('.chart-song').first(); await chart.waitFor();
  assert.deepEqual(await scale(chart.locator('.chart-song-title')), recommendationScale);
  assert((await chart.locator('.chart-song-copy').boundingBox()).width >= 110);
  assert.equal(Number((await chart.locator('.row-number').textContent()).trim()), 1);
  const chartPlay = page.locator('.chart-play-all');
  await touchTarget(chartPlay);
  assert.deepEqual(await playStyle(chartPlay), recommendationPlayStyle);
  const chartPicker = page.getByRole('combobox', { name: '网易云榜单', exact: true });
  assert.equal(await chartPicker.count(), 1);
  assert.equal(await chartPicker.evaluate(e => getComputedStyle(e).fontSize), '20px', 'the picker reads as the chart heading');
  await touchTarget(chartPicker);
  const pickerBox = await chartPicker.boundingBox(), playBox = await chartPlay.boundingBox();
  assert(!overlaps(pickerBox, playBox), 'chart title picker and playback retain separate touch areas at 320px');
  const chartInfo = page.locator('.mobile-chart-details');
  assert.equal(await chartInfo.evaluate(e => e.open), false);
  await chartInfo.locator('summary').click();
  await chartInfo.getByRole('link', { name: '查看原榜', exact: true }).waitFor();
  await chartPicker.selectOption('new');
  await page.waitForFunction(()=>document.querySelector('.mobile-chart-kind')?.value==='new'&&!document.querySelector('.charts-page .loading'));
  assert(fixture.reads.some(url => url.includes('chart=new')), 'the heading remains a working chart selector');
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  assert.equal(fixture.writes.length, 0, 'view and layout checks do not edit the library');
  assert.deepEqual(errors, []);
});

test('mobile titles play directly while more preserves source details, compact rows and one audio instance', { timeout: 60000 }, async t => {
  const fixture = await createMobileFixture({ discovery: true });
  const { page, errors } = await setup(t, fixture);
  const originalTitle = '【音乐分享】这是很长的来源说明与现场演出文案，真正的歌名《风从远方来》保留在标题后段 · 完整现场';
  fixture.tracks[0].title = originalTitle;
  await page.route('**/api/discovery/bilibili**', async route => {
    const response = await route.fetch(), shelves = await response.json();
    shelves[0].page.items[0].title = originalTitle;
    await route.fulfill({ response, json: shelves });
  });
  await page.goto(fixture.base); await navigation(page).waitFor();
  const audio = await page.locator('audio').elementHandle(), idle = page.locator('.mobile-mini-player.is-empty');
  assert.equal((await idle.boundingBox()).height, 48);
  assert.equal(await idle.getByRole('button', { disabled: true }).count(), 0, 'idle state has no disabled transport controls');
  const title = page.locator('.mobile-shelf-featured .card-title').first();
  assert.equal((await title.textContent()).trim(), '风从远方来', 'existing song metadata supplies the title');
  await title.click();
  await page.waitForFunction(() => document.querySelector('audio')?.currentTime > 0);
  assert.equal(fixture.preparations.length, 1, 'one title click starts playback once');
  assert.equal(await page.getByRole('dialog').count(), 0, 'a song title is a play action');
  await page.locator('.mobile-shelf-featured .card-menu').first().click();
  const details = page.getByRole('dialog', { name: '歌曲与分 P', exact: true });
  await details.getByRole('heading', { name: originalTitle, exact: true }).waitFor();
  assert.equal(fixture.preparations.length, 1, 'viewing details leaves current audio alone');
  await details.getByRole('button', { name: '关闭', exact: true }).click();
  await page.getByRole('button', { name: '搜索歌曲或视频', exact: true }).click();
  const search = page.getByRole('main', { name: '搜索音乐', exact: true });
  assert.equal(await search.getByRole('button', { name: /粘贴.*链接/ }).count(), 1, 'search has one stable link entry');
  await page.getByRole('button', { name: '关闭搜索', exact: true }).click();
  await navigation(page).getByRole('button', { name: '音乐库', exact: true }).click();
  await page.getByRole('button', { name: '我的收藏 2 首歌曲', exact: true }).click();
  assert.equal(await page.locator('.mobile-header h1').textContent(), '我的收藏');
  const row = page.locator('.song-library-row').first();
  for (const width of [320, 360, 390, 430]) {
    await page.setViewportSize({ width, height: 844 });
    assert((await row.boundingBox()).height <= 96, 'simple songs use less vertical space');
    assert((await row.locator('.row-info').boundingBox()).width >= 110);
    const favorite = await row.getByRole('button', { name: '取消收藏 风从远方来', exact: true }).boundingBox();
    const more = await row.getByRole('button', { name: '更多操作 风从远方来', exact: true }).boundingBox();
    assert(Math.abs(favorite.y - more.y) < 1 && more.x >= favorite.x + favorite.width, 'quick actions sit alongside each other');
    for (const control of await row.getByRole('button').all()) await touchTarget(control);
  }
  await row.locator('.track-name').click();
  await page.waitForFunction(() => document.querySelector('audio')?.currentTime > 0);
  assert.equal(await page.getByRole('dialog').count(), 0, 'library titles also play without a title reader');
  assert.equal((await page.locator('.mobile-mini-player').boundingBox()).height, 72);
  assert.equal(await page.locator('.mobile-mini-player.is-empty').count(), 0);
  assert(await audio.evaluate(e => e === document.querySelector('audio') && !e.paused));
  assert.deepEqual(errors, []);
});

test('follow list, cover and search titles start playback directly and retain the audio element', { timeout: 60000 }, async t => {
  const fixture = await createMobileSecondaryFixture();
  const { page, errors } = await setup(t, fixture);
  await page.goto(fixture.base); await navigation(page).waitFor();
  const audio = await page.locator('audio').elementHandle();
  async function playTitle(title) {
    const count = fixture.preparations.length;
    const prepared = page.waitForResponse(response => new URL(response.url()).pathname === '/v1/call/prepare');
    await title.click(); await prepared;
    await page.waitForFunction(() => document.querySelector('audio')?.currentTime > 0 && !document.querySelector('audio').paused);
    assert.equal(fixture.preparations.length, count + 1, 'a title click prepares exactly one item');
    assert.equal(await page.getByRole('dialog').count(), 0, 'direct playback does not open details');
    assert(await audio.evaluate(e => e === document.querySelector('audio') && !e.paused));
  }
  await page.getByRole('navigation', { name: '发现栏目' }).getByRole('button', { name: '关注', exact: true }).click();
  await page.getByRole('button', { name: '最近更新', exact: true }).click();
  await playTitle(page.locator('.follow-feed-pages .track-name').first());
  await page.getByRole('button', { name: '关注页面操作', exact: true }).click();
  await page.getByRole('dialog', { name: '关注页面操作', exact: true }).getByRole('button', { name: '封面浏览', exact: true }).click();
  await playTitle(page.locator('.follow-feed-pages .card-title').nth(1));
  await page.getByRole('button', { name: '搜索歌曲或视频', exact: true }).click();
  const search = page.getByRole('main', { name: '搜索音乐', exact: true });
  await search.getByRole('searchbox', { name: '搜索关键词', exact: true }).fill('晚风');
  await search.getByRole('button', { name: '搜索', exact: true }).click();
  await playTitle(search.locator('.track-name').first());
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
