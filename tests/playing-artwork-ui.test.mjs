import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { chromium } from './helpers/browser.mjs';
import {queueRecord} from './helpers/song-fixture.mjs';
import { createPlayingArtworkFixture } from './helpers/playing-artwork-fixture.mjs';
import { developmentPaths } from '../scripts/workspace-paths.mjs';

const preference = 'slow-listening:playing-visual:v1';
const executablePath = process.env.MUSIC_APP_BROWSER;
const mode = page => page.locator('.playing-art-switch');
const media = page => page.locator('audio[data-product-media]');
async function selectMode(page, target) {
  for (let i = 0; i < 7 && await mode(page).getAttribute('data-visual-mode') !== target; i++) await mode(page).click();
  assert.equal(await mode(page).getAttribute('data-visual-mode'), target);
  await page.waitForFunction(() => getComputedStyle(document.querySelector('.playing-art-layer.is-active')).opacity === '1');
}
async function openPlaying(page, base) {
  await page.goto(base); await page.getByRole('button', { name: '打开正在播放', exact: true }).click();
}
async function spectrumPeak(page, variant = 'bars') {
  return page.locator('.playing-art-layer.is-active .playing-spectrum').evaluate((canvas, variant) => {
    const context = canvas.getContext('2d'), { width, height } = canvas;
    const pixels = context.getImageData(0, 0, width, height).data, count = canvas.clientWidth < 340 ? 32 : 48;
    const size = Math.min(width, height);
    const centres = [];
    const heights = Array.from({ length: count }, (_, index) => {
      if (variant === 'bars') {
        const x = Math.floor(width * .04 + (index + .5) * width * .92 / count);
        let top = height, bottom = 0;
        for (let y = 0; y < height; y++) if (pixels[(y * width + x) * 4 + 3] > 150) { top = Math.min(top, y); bottom = y; }
        centres.push((top + bottom) / 2);
        return Math.max(0, bottom - top + 1);
      }
      const angle = index / (count * 2) * Math.PI * 2 - Math.PI / 2;
      const start = Math.ceil(size * .32 + 5);
      let extent = 0;
      for (let radius = start; radius < size * .48; radius++) {
        const x = Math.round(width / 2 + Math.cos(angle) * radius), y = Math.round(height / 2 + Math.sin(angle) * radius);
        if (pixels[(y * width + x) * 4 + 3] > 150) extent = radius - start;
      }
      return extent;
    });
    return { index: heights.indexOf(Math.max(...heights)), max: Math.max(...heights), min: Math.min(...heights), count, centres };
  }, variant);
}

test('artwork cycles, real spectrum, uninterrupted audio and responsive layout', { timeout: 120000 }, async t => {
  const fixture = await createPlayingArtworkFixture(), browser = await chromium.launch({ executablePath, headless: true });
  t.after(async () => { await browser.close(); await fixture.close(); });
  const context = await browser.newContext({ viewport: { width: 1803, height: 1022 }, colorScheme: 'light' });
  await context.route('https://i1.hdslb.com/fixture-artwork.png', route => route.fulfill({ contentType: 'image/png', body: readFileSync(resolve('public/assets/coast.png')) }));
  await context.addInitScript(({ record, preference }) => {
    if (!localStorage.getItem('slow-listening:playback:v3')) localStorage.setItem('slow-listening:playback:v3', JSON.stringify(record));
    localStorage.setItem('slow-listening:theme:v1', 'light');
    window.__graphs = []; window.__bindings = 0; window.__paints = 0;
    const NativeContext = window.AudioContext;
    window.AudioContext = class extends NativeContext {
      constructor(...args) { super(...args); window.__graphs.push(this); }
      createMediaElementSource(audio) { window.__bindings++; return super.createMediaElementSource(audio); }
    };
    const clear = CanvasRenderingContext2D.prototype.clearRect;
    CanvasRenderingContext2D.prototype.clearRect = function (...args) { if (this.canvas.classList.contains('playing-spectrum')) window.__paints++; return clear.apply(this, args); };
  }, { record:queueRecord(fixture.tracks), preference });
  const page = await context.newPage(); page.setDefaultTimeout(10000);
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  const artifacts = resolve('local/verification/halo-red-label-2026-10-16'); mkdirSync(artifacts, { recursive: true });
  await openPlaying(page, fixture.base);
  assert.equal(await mode(page).getAttribute('data-visual-mode'), 'vinyl');
  await page.waitForFunction(() => document.querySelector('.vinyl-material')?.naturalWidth > 0);
  const record = await page.locator('.vinyl-record').boundingBox(), label = await page.locator('.playing-art-vinyl .vinyl-label').boundingBox();
  assert.equal(record.width, record.height); assert(record.width <= 420);
  assert(Math.abs(label.width / record.width - .47619) < .01);
  assert.equal(await page.locator('.playing-art-vinyl img').count(), 1, 'the only image in the record is the blank material, never a song cover');
  assert.equal(await page.locator('.playing-art-vinyl .vinyl-label-brand').textContent(), 'SLOWTUNE');
  assert.equal(await page.locator('.playing-art-frequency img,.playing-art-halo img').count(), 0, 'both audio visualizers are abstract');
  assert.equal(await page.locator('.vinyl-record').evaluate(el => getComputedStyle(el).backgroundColor), 'rgb(25, 25, 27)');
  const stationarySheen = await page.locator('.vinyl-sheen').evaluate(el => getComputedStyle(el).transform);
  await page.locator('.listening-transport .play-toggle').click();
  await page.waitForFunction(() => document.querySelector('audio').currentTime > .2).catch(async error=>{throw new Error(error.message+' '+await page.locator('.feedback').allTextContents());});
  const vinylAngle = await page.locator('.vinyl-rotor').evaluate(el => getComputedStyle(el).transform);
  await page.waitForFunction(angle => getComputedStyle(document.querySelector('.vinyl-rotor')).transform !== angle, vinylAngle);
  assert.equal(await page.locator('.vinyl-sheen').evaluate(el => getComputedStyle(el).transform), stationarySheen, 'light remains stationary while the record rotates');
  await page.locator('.listening-transport .play-toggle').click();
  await page.waitForFunction(() => getComputedStyle(document.querySelector('.vinyl-rotor')).animationPlayState === 'paused');
  const stoppedVinyl = await page.locator('.vinyl-rotor').evaluate(el => getComputedStyle(el).transform);
  await page.waitForTimeout(140);
  assert.equal(await page.locator('.vinyl-rotor').evaluate(el => getComputedStyle(el).transform), stoppedVinyl);
  await page.screenshot({ path: join(artifacts, 'desktop-vinyl.png') });
  await selectMode(page, 'original');
  await page.locator('.playing-art-original img').waitFor();
  await page.waitForFunction(() => document.querySelector('.playing-art-original img')?.naturalWidth > 0);
  assert.equal(await mode(page).getAttribute('data-visual-mode'), 'original');
  const detail = await page.locator('.playing-detail').boundingBox();
  const gap = await page.locator('.listening-content').evaluate(el => getComputedStyle(el).columnGap);
  assert.equal(gap, '96px');
  const original = await page.locator('.playing-art-original img').boundingBox();
  assert(Math.abs(original.width / original.height - 1983 / 793) < .01, 'original preserves the real image aspect ratio without inner letterboxing');
  await page.screenshot({ path: join(artifacts, 'desktop-original.png') });
  await mode(page).focus(); await page.keyboard.press('Enter');
  assert.equal(await mode(page).getAttribute('data-visual-mode'), 'square');
  await page.waitForFunction(() => getComputedStyle(document.querySelector('.playing-art-square')).opacity === '1');
  const square = await page.locator('.playing-art-square .playing-art-frame').boundingBox();
  assert(Math.abs(square.width - square.height) < 1);
  assert(square.width <= 340 && square.width < record.width, 'square cover stays smaller than the round visuals');
  assert.equal(await page.locator('.playing-art-square img').evaluate(el => getComputedStyle(el).objectFit), 'cover');
  await page.screenshot({ path: join(artifacts, 'desktop-square.png') });
  await page.keyboard.press('Space');
  assert.equal(await mode(page).getAttribute('data-visual-mode'), 'disc');
  await page.waitForFunction(() => getComputedStyle(document.querySelector('.playing-art-disc')).opacity === '1');
  const disc = await page.locator('.playing-art-disc .playing-art-frame').boundingBox();
  assert(disc.width <= 360 && Math.abs(disc.width - record.width) < 1, 'circular cover and vinyl share the same diameter');
  assert(await media(page).evaluate(el => el.paused), 'Space on artwork changes appearance without toggling playback');
  await page.locator('.listening-transport .play-toggle').click();
  await page.waitForFunction(() => { const audio = document.querySelector('audio[data-product-media]'); return !audio.paused && audio.currentTime > .2; });
  const rotation = () => page.locator('.playing-art-disc img').evaluate(el => getComputedStyle(el).transform);
  const firstAngle = await rotation();
  await page.waitForFunction(angle => getComputedStyle(document.querySelector('.playing-art-disc img')).transform !== angle, firstAngle);
  await page.locator('.listening-transport .play-toggle').click();
  await page.waitForFunction(() => getComputedStyle(document.querySelector('.playing-art-disc img')).animationPlayState === 'paused');
  const pausedAngle = await rotation(); await page.waitForTimeout(140);
  assert.equal(await rotation(), pausedAngle, 'pause retains the current rotation angle');
  await page.locator('.listening-transport .play-toggle').click();
  await page.screenshot({ path: join(artifacts, 'desktop-disc.png') });
  const source = await media(page).evaluate(el => ({ src: el.currentSrc, position: el.currentTime })), preparations = fixture.preparations.length;
  await selectMode(page, 'spectrum');
  await page.waitForFunction(() => document.querySelector('.playing-art-switch').dataset.analysisState === 'ready');
  await media(page).evaluate(el => { el.currentTime = 1; });
  await page.waitForTimeout(450);
  const low = await spectrumPeak(page);
  assert(low.max > low.min + 40, 'real 440 Hz tone has a frequency peak');
  await page.waitForTimeout(700);
  const sustained = await spectrumPeak(page);
  assert(Math.max(...low.centres) - Math.min(...low.centres) <= 1, 'all frequency bars share the original straight centreline');
  assert(Math.max(...low.centres.map((value, index) => Math.abs(value - sustained.centres[index]))) <= .5, 'the centreline stays fixed without a breathing offset');
  const breathingHeights = [low.max, sustained.max];
  for (let sample = 0; sample < 8; sample++) {
    await page.waitForTimeout(250);
    const frame = await spectrumPeak(page);
    assert(Math.max(...frame.centres) - Math.min(...frame.centres) <= 1, 'breathing never moves individual bars off the horizontal centreline');
    breathingHeights.push(frame.max);
  }
  assert(Math.max(...breathingHeights) - Math.min(...breathingHeights) > 1, 'a sustained tone still has subtle breathing scale');
  await media(page).evaluate(el => { el.currentTime = 10; });
  await page.waitForTimeout(700);
  const high = await spectrumPeak(page);
  assert(high.index > low.index + 6, JSON.stringify({ low, high }));
  await page.screenshot({ path: join(artifacts, 'desktop-spectrum.png') });
  await selectMode(page, 'halo');
  await media(page).evaluate(el => { el.currentTime = 1; }); await page.waitForTimeout(450);
  const haloLow = await spectrumPeak(page, 'halo');
  await media(page).evaluate(el => { el.currentTime = 10; }); await page.waitForTimeout(700);
  const haloHigh = await spectrumPeak(page, 'halo');
  assert(haloLow.max > haloLow.min + 30 && haloHigh.index > haloLow.index + 6, JSON.stringify({ haloLow, haloHigh }));
  await page.screenshot({ path: join(artifacts, 'desktop-halo.png') });
  const continuous = await media(page).evaluate(el => ({ src: el.currentSrc, position: el.currentTime, paused: el.paused }));
  assert.equal(continuous.src, source.src); assert.equal(continuous.paused, false);
  assert.equal(fixture.preparations.length, preparations);
  assert.equal(await media(page).count(), 1);
  assert.deepEqual(await page.evaluate(() => ({ graphs: window.__graphs.length, bindings: window.__bindings })), { graphs: 1, bindings: 1 });
  assert.deepEqual(await page.locator('.playing-detail').boundingBox(), detail, 'mode changes leave the controls in place');
  assert.equal(await page.locator('.listening-stage').evaluate(el => el.scrollTop), 0, 'the stage never scrolls when focused artwork changes shape');

  // Sampling stops outside the spectrum, while its audio output stays alive.
  await selectMode(page, 'original'); await page.waitForTimeout(220);
  const paints = await page.evaluate(() => window.__paints), position = await media(page).evaluate(el => el.currentTime);
  await page.waitForTimeout(180);
  assert.equal(await page.evaluate(() => window.__paints), paints);
  assert(await media(page).evaluate((el, before) => el.currentTime > before && !el.paused, position));
  assert.equal(await page.evaluate(() => window.__graphs[0].state), 'running');
  await selectMode(page, 'spectrum');
  assert.equal(await page.evaluate(() => window.__bindings), 1);
  await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, value: true }); document.dispatchEvent(new Event('visibilitychange')); });
  const hiddenPaints = await page.evaluate(() => window.__paints); await page.waitForTimeout(180);
  assert.equal(await page.evaluate(() => window.__paints), hiddenPaints);
  await page.evaluate(() => { delete document.hidden; document.dispatchEvent(new Event('visibilitychange')); });
  await page.waitForFunction(before => window.__paints > before, hiddenPaints);

  await page.locator('.stage-volume button').click(); await page.waitForTimeout(900);
  let silent = await spectrumPeak(page);
  for (let attempt = 0; attempt < 10 && silent.max > 8; attempt++) { await page.waitForTimeout(200); silent = await spectrumPeak(page); }
  assert(silent.max <= 8, JSON.stringify(silent));
  await page.locator('.stage-volume button').click();
  await page.locator('.listening-transport .play-toggle').click(); await page.waitForTimeout(900);
  assert((await spectrumPeak(page)).max <= 8, 'paused spectrum settles');
  await page.locator('.listening-transport .play-toggle').click();
  await media(page).evaluate(el => { el.currentTime = el.duration - .3; });
  await page.waitForFunction(() => document.querySelector('audio').currentSrc.endsWith('/media/1.wav'));
  assert.equal(await mode(page).getAttribute('data-visual-mode'), 'spectrum');
  assert.equal(await page.evaluate(() => window.__bindings), 1, 'automatic next track reuses the same graph');
  await page.locator('.listening-transport .play-toggle').click();

  // Same-origin tab synchronization, including preference removal.
  const second = await context.newPage(); await openPlaying(second, fixture.base);
  await selectMode(second, 'halo');
  await page.waitForFunction(() => document.querySelector('.playing-art-switch').dataset.visualMode === 'halo');
  await second.evaluate(key => localStorage.removeItem(key), preference);
  await page.waitForFunction(() => document.querySelector('.playing-art-switch').dataset.visualMode === 'vinyl');
  await second.close();
  await selectMode(page, 'spectrum'); await page.reload();
  await page.getByRole('button', { name: '打开正在播放', exact: true }).click();
  assert.equal(await mode(page).getAttribute('data-visual-mode'), 'spectrum');
  assert(await media(page).evaluate(el => el.paused), 'preference restoration never autoplays');
  await selectMode(page, 'vinyl');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  assert.equal(await page.locator('.vinyl-rotor').evaluate(el => getComputedStyle(el).animationName), 'playing-art-turn');
  await selectMode(page, 'disc');
  assert.equal(await page.locator('.playing-art-disc img,.playing-art-disc .unknown-cover').evaluate(el => getComputedStyle(el).animationName), 'playing-art-turn');
  for (const visual of ['spectrum', 'halo']) {
    await selectMode(page, visual); await page.waitForTimeout(200);
    const reducedPaints = await page.evaluate(() => window.__paints); await page.waitForTimeout(180);
    assert.equal(await page.evaluate(() => window.__paints), reducedPaints);
  }
  await page.emulateMedia({ reducedMotion: 'no-preference' });

  const measurements = [];
  for (const theme of ['light', 'dark']) {
    await page.evaluate(value => { document.documentElement.dataset.theme = value; }, theme);
    for (const [width, height] of [[1803,1022], [1440,900], [1100,768], [1024,600], [800,600], [390,844], [320,568], [320,480], [667,375]]) {
      await page.setViewportSize({ width, height });
      await page.waitForFunction(width=>document.querySelector('.app')?.dataset.layout===(width<=760?'mobile':'desktop'),width);
      const anchor = await page.locator('.playing-detail').boundingBox();
      for (const visual of ['vinyl', 'original', 'square', 'disc', 'spectrum', 'halo']) {
        await selectMode(page, visual);
        const measurement = await page.evaluate(() => {
          const stage = document.querySelector('.listening-stage,.mobile-player').getBoundingClientRect();
          const boxes = [...document.querySelectorAll('.playing-art-switch,.playing-detail,.stage-controls,.listening-transport')].map(el => { const r = el.getBoundingClientRect(); return { name: el.className, x: r.x, y: r.y, right: r.right, bottom: r.bottom, width: r.width, height: r.height }; });
          return { width: innerWidth, height: innerHeight, overflow: document.documentElement.scrollHeight > innerHeight + 1 || document.documentElement.scrollWidth > innerWidth + 1, fits: boxes.every(r => r.y >= stage.top - 1 && r.bottom <= stage.bottom + 1 && r.x >= 0 && r.right <= innerWidth + 1), boxes };
        });
        assert.equal(measurement.overflow, false, JSON.stringify(measurement));
        if (width <= 760 && height < 568) {
          assert(measurement.boxes.every(box => box.x >= 0 && box.right <= width + 1), JSON.stringify(measurement));
          const queue = page.locator('.mobile-player-tools').getByRole('button', { name: '播放队列', exact: true });
          await queue.scrollIntoViewIfNeeded();
          const bounds = await queue.boundingBox();
          assert(bounds.y >= 64 && bounds.y + bounds.height <= height + 1, 'short mobile screens scroll to expose the bottom controls');
          await page.locator('.main-content').evaluate(element => { element.scrollTop = 0; });
        } else assert(measurement.fits, JSON.stringify(measurement));
        if (width <= 760) assert(measurement.boxes[0].width >= 44 && measurement.boxes[0].height >= 44, 'artwork retains a 44px touch target: ' + JSON.stringify(measurement));
        const hint = await page.locator('.playing-art-hint').boundingBox();
        assert(hint.x >= 0 && hint.x + hint.width <= width, 'mode hint fits the screen');
        assert.deepEqual(await page.locator('.playing-detail').boundingBox(), anchor);
        if (visual === 'square' || visual === 'disc') {
          const crop = await page.locator('.playing-art-layer.is-active .playing-art-frame').boundingBox();
          assert(crop.width <= measurement.boxes[0].width * .81 && Math.abs(crop.width - crop.height) < 1, 'cropped covers keep breathing room at every size: ' + JSON.stringify({ theme, visual, crop, measurement }));
        }
        measurements.push({ theme, visual, ...measurement });
        if (visual === 'vinyl' && (width === 390 || width === 320 || (theme === 'dark' && width === 1803))) await page.screenshot({ path: join(artifacts, `${theme}-vinyl-${width}x${height}.png`) });
        if ((width === 390 || width === 1803) && visual !== 'vinyl') await page.screenshot({ path: join(artifacts, `${theme}-${visual}-${width}x${height}.png`) });
      }
      if (width === 390 || width === 667 || (width === 320 && height === 480)) {
        await selectMode(page, 'spectrum');
        await page.screenshot({ path: join(artifacts, `${theme}-spectrum-${width}x${height}.png`) });
      }
    }
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByRole('button', { name: '播放队列', exact: true }).click();
  assert.equal(await page.locator('.listening-content').evaluate(el => getComputedStyle(el).columnGap), '48px');
  const queue = await page.locator('.listening-sidepanel').boundingBox(), controls = await page.locator('.playing-detail').boundingBox();
  assert(controls.x + controls.width <= queue.x);
  await page.screenshot({ path: join(artifacts, 'desktop-queue.png') });
  assert.deepEqual(errors, []);
  writeFileSync(join(artifacts, 'checks.json'), JSON.stringify({ low, high, breathingHeights, haloLow, haloHigh, measurements, errors }, null, 2));
});

test('unavailable analysis preserves native playback and invalid preferences recover', { timeout: 30000 }, async t => {
  const fixture = await createPlayingArtworkFixture(), browser = await chromium.launch({ executablePath, headless: true });
  t.after(async () => { await browser.close(); await fixture.close(); });
  const page = await browser.newPage(); page.setDefaultTimeout(8000);
  await page.addInitScript(({ record, preference }) => {
    localStorage.setItem('slow-listening:playback:v3', JSON.stringify(record));
    localStorage.setItem(preference, 'invalid-mode');
    window.AudioContext = class { constructor() { throw new Error('unavailable'); } };
  }, { record:queueRecord(fixture.tracks), preference });
  await openPlaying(page, fixture.base);
  assert.equal(await mode(page).getAttribute('data-visual-mode'), 'vinyl');
  await selectMode(page, 'spectrum');
  await page.getByText('当前环境暂不支持实时音波', { exact: true }).waitFor();
  await page.setViewportSize({ width: 320, height: 480 });
  const failureBounds = await page.locator('.playing-spectrum-status').boundingBox(), detail = await page.locator('.playing-detail').boundingBox();
  assert(failureBounds.x >= 0 && failureBounds.x + failureBounds.width <= 320 && failureBounds.y + failureBounds.height <= detail.y, 'fallback explanation stays clear of the controls on short phones');
  await page.locator('.listening-transport .play-toggle').click();
  await page.waitForFunction(() => document.querySelector('audio').currentTime > .2);
  assert.equal(await mode(page).getAttribute('data-visual-mode'), 'spectrum');
  assert(await media(page).evaluate(el => !el.paused));
  await selectMode(page, 'halo');
  await page.getByText('当前环境暂不支持实时音波', { exact: true }).waitFor();
  assert(await media(page).evaluate(el => !el.paused), 'the additional halo also preserves playback after analysis failure');
  await selectMode(page, 'square');
  await page.locator('.listening-transport .play-toggle').click();
  assert(await media(page).evaluate(el => el.paused));
});

test('desktop vinyl and circular covers rotate with reduced motion and preserve their angle across pauses', { timeout: 30000 }, async t => {
  const fixture = await createPlayingArtworkFixture(), browser = await chromium.launch({ executablePath, headless: true });
  t.after(async () => { await browser.close(); await fixture.close(); });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
  await context.route('https://i1.hdslb.com/fixture-artwork.png', route => route.fulfill({ contentType: 'image/png', body: readFileSync(resolve('public/assets/coast.png')) }));
  await context.addInitScript(record => localStorage.setItem('slow-listening:playback:v3', JSON.stringify(record)), queueRecord(fixture.tracks));
  const page = await context.newPage(); page.setDefaultTimeout(5000);
  await openPlaying(page, fixture.base);
  const selectors = { vinyl: '.vinyl-rotor', disc: '.playing-art-disc .playing-art' };
  const animation = visual => page.locator('.listening-stage ' + selectors[visual] + ',.mobile-player ' + selectors[visual]).evaluate(el => {
    const style = getComputedStyle(el), animation = el.getAnimations()[0];
    return { name: style.animationName, duration: style.animationDuration, state: style.animationPlayState, transform: style.transform, time: animation?.currentTime };
  });
  const moves = async visual => {
    const before = await animation(visual);
    await page.waitForTimeout(160);
    const after = await animation(visual);
    assert.equal(after.name, 'playing-art-turn'); assert.equal(after.duration, '24s'); assert.equal(after.state, 'running');
    assert.notEqual(after.transform, before.transform, visual + ' visibly rotates');
    assert(after.time > before.time, visual + ' advances from the retained angle');
  };
  await page.locator('.listening-transport .play-toggle').click();
  await page.waitForFunction(() => document.querySelector('audio[data-product-media]').currentTime > .2);
  const source = await media(page).evaluate(el => el.currentSrc), preparations = fixture.preparations.length;
  const sheen = await page.locator('.vinyl-sheen').evaluate(el => getComputedStyle(el).transform);
  for (const visual of ['vinyl', 'disc']) {
    await selectMode(page, visual); await moves(visual);
    await page.locator('.listening-transport .play-toggle').click();
    await page.waitForFunction(selector => getComputedStyle(document.querySelector(selector)).animationPlayState === 'paused', selectors[visual]);
    await page.waitForTimeout(80);
    const paused = await animation(visual); await page.waitForTimeout(160);
    assert.deepEqual(await animation(visual), paused, visual + ' retains the paused angle');
    await page.locator('.listening-transport .play-toggle').click(); await moves(visual);
    assert((await animation(visual)).time >= paused.time, visual + ' resumes without resetting');
    await page.emulateMedia({ reducedMotion: 'no-preference' }); await moves(visual);
    await page.emulateMedia({ reducedMotion: 'reduce' }); await moves(visual);
    await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, value: true }); document.dispatchEvent(new Event('visibilitychange')); });
    await page.waitForTimeout(80);
    const hidden = await animation(visual); await page.waitForTimeout(160);
    assert.equal(hidden.state, 'paused'); assert.deepEqual(await animation(visual), hidden);
    await page.evaluate(() => { delete document.hidden; document.dispatchEvent(new Event('visibilitychange')); }); await moves(visual);
    await page.getByRole('button', { name: '打开沉浸歌词', exact: true }).click();
    await page.waitForTimeout(80);
    const covered = await animation(visual); await page.waitForTimeout(160);
    assert.equal(covered.state, 'paused'); assert.deepEqual(await animation(visual), covered);
    const lyricVisual = page.locator('.desktop-lyrics-track ' + selectors[visual]);
    const lyricAngle = await lyricVisual.evaluate(el => getComputedStyle(el).transform);
    assert.equal(await lyricVisual.evaluate(el => getComputedStyle(el).animationPlayState), 'running');
    await page.waitForTimeout(160);
    assert.notEqual(await lyricVisual.evaluate(el => getComputedStyle(el).transform), lyricAngle, 'the visible lyric-mode artwork rotates while the normal one is suspended');
    await page.keyboard.press('Escape'); await moves(visual);
  }
  assert.equal(await page.locator('.vinyl-sheen').evaluate(el => getComputedStyle(el).transform), sheen);
  assert.equal(await media(page).evaluate(el => el.currentSrc), source); assert.equal(fixture.preparations.length, preparations);
  assert.equal(await media(page).count(), 1);
  await page.locator('.listening-transport .play-toggle').click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('.app[data-layout="mobile"]').waitFor();
  for (const visual of ['vinyl', 'disc']) {
    await selectMode(page, visual);
    assert.equal((await animation(visual)).name, 'playing-art-turn');
    assert.equal((await animation(visual)).state, 'paused');
    await page.locator('.listening-transport .play-toggle').click(); await moves(visual);
    await page.locator('.listening-transport .play-toggle').click();
    await page.waitForFunction(selector => getComputedStyle(document.querySelector(selector)).animationPlayState === 'paused', selectors[visual]);
    const paused = await animation(visual); await page.waitForTimeout(160);
    assert.deepEqual(await animation(visual), paused, 'mobile pause retains the current angle');
  }
});

test('mobile spectrum and halo keep following real audio regardless of system motion preferences', { timeout: 30000 }, async t => {
  const fixture = await createPlayingArtworkFixture(), browser = await chromium.launch({ executablePath, headless: true });
  t.after(async () => { await browser.close(); await fixture.close(); });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, reducedMotion: 'reduce' });
  await context.route('**/*', route => new URL(route.request().url()).origin === fixture.base ? route.continue() : route.abort());
  await context.addInitScript(({ record, preference }) => {
    localStorage.setItem('slow-listening:playback:v3', JSON.stringify(record)); localStorage.setItem(preference, 'spectrum');
    window.__graphs = 0; window.__bindings = 0; window.__paints = 0;
    const NativeContext = window.AudioContext;
    window.AudioContext = class extends NativeContext {
      constructor(...args) { super(...args); window.__graphs++; }
      createMediaElementSource(audio) { window.__bindings++; return super.createMediaElementSource(audio); }
    };
    const clear = CanvasRenderingContext2D.prototype.clearRect;
    CanvasRenderingContext2D.prototype.clearRect = function (...args) { if (this.canvas.classList.contains('playing-spectrum')) window.__paints++; return clear.apply(this, args); };
  }, { record: queueRecord(fixture.tracks), preference });
  const page = await context.newPage(); page.setDefaultTimeout(6000);
  await openPlaying(page, fixture.base); await page.locator('.listening-transport .play-toggle').click();
  await page.waitForFunction(() => document.querySelector('audio').currentTime > .2);
  await page.waitForFunction(() => document.querySelector('.playing-art-switch').dataset.analysisState === 'ready');
  const source = await media(page).evaluate(audio => audio.currentSrc), preparations = fixture.preparations.length;
  for (const [visual, variant] of [['spectrum', 'bars'], ['halo', 'halo']]) {
    await selectMode(page, visual);
    await media(page).evaluate(audio => { audio.currentTime = 1; }); await page.waitForTimeout(450);
    const low = await spectrumPeak(page, variant);
    await media(page).evaluate(audio => { audio.currentTime = 10; }); await page.waitForTimeout(700);
    const high = await spectrumPeak(page, variant);
    assert(low.max > low.min + 15 && high.index > low.index + 6, JSON.stringify({ visual, low, high }));
    for (const reducedMotion of ['no-preference', 'reduce']) {
      await page.emulateMedia({ reducedMotion });
      const paints = await page.evaluate(() => window.__paints);
      await page.waitForFunction(before => window.__paints > before, paints);
      assert.equal(await page.getByText('已减少动态效果', { exact: true }).count(), 0);
      assert.equal(await page.getByRole('button', { name: '启用实时音波', exact: true }).count(), 0);
    }
  }
  assert.deepEqual(await page.evaluate(() => ({ graphs: window.__graphs, bindings: window.__bindings })), { graphs: 1, bindings: 1 });
  assert.equal(await media(page).evaluate(audio => audio.currentSrc), source);
  assert.equal(fixture.preparations.length, preparations);
  assert.equal(await media(page).evaluate(audio => audio.paused), false);
});

test('touch artwork hints stay hidden after tapping while pointer and keyboard cues remain available', { timeout: 60000 }, async t => {
  const fixture = await createPlayingArtworkFixture(), browser = await chromium.launch({ executablePath, headless: true });
  t.after(async () => { await browser.close(); await fixture.close(); });
  const artifacts = join(developmentPaths().artifacts, 'playing-artwork'); mkdirSync(artifacts, { recursive: true });
  for (const width of [320, 360, 390, 430]) {
    const context = await browser.newContext({ viewport: { width, height: 844 }, hasTouch: true, colorScheme: 'dark', reducedMotion: 'reduce' });
    await context.route('**/*', route => new URL(route.request().url()).origin === fixture.base ? route.continue() : route.abort());
    await context.addInitScript(record => localStorage.setItem('slow-listening:playback:v3', JSON.stringify(record)), queueRecord(fixture.tracks));
    const page = await context.newPage(); page.setDefaultTimeout(6000);
    await openPlaying(page, fixture.base);
    assert.equal(await page.evaluate(() => matchMedia('(pointer:coarse)').matches), true);
    const opacity = () => page.locator('.playing-art-hint').evaluate(element => getComputedStyle(element).opacity);
    assert.equal(await opacity(), '0', 'touch screens do not show a persistent switch hint');
    await mode(page).tap();
    assert.equal(await mode(page).getAttribute('data-visual-mode'), 'original', 'tapping the artwork still changes its style');
    await page.waitForTimeout(220);
    assert.equal(await opacity(), '0', 'touch hover does not leave the switch hint visible');
    await selectMode(page, 'vinyl');
    await page.locator('.listening-transport .play-toggle').click();
    const angle = await page.locator('.vinyl-rotor').evaluate(element => getComputedStyle(element).transform);
    await page.waitForFunction(before => getComputedStyle(document.querySelector('.vinyl-rotor')).transform !== before, angle);
    if (width === 390) await page.screenshot({ path: join(artifacts, 'mobile-vinyl.png') });
    await context.close();
  }
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage(); await openPlaying(page, fixture.base);
  await page.mouse.move(0, 0);
  const hint = page.locator('.playing-art-hint');
  await page.waitForFunction(() => getComputedStyle(document.querySelector('.playing-art-hint')).opacity === '0');
  await mode(page).hover();
  await page.waitForFunction(() => getComputedStyle(document.querySelector('.playing-art-hint')).opacity === '1');
  await page.mouse.move(0, 0); await page.keyboard.press('Tab'); await mode(page).focus();
  await page.waitForFunction(() => getComputedStyle(document.querySelector('.playing-art-hint')).opacity === '1');
  assert.equal(await mode(page).evaluate(element => element.matches(':focus-visible')), true);
  assert(await hint.isVisible());
});

test('real spectrum and halo keep following audio when the browser prefers reduced motion', { timeout: 30000 }, async t => {
  const fixture = await createPlayingArtworkFixture(), browser = await chromium.launch({ executablePath, headless: true });
  t.after(async () => { await browser.close(); await fixture.close(); });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
  await context.route('**/*', route => new URL(route.request().url()).origin === fixture.base ? route.continue() : route.abort());
  await context.addInitScript(({ record, preference }) => {
    localStorage.setItem('slow-listening:playback:v3', JSON.stringify(record));
    localStorage.setItem(preference, 'spectrum');
    window.__graphs = []; window.__bindings = 0;
    const NativeContext = window.AudioContext;
    window.AudioContext = class extends NativeContext {
      constructor(...args) { super(...args); window.__graphs.push(this); }
      createMediaElementSource(audio) { window.__bindings++; return super.createMediaElementSource(audio); }
    };
  }, { record: queueRecord(fixture.tracks), preference });
  const page = await context.newPage(); page.setDefaultTimeout(6000);
  await openPlaying(page, fixture.base);
  await page.locator('.listening-transport .play-toggle').click();
  await page.waitForFunction(() => document.querySelector('audio').currentTime > .2);
  await page.waitForFunction(() => document.querySelector('.playing-art-switch').dataset.analysisState === 'ready');
  const before = await media(page).evaluate(el => el.currentSrc), preparations = fixture.preparations.length;
  const artifacts = resolve('local/verification/real-spectrum-2026-10-18'); mkdirSync(artifacts, { recursive: true });
  const checks = [];
  for (const [visual, variant] of [['spectrum', 'bars'], ['halo', 'halo']]) {
    await selectMode(page, visual);
    await media(page).evaluate(el => { el.currentTime = 1; }); await page.waitForTimeout(450);
    const low = await spectrumPeak(page, variant);
    await media(page).evaluate(el => { el.currentTime = 10; }); await page.waitForTimeout(700);
    const high = await spectrumPeak(page, variant);
    assert(low.max > low.min + 30 && high.index > low.index + 6, JSON.stringify({ visual, low, high }));
    assert.equal(await page.getByText('已减少动态效果', { exact: true }).count(), 0);
    assert.equal(await page.getByRole('button', { name: '启用实时音波', exact: true }).count(), 0, 'no extra opt-in is required');
    await page.screenshot({ path: join(artifacts, visual + '.png') }); checks.push({ visual, low, high });
  }
  assert.equal(await media(page).evaluate(el => el.currentSrc), before); assert.equal(fixture.preparations.length, preparations);
  assert.equal(await media(page).count(), 1);
  assert.deepEqual(await page.evaluate(() => ({ graphs: window.__graphs.length, bindings: window.__bindings })), { graphs: 1, bindings: 1 });
  await page.locator('.listening-transport .play-toggle').click();
  assert.equal(await media(page).evaluate(el => el.paused), true);
  writeFileSync(join(artifacts, 'checks.json'), JSON.stringify(checks, null, 2));
});
