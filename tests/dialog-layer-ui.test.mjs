import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from './helpers/browser.mjs';
import { startSongManagementFixture } from './helpers/song-management-fixture.mjs';
import { navigate, selectPlaylist, libraryAction } from '../scripts/browser-ui.mjs';

const playlistName = '晚风与散步';

async function openPlaylist(t, mobile = false) {
  const fixture = await startSongManagementFixture();
  t.after(fixture.close);
  fixture.library.execute(fixture.library.read().revision, [
    { type: 'create-playlist', id: 'dialog-test', name: playlistName },
    ...Array.from({ length: 16 }, (_, i) => ({
      type: 'add-entry', playlistId: 'dialog-test', entryId: 'song-' + i, songId: 'sun',
    })),
  ]);
  const browser = await chromium.launch({ headless: true });
  t.after(() => browser.close());
  const viewport = mobile ? { width: 390, height: 844 } : { width: 1280, height: 800 };
  const page = await browser.newPage({ viewport, hasTouch: mobile });
  page.setDefaultTimeout(8000);
  await page.route('**/*', route => new URL(route.request().url()).origin === fixture.origin ? route.continue() : route.abort());
  await page.goto(fixture.origin);
  await navigate(page, '歌单');
  await selectPlaylist(page, playlistName);
  const library = page.locator('.song-library-page');
  await library.getByRole('heading', { name: playlistName, exact: true }).waitFor();
  return { page, library };
}

function renameDialog(page) {
  return page.getByRole('dialog', { name: '歌单改名', exact: true });
}

async function openRename(page) {
  await libraryAction(page, '歌单改名');
  const dialog = renameDialog(page);
  await dialog.waitFor();
  return dialog;
}

async function active(locator) {
  return locator.evaluate(element => element === document.activeElement);
}

test('desktop rename opens above other layers with the name focused', async t => {
  const { page } = await openPlaylist(t);
  const dialog = await openRename(page);
  assert.equal(await dialog.getAttribute('data-layer'), 'dialog');
  assert(await active(dialog.getByRole('textbox', { name: '歌单名称' })));
  assert(await dialog.evaluate(element => {
    const box = element.getBoundingClientRect();
    return element.contains(document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2));
  }));
});

test('Tab and Shift+Tab cycle through the original rename control order', async t => {
  const { page } = await openPlaylist(t);
  const dialog = await openRename(page);
  const name = dialog.getByRole('textbox', { name: '歌单名称' });
  const save = dialog.getByRole('button', { name: '保存歌单', exact: true });
  const close = dialog.getByRole('button', { name: '关闭', exact: true });
  assert(await active(name));
  for (const [key, expected] of [
    ['Tab', save], ['Tab', close], ['Tab', name],
    ['Shift+Tab', close], ['Shift+Tab', save], ['Shift+Tab', name],
  ]) {
    await page.keyboard.press(key);
    assert(await active(expected), key + ' reaches the expected control');
  }
});

test('Escape closes rename and restores the desktop playlist menu button', async t => {
  const { page, library } = await openPlaylist(t);
  const dialog = await openRename(page);
  await page.keyboard.press('Escape');
  await dialog.waitFor({ state: 'detached' });
  const manage = library.getByRole('button', { name: '歌单管理', exact: true });
  await page.waitForFunction(() => document.activeElement?.matches('.playlist-manage-menu > button'));
  assert(await active(manage));
});

test('clicking the backdrop discards the unsaved rename', async t => {
  const { page, library } = await openPlaylist(t);
  const dialog = await openRename(page);
  await dialog.getByRole('textbox', { name: '歌单名称' }).fill('不保存的名字');
  await page.locator('.modal-backdrop').click({ position: { x: 10, y: 10 } });
  await dialog.waitFor({ state: 'detached' });
  assert(await library.getByRole('heading', { name: playlistName, exact: true }).isVisible());
});

test('rename owns Space and Escape without toggling playback or leaving the playlist', async t => {
  const { page, library } = await openPlaylist(t);
  const transport = page.locator('.playbar');
  await library.getByRole('button', { name: '播放全部', exact: true }).click();
  const audio = page.locator('audio[data-product-media]');
  await transport.getByRole('button', { name: '暂停', exact: true }).click();
  await transport.getByRole('button', { name: '播放', exact: true }).waitFor();
  await audio.evaluate(element => {
    element.addEventListener('play', () => { element.dataset.testResumed = 'true'; });
  });
  const dialog = await openRename(page);
  // Target the content so the shortcut would otherwise reach the playback handler.
  await dialog.focus();
  assert(await active(dialog));
  await page.keyboard.press('Space');
  await page.keyboard.press('Escape');
  await dialog.waitFor({ state: 'detached' });
  assert(await audio.evaluate(element => element.paused && !element.dataset.testResumed));
  assert(await library.getByRole('heading', { name: playlistName, exact: true }).isVisible());
});

test('mobile Back closes rename before leaving the playlist', async t => {
  const { page, library } = await openPlaylist(t, true);
  const route = await page.evaluate(() => history.state.slowTuneMobileNavigation.page);
  const dialog = await openRename(page);
  await page.waitForFunction(() => history.state?.slowTuneMobileNavigation?.layers.length === 1);
  await page.evaluate(() => history.back());
  await dialog.waitFor({ state: 'detached' });
  await library.getByRole('heading', { name: playlistName, exact: true }).waitFor();
  assert.equal(await page.evaluate(() => history.state.slowTuneMobileNavigation.page), route);
  await page.evaluate(() => history.back());
  await page.getByRole('region', { name: '音乐库', exact: true }).waitFor();
  assert.equal(await dialog.count(), 0);
});

test('mobile rename locks a scrollable background', async t => {
  const { page } = await openPlaylist(t, true);
  assert(await page.evaluate(() => document.documentElement.scrollHeight > innerHeight + 300));
  await openRename(page);
  const scroll = await page.evaluate(() => window.scrollY);
  await page.mouse.move(10, 100);
  await page.mouse.wheel(0, 600);
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  assert.equal(await page.evaluate(() => window.scrollY), scroll);
});

test('both playlist menu entries save the new name and dismiss rename', async t => {
  const { page, library } = await openPlaylist(t);
  async function save(name) {
    const dialog = renameDialog(page);
    await dialog.getByRole('textbox', { name: '歌单名称' }).fill(name);
    await dialog.getByRole('button', { name: '保存歌单', exact: true }).click();
    await dialog.waitFor({ state: 'detached' });
    await library.getByRole('heading', { name, exact: true }).waitFor();
  }
  await openRename(page);
  await save('歌单菜单改名');
  await page.locator('.sidebar-playlist').filter({ hasText: '歌单菜单改名' }).click({ button: 'right' });
  await page.locator('.context-menu:popover-open').getByRole('menuitem', { name: '歌单改名', exact: true }).click();
  await save('右键菜单改名');
});
