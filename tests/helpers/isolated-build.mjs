import { registerHooks } from 'node:module';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
// Make every module import and spawned host use the explicitly selected build.
// With no override, npm test exercises the ordinary dist unchanged.
if (process.env.MUSIC_APP_TEST_BUILD && !globalThis[Symbol.for('slowtune-test-build')]) {
  globalThis[Symbol.for('slowtune-test-build')] = true;
  const original = new URL('../../dist/', import.meta.url).href;
  const selected = pathToFileURL(join(resolve(process.env.MUSIC_APP_TEST_BUILD), 'dist') + '/').href;
  registerHooks({ resolve(specifier, context, next) {
    const result = next(specifier, context);
    return result.url.startsWith(original) ? { ...result, url: selected + result.url.slice(original.length) } : result;
  } });
  const option = '--import=' + JSON.stringify(new URL(import.meta.url).href);
  if (!(process.env.NODE_OPTIONS ?? '').includes('isolated-build.mjs')) process.env.NODE_OPTIONS = ((process.env.NODE_OPTIONS ?? '') + ' ' + option).trim();
}
