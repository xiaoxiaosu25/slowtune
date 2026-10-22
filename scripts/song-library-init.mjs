import { mkdir, realpath, rm } from 'node:fs/promises';
import { resolve, relative, dirname, join, isAbsolute } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/** Deliberately ignores private config. Rebuild is limited to this project's local/ tree. */
export async function initializeSongLibrary({ database, userSpace, reset = false, build } = {}) {
  const root = fileURLToPath(new URL('..', import.meta.url));
  if (typeof database !== 'string' || !database || typeof userSpace !== 'string' || !userSpace.trim()) throw new Error('Explicit --database and --user-space are required');
  const local = resolve(root, 'local'), target = resolve(root, database), within = relative(local, target);
  if (!within || within.startsWith('..') || isAbsolute(within) || !target.endsWith('.sqlite')) throw new Error('Database must be a .sqlite file under this project local/');
  await mkdir(local, { recursive: true });
  const realRoot = await realpath(root), realLocal = await realpath(local), localWithinRoot = relative(realRoot, realLocal);
  if (localWithinRoot.startsWith('..') || isAbsolute(localWithinRoot)) throw new Error('Database directory escapes local/');
  // Check the nearest existing ancestor BEFORE creating directories through a possible junction.
  let ancestor = dirname(target);
  while (true) {
    try {
      const physical = relative(realLocal, await realpath(ancestor));
      if (physical.startsWith('..') || isAbsolute(physical)) throw new Error('Database directory escapes local/');
      break;
    } catch (error) { if (error.code !== 'ENOENT') throw error; ancestor = dirname(ancestor); }
  }
  await mkdir(dirname(target), { recursive: true });
  const physical = relative(realLocal, await realpath(dirname(target)));
  if (physical.startsWith('..') || isAbsolute(physical)) throw new Error('Database directory escapes local/');
  if (!reset) {
    try { const realTarget = await realpath(target), check = relative(realLocal, realTarget); if (check.startsWith('..') || isAbsolute(check)) throw new Error('Database file escapes local/'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  if (reset) {
    // Each resolved target was checked; no recursive deletion and no configuration-derived path.
    for (const suffix of ['', '-wal', '-shm']) await rm(target + suffix, { force: true });
  }
  const moduleRoot = build ?? process.env.MUSIC_APP_TEST_BUILD ?? root;
  const { SongLibraryStore } = await import(pathToFileURL(join(moduleRoot, 'dist/server/song-library-store.js')));
  const store = new SongLibraryStore(target, userSpace);
  try { const state = store.read(); return { database: target, revision: state.revision, modelVersion: state.modelVersion }; }
  finally { store.close(); }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2), options = {};
    for (let i = 0; i < args.length; i++) {
      if (args[i] === '--reset') options.reset = true;
      else if (args[i] === '--database') options.database = args[++i];
      else if (args[i] === '--user-space') options.userSpace = args[++i];
      else throw new Error('Unknown option: ' + args[i]);
    }
    console.log(JSON.stringify(await initializeSongLibrary(options)));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
