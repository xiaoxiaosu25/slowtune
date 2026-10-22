import { copyFileSync, existsSync, lstatSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { publicSourceFiles } from './public-source.mjs';

// Export files only: no Git initialization, commit, upload or history copying.
export function exportPublicSource(root, target) {
  root = resolve(root); target = resolve(target);
  if (existsSync(target)) throw new Error('Export requires a new directory: ' + target);
  const files = [...publicSourceFiles(root), ...[
    'notices.json', 'THIRD-PARTY-NOTICES.txt', 'PROJECT-LICENSE.txt', 'PROJECT-NOTICE.txt',
  ].map(name => 'public/legal/' + name).filter(path => existsSync(join(root, path)))].sort();
  for (const path of files) if (!lstatSync(join(root, path)).isFile()) throw new Error('Public export requires regular files: ' + path);
  mkdirSync(target, { recursive: true });
  for (const path of files) {
    const destination = join(target, path);
    mkdirSync(dirname(destination), { recursive: true });
    copyFileSync(join(root, path), destination);
  }
  return files;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 3) throw new Error('Usage: node scripts/export-source.mjs <new-directory>');
  const root = fileURLToPath(new URL('..', import.meta.url));
  const target = resolve(process.argv[2]);
  const files = exportPublicSource(root, target);
  const { checkLocalLinks } = await import('./documentation.mjs');
  const errors = checkLocalLinks(target);
  if (errors.length) throw new Error('Exported documentation failed validation:\n' + errors.join('\n'));
  console.log(JSON.stringify({ directory: target, files: files.length }));
}
