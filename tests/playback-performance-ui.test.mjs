import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import { createPlayingArtworkFixture } from './helpers/playing-artwork-fixture.mjs';

async function setup(t) {
  const fixture = await createPlayingArtworkFixture({ librarySeed: tracks => ({ favorites: tracks }) });
  const browser = await chromium.launch({ executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true });
  t.after(async () => { await browser.close(); await fixture.close(); });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } }); page.setDefaultTimeout(8000);
  await page.route('**/*', route => new URL(route.request().url()).origin === fixture.base ? route.continue() : route.abort());
  await page.addInitScript(() => {
    localStorage.setItem('slow-listening:playing-visual:v1', 'spectrum');
    window.__queueWrites = 0;
    const save = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) { if (key === 'slow-listening:playback:v3') window.__queueWrites++; return save.call(this, key, value); };
  });
  await page.goto(fixture.base);
  await page.locator('.sidebar-nav').getByRole('button', { name: '歌单', exact: true }).click();
  await page.getByRole('button', { name: '播放 ' + fixture.tracks[0].title, exact: true }).waitFor();
  return { fixture, page };
}

const audio = page => page.locator('audio[data-product-media]');
const peak = page => page.locator('.playing-art-layer.is-active canvas').evaluate(canvas => {
  const { width, height } = canvas, pixels = canvas.getContext('2d').getImageData(0, 0, width, height).data;
  let top = height, bottom = 0;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) if (pixels[(y * width + x) * 4 + 3] > 150) { top = Math.min(top, y); bottom = Math.max(bottom, y); break; }
  return bottom - top;
});

test('exact saved versions start and switch while metadata and lyric requests remain blocked', { timeout: 30000 }, async t => {
  const { fixture, page } = await setup(t), metadata = [];
  let release; const gate = new Promise(resolve => { release = resolve; }); t.after(() => release());
  await page.route('**/api/lyrics/**', async route => { await gate; await route.fulfill({ status: 503, json: { error: { code: 'upstream' } } }).catch(() => {}); });
  await page.route('**/v1/call/metadata', async route => { await gate; await route.continue().catch(() => {}); });
  page.on('request', request => { if (request.url().endsWith('/v1/call/metadata')) metadata.push(request.url()); });
  for (const track of fixture.tracks) {
    await page.getByRole('button', { name: '播放 ' + track.title, exact: true }).click();
    await page.waitForFunction(title => !document.querySelector('audio').paused && document.querySelector('.now-playing strong')?.textContent === title, track.title);
  }
  assert.equal(fixture.preparations.length, 2, 'each selection still obtains a fresh playable source');
  assert(metadata.length <= 1, 'only the optional missing-artwork lookup may request metadata, without delaying playback');
  assert.equal(await audio(page).evaluate(el => el.playbackRate), 1);
  release();
});

test('a pending or failed song preparation keeps the current real spectrum and playback clock running', { timeout: 30000 }, async t => {
  const { fixture, page } = await setup(t);
  await page.getByRole('button', { name: '播放 ' + fixture.tracks[0].title, exact: true }).click();
  await page.waitForFunction(() => document.querySelector('audio').currentTime > .2);
  await page.getByRole('button', { name: '打开正在播放', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('.playing-art-switch')?.dataset.analysisState === 'ready');
  await page.waitForTimeout(350); assert(await peak(page) > 30);
  await page.evaluate(() => { window.__queueWrites = 0; }); await page.waitForTimeout(600);
  const clockWrites = await page.evaluate(() => window.__queueWrites);
  await page.getByRole('button', { name: '返回浏览音乐', exact: true }).click();
  let release, requested; const gate = new Promise(resolve => { release = resolve; }), pending = new Promise(resolve => { requested = resolve; }); t.after(() => release());
  await page.route('**/v1/call/prepare', async route => { requested(); await gate; await route.fulfill({ status: 503, json: { protocol: 2, error: { code: 'upstream', retryable: true } } }).catch(() => {}); });
  await page.getByRole('button', { name: '播放 ' + fixture.tracks[1].title, exact: true }).click(); await pending;
  await page.getByRole('button', { name: '打开正在播放', exact: true }).click();
  const before = await audio(page).evaluate(el => ({ source: el.currentSrc, position: el.currentTime }));
  await page.waitForTimeout(1100);
  const after = await audio(page).evaluate(el => ({ source: el.currentSrc, position: el.currentTime, paused: el.paused }));
  assert.equal(after.source, before.source); assert.equal(after.paused, false); assert(after.position > before.position + .5);
  assert(await peak(page) > 30, 'preparing another song must not flatten the spectrum of the audible current song');
  assert.equal(clockWrites, 0, 'clock ticks do not write browser queue storage');
  release();
  await page.waitForFunction(() => document.querySelector('.play-toggle')?.getAttribute('aria-busy') === 'false');
  assert.equal(await audio(page).evaluate(el => el.currentSrc), before.source);
  assert.equal(await audio(page).evaluate(el => el.paused), false);
});
