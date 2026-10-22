import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { publicSourceFiles } from './public-source.mjs';

const generatedNotices = ['notices.json', 'THIRD-PARTY-NOTICES.txt', 'PROJECT-LICENSE.txt', 'PROJECT-NOTICE.txt'];

export function publicRepositoryErrors(root, tracked) {
  const allowed = new Set([...publicSourceFiles(root), ...generatedNotices.map(name => 'public/legal/' + name)]);
  return tracked.filter(file => !allowed.has(file)).map(file => 'Tracked file is outside public source inputs: ' + file);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = fileURLToPath(new URL('..', import.meta.url));
  const tracked = execFileSync('git', ['ls-files', '--cached', '-z'], { cwd: root, encoding: 'utf8', windowsHide: true }).split('\0').filter(Boolean);
  const errors = publicRepositoryErrors(root, tracked);
  if (errors.length) throw new Error(errors.join('\n'));
  console.log('Tracked repository files match public source inputs.');
}
