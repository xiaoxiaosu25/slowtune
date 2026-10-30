import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Browser/native tests run serially so timing and window focus do not compete.
export const testGroups = {
  core: [
    'documentation', 'desktop-lyric-source', 'browser-config', 'workspace-paths', 'vendor',
    'lyric-timing', 'audio-quality', 'song-library', 'song-library-sync', 'recommendation',
    'desktop-continuity', 'desktop-playback-performance', 'playback-diagnostics', 'desktop-library-copy',
    'song-library-worker', 'desktop-storage', 'desktop-state', 'desktop-profile',
    'search-playback', 'desktop-lyric-match', 'desktop-media-policy', 'desktop-youtube-reuse',
    'lyrics', 'desktop-lyrics-progress', 'playlist-cover',
  ],
  browser: [
    'song-targets-desktop-ui', 'desktop-runtime-ui', 'desktop-feedback-ui', 'desktop-context-menu-ui', 'chart-cache-ui', 'playback-performance-ui',
    'playback', 'sleep-timer-ui', 'playback-retry', 'song-version-switch', 'playback-management-ui',
    'desktop-lyrics-ui', 'desktop-lyrics-progress-ui', 'lyrics-ui', 'lyrics-experience-ui', 'comments-ui', 'search-discovery-ui', 'mobile-layout-ui', 'mobile-lyrics-recovery-ui', 'mobile-settings-ui', 'mobile-browse-ui',
    'playlist-cover-ui', 'song-management-desktop-ui', 'desktop-library-layout-ui', 'mobile-secondary-ui', 'mobile-design-ui',
  ],
  desktop: ['desktop-host', 'desktop-lifecycle', 'desktop-state-recovery', 'desktop-restart'],
};

const suite = process.argv[2];
if (!Object.hasOwn(testGroups, suite)) {
  console.error('选择测试分组：core、browser 或 desktop。请先构建；desktop 另需 desktop:build。');
  process.exitCode = 1;
} else {
  const result = spawnSync(process.execPath, [
    '--import', './tests/helpers/isolated-build.mjs', '--test',
    '--test-concurrency=' + (suite === 'core' ? '4' : '1'),
    ...testGroups[suite].map(name => `tests/${name}.test.mjs`),
  ], { cwd: fileURLToPath(new URL('..', import.meta.url)), stdio: 'inherit', windowsHide: true });
  process.exitCode = result.status ?? 1;
}
