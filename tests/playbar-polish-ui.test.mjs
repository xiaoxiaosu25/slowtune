import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { chromium } from './helpers/browser.mjs';
import { createPlayingArtworkFixture } from './helpers/playing-artwork-fixture.mjs';
import { measurePlaybarContrast, settlePlaybarGlow } from './helpers/playbar-contrast.mjs';

const cover = '<svg xmlns="http://www.w3.org/2000/svg" width="480" height="270"><rect width="480" height="270" fill="#f7b267"/></svg>';
const progress = '.playbar .progress-track';
let fixture, browser;

before(async () => {
  fixture = await createPlayingArtworkFixture({ preview: true });
  browser = await chromium.launch();
});
after(async () => {
  try { await browser?.close(); }
  finally { await fixture?.close(); }
});

async function openPlaybar(t, { width = 1440, artwork = cover, appearance } = {}) {
  const page = await browser.newPage({ viewport: { width, height: 900 } });
  t.after(() => page.close());
  page.setDefaultTimeout(8000);
  if (appearance) await page.addInitScript(({ theme, palette, style }) => {
    localStorage.setItem('slow-listening:theme:v1', theme);
    localStorage.setItem('slow-listening:palette:v1', palette);
    localStorage.setItem('slow-listening:player-style:v1', style);
  }, appearance);
  await page.route('https://i1.hdslb.com/**', route => route.fulfill({ contentType: 'image/svg+xml', body: artwork }));
  await page.goto(fixture.base);
  const playbar = page.locator('.playbar');
  await playbar.locator('button[aria-label="播放"]:enabled').waitFor();
  return { page, playbar };
}

async function startPlayback(playbar) {
  await playbar.getByRole('button', { name: '播放', exact: true }).click();
  await playbar.getByRole('button', { name: '暂停', exact: true }).waitFor();
}

async function pausePlayback(playbar) {
  await playbar.getByRole('button', { name: '暂停', exact: true }).click();
  await playbar.getByRole('button', { name: '播放', exact: true }).waitFor();
}

async function hoverAt(page, track, ratio) {
  const box = await track.boundingBox();
  await page.mouse.move(box.x + box.width * ratio, box.y + box.height / 2);
}

function waitForStyle(page, selector, property, value) {
  return page.waitForFunction(({ selector, property, value }) => {
    const element = document.querySelector(selector);
    return element && getComputedStyle(element)[property] === value;
  }, { selector, property, value });
}

test('the paused track has one cover glow image', async t => {
  const { playbar } = await openPlaybar(t);
  const glow = playbar.locator('.playbar-glow');
  await glow.locator('img').waitFor();
  assert.equal(await glow.locator('img').count(), 1);
  assert.equal(await glow.getAttribute('data-playing'), null);
});

test('the glow marks playback and clears the marker on pause', async t => {
  const { playbar } = await openPlaybar(t);
  const glow = playbar.locator('.playbar-glow');
  await startPlayback(playbar);
  assert.notEqual(await glow.getAttribute('data-playing'), null);
  await pausePlayback(playbar);
  assert.equal(await glow.getAttribute('data-playing'), null);
});

test('playbar text keeps 4.5:1 contrast with extreme artwork at narrow desktop width', async t => {
  for (const [theme, color] of [['light', '#000000'], ['dark', '#ffffff']]) {
    for (const style of ['floating', 'bar']) {
      await t.test(theme + ' ' + style, async t => {
        const { page, playbar } = await openPlaybar(t, {
          width: 800,
          artwork: cover.replace('#f7b267', color),
          appearance: { theme, palette: 'plum', style },
        });
        await startPlayback(playbar);
        await settlePlaybarGlow(playbar);
        assert.equal(await page.locator('html').getAttribute('data-theme'), theme);
        assert.equal(await page.locator('html').getAttribute('data-palette'), 'plum');
        assert.equal(await page.locator('.app').getAttribute('data-player-style'), style);
        for (const hovered of [false, true]) {
          if (hovered) await playbar.getByRole('button', { name: '打开正在播放', exact: true }).hover();
          const { ratios } = await measurePlaybarContrast(page);
          for (const [index, label] of ['title', 'subtitle'].entries()) {
            assert(ratios[index] >= 4.5, `${label}, hovered=${hovered}: ${ratios[index]}`);
          }
        }
      });
    }
  }
});

test('the next track clears the glow when it has no cover', async t => {
  const { playbar } = await openPlaybar(t);
  const image = playbar.locator('.playbar-glow img');
  await image.waitFor();
  await startPlayback(playbar);
  await playbar.getByRole('button', { name: '下一首', exact: true }).click();
  await playbar.getByText(fixture.tracks[1].title, { exact: true }).waitFor();
  await image.waitFor({ state: 'detached' });
  assert.equal(await image.count(), 0);
});

test('the resting progress rail is 4px and its thumb is scaled to zero', async t => {
  const { page, playbar } = await openPlaybar(t);
  await startPlayback(playbar);
  await pausePlayback(playbar);
  await page.mouse.move(0, 0);
  await waitForStyle(page, `${progress} .scrubber-rail`, 'height', '4px');
  const scale = await page.locator(`${progress} .scrubber-thumb`).evaluate(thumb => {
    const transform = new DOMMatrixReadOnly(getComputedStyle(thumb).transform);
    return [transform.a, transform.d];
  });
  assert.deepEqual(scale, [0, 0]);
});

test('hovering at 62% thickens the progress rail and previews that time', async t => {
  const { page, playbar } = await openPlaybar(t);
  await startPlayback(playbar);
  const track = page.locator(progress);
  const duration = Number(await track.getByRole('slider', { name: '播放进度' }).getAttribute('max'));
  assert(duration > 0);
  await hoverAt(page, track, .62);
  await waitForStyle(page, `${progress} .scrubber-rail`, 'height', '6px');
  await waitForStyle(page, `${progress} .scrubber-tip`, 'opacity', '1');
  const label = await track.locator('.scrubber-tip').textContent();
  const seconds = label.split(':').reduce((total, part) => total * 60 + Number(part), 0);
  assert(Math.abs(seconds - duration * .62) <= 1, `hover preview: ${label} for ${duration}s`);
});

test('a progress rail without a duration stays 4px and hides the tip on hover', async t => {
  const { page, playbar } = await openPlaybar(t);
  const slider = playbar.getByRole('slider', { name: '播放进度' });
  assert.equal(await slider.getAttribute('max'), '0');
  assert.equal(await slider.isDisabled(), true);
  const track = page.locator(progress);
  await hoverAt(page, track, .62);
  const styles = await track.evaluate(element => ({
    rail: getComputedStyle(element.querySelector('.scrubber-rail')).height,
    tip: getComputedStyle(element.querySelector('.scrubber-tip')).opacity,
  }));
  assert.deepEqual(styles, { rail: '4px', tip: '0' });
});

test('Tab reveals the progress thumb and focus ring, and ArrowRight seeks', async t => {
  const { page, playbar } = await openPlaybar(t);
  await startPlayback(playbar);
  await pausePlayback(playbar);
  const slider = playbar.getByRole('slider', { name: '播放进度' });
  await playbar.getByRole('button', { name: '下一首', exact: true }).focus();
  await page.keyboard.press('Tab');
  assert(await slider.evaluate(element => element.matches(':focus-visible')));
  await page.waitForFunction(selector => {
    const style = getComputedStyle(document.querySelector(selector));
    const transform = new DOMMatrixReadOnly(style.transform);
    return transform.a === 1 && transform.d === 1 && /0px 0px 0px 3px\b/.test(style.boxShadow);
  }, `${progress} .scrubber-thumb`);
  const position = await page.locator('audio[data-product-media]').evaluate(audio => audio.currentTime);
  await page.keyboard.press('ArrowRight');
  await page.waitForFunction(before => document.querySelector('audio[data-product-media]').currentTime > before, position);
});

test('the play button morphs both paths and switches its accessible label', async t => {
  const { page, playbar } = await openPlaybar(t);
  const toggle = playbar.locator('.play-toggle');
  const paths = toggle.locator('.play-glyph path');
  assert.equal(await paths.count(), 2);
  assert.equal(await toggle.getAttribute('aria-label'), '播放');
  const paused = await paths.evaluateAll(elements => elements.map(element => getComputedStyle(element).d));
  await startPlayback(playbar);
  assert.equal(await toggle.getAttribute('aria-label'), '暂停');
  await page.waitForFunction(before => {
    const paths = [...document.querySelectorAll('.playbar .play-toggle .play-glyph path')];
    return paths.length === 2 && paths.every((path, index) => getComputedStyle(path).d !== before[index]);
  }, paused);
  await pausePlayback(playbar);
  assert.equal(await toggle.getAttribute('aria-label'), '播放');
});

test('reduced motion removes transitions from the play glyph and progress rail', async t => {
  const { page, playbar } = await openPlaybar(t);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const controls = playbar.locator('.play-toggle .play-glyph path, .progress-track .scrubber-rail');
  assert.deepEqual(await controls.evaluateAll(elements => elements.map(element => getComputedStyle(element).transitionDuration)), ['0s', '0s', '0s']);
});

test('the desktop volume rail thickens on hover, updates on drag, and empties on mute', async t => {
  const { page, playbar } = await openPlaybar(t);
  const volume = playbar.locator('.volume-scrubber');
  const slider = volume.getByRole('slider', { name: '音量' });
  const initial = await slider.getAttribute('aria-valuetext');
  const ratio = Number(await slider.inputValue());
  const box = await slider.boundingBox();
  await hoverAt(page, volume, ratio);
  await waitForStyle(page, '.playbar .volume-scrubber .scrubber-rail', 'height', '6px');
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * .75, box.y + box.height / 2, { steps: 4 });
  await page.mouse.up();
  const changed = await slider.getAttribute('aria-valuetext');
  assert.notEqual(changed, initial);
  assert(Math.abs(parseInt(changed, 10) - 75) <= 2, changed);
  const fill = volume.locator('.scrubber-fill');
  assert(await fill.evaluate(element => element.getBoundingClientRect().width > 0));
  await playbar.getByRole('button', { name: '静音', exact: true }).click();
  await playbar.getByRole('button', { name: '取消静音', exact: true }).waitFor();
  assert.equal(await fill.evaluate(element => element.getBoundingClientRect().width), 0);
});
