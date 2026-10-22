import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from './helpers/browser.mjs';
import { createSettingsFixture } from './helpers/settings-fixture.mjs';
import { openSettingsPage } from '../scripts/browser-ui.mjs';

const buildRoot = resolve(process.env.MUSIC_APP_TEST_BUILD ?? '.');
const { StartupSettingsStore } = await import(pathToFileURL(join(buildRoot, 'dist/server/startup-settings.js')));

test('settings automatically darken at night and access-policy edits can be saved', { timeout: 60000 }, async t => {
  const fixture = await createSettingsFixture();
  const store = new StartupSettingsStore(':memory:', 'settings-ui', 'fixture-current-code');
  const browser = await chromium.launch({ headless: true });
  t.after(async () => { await browser.close(); store.close(); await fixture.close(); });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, timezoneId: 'Asia/Hong_Kong', colorScheme: 'light' });
  const errors = [], writes = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/api/settings/access', async route => {
    if (route.request().method() === 'GET') return route.fulfill({ json: store.access() });
    const input = route.request().postDataJSON();
    writes.push(input);
    try { await route.fulfill({ json: store.changeAccess(input) }); }
    catch (error) { await route.fulfill({ status: 400, json: { error: { code: error.code } } }); }
  });
  await page.route(/^https:\/\//, route => route.abort());
  await page.clock.install({ time: new Date('2026-10-15T17:59:00+08:00') });
  await page.goto(fixture.base);
  await openSettingsPage(page);

  await t.test('open pages switch at both time boundaries, restore at night and retain manual choices', async () => {
    const mode = page.getByRole('group', { name: '明暗模式', exact: true });
    assert.equal(await page.locator('html').getAttribute('data-theme'), 'light');
    await page.clock.fastForward(60000);
    await page.waitForFunction(() => document.documentElement.dataset.theme === 'dark');
    assert.equal(await mode.getByRole('button', { name: '跟随系统', exact: true }).getAttribute('aria-pressed'), 'true');
    await page.reload();
    await page.locator('.app').waitFor();
    assert.equal(await page.locator('html').getAttribute('data-theme'), 'dark');
    await openSettingsPage(page);
    await page.clock.fastForward(12 * 60 * 60 * 1000);
    await page.waitForFunction(() => document.documentElement.dataset.theme === 'light');
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.waitForFunction(() => document.documentElement.dataset.theme === 'dark');
    await mode.getByRole('button', { name: '白天', exact: true }).click();
    await page.clock.fastForward(12 * 60 * 60 * 1000);
    assert.equal(await page.locator('html').getAttribute('data-theme'), 'light');
    await mode.getByRole('button', { name: '跟随系统', exact: true }).click();
    await page.waitForFunction(() => document.documentElement.dataset.theme === 'dark');
  });

  await t.test('checkbox edits enable saving, require the current code, and persist in both directions', async () => {
    await page.locator('.settings-nav').getByRole('button', { name: '启动与访问', exact: true }).click();
    const panel = page.locator('[data-settings-section="access"]');
    const toggle = panel.getByLabel('进入时验证访问码');
    const current = panel.getByLabel('当前访问码', { exact: true });
    const save = panel.getByRole('button', { name: '保存访问设置', exact: true });
    const saved = panel.getByText('访问设置已保存。', { exact: false });
    await toggle.waitFor();
    assert(await toggle.isChecked());
    assert(await save.isDisabled());
    await toggle.uncheck();
    assert(await save.isEnabled(), 'changing just the checkbox must enable saving');
    await panel.getByText('有未保存的修改。', { exact: false }).waitFor();
    await save.click();
    assert.equal(writes.length, 0, 'missing current code never reaches the service');
    assert(await current.evaluate(input => input === document.activeElement && input.validity.valueMissing));
    await current.fill('wrong-code');
    await save.click();
    await panel.getByRole('alert').waitFor();
    assert.match(await panel.getByRole('alert').innerText(), /当前访问码不正确/);
    assert.equal(store.access().authenticationRequired, true);
    assert.equal(await toggle.isChecked(), false, 'a failed save retains the draft');
    await current.fill('fixture-current-code');
    await save.click();
    await saved.waitFor();
    assert.equal(store.access().authenticationRequired, false);
    assert.equal(writes.at(-1).newAccessKey, undefined, 'changing policy does not require a new code');
    assert.equal(await current.inputValue(), '');
    assert(await save.isDisabled());
    await page.reload();
    await openSettingsPage(page, '启动与访问');
    assert.equal(await toggle.isChecked(), false, 'a reload restores the saved policy');
    await toggle.check();
    assert(await save.isEnabled(), 're-enabling verification also enables saving');
    await current.fill('fixture-current-code');
    await save.click();
    await saved.waitFor();
    assert.equal(store.access().authenticationRequired, true);
    await toggle.uncheck();
    await panel.getByRole('button', { name: '取消修改', exact: true }).click();
    assert(await toggle.isChecked());
    assert(await save.isDisabled());

    await current.fill('fixture-current-code');
    await panel.getByLabel('新访问码（不修改可留空）', { exact: true }).fill('fixture-replacement-code');
    await panel.getByLabel('再次输入新访问码', { exact: true }).fill('fixture-replacement-code');
    await save.click();
    await saved.waitFor();
    assert(store.verify('fixture-replacement-code'));
    assert.equal(store.verify('fixture-current-code'), false);

    const artifacts = resolve('local/verification/settings-preferences');
    mkdirSync(artifacts, { recursive: true });
    for (const width of [1440, 320]) {
      await page.setViewportSize({ width, height: 1000 });
      await toggle.uncheck();
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth), false);
      await page.screenshot({ path: join(artifacts, `access-${width}.png`), fullPage: true });
      await panel.getByRole('button', { name: '取消修改', exact: true }).click();
    }
  });
  assert.deepEqual(errors, []);
});
