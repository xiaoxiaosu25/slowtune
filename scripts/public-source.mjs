import { existsSync, lstatSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

// Public documentation is opt-in. Author workspace instructions and task notes
// must not become public merely because they live beside the product sources.
export const publicDocuments = [
  'docs/文档导航.md',
  'docs/产品/产品功能.md', 'docs/产品/启动与访问.md', 'docs/产品/当前限制.md',
  'docs/开发/开发约定.md', 'docs/开发/开源与协作.md',
  'docs/开发/接口说明.md', 'docs/开发/架构与数据.md',
  'docs/开发/界面规范.md', 'docs/开发/验证规范.md',
  'docs/运维/运行维护.md',
  'docs/参考/依赖清单.md', 'docs/参考/素材与来源.md',
];

// Keep the README's curated product screenshots in source exports as well.
export const publicDocumentAssets = [
  'docs/images/player.jpg', 'docs/images/charts.jpg',
];

export function publicSourceFiles(root) {
  const files = [
    'README.md', 'CONTRIBUTING.md', 'LICENSE', 'NOTICE', 'package.json', 'package-lock.json',
    'index.html', 'vite.config.ts', 'tsconfig.json', 'tsconfig.server.json',
    'config.example.json', '.gitignore', '.gitattributes', '第三方声明.md',
    '一键启动.cmd', 'public/theme-init.js', ...publicDocuments, ...publicDocumentAssets,
  ].filter(path => existsSync(join(root, path)));
  const privateName = /^(?:\.git|node_modules|maintainer|data|runtime|local|artifacts|dist|test-results|coverage|playwright-report)$|^\.env(?:\.|$)|\.local\.|\.(?:log|pem|key|sqlite(?:-wal|-shm)?)$/i;
  function walk(path) {
    if (!lstatSync(join(root, path)).isDirectory()) throw new Error('Public source directory is not a regular directory: ' + path);
    for (const entry of readdirSync(join(root, path), { withFileTypes: true })) {
      const child = path + '/' + entry.name;
      if (privateName.test(entry.name)) throw new Error('Private or generated file in public source directory: ' + child);
      if (entry.isSymbolicLink()) throw new Error('Public source refuses links: ' + child);
      if (entry.isDirectory()) walk(child);
      else if (entry.isFile()) files.push(child);
      else throw new Error('Public source requires regular files: ' + child);
    }
  }
  for (const path of ['.github', 'src', 'server', 'scripts', 'tests', 'vendor', 'legal', 'public/assets', 'public/fonts', 'desktop']) {
    if (existsSync(join(root, path))) walk(path);
  }
  for (const path of files) if (!lstatSync(join(root, path)).isFile()) throw new Error('Public source requires regular files: ' + path);
  return [...new Set(files)].sort();
}
