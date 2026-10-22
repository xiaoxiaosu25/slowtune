import { test } from 'node:test';
import assert from 'node:assert/strict';
import { browserOptions } from './helpers/browser.mjs';

test('browser defaults use Edge discovery and preserve launch flags', () => {
  assert.deepEqual(browserOptions({ headless: true, args: ['--mute-audio'] }, {}), { headless: true, args: ['--mute-audio'], channel: 'msedge' });
});

test('an explicit browser overrides both channel and executable defaults', () => {
  const options = browserOptions({ channel: 'msedge', executablePath: 'old.exe', headless: true }, { MUSIC_APP_BROWSER: ' D:/tools/chromium.exe ' });
  assert.deepEqual(options, { headless: true, executablePath: 'D:/tools/chromium.exe' });
  assert.deepEqual(browserOptions({ executablePath: 'custom.exe' }, {}), { executablePath: 'custom.exe' });
});
