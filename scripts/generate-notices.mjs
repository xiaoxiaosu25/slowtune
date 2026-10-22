import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateLyricSource } from './generate-lyric-source.mjs';

// Package metadata and the installed license texts are the source of truth.
// Keep this deterministic so a dependency update produces a reviewable diff.
export function generateNotices(root = resolve(dirname(fileURLToPath(import.meta.url)), '..')) {
  const app = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  const lock = JSON.parse(readFileSync(join(root, 'package-lock.json'), 'utf8'));
  const purposes = {
    '@applemusic-like-lyrics/core': '桌面沉浸歌词渲染（按需加载）',
    '@hono/node-server': 'Node.js HTTP 服务', '@phosphor-icons/react': '界面图标',
    hono: '服务路由与媒体接口', qrcode: '在浏览器内生成登录二维码',
    react: '界面组件', 'react-dom': '浏览器界面渲染',
    'youtubei.js': 'YouTube 目录、搜索、作者内容与评论接入',
  };
  const entries = [], missing = [];
  for (const [location, record] of Object.entries(lock.packages)) {
    if (!location || record.dev || !location.includes('node_modules/')) continue;
    const directory = join(root, location);
    if (!existsSync(join(directory, 'package.json'))) {
      if (record.optional) continue;
      throw new Error(`Missing runtime dependency: ${location}`);
    }
    const pkg = JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8'));
    if (pkg.version !== record.version) throw new Error(`Installed dependency differs from lockfile: ${pkg.name}`);
    // Our own packages are implementation details, not third-party attributions.
    if (pkg.name.startsWith('@studio/')) continue;
    const texts = readdirSync(directory, { withFileTypes: true })
      .filter(entry => entry.isFile() && /^(licen[cs]e|copying|notice|third[-_]party)(?:[._-]|$)/i.test(entry.name))
      .sort((a, b) => a.name.localeCompare(b.name, 'en'))
      .map(entry => ({ name: entry.name, text: readFileSync(join(directory, entry.name), 'utf8') }));
    const supplement = join(root, 'legal/upstream', pkg.name.replaceAll('/', '__') + '@' + pkg.version);
    if (existsSync(supplement)) for (const name of readdirSync(supplement).sort()) {
      if (/^(licen[cs]e|copying|notice)(?:[._-]|$)/i.test(name)) texts.push({name, text:readFileSync(join(supplement, name), 'utf8')});
    }
    if (!texts.some(file => /^(licen[cs]e|copying)/i.test(file.name))) missing.push(`${pkg.name}@${pkg.version}`);
    const repository = typeof pkg.repository === 'string' ? pkg.repository : pkg.repository?.url;
    const source = repository?.replace(/^git\+/, '').replace(/\.git$/, '');
    const license = typeof pkg.license === 'string' ? pkg.license : record.license ?? null;
    entries.push({ name: pkg.name, version: pkg.version, license,
      purpose: purposes[pkg.name] ?? '运行依赖',
      ...(source?.startsWith('https://') ? { source } : {}),
      texts });
  }
  if (missing.length) throw new Error(`Missing upstream license texts: ${missing.join(', ')}`);
  entries.push({ name: 'Noto Sans SC', version: '随应用提供的本地字体子集', license: 'OFL-1.1',
    purpose: '中文界面字体', source: 'https://github.com/notofonts/noto-cjk',
    texts: [{ name: 'sans-OFL.txt', text: readFileSync(join(root, 'public/fonts/sans-OFL.txt'), 'utf8') }] });
  entries.push({ name: 'Noto Serif SC', version: '随应用提供的本地字体子集', license: 'OFL-1.1',
    purpose: '随应用保留的字体资源', source: 'https://github.com/notofonts/noto-cjk',
    texts: [{ name: 'serif-OFL.txt', text: readFileSync(join(root, 'public/fonts/serif-OFL.txt'), 'utf8') }] });
  entries.sort((a, b) => a.name.localeCompare(b.name, 'en') || a.version.localeCompare(b.version, 'en'));
  const manifest = { schema: 1, appVersion: app.version, entries };
  const output = join(root, 'public/legal');
  mkdirSync(output, { recursive: true });
  for (const [source, destination] of [['LICENSE', 'PROJECT-LICENSE.txt'], ['NOTICE', 'PROJECT-NOTICE.txt']]) {
    if (existsSync(join(root, source))) copyFileSync(join(root, source), join(output, destination));
  }
  writeFileSync(join(output, 'notices.json'), JSON.stringify(manifest, null, 2) + '\n');
  writeFileSync(join(output, 'THIRD-PARTY-NOTICES.txt'), [
    `慢听 ${app.version} — 随应用分发的第三方材料`,
    '本文件列出应用使用的第三方软件与字体，保留其原版权及许可文本。外部 yt-dlp 工具的许可请参阅实际安装的版本及发行物。',
    ...entries.map(entry => [
      `${entry.name} — ${entry.version}`, `用途：${entry.purpose}`,
      `许可证：${entry.license ?? '未声明；不应视作开源授权'}`, entry.source ?? '',
      ...entry.texts.map(file => `${file.name}\n\n${file.text}`),
    ].filter(Boolean).join('\n\n')),
  ].join('\n\n' + '='.repeat(72) + '\n\n') + '\n');
  return manifest;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = generateNotices();
  generateLyricSource(resolve(dirname(fileURLToPath(import.meta.url)), '..'));
  console.log(`Generated offline notices for ${result.entries.length} components.`);
}
