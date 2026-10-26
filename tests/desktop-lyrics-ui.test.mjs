import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { chromium } from './helpers/browser.mjs';
import { createPlayingArtworkFixture } from './helpers/playing-artwork-fixture.mjs';
import { queueRecord } from './helpers/song-fixture.mjs';

const artifactDir = resolve('local/desktop-lyrics-20261018/screenshots');
const selector = '.desktop-lyrics-view';
const firstDocument = { provider: 'local', id: 'desktop', title: '受控歌词', artists: [], synced: true, lines: [
  { startMs: 2000, text: '让晚风慢慢经过身旁', translation: 'Let the evening breeze pass gently by' },
  { startMs: 5000, text: '把今天的心事轻轻收藏' },
  { startMs: 8000, text: '听风', words: [{ startMs: 8000, endMs: 9000, text: '听' }, { startMs: 10000, endMs: 11000, text: '风' }] },
  { startMs: 12000, text: '有些答案不必急着讲' },
  { startMs: 16000, text: '再留一点时间听远方，等待缓慢绽放的回响' },
  { startMs: 20000, text: 'Stay a little longer, let the night unfold' },
] };
const lines = page => page.locator('.desktop-lyrics-host').locator('.slow-lyric-line');
const region = page => page.getByRole('region', { name: '沉浸歌词', exact: true });
async function open(page) { await page.getByRole('button', { name: '打开沉浸歌词', exact: true }).click(); await lines(page).first().waitFor(); }
async function seek(page, seconds) { await page.locator('audio').evaluate((audio, time) => { audio.currentTime = time; audio.dispatchEvent(new Event('timeupdate')); }, seconds); }
async function geometry(page) {
  const result = {};
  for (const name of ['.playing-art-slot', '.playing-detail', '.playing-title', '.listening-playback', '.stage-volume', '.stage-controls']) result[name] = await page.locator(name).boundingBox();
  return result;
}

test('desktop lyric toggle, isolated layout, media clock, browsing, dialogs, themes, fallback and normal/mobile preservation', { timeout: 180000 }, async t => {
  mkdirSync(artifactDir, { recursive: true });
  const fixture = await createPlayingArtworkFixture();
  const browser = await chromium.launch({ headless: true });
  t.after(async () => { await browser.close(); await fixture.close(); });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await context.addInitScript(record => {
    localStorage.setItem('slow-listening:playback:v3', JSON.stringify(record));
    localStorage.setItem('slow-listening:theme:v1', 'dark');
    localStorage.setItem('slow-listening:lyrics-display:v1', JSON.stringify({ bottom: false, translations: true }));
  }, queueRecord(fixture.tracks));
  await context.route('https://i1.hdslb.com/fixture-artwork.png', route => route.fulfill({ contentType: 'image/png', body: readFileSync(resolve('public/assets/coast.png')) }));
  let selectedDocument = firstDocument;
  const requests = [], errors = [], engineLoads = [];
  await context.route('**/api/lyrics/state', route => { requests.push('state'); return route.fulfill({ json: { revision: 'desktop', offsetMs: 1000, document: route.request().postDataJSON().ref.part === '900' ? selectedDocument : { ...firstDocument, id: 'second', lines: [{ startMs: 500, text: '下一首的第一句' }, { startMs: 4000, text: '下一首的最后一句' }] } } }); });
  const page = await context.newPage(); page.setDefaultTimeout(10000);
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => { if (request.url().includes('/desktop-lyric-engine-')) engineLoads.push(request.url()); });
  await page.goto(fixture.base); await page.getByRole('button', { name: '打开正在播放', exact: true }).click();
  await page.locator('.playing-art-vinyl .vinyl-material').evaluate(img => img.decode());
  await page.evaluate(() => document.fonts.ready);
  const normal = await geometry(page);
  const normalVinyl = await page.locator('.vinyl-record').boundingBox(), normalDisc = await page.locator('.playing-art-disc .playing-art-frame').boundingBox();
  assert(Math.abs(normalVinyl.width - normalDisc.width) < 1, 'normal desktop vinyl matches the round cover diameter');
  assert.equal(await page.locator('.playing-title-trigger').evaluate(el => getComputedStyle(el).textAlign), 'center');
  const buttons = page.locator('.playing-song-actions > button, .playing-song-actions > .control-popover > button');
  assert.deepEqual(await buttons.evaluateAll(elements => elements.map(e => e.getAttribute('aria-label'))), ['打开沉浸歌词', '更多播放选项']);
  for (const button of await buttons.all()) { const box = await button.boundingBox(); assert.equal(box.width, 44); assert.equal(box.height, 44); }
  await page.screenshot({ path: join(artifactDir, 'normal-desktop.png'), animations: 'disabled' });
  await page.locator('.listening-transport .play-toggle').click();
  await page.waitForFunction(() => document.querySelector('audio').currentTime > .2);
  await page.locator('.listening-transport .play-toggle').click();
  await seek(page, 9.5);
  const source = await page.locator('audio').getAttribute('src'), prepares = fixture.preparations.length, lyricReads = requests.length;
  const element = await page.locator('audio').elementHandle();
  assert.equal(engineLoads.length, 0, 'the renderer is not downloaded in ordinary mode');
  await open(page);
  assert.equal(await region(page).getByRole('button', { name: '关闭沉浸歌词', exact: true }).getAttribute('aria-pressed'), 'true');
  await page.waitForFunction(() => document.querySelector('.desktop-lyrics-host')?.dataset.activeLine === '2');
  assert.equal(await page.getByRole('heading', { name: '正在播放', exact: true }).isVisible(), false);
  assert.equal(await region(page).locator('.playing-art-slot').count(), 1);
  assert.equal(await region(page).locator('.desktop-lyrics-song h2').textContent(), fixture.tracks[0].title);
  assert.equal(await region(page).getByRole('button', { name: '查看歌曲来源', exact: true }).count(), 1);
  const lyricArtwork = region(page).locator('.playing-art-switch'), lyricModes = [];
  const vinyl = await region(page).locator('.vinyl-record').boundingBox(), disc = await region(page).locator('.playing-art-disc .playing-art-frame').boundingBox();
  assert(Math.abs(vinyl.width - disc.width) < 1, 'immersive vinyl matches the round cover diameter');
  assert.equal(await page.locator('.desktop-lyrics-song').evaluate(el => getComputedStyle(el).textAlign), 'center');
  assert.equal(await page.locator('.desktop-lyrics-host').evaluate(el => getComputedStyle(el).fontSize), '28px');
  for (let i = 0; i < 6; i++) { lyricModes.push(await lyricArtwork.getAttribute('data-visual-mode')); await lyricArtwork.click(); }
  assert.deepEqual(lyricModes, ['vinyl', 'original', 'square', 'disc', 'spectrum', 'halo']);
  assert.equal(await lyricArtwork.getAttribute('data-visual-mode'), 'vinyl');
  await region(page).getByRole('button', { name: '查看完整标题：' + fixture.tracks[0].title, exact: true }).click();
  await page.getByRole('dialog', { name: '完整标题', exact: true }).waitFor();
  await page.keyboard.press('Escape'); assert.equal(await region(page).isVisible(), true);
  assert.equal(await element.evaluate(audio => audio === document.querySelector('audio')), true);
  assert.equal(await page.locator('audio').count(), 1); assert.equal(await page.locator('audio').getAttribute('src'), source);
  assert.equal(fixture.preparations.length, prepares); assert.equal(requests.length, lyricReads);
  await page.locator('.toast').waitFor({ state: 'hidden' });
  const pausedTime = await page.locator('.desktop-lyrics-host').getAttribute('data-time');
  await page.waitForTimeout(160); assert.equal(await page.locator('.desktop-lyrics-host').getAttribute('data-time'), pausedTime);
  const mask = await lines(page).nth(0).locator('[class*="_lyricMainLine"]').evaluate(el => getComputedStyle(el).maskImage);
  assert.equal(mask, 'none', 'ordinary LRC is whole-line highlighting even in a mixed timed-word document');
  await lines(page).nth(3).focus(); await page.keyboard.press('Enter');
  await page.waitForFunction(() => Math.abs(document.querySelector('audio').currentTime - 13) < .2);
  assert.equal(await page.locator('audio').evaluate(a => a.paused), true);
  await region(page).getByRole('button', { name: '更多播放选项', exact: true }).click();
  await page.getByRole('slider', { name: '沉浸歌词字号', exact: true }).fill('24');
  await page.waitForFunction(() => getComputedStyle(document.querySelector('.desktop-lyrics-host')).fontSize === '24px');
  assert.equal(await page.evaluate(() => localStorage.getItem('slow-listening:desktop-lyric-size:v1')), '24');
  await page.keyboard.press('Escape'); assert.equal(await region(page).isVisible(), true, 'Escape dismisses a popover before the lyric view');
  await region(page).getByRole('button', { name: '播放队列', exact: true }).click();
  await page.getByRole('dialog', { name: '播放队列', exact: true }).waitFor();
  await page.keyboard.press('Escape'); assert.equal(await region(page).isVisible(), true);
  await region(page).getByRole('button', { name: '更多播放选项', exact: true }).click(); await page.getByRole('button', { name: '歌词管理', exact: true }).click();
  await page.getByRole('dialog', { name: '版本与歌词', exact: true }).waitFor(); await page.keyboard.press('Escape'); assert.equal(await region(page).isVisible(), true);
  await page.getByLabel('沉浸歌词正文', { exact: true }).dispatchEvent('wheel', { deltaY: 220 });
  await page.getByRole('button', { name: '回到当前行', exact: true }).waitFor();
  await page.waitForTimeout(900); assert.equal(await page.getByRole('button', { name: '回到当前行', exact: true }).isVisible(), true);
  await page.getByRole('button', { name: '回到当前行', exact: true }).click();
  await page.getByLabel('沉浸歌词正文', { exact: true }).dispatchEvent('wheel', { deltaY: -180 });
  await page.waitForFunction(() => !document.querySelector('.desktop-lyrics-resume'), null, { timeout: 6500 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.waitForFunction(() => document.querySelector('.desktop-lyrics-host')?.shadowRoot?.querySelector('.amll-lyric-player')?.dataset.reduced === 'true');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  if (await page.getByRole('button', { name: '回到当前行', exact: true }).isVisible()) await page.getByRole('button', { name: '回到当前行', exact: true }).click();
  for (const viewport of [{ width: 1440, height: 900 }, { width: 1280, height: 720 }, { width: 1920, height: 1080 }, { width: 1110, height: 1216 }, { width: 1024, height: 600 }, { width: 761, height: 600 }, { width: 844, height: 390 }]) {
    await page.setViewportSize(viewport); await seek(page, viewport.width === 1110 ? 6 : 13);
    await page.waitForTimeout(1300); await page.mouse.move(0, 0);
    const bounds = await region(page).boundingBox(), controls = await page.locator('.desktop-lyrics-controls').boundingBox(), footer = await page.locator('.desktop-lyrics-footer').boundingBox();
    assert.equal(bounds.width, viewport.width); assert.equal(bounds.height, viewport.height);
    assert.equal(controls.height, 70); assert.equal(footer.height, 88); assert.equal(footer.y + footer.height, viewport.height - 16);
    assert(footer.width <= 880 && footer.width < viewport.width - 32, 'the control card leaves space at both sides');
    assert(Math.abs(footer.x + footer.width / 2 - viewport.width / 2) < 1, 'the compact card is centred');
    const track = await page.locator('.desktop-lyrics-track').boundingBox(), reading = await page.locator('.desktop-lyrics-reading').boundingBox(), title = await page.locator('.desktop-lyrics-song').boundingBox();
    assert(track.x + track.width <= reading.x, 'artwork and lyrics occupy separate columns');
    assert(track.y + track.height <= controls.y && reading.y + reading.height <= controls.y, 'both columns stay above the bottom controls');
    assert(title.y + title.height <= controls.y && title.height > 0, 'song title and author stay visible in short windows');
    const play = await region(page).locator('.play-toggle').boundingBox();
    assert(Math.abs(play.x + play.width / 2 - viewport.width / 2) < 1, 'primary playback stays centred');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.screenshot({ path: join(artifactDir, `immersive-${viewport.width}.png`), animations: 'disabled' });
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  for (const palette of ['paper', 'mint', 'ocean', 'plum']) for (const theme of ['light', 'dark']) {
    await page.evaluate(({ palette, theme }) => { document.documentElement.dataset.palette = palette; document.documentElement.dataset.theme = theme; }, { palette, theme });
    await page.screenshot({ path: join(artifactDir, `immersive-${palette}-${theme}.png`), animations: 'disabled' });
  }
  await page.evaluate(() => { document.documentElement.dataset.palette = 'paper'; document.documentElement.dataset.theme = 'dark'; });
  await lyricArtwork.click(); assert.equal(await lyricArtwork.getAttribute('data-visual-mode'), 'original');
  await region(page).getByRole('button', { name: '返回普通播放', exact: true }).click();
  await page.waitForFunction(() => !document.querySelector('.desktop-lyrics-view'));
  await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === '打开沉浸歌词');
  assert.equal(await page.getByRole('button', { name: '打开沉浸歌词', exact: true }).evaluate(e => e === document.activeElement), true);
  assert.equal(await page.locator('.playing-art-switch').getAttribute('data-visual-mode'), 'original', 'returning retains the artwork style selected in lyric mode');
  for (let i = 0; i < 5; i++) await page.locator('.playing-art-switch').click();
  assert.deepEqual(await geometry(page), normal, 'normal layout survives the full-screen mode unchanged');
  assert.equal(await page.locator('audio').getAttribute('src'), source); assert.equal(fixture.preparations.length, prepares); assert.equal(requests.length, lyricReads);
  // Both layouts retain six artwork modes; mobile lyrics have a separate direct control.
  const mode = page.locator('.playing-art-switch'), modes = [];
  for (let i = 0; i < 6; i++) { modes.push(await mode.getAttribute('data-visual-mode')); await mode.click(); }
  assert.deepEqual(modes, ['vinyl', 'original', 'square', 'disc', 'spectrum', 'halo']); assert.equal(await mode.getAttribute('data-visual-mode'), 'vinyl');
  await open(page); await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForFunction(() => !document.querySelector('.desktop-lyrics-view'));
  assert.equal(await page.locator(selector).count(), 0); assert.equal(await page.getByRole('button', { name: '打开沉浸歌词', exact: true }).count(), 0);
  assert.equal(await mode.isDisabled(),true,'mobile artwork styles use the named selector');
  await page.getByRole('button',{name:'更多播放选项',exact:true}).click();
  const mobileOptions=page.getByRole('dialog',{name:'更多播放选项',exact:true});
  for(const visual of ['original','square','disc','spectrum','halo','vinyl'])await mobileOptions.getByRole('combobox',{name:'封面样式',exact:true}).selectOption(visual);
  await mobileOptions.getByRole('button',{name:'关闭',exact:true}).click();assert.equal(await mode.getAttribute('data-visual-mode'),'vinyl');
  await page.getByRole('button',{name:'查看歌词',exact:true}).click(); await page.locator('.mobile-player.is-lyrics').waitFor();
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByRole('button', { name: '打开沉浸歌词', exact: true }).waitFor();
  assert.equal(await mode.getAttribute('data-visual-mode'), 'vinyl');
  assert.equal(await page.evaluate(() => localStorage.getItem('slow-listening:playing-visual:v1')), 'vinyl');
  assert.equal(await page.evaluate(() => localStorage.getItem('slow-listening:mobile-lyric-view:v1')), 'true');
  await open(page); await page.keyboard.press('Escape'); await page.waitForFunction(() => !document.querySelector('.desktop-lyrics-view'));
  // A renderer chunk failure has a readable, seekable fallback and can be retried.
  const failure = await context.newPage();
  failure.setDefaultTimeout(10000);
  await failure.route('**/*desktop-lyric-engine*.js', route => route.abort());
  await failure.goto(fixture.base); await failure.getByRole('button', { name: '播放', exact: true }).click();
  await failure.waitForFunction(() => document.querySelector('audio').currentTime > .1);
  await failure.getByRole('button', { name: '打开正在播放', exact: true }).click();
  await failure.getByRole('button', { name: '打开沉浸歌词', exact: true }).click();
  await failure.getByRole('button', { name: '重试动效', exact: true }).waitFor();
  await failure.getByRole('button', { name: '让晚风慢慢经过身旁', exact: true }).waitFor();
  await failure.unroute('**/*desktop-lyric-engine*.js');
  await failure.getByRole('button', { name: '重试动效', exact: true }).click();
  await lines(failure).first().waitFor();
  await failure.close();
  // Static documents and empty states use the same control bar, with no second media element.
  selectedDocument = { ...firstDocument, synced: false, lines: [{ startMs: null, text: '静态歌词正文' }] };
  await page.reload(); await page.getByRole('button', { name: '播放', exact: true }).click(); await page.getByRole('button', { name: '打开正在播放', exact: true }).click();
  await page.getByRole('button', { name: '打开沉浸歌词', exact: true }).click(); await region(page).getByText('静态歌词正文', { exact: true }).waitFor();
  assert.equal(await page.locator('audio').count(), 1);
  assert.deepEqual(errors, []);
});

test('timed word masks follow the media clock at fast and slow rates and during paused seeks', { timeout: 30000 }, async t => {
  const fixture = await createPlayingArtworkFixture();
  const browser = await chromium.launch({ headless: true });
  t.after(async () => { await browser.close(); await fixture.close(); });
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, reducedMotion: 'no-preference' });
  await context.addInitScript(record => localStorage.setItem('slow-listening:playback:v3', JSON.stringify(record)), queueRecord(fixture.tracks));
  const document = { ...firstDocument, lines: [{ startMs: 0, text: '听晚风', words: [
    { text: '听', startMs: 0, endMs: 7000 }, { text: '晚', startMs: 7000, endMs: 14000 }, { text: '风', startMs: 14000, endMs: 20000 },
  ] }, { startMs: 20000, text: '下一句' }] };
  await context.route('**/api/lyrics/state', route => route.fulfill({ json: { revision: 'word-clock', offsetMs: 1000, document } }));
  const page = await context.newPage(); page.setDefaultTimeout(8000);
  await page.goto(fixture.base); await page.getByRole('button', { name: '播放', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('audio').currentTime > .1);
  await page.getByRole('button', { name: '打开正在播放', exact: true }).click(); await open(page);
  const clock = () => page.evaluate(() => {
    const row = document.querySelector('.desktop-lyrics-host').shadowRoot.querySelector('.slow-lyric-line[data-line-index="0"]');
    return { media: Math.max(0, document.querySelector('audio').currentTime * 1000 - 1000), masks: row.getAnimations({ subtree: true }).filter(animation => animation.id.startsWith('fade-word-')).map(animation => Number(animation.currentTime)) };
  });
  for (const rate of [2, .5]) {
    await region(page).getByRole('button', { name: '更多播放选项', exact: true }).click();
    await page.getByRole('button', { name: '播放速度', exact: true }).click();
    await page.getByRole('menuitemradio', { name: rate + '×', exact: true }).click(); await page.keyboard.press('Escape');
    await seek(page, 2); await page.waitForTimeout(1200);
    const sample = await clock(); assert.equal(sample.masks.length, 3);
    for (const mask of sample.masks) assert(Math.abs(mask - sample.media) < 200, JSON.stringify({ rate, ...sample }));
  }
  await region(page).getByRole('button', { name: '暂停', exact: true }).click(); await seek(page, 10);
  await page.waitForTimeout(100);
  const paused = await clock(); for (const mask of paused.masks) assert(Math.abs(mask - paused.media) < 100);
  await page.waitForTimeout(200); assert.deepEqual(await clock(), paused);
});

test('immersive playback follows the media clock across rate changes, buffering, track changes and missing lyrics', { timeout: 60000 }, async t => {
  const fixture = await createPlayingArtworkFixture();
  const browser = await chromium.launch({ headless: true });
  t.after(async () => { await browser.close(); await fixture.close(); });
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  await context.addInitScript(record => localStorage.setItem('slow-listening:playback:v3', JSON.stringify(record)), queueRecord(fixture.tracks));
  let reads = 0;
  await context.route('**/api/lyrics/state', route => { reads++; return route.fulfill({ json: { revision: 'playback', offsetMs: 1000, document: route.request().postDataJSON().ref.part === '900' ? firstDocument : { ...firstDocument, instrumental: true, lines: [] } } }); });
  const page = await context.newPage(); page.setDefaultTimeout(8000);
  await page.goto(fixture.base); await page.getByRole('button', { name: '播放', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('audio').currentTime > .1);
  await page.getByRole('button', { name: '打开正在播放', exact: true }).click(); await open(page);
  const audio = await page.locator('audio').elementHandle();
  await seek(page, 8.5);
  await region(page).getByRole('button', { name: '更多播放选项', exact: true }).click();
  await page.getByRole('button', { name: '播放速度', exact: true }).click();
  await page.getByRole('menuitemradio', { name: '1.5×', exact: true }).click(); await page.keyboard.press('Escape');
  await page.waitForFunction(() => document.querySelector('audio').playbackRate === 1.5);
  await page.waitForTimeout(160);
  assert(await page.evaluate(() => Math.abs(Number(document.querySelector('.desktop-lyrics-host').dataset.time) - (document.querySelector('audio').currentTime * 1000 - 1000)) < 100));
  assert.notEqual(await lines(page).nth(2).locator('[class*="_lyricMainLine"] [style*="mask"]').count(), 0, 'real word timestamps retain progressive masks');
  await region(page).getByRole('button', { name: '暂停', exact: true }).click();
  await page.waitForTimeout(80);
  const paused = await page.locator('.desktop-lyrics-host').getAttribute('data-time');
  await page.waitForTimeout(160); assert.equal(await page.locator('.desktop-lyrics-host').getAttribute('data-time'), paused);
  // Buffering has no advancing media clock; drawing remains at the real position.
  await page.locator('audio').evaluate(a => a.dispatchEvent(new Event('waiting')));
  await page.waitForTimeout(100); assert.equal(await page.locator('.desktop-lyrics-host').getAttribute('data-time'), paused);
  await page.locator('audio').evaluate(a => a.dispatchEvent(new Event('canplay')));
  await region(page).getByRole('button', { name: '播放队列', exact: true }).click();
  const queue = page.getByRole('dialog', { name: '播放队列', exact: true }); await queue.waitFor();
  const stage = await region(page).boundingBox();
  await queue.getByRole('button', { name: '评论', exact: true }).click();
  await page.getByRole('dialog', { name: '视频评论', exact: true }).waitFor();
  assert.deepEqual(await region(page).boundingBox(), stage, 'comments overlay the lyric stage');
  await page.screenshot({ path: join(artifactDir, 'immersive-comments.png'), animations: 'disabled' });
  await page.keyboard.press('Escape');
  const previousReads = reads, previousPrepares = fixture.preparations.length;
  await region(page).getByRole('button', { name: '下一首', exact: true }).click();
  await region(page).getByText('纯音乐，安心听', { exact: true }).waitFor();
  assert.equal(await region(page).locator('.desktop-lyrics-song h2').textContent(), fixture.tracks[1].title);
  assert.equal(await audio.evaluate(a => a === document.querySelector('audio')), true);
  assert.equal(await page.locator('audio').evaluate(a => a.playbackRate), 1.5);
  assert.equal(reads, previousReads + 1); assert.equal(fixture.preparations.length, previousPrepares + 1);
  assert.equal(await region(page).getByRole('button', { name: '关闭沉浸歌词', exact: true }).isVisible(), true);
  await page.reload(); await page.getByRole('button', { name: '打开正在播放', exact: true }).click();
  assert.equal(await region(page).count(), 0, 'reload always returns to normal mode');
});

test('split lyric artwork shares the live audio graph and handles long titles and missing covers', { timeout: 45000 }, async t => {
  const fixture = await createPlayingArtworkFixture();
  fixture.tracks[0].title = '很长的歌曲标题与现场版本说明 '.repeat(10);
  const browser = await chromium.launch({ headless: true });
  t.after(async () => { await browser.close(); await fixture.close(); });
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, reducedMotion: 'reduce' });
  await context.addInitScript(record => {
    localStorage.setItem('slow-listening:playback:v3', JSON.stringify(record));
    localStorage.setItem('slow-listening:playing-visual:v1', 'spectrum');
    window.__graphs = 0; window.__bindings = 0;
    const NativeContext = window.AudioContext;
    window.AudioContext = class extends NativeContext {
      constructor(...args) { super(...args); window.__graphs++; }
      createMediaElementSource(audio) { window.__bindings++; return super.createMediaElementSource(audio); }
    };
  }, queueRecord(fixture.tracks));
  await context.route('https://i1.hdslb.com/fixture-artwork.png', route => route.abort());
  await context.route('**/api/lyrics/state', route => route.fulfill({ json: { revision: 'split', offsetMs: 0, document: firstDocument } }));
  const page = await context.newPage(); page.setDefaultTimeout(8000);
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto(fixture.base); await page.getByRole('button', { name: '打开正在播放', exact: true }).click();
  await page.getByRole('button', { name: '播放', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('audio').currentTime > .2);
  await open(page);
  const artwork = region(page).locator('.playing-art-switch');
  assert.equal(await artwork.getAttribute('data-visual-mode'), 'spectrum');
  await page.waitForFunction(() => document.querySelector('.desktop-lyrics-track .playing-art-switch').dataset.analysisState === 'ready');
  const audio = await page.locator('audio').elementHandle(), source = await page.locator('audio').getAttribute('src'), prepares = fixture.preparations.length;
  const sample = () => region(page).locator('.playing-art-layer.is-active canvas').evaluate(canvas => {
    const pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
    return { image: canvas.toDataURL(), painted: pixels.filter((value, index) => index % 4 === 3 && value > 100).length };
  });
  for (const visual of ['spectrum', 'halo']) {
    assert.equal(await artwork.getAttribute('data-visual-mode'), visual);
    await seek(page, 1); await page.waitForTimeout(450); const low = await sample();
    await seek(page, 10); await page.waitForTimeout(450); const high = await sample();
    assert(low.painted > 100 && high.painted > 100, 'the visible artwork paints a real spectrum');
    assert.notEqual(low.image, high.image, 'the lyric-side spectrum responds to the changed audio frequency');
    await artwork.click();
  }
  assert.equal(await artwork.getAttribute('data-visual-mode'), 'vinyl');
  await artwork.click(); await artwork.click();
  assert.equal(await artwork.getAttribute('data-visual-mode'), 'square');
  await region(page).locator('.playing-art-square .unknown-cover').waitFor();
  await region(page).getByRole('button', { name: '查看完整标题：' + fixture.tracks[0].title, exact: true }).click();
  const title = page.getByRole('dialog', { name: '完整标题', exact: true }); await title.waitFor();
  assert.equal(await title.locator('.playing-full-title').textContent(), fixture.tracks[0].title);
  await page.keyboard.press('Escape');
  await region(page).getByRole('button', { name: '关闭沉浸歌词', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('.listening-stage .playing-art-switch').dataset.visualMode === 'square');
  assert.equal(await audio.evaluate(element => element === document.querySelector('audio')), true);
  assert.equal(await page.locator('audio').getAttribute('src'), source); assert.equal(fixture.preparations.length, prepares);
  assert.deepEqual(await page.evaluate(() => ({ graphs: window.__graphs, bindings: window.__bindings })), { graphs: 1, bindings: 1 });
  assert.deepEqual(errors, []);
});
