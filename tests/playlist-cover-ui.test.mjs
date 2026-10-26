import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from './helpers/browser.mjs';
import { startSongManagementFixture } from './helpers/song-management-fixture.mjs';
import { navigate, selectPlaylist } from '../scripts/browser-ui.mjs';

test('desktop playlist covers upload, crop, select, persist, recover and leave mobile unchanged', { timeout: 120000 }, async t => {
  const fixture = await startSongManagementFixture(); t.after(fixture.close);
  fixture.library.execute(fixture.library.revision(), [{ type: 'edit-song', songId: 'sun', artwork: 'https://p1.music.126.net/sun.jpg' }, { type: 'edit-song', songId: 'duplicate', artwork: 'https://p1.music.126.net/duplicate.jpg' }]);
  const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--autoplay-policy=no-user-gesture-required'] }); t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, colorScheme: 'dark' }), errors = [];
  page.setDefaultTimeout(12000); page.on('pageerror', e => errors.push(e.message));
  const source = await page.evaluate(() => {
    const canvas = document.createElement('canvas'); canvas.width = 1200; canvas.height = 600; const x = canvas.getContext('2d');
    const gradient = x.createLinearGradient(0, 0, 1200, 600); gradient.addColorStop(0, '#bd6c46'); gradient.addColorStop(.5, '#577b60'); gradient.addColorStop(1, '#262e40');
    x.fillStyle = gradient; x.fillRect(0, 0, 1200, 600); x.fillStyle = '#f4eddb'; x.fillRect(700, 120, 100, 340);
    return canvas.toDataURL('image/png');
  });
  const payload = { name: 'landscape.png', mimeType: 'image/png', buffer: Buffer.from(source.split(',')[1], 'base64') };
  await page.route('**/*', route => new URL(route.request().url()).origin === fixture.origin ? route.continue() : route.fulfill({ contentType: 'image/png', body: payload.buffer }));
  let failWrite = false, failSource = false;
  await page.route('**/api/song-library/edits', route => failWrite ? route.fulfill({ status: 503, json: { error: { code: 'storage' } } }) : route.continue());
  await page.route('**/api/song-library/covers/source', route => failSource ? route.fulfill({ status: 503, json: { error: { code: 'network' } } }) : route.fulfill({ json: { image: source } }));
  await page.goto(fixture.origin); await navigate(page, '歌单');
  const trigger = () => page.getByRole('button', { name: '更换封面', exact: true });
  const dialog = () => page.getByRole('dialog', { name: '更换封面', exact: true });
  const open = async () => { await trigger().click(); await dialog().waitFor(); };
  const upload = async () => { await dialog().getByLabel('上传封面图片', { exact: true }).setInputFiles(payload); await dialog().locator('canvas').waitFor(); await dialog().locator('p[role="status"]').waitFor({ state: 'detached' }); };
  const save = async () => { await dialog().getByRole('button', { name: '保存封面', exact: true }).click(); await dialog().waitFor({ state: 'detached' }); };
  const choosePlaylist = async name => page.locator('.sidebar-playlist:visible,.playlist-switcher button:visible').filter({ hasText: name }).first().click();
  const image = () => page.locator('.playlist-intro .playlist-art').getAttribute('src');
  const screenshotRoot = resolve('local/verification/playlist-cover'); await mkdir(screenshotRoot, { recursive: true });

  await t.test('cancel, invalid file, cropping and write retry preserve the original until saved', async () => {
    const original = await image();
    await open(); await upload(); await dialog().getByRole('button', { name: '取消', exact: true }).click();
    assert.equal(await image(), original); assert.equal(fixture.library.read().snapshot.desktopFavoritesCover, undefined);
    assert.equal(await trigger().evaluate(element => element === document.activeElement), true);
    await page.getByRole('button', { name: '播放 晴天', exact: true }).click(); await page.waitForFunction(() => document.querySelector('audio')?.currentTime > .2);
    const audioBefore = await page.locator('audio').evaluate(audio => ({ source: audio.currentSrc, time: audio.currentTime }));
    await open(); await dialog().getByLabel('上传封面图片').setInputFiles({ name: 'bad.svg', mimeType: 'image/svg+xml', buffer: Buffer.from('<svg/>') }); await dialog().getByRole('alert').waitFor();
    assert.equal(await dialog().getByRole('button', { name: '保存封面', exact: true }).isDisabled(), true);
    await upload(); const before = await dialog().locator('canvas').evaluate(c => c.toDataURL());
    await dialog().getByLabel('封面缩放', { exact: true }).fill('1.6');
    const canvas = dialog().locator('canvas'), box = await canvas.boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down(); await page.mouse.move(box.x + box.width / 2 + 38, box.y + box.height / 2 + 25, { steps: 4 }); await page.mouse.up();
    await canvas.focus(); await page.keyboard.press('ArrowLeft');
    const cropped = await canvas.evaluate(c => c.toDataURL()); assert.notEqual(cropped, before);
    failWrite = true; await dialog().getByRole('button', { name: '保存封面', exact: true }).click(); await dialog().getByRole('alert').waitFor();
    assert.equal(await image(), original); assert.equal(await canvas.evaluate(c => c.toDataURL()), cropped);
    await page.screenshot({ path: resolve(screenshotRoot, 'upload-dark.png') });
    failWrite = false; await save();
    const saved = fixture.library.read().snapshot.desktopFavoritesCover; assert.match(saved, /^data:image\/jpeg;base64,/); assert.equal(await image(), saved);
    assert.equal(await page.locator('.sidebar-playlist').filter({ hasText: '我的收藏' }).locator('img').getAttribute('src'), saved);
    const audioAfter = await page.locator('audio').evaluate(audio => ({ source: audio.currentSrc, time: audio.currentTime, paused: audio.paused }));
    assert.equal(audioAfter.source, audioBefore.source); assert.equal(audioAfter.paused, false); assert(audioAfter.time > audioBefore.time);
    await page.reload(); await navigate(page, '歌单'); assert.equal(await image(), saved);
  });

  await t.test('song cover choice deduplicates members, handles failure, previews and persists independently', async () => {
    await choosePlaylist('周杰伦精选'); const favoritesImage = fixture.library.read().snapshot.desktopFavoritesCover;
    await open(); await dialog().getByRole('button', { name: '从歌曲选择', exact: true }).click();
    assert.equal(await dialog().locator('.playlist-cover-choice').count(), 1);
    await dialog().getByLabel('搜索封面歌曲').fill('不存在'); assert.equal(await dialog().locator('.playlist-cover-choice').count(), 0);
    await dialog().getByLabel('搜索封面歌曲').fill('周杰伦'); failSource = true;
    await dialog().getByRole('button', { name: '使用封面 晴天', exact: true }).click(); await dialog().getByRole('alert').waitFor();
    failSource = false; await dialog().getByRole('button', { name: '使用封面 晴天', exact: true }).click(); await dialog().locator('canvas').waitFor();
    await page.screenshot({ path: resolve(screenshotRoot, 'songs-dark.png') });
    await page.emulateMedia({ colorScheme: 'light' });
    await page.setViewportSize({ width: 761, height: 800 });
    assert.equal(await dialog().evaluate(d => d.scrollWidth > d.clientWidth), false);
    await page.screenshot({ path: resolve(screenshotRoot, 'songs-compact.png') });
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.setViewportSize({ width: 1440, height: 1000 }); await save();
    const state = fixture.library.read(), saved = state.snapshot.playlists[0].desktopCover; assert(saved); assert.notEqual(saved, favoritesImage);
    fixture.library.execute(state.revision, state.snapshot.playlists[0].entries.map(entry => ({ type: 'remove-entry', playlistId: 'repeat', entryId: entry.entryId })));
    await page.reload(); await navigate(page, '歌单'); await choosePlaylist('周杰伦精选');
    assert.equal(await image(), saved); assert.equal(fixture.library.read().snapshot.desktopFavoritesCover, favoritesImage);
    const backup = await page.request.get(fixture.origin + '/api/song-library/export'); const snapshot = await backup.json();
    assert.equal(snapshot.playlists[0].desktopCover, saved); assert.equal(snapshot.desktopFavoritesCover, favoritesImage);
    await open(); await dialog().getByRole('button', { name: '恢复自动封面', exact: true }).click(); await save();
    assert.equal(fixture.library.read().snapshot.playlists[0].desktopCover, undefined);
    assert.equal(await page.locator('.playlist-intro .unknown-cover').count(), 1);
    await open(); await dialog().getByRole('button', { name: '从歌曲选择', exact: true }).click(); await dialog().getByText('当前列表还没有可用的歌曲封面，可以上传图片。').waitFor(); await page.keyboard.press('Escape');
  });

  await t.test('revision conflicts retain the crop and require review before saving the chosen cover', async () => {
    await choosePlaylist('我的收藏'); await open(); await upload();
    const crop = await dialog().locator('canvas').evaluate(c => c.toDataURL());
    fixture.library.execute(fixture.library.revision(), [{ type: 'edit-song', songId: 'sun', title: '晴天新资料' }]);
    await dialog().getByRole('button', { name: '保存封面', exact: true }).click(); await dialog().getByRole('button', { name: '已核对，保留我的选择', exact: true }).waitFor();
    assert.equal(await dialog().locator('canvas').evaluate(c => c.toDataURL()), crop);
    assert.equal(await dialog().getByRole('button', { name: '保存封面', exact: true }).isDisabled(), true);
    await dialog().getByRole('button', { name: '已核对，保留我的选择', exact: true }).click(); await save();
    assert.equal(fixture.library.read().snapshot.songs.find(song => song.id === 'sun').title, '晴天新资料');
  });

  await t.test('mobile retains its original artwork and exposes no new cover controls', async () => {
    const saved = fixture.library.read().snapshot.desktopFavoritesCover; assert(saved);
    await page.setViewportSize({ width: 390, height: 844 }); await page.reload(); await navigate(page, '歌单');
    await selectPlaylist(page,'我的收藏');
    assert.equal(await trigger().count(), 0); assert.equal(await image(), 'https://p1.music.126.net/sun.jpg');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.setViewportSize({ width: 1440, height: 1000 });
    await trigger().waitFor();
    assert.equal(await image(), saved);
  });
  assert.deepEqual(errors, []);
});
