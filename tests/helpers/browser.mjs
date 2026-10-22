import { chromium as browserType } from 'playwright-core';

export function browserOptions(options = {}, env = process.env) {
  const { executablePath, channel, ...rest } = options;
  const selected = env.MUSIC_APP_BROWSER?.trim() || executablePath;
  return selected ? { ...rest, executablePath: selected } : { ...rest, channel: channel ?? 'msedge' };
}

export const chromium = {
  launch(options) { return browserType.launch(browserOptions(options)); },
};
