import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from './helpers/browser.mjs';
import { startSongManagementFixture } from './helpers/song-management-fixture.mjs';
import { navigate, libraryAction } from '../scripts/browser-ui.mjs';

async function setup(t) {
  const fixture = await startSongManagementFixture();
  const browser = await chromium.launch({ headless: true, args: ['--autoplay-policy=no-user-gesture-required'] });
  t.after(async () => { await browser.close(); await fixture.close(); });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.setDefaultTimeout(10000);
  await page.route('**/*', route => new URL(route.request().url()).origin === fixture.origin ? route.continue() : route.abort());
  return { page, fixture };
}
async function play(page, origin) {
  await page.goto(origin); await navigate(page, '歌单');
  await page.getByRole('button', { name: '播放 晴天', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('audio')?.currentTime > .2);
  await page.evaluate(() => { window.testAudio = document.querySelector('audio'); });
}

test('desktop feature load failure retries with a fresh URL while the same audio keeps playing', { timeout: 30000 }, async t => {
  const { page, fixture } = await setup(t), requests = [];
  let fail = true;
  await page.route('**/assets/desktop-features-*.js*', route => {
    requests.push(route.request().url());
    return fail ? route.fulfill({ status: 503, contentType: 'text/javascript', body: '' }) : route.continue();
  });
  await play(page, fixture.origin);
  assert.equal(requests.length, 0, 'desktop manager is not fetched at startup or while browsing the library');
  await libraryAction(page, '歌曲管理');
  await page.getByRole('dialog', { name: '歌曲管理暂不可用', exact: true }).waitFor();
  const before = await page.evaluate(() => window.testAudio.currentTime);
  fail = false;
  await page.getByRole('button', { name: '重试显示', exact: true }).click();
  await page.getByRole('dialog', { name: '歌曲管理', exact: true }).waitFor();
  assert(requests.some(url => new URL(url).searchParams.has('retry')));
  assert(await page.evaluate(before => document.querySelector('audio') === window.testAudio && !window.testAudio.paused && window.testAudio.currentTime > before, before));
  await page.getByRole('textbox', { name: '搜索已保存歌曲' }).fill('晴天');
  await page.evaluate(() => window.testAudio.pause());
  await page.waitForFunction(() => document.querySelector('audio').paused);
  assert.equal(await page.getByRole('textbox', { name: '搜索已保存歌曲' }).inputValue(), '晴天', 'parent playback changes do not remount a newly loaded manager');
  await page.keyboard.press('Escape');
});

test('desktop managers share one retryable module without unloaded static dependencies', { timeout: 30000 }, async t => {
  const { page, fixture } = await setup(t), requests = [];
  await play(page, fixture.origin);
  let fail = true;
  await page.route('**/assets/*.js*', route => {
    requests.push(route.request().url());
    return fail ? route.fulfill({ status: 503, contentType: 'text/javascript', body: '' }) : route.continue();
  });
  await libraryAction(page, '歌曲管理');
  await page.getByRole('dialog', { name: '歌曲管理暂不可用', exact: true }).waitFor();
  fail = false;
  await page.getByRole('button', { name: '重试显示', exact: true }).click();
  await page.getByRole('dialog', { name: '歌曲管理', exact: true }).waitFor();
  assert.equal(new Set(requests.map(url => new URL(url).pathname)).size, 1, 'a deferred static dependency would retain its failed URL when only the entry is retried');
  assert.equal(requests.length, 2);
  assert(new URL(requests[1]).searchParams.has('retry'));
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '打开正在播放', exact: true }).click();
  await page.getByRole('button', { name: '查看歌曲来源', exact: true }).click();
  await page.getByRole('button', { name: '选择播放版本', exact: true }).click();
  await page.getByRole('dialog', { name: '播放版本', exact: true }).waitFor();
  assert.equal(requests.length, 2, 'another manager reuses the successfully retried module');
  assert(await page.evaluate(() => document.querySelector('audio') === window.testAudio && !window.testAudio.paused));
});

test('desktop clock updates only its local subscribers and paused seeking still updates the progress', { timeout: 30000 }, async t => {
  const { page, fixture } = await setup(t);
  await page.addInitScript(() => {
    window.workspaceRenders = 0;
    window.__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
      supportsFiber: true, inject: () => 1, onCommitFiberUnmount() {},
      onCommitFiberRoot(_id, root) {
        const pending = [root.current];
        while (pending.length) {
          const fiber = pending.pop();
          if (fiber.type === 'div' && /^app(?: |$)/.test(fiber.memoizedProps?.className ?? '') && fiber.alternate && fiber.memoizedProps !== fiber.alternate.memoizedProps) window.workspaceRenders++;
          if (fiber.child) pending.push(fiber.child);
          if (fiber.sibling) pending.push(fiber.sibling);
        }
      },
    };
  });
  await play(page, fixture.origin);
  await page.waitForTimeout(800);
  const before = await page.locator('[aria-label="播放进度"]').inputValue();
  await page.evaluate(() => { window.workspaceRenders = 0; });
  await page.waitForTimeout(1200);
  assert(Number(await page.locator('[aria-label="播放进度"]').inputValue()) > Number(before) + .5);
  assert.equal(await page.evaluate(() => window.workspaceRenders), 0, 'media clock must not rerender the app shell');
  await page.getByRole('button', { name: '暂停', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('audio').paused);
  await page.locator('[aria-label="播放进度"]').press('Home');
  await page.waitForFunction(() => document.querySelector('audio').currentTime < .2);
  await page.waitForFunction(() => Number(document.querySelector('[aria-label="播放进度"]').value) === 0);
  assert.equal(Number(await page.locator('[aria-label="播放进度"]').inputValue()), 0);
});

test('a desktop page render error stays below the player and navigation recovers', { timeout: 30000 }, async t => {
  const { page, fixture } = await setup(t);
  await page.route('**/api/charts?*', route => route.fulfill({ json: { source: 'netease', chart: 'hot', title: 'Fixture', fetchedAt: Date.now(), items: null } }));
  await play(page, fixture.origin);
  await navigate(page, '音乐榜单');
  await page.getByRole('alert').filter({ hasText: '当前页面暂时无法显示' }).waitFor();
  assert(await page.evaluate(() => document.querySelector('audio') === window.testAudio && !window.testAudio.paused));
  await navigate(page, '歌单');
  await page.getByRole('button', { name: '播放 晴天', exact: true }).waitFor();
  assert(await page.evaluate(() => document.querySelector('audio') === window.testAudio));
});

test('a failed version dialog can be dismissed or retried without replacing the player', { timeout: 30000 }, async t => {
  const { page, fixture } = await setup(t);
  let fail = true;
  await page.route('**/assets/desktop-features-*.js*', route => fail ? route.fulfill({ status: 503, contentType: 'text/javascript', body: '' }) : route.continue());
  await play(page, fixture.origin);
  await page.getByRole('button', { name: '打开正在播放', exact: true }).click();
  await page.getByRole('button', { name: '查看歌曲来源', exact: true }).click();
  await page.getByRole('button', { name: '选择播放版本', exact: true }).click();
  await page.getByRole('dialog',{name:'播放版本暂不可用',exact:true}).getByRole('alert').waitFor();
  assert(await page.evaluate(()=>document.querySelector('audio')===window.testAudio&&!window.testAudio.paused));
  fail = false;
  await page.getByRole('button', { name: '重试显示', exact: true }).click();
  await page.getByRole('dialog', { name: '播放版本', exact: true }).waitFor();
  assert(await page.evaluate(() => document.querySelector('audio') === window.testAudio));
});
