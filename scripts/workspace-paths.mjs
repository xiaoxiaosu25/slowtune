import { existsSync, lstatSync, readFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const sourceRoot = fileURLToPath(new URL('..', import.meta.url));
const within = (parent, file) => { const value = relative(parent, file); return value === '' || (!isAbsolute(value) && value !== '..' && !value.startsWith('..' + sep)); };

export function developmentPaths(root = sourceRoot) {
  root = resolve(root);
  const file = join(root, 'workspace.paths.json');
  if (!existsSync(file)) return { declared: false, build: join(root, 'local'), desktopBuild: join(root, 'local/desktop-build'), artifacts: join(root, 'local/artifacts'), testRuntime: join(root, 'local') };
  const config = JSON.parse(readFileSync(file, 'utf8'));
  if (config.schemaVersion !== 1 || config.project !== 'slowtune') throw new Error('慢听开发路径声明无效。');
  const paths = {};
  for (const name of ['studio', 'build', 'artifacts', 'testRuntime']) {
    if (typeof config.paths?.[name] !== 'string' || !config.paths[name].trim()) throw new Error('慢听开发路径缺少 ' + name);
    paths[name] = resolve(root, config.paths[name]);
  }
  for (const [name, category] of [['build', 'build'], ['artifacts', 'artifacts'], ['testRuntime', 'runtime']]) {
    if (!within(join(paths.studio, 'local', category, 'slowtune'), paths[name])) throw new Error('慢听开发路径超出本项目的 ' + category + ' 目录。');
  }
  return { declared: true, ...paths, desktopBuild: join(paths.build, 'desktop') };
}

export const desktopBuildDirectory = (root = sourceRoot) => developmentPaths(root).desktopBuild;

// Call before deleting or recreating build output. Refuse redirection through directory links.
export function assertDesktopBuildDirectory(target, root = sourceRoot) {
  target = resolve(target);
  if (target !== desktopBuildDirectory(root)) throw new Error('桌面构建目标与本项目路径声明不一致。');
  for (let current = target; ; current = dirname(current)) {
    if (lstatSync(current, { throwIfNoEntry: false })?.isSymbolicLink()) throw new Error('桌面构建目录及父目录不能使用目录链接。');
    if (dirname(current) === current) break;
  }
  return target;
}
