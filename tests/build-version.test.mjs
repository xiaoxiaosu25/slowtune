import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, utimesSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildArtifacts, captureBuild, buildState } from '../dist/server/build-state.js';

// The fixtures stand in for the two artifacts the server pins at startup. Timestamps are written
// explicitly so a comparison never depends on the clock granularity of the file system.
const root = fileURLToPath(new URL('..', import.meta.url));
const parent = resolve(root, '../local/artifacts/music-app/build-state');
mkdirSync(parent, { recursive: true });
const earlier = new Date(Date.now() - 60000), newer = new Date(Date.now() + 2000);
function artifactSet(dir, { server = earlier, client = earlier } = {}) {
  mkdirSync(join(dir, 'dist/server'), { recursive: true });
  mkdirSync(join(dir, 'dist/client'), { recursive: true });
  for (const [name, at] of [['server', server], ['client', client]]) {
    const path = join(dir, buildArtifacts[name]);
    writeFileSync(path, '// ' + name + '\n');
    utimesSync(path, at, at);
  }
  return dir;
}

test('A rebuild that lands after startup is reported as a stale running build', () => {
  const dir = artifactSet(mkdtempSync(join(parent, 'rebuild-')));
  const capture = captureBuild(dir);
  assert.equal(buildState(capture).stale, false, 'a service that started last always serves its own pair');
  assert.deepEqual(buildState(capture).changed, []);

  utimesSync(join(dir, buildArtifacts.client), newer, newer);
  const clientOnly = buildState(capture);
  assert.equal(clientOnly.stale, true);
  assert.deepEqual(clientOnly.changed, ['client'], 'only the artifact a rebuild replaced is named');
  assert(clientOnly.current.client > capture.builtAt.client && clientOnly.current.server === capture.builtAt.server, 'unchanged artifacts keep the timestamps captured at startup');

  utimesSync(join(dir, buildArtifacts.server), newer, newer);
  assert.deepEqual(buildState(capture).changed, ['server', 'client']);

  utimesSync(join(dir, buildArtifacts.server), earlier, earlier);
  assert.deepEqual(buildState(capture).changed, ['client'], 'an artifact restored to an older timestamp is not a newer build');
  assert.equal(buildState(capture).stale, true, 'each report reflects the directory instead of a cached verdict');
});

test('Missing artifacts are reported as a consistent build', () => {
  const empty = mkdtempSync(join(parent, 'empty-'));
  const capture = captureBuild(empty);
  assert.deepEqual(buildState(capture), { startedAt: capture.startedAt, stale: false, changed: [], started: { server: 0, client: 0 }, current: { server: 0, client: 0 } });

  const partial = mkdtempSync(join(parent, 'partial-'));
  mkdirSync(join(partial, 'dist/server'), { recursive: true });
  writeFileSync(join(partial, buildArtifacts.server), '// server\n');
  const partialCapture = captureBuild(partial);
  utimesSync(join(partial, buildArtifacts.server), newer, newer);
  assert.deepEqual(buildState(partialCapture).changed, ['server'], 'the absent page artifact is never a newer build');
  assert.equal(buildState(partialCapture).stale, true);
});
