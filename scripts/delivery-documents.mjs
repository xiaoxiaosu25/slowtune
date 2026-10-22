import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';

// Runtime documentation is a subset of the public source documentation.
export const deliveryDocuments = [
  'docs/产品/产品功能.md', 'docs/产品/启动与访问.md', 'docs/产品/当前限制.md',
  'docs/运维/运行维护.md', 'docs/参考/依赖清单.md', 'docs/参考/素材与来源.md',
];

export function copyDeliveryDocuments(root, target) {
  root = resolve(root); target = resolve(target);
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  const repository = (typeof pkg.repository === 'string' ? pkg.repository : pkg.repository?.url) ?? 'https://github.com/xiaoxiaosu25/slowtune';
  const base = repository.replace(/^git\+/, '').replace(/\.git$/, '') + '/blob/main/';
  const documents = deliveryDocuments.filter(file => existsSync(join(root, file)));
  for (const file of documents) {
    mkdirSync(dirname(join(target, file)), { recursive: true });
    copyFileSync(join(root, file), join(target, file));
  }
  mkdirSync(join(target, 'docs'), { recursive: true });
  writeFileSync(join(target, 'docs/文档导航.md'), [
    '# 运行文档', '',
    ...documents.map(file => `- [${file.slice(file.lastIndexOf('/') + 1, -3)}](${file.slice(5)})`),
    '', `开发与贡献说明见[在线源码](${base}CONTRIBUTING.md)。源码链接仅适用于源码工作区；运行包中的开发参考链接指向在线源码。`, '',
  ].join('\n'));
  writeFileSync(join(target, 'README.md'), [
    '# 慢听运行文件', '',
    'Windows 桌面版请从完整免安装目录双击 SlowTune.exe；程序自己的 data 目录用于保存资料。',
    '服务版需要兼容的 Node.js，在本目录安装生产依赖、建立私人配置后启动：', '',
    '```powershell', 'npm ci --omit=dev --ignore-scripts', 'node scripts/launch.mjs --no-open', '```', '',
    '运行与备份见[文档导航](docs/文档导航.md)，许可见[LICENSE](LICENSE)和[第三方声明](第三方声明.md)。',
    `源码开发与贡献见[在线仓库](${base}README.md)。`, '',
  ].join('\n'));

  // Keep links within the runtime package when available; point omitted
  // developer documents and source code to the public repository.
  for (const file of [...documents, '第三方声明.md', 'vendor/README.md']) {
    const destination = join(target, file);
    if (!existsSync(destination)) continue;
    const source = readFileSync(destination, 'utf8');
    const rewritten = source.replace(/(\]\(|^\[[^\]]+\]:\s*)([^\s)]+)(?=\)|\s|$)/gm, (match, prefix, href) => {
      if (/^(?:[a-z][a-z\d+.-]*:|\/\/|#)/i.test(href)) return match;
      const hash = href.indexOf('#'), path = hash < 0 ? href : href.slice(0, hash), fragment = hash < 0 ? '' : href.slice(hash);
      const name = relative(root, resolve(root, dirname(file), decodeURIComponent(path))).replaceAll('\\', '/');
      if (name.startsWith('../')) throw new Error('Delivery link escapes source: ' + href);
      if (existsSync(join(target, name))) return match;
      return prefix + base + name.split('/').map(encodeURIComponent).join('/') + fragment;
    });
    writeFileSync(destination, rewritten);
  }
  return ['README.md', 'docs/文档导航.md', ...documents];
}
