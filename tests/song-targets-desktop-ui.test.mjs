import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { chromium } from './helpers/browser.mjs';
import { startSongManagementFixture } from './helpers/song-management-fixture.mjs';
import { navigate } from '../scripts/browser-ui.mjs';

async function setup(t, width = 1280) {
  const fixture = await startSongManagementFixture(); t.after(fixture.close);
  const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--autoplay-policy=no-user-gesture-required'] }); t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width, height: 900 } }); page.setDefaultTimeout(8000);
  const errors = [], writes = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => { if (request.method() === 'POST' && new URL(request.url()).pathname.startsWith('/api/song-library/')) writes.push(new URL(request.url()).pathname); });
  await page.route('**/*', route => new URL(route.request().url()).origin === fixture.origin ? route.continue() : route.abort());
  const snapshot = () => fixture.library.read().snapshot;
  const edit = commands => fixture.library.execute(fixture.library.read().revision, commands);
  edit([{ type: 'remove-favorite', favoriteId: snapshot().favorites.find(f => f.songId === 'duplicate').favoriteId }]);
  await page.goto(fixture.origin); await navigate(page, '歌单');
  const refresh = () => Promise.all([
    page.waitForResponse(response => new URL(response.url()).pathname === '/api/song-library'),
    page.evaluate(() => document.dispatchEvent(new Event('visibilitychange'))),
  ]);
  const play = async () => {
    await page.getByRole('button', { name: '播放 晴天', exact: true }).click();
    await page.waitForFunction(() => { const audio = document.querySelector('audio'); return audio && !audio.paused && audio.currentTime > .1; });
  };
  const openGroup = async () => {
    if (width <= 760) await page.getByRole('button', { name: '打开正在播放', exact: true }).click();
    await page.getByRole('button', { name: '更多播放选项', exact: true }).first().click();
    await page.getByRole('button', { name: '归入歌曲', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: '归入歌曲', exact: true }); await dialog.waitFor(); return dialog;
  };
  t.after(() => assert.deepEqual(errors, []));
  return { fixture, page, snapshot, edit, refresh, play, openGroup, writes };
}

test('desktop grouping uses current memberships and drops removed targets without saving hidden selections', { timeout: 60000 }, async t => {
  const { page, snapshot, edit, refresh, play, openGroup, writes } = await setup(t);
  await play(); let group = await openGroup();
  const choices = () => group.getByRole('radiogroup', { name: '归入的歌曲', exact: true });
  assert.equal(await choices().getByRole('radio', { name: /稻香/ }).count(), 0, 'historical songs without versions are hidden');
  assert.equal(await choices().getByRole('radio', { name: /晴天（重复保存）/ }).count(), 0, 'historical songs with versions are hidden');
  edit([{ type: 'add-entry', playlistId: 'repeat', entryId: 'orphan-first', songId: 'orphan' }, { type: 'add-entry', playlistId: 'repeat', entryId: 'orphan-second', songId: 'orphan' }]);
  await refresh(); const orphan = choices().getByRole('radio', { name: /稻香/ }); await orphan.check();
  assert.equal(await orphan.count(), 1, 'playlist-only songs appear once even with repeated memberships');
  edit([{ type: 'remove-entry', playlistId: 'repeat', entryId: 'orphan-first' }]); await refresh();
  assert(await orphan.isChecked(), 'a remaining playlist entry preserves the selected target');
  edit([{ type: 'remove-entry', playlistId: 'repeat', entryId: 'orphan-second' }]); await refresh();
  await orphan.waitFor({ state: 'detached' });
  assert(await group.getByRole('button', { name: '添加版本', exact: true }).isDisabled());
  const beforeInvalidSubmit = writes.length, revision = snapshot();
  await group.locator('form').evaluate(form => form.requestSubmit());
  await page.evaluate(() => new Promise(requestAnimationFrame));
  assert.equal(writes.length, beforeInvalidSubmit, 'a removed target cannot be submitted through the form'); assert.deepEqual(snapshot(), revision);
  edit([{ type: 'remove-favorite', favoriteId: snapshot().favorites.find(f => f.songId === 'sun').favoriteId }, ...snapshot().playlists[0].entries.filter(e => e.songId === 'sun').map(e => ({ type: 'remove-entry', playlistId: 'repeat', entryId: e.entryId }))]);
  await refresh(); await choices().getByRole('radio', { name: /^晴天 周杰伦/ }).waitFor({ state: 'detached' });
  await group.getByRole('button', { name: '取消', exact: true }).click(); group = await openGroup();
  assert.equal(await group.getByRole('button', { name: '整理本首歌曲', exact: true }).getAttribute('aria-pressed'), 'true', 'a historical owner is not selected as an existing target');
  await group.getByRole('button', { name: '加入已有歌曲', exact: true }).click();
  assert.equal(await choices().locator('input:checked').count(), 0); assert(await group.getByRole('button', { name: '添加版本', exact: true }).isDisabled());
  await group.getByLabel('查找已有歌曲', { exact: true }).fill('稻香');
  await group.getByText('没有匹配的歌曲。', { exact: true }).waitFor();
  edit([{ type: 'favorite', songId: 'orphan' }]); await refresh(); await choices().getByRole('radio', { name: /稻香/ }).check();
  const artifacts = resolve('local/verification/song-targets-membership'); await mkdir(artifacts, { recursive: true });
  await group.screenshot({ path: join(artifacts, 'group-current-targets.png') });
  await group.getByRole('button', { name: '预览归组影响', exact: true }).click();
  await group.getByRole('button', { name: '确认归入此歌曲', exact: true }).click(); await group.waitFor({ state: 'detached' });
  assert.equal(snapshot().versions.find(v => v.id === 'studio').songId, 'orphan');
  assert(snapshot().songs.some(s => s.id === 'sun'), 'historical metadata is preserved');
  assert.equal(await page.locator('audio').evaluate(audio => audio.paused), false, 'grouping preserves current playback');
  edit([...snapshot().favorites.map(f => ({ type: 'remove-favorite', favoriteId: f.favoriteId })), ...snapshot().playlists.map(p => ({ type: 'delete-playlist', playlistId: p.id }))]); await refresh();
  group = await openGroup(); await group.getByRole('button', { name: '加入已有歌曲', exact: true }).click();
  await group.getByText('还没有收藏或加入歌单的歌曲，可以先新建一首。', { exact: true }).waitFor();
  assert.equal(await choices().getByRole('radio').count(), 0); assert(await group.getByRole('button', { name: '添加版本', exact: true }).isDisabled());
});

test('desktop merge and move selectors exclude historical targets and invalidate removed selections', { timeout: 60000 }, async t => {
  const { page, snapshot, edit, refresh } = await setup(t);
  const manager = page.getByRole('dialog', { name: '歌曲管理', exact: true });
  const editor = page.getByRole('dialog', { name: '歌曲与版本', exact: true });
  await page.getByRole('button', { name: '歌曲管理', exact: true }).click();
  await manager.getByRole('button', { name: '管理歌曲 晴天', exact: true }).click();
  for (const task of ['移到其他歌曲', '合并到另一首歌曲']) {
    if (task === '合并到另一首歌曲') await editor.getByRole('tab', { name: '歌曲资料', exact: true }).click();
    await editor.getByRole('button', { name: task, exact: true }).click();
    const targets = editor.getByRole('radiogroup', { name: '目标歌曲', exact: true });
    assert.equal(await targets.getByRole('radio', { name: /稻香|晴天（重复保存）/ }).count(), 0, task + ' hides historical candidates');
    await targets.getByRole('radio', { name: /暂待确认/ }).check();
    await editor.getByRole('button', { name: '预览影响', exact: true }).click();
    await editor.getByRole('region', { name: '操作影响预览', exact: true }).waitFor();
    edit([{ type: 'remove-favorite', favoriteId: snapshot().favorites.find(f => f.songId === 'uncertain').favoriteId }]); await refresh();
    await targets.getByRole('radio', { name: /暂待确认/ }).waitFor({ state: 'detached' });
    assert(await editor.getByRole('button', { name: '预览影响', exact: true }).isDisabled());
    assert.equal(await editor.getByRole('region', { name: '操作影响预览', exact: true }).count(), 0, 'removal discards its old impact preview');
    edit([{ type: 'favorite', songId: 'uncertain' }]); await refresh();
    await targets.getByRole('radio', { name: /暂待确认/ }).waitFor();
    assert.equal(await targets.locator('input:checked').count(), 0, 'rejoining does not restore a stale target selection');
    await editor.getByRole('button', { name: '返回', exact: true }).click();
  }
});

test('mobile grouping keeps its existing candidate behavior', { timeout: 30000 }, async t => {
  const { play, openGroup } = await setup(t, 390); await play(); const group = await openGroup();
  const choices = group.getByRole('radiogroup', { name: '归入的歌曲', exact: true });
  assert.equal(await choices.getByRole('radio', { name: /稻香/ }).count(), 1);
  assert.equal(await choices.getByRole('radio', { name: /晴天（重复保存）/ }).count(), 1);
});
