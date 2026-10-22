import { cpSync, mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { packager } from '@electron/packager';
import { iconIco } from '../desktop/icon.mjs';
import { developmentPaths } from './workspace-paths.mjs';

if (process.platform !== 'win32') throw new Error('当前桌面交付只支持 Windows 构建与验证。');
const root = fileURLToPath(new URL('..', import.meta.url)), app = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const label = `slowtune-desktop-${app.version}-${new Date().toISOString().replace(/[:.]/g, '-')}`;
const locations = developmentPaths(root);
const stage = join(locations.build, 'desktop-packaging', label), output = join(locations.artifacts, label);
mkdirSync(stage, { recursive: true }); mkdirSync(dirname(output), { recursive: true }); mkdirSync(output, { recursive: false });
const application = join(stage, 'app'), service = join(stage, 'service'), runtime = join(stage, 'runtime');
cpSync(join(root, 'desktop'), application, { recursive: true });
writeFileSync(join(application, 'package.json'), JSON.stringify({ ...JSON.parse(readFileSync(join(application, 'package.json'), 'utf8')), version: app.version }, null, 2) + '\n');
mkdirSync(service); cpSync(join(locations.desktopBuild, 'dist'), join(service, 'dist'), { recursive: true });
cpSync(join(root, 'desktop/service.mjs'), join(service, 'desktop-service.mjs'));
for (const name of ['vendor', 'docs', 'README.md', 'LICENSE', 'NOTICE', 'package.json', 'package-lock.json', 'config.example.json', '第三方声明.md']) cpSync(join(root, name), join(service, name), { recursive: true });
mkdirSync(join(service, 'scripts'));
for (const name of ['start.mjs', 'launch.mjs', 'control.mjs', 'reset-access.mjs', 'instance-path.mjs']) cpSync(join(root, 'scripts', name), join(service, 'scripts', name));
const npm = join(dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js');
if (!existsSync(npm)) throw new Error('打包需使用含 npm 的普通 Node 安装。');
execFileSync(process.execPath, [npm, 'ci', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund'], { cwd: service, stdio: 'inherit', windowsHide: true });
// The ordinary Node runtime keeps node:sqlite and the existing service launcher
// independent of Electron's embedded Node and process.execPath semantics.
mkdirSync(runtime); cpSync(process.execPath, join(runtime, 'node.exe'));
const nodeLicense = ['LICENSE', 'LICENSE.txt'].map(name => join(dirname(process.execPath), name)).find(existsSync);
if (nodeLicense) cpSync(nodeLicense, join(runtime, 'LICENSE.txt'));
else {
  const response = await fetch(`https://raw.githubusercontent.com/nodejs/node/v${process.versions.node}/LICENSE`, { signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error('未取得所附 Node 精确版本的官方许可，未生成不完整交付。');
  const license = await response.text();
  if (!license.includes('Node.js') || !license.includes('MIT')) throw new Error('Node 许可材料格式异常。');
  writeFileSync(join(runtime, 'LICENSE.txt'), license);
}
const icon = join(stage, 'slowtune.ico'); writeFileSync(icon, iconIco());
const paths = await packager({ dir: application, out: output, name: 'SlowTune', executableName: 'SlowTune', platform: 'win32', arch: process.arch, electronVersion: app.devDependencies.electron, appVersion: app.version, asar: true, icon, extraResource: [service, runtime], overwrite: false, prune: false, win32metadata: { CompanyName: 'SlowTune', FileDescription: '慢听桌面播放器', ProductName: '慢听 SlowTune' } });
const packaged = paths[0];
writeFileSync(join(packaged, '使用说明.txt'), '慢听 SlowTune Windows 桌面版\r\n\r\n双击 SlowTune.exe，在同一窗口显示欢迎页并自动进入，无需选择配置、输入访问码或另装 Node。重复打开唤起原窗口。\r\n所有资料与偏好位于 EXE 同级 data；更新程序时保留它，完整备份请先退出再复制整个 data。请放在当前用户可写的位置。\r\n设置 → 本地资料可打开资料和日志文件夹，或使用歌单备份恢复。换电脑或 Windows 用户后，B站账号可能需要重新登录。\r\n桌面与服务版独立运行，各自保存资料。关闭主窗口或退出慢听会停止自己的内部进程；最小化继续播放。\r\n更多播放选项 → 桌面悬浮歌词；托盘可开关、解锁和重置位置。\r\n当前不包含自动更新、签名或独立移动应用。YouTube 默认关闭，启用需另外配置取源工具。\r\n');
writeFileSync(join(packaged, 'desktop-delivery.json'), JSON.stringify({ product: 'SlowTune', version: app.version, electron: app.devDependencies.electron, node: process.versions.node, platform: process.platform, arch: process.arch, unsigned: true }, null, 2) + '\n');
const zip = join(output, basename(packaged) + '.zip');
const psQuote = value => "'" + value.replaceAll("'", "''") + "'";
execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `Add-Type -AssemblyName System.IO.Compression.FileSystem; [System.IO.Compression.ZipFile]::CreateFromDirectory(${psQuote(packaged)}, ${psQuote(zip)}, [System.IO.Compression.CompressionLevel]::Fastest, $true)`], { windowsHide: true, stdio: 'inherit' });
console.log(JSON.stringify({ executable: join(packaged, 'SlowTune.exe'), zip }));
