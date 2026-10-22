import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const result = spawnSync(process.execPath, ['--test', 'tests/song-management-performance-ui.test.mjs'], {
  cwd: fileURLToPath(new URL('..', import.meta.url)),
  env: { ...process.env, MUSIC_APP_PERF_VERIFY: '1' }, stdio: 'inherit',
});
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
