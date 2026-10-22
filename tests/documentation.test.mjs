import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs, { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { checkDocumentation, checkLocalLinks, collectRoutes, generateDocumentation, parseMarkdown, parseRouteSource } from '../scripts/documentation.mjs';

const project = fileURLToPath(new URL('..', import.meta.url));
function put(root, name, value) { mkdirSync(dirname(join(root, name)), { recursive: true }); writeFileSync(join(root, name), value); }
function get(root, name) { return readFileSync(join(root, name), 'utf8'); }
function putJSON(root, name, value) { put(root, name, JSON.stringify(value, null, 2) + '\n'); }
function edit(root, name, change) { put(root, name, change(get(root, name))); }
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'slowtune-docs-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const dependencies = { '@studio/music-sources': 'file:vendor/sources.tgz' };
  putJSON(root, 'package.json', { name: 'docs-fixture', version: '1.0.0', engines: { node: '>=24.15.0' }, scripts: { start: 'node scripts/start.mjs' }, dependencies });
  putJSON(root, 'package-lock.json', { packages: { '': { dependencies }, 'node_modules/@studio/music-sources': { version: '1.0.0', resolved: 'file:vendor/sources.tgz' } } });
  putJSON(root, 'node_modules/@studio/music-sources/package.json', { name: '@studio/music-sources', version: '1.0.0', exports: { './service': { import: './dist/service.js' } } });
  put(root, 'node_modules/@studio/music-sources/dist/service.js', "import { Hono } from 'hono';\nexport function createMusicService(){const app=new Hono();app.get('/v1/handshake',c=>c.json({}));app.get('/v1/media/:id',c=>c.body(''));app.on('HEAD','/v1/media/:id',c=>c.body(null));return app;}\n");
  put(root, 'server/index.ts', "import { Hono } from 'hono';\nimport { createMusicService } from '@studio/music-sources/service';\nconst app=new Hono();app.get('/api/a',c=>c.json({}));app.all('/v1/*',c=>createMusicService().fetch(c.req.raw));\n");
  put(root, 'server/song-library-http.ts', "import { Hono } from 'hono';\nexport function createSongLibraryRouter(){const app=new Hono();app.get('/',c=>c.json({}));app.all('*',c=>c.body(null,404));return app;}\n");
  putJSON(root, 'vendor/provenance.json', { entries: [{ file: 'sources.tgz' }] });
  put(root, 'vendor/sources.tgz', 'fixture artifact');
  put(root, 'src/fixture.ts', 'export const fixture = true;');
  put(root, '项目说明.md', '# 项目\n\n[文档](docs/文档导航.md)\n');
  put(root, '第三方声明.md', '# 第三方\n');
  put(root, 'docs/文档导航.md', '# 文档导航\n\n[接口](开发/接口说明.md)\n\n[运行](运维/运行维护.md)\n\n[依赖](参考/依赖清单.md)\n\n源码链接仅适用于源码工作区。\n');
  put(root, 'docs/开发/接口说明.md', '# 接口说明\n\n人工说明保持。\n\n[源码](../../src/fixture.ts)\n\n[源码目录](../../src)\n\n<!-- generated:routes:start -->\n<!-- generated:routes:end -->\n\n| 方法 | 路径 | 请求 | 响应 |\n| --- | --- | --- | --- |\n| GET | `/api/a` | 无 | 对象 |\n| GET | `/v1/handshake` | 无 | 对象 |\n| GET | `/v1/media/:id` | ID | 字节 |\n| HEAD | `/v1/media/:id` | ID | 响应头 |\n| GET | `/api/song-library` | 无 | 对象 |\n');
  put(root, 'docs/运维/运行维护.md', '# 运行维护\n\n<!-- generated:commands:start -->\n<!-- generated:commands:end -->\n');
  put(root, 'docs/参考/依赖清单.md', '# 依赖清单\n\n<!-- generated:dependencies:start -->\n<!-- generated:dependencies:end -->\n');
  generateDocumentation(root);
  return root;
}

test('Generation is deterministic, preserves prose, and checks never write', t => {
  const root = fixture(t);
  const writes = t.mock.method(fs, 'writeFileSync', () => { throw new Error('Unexpected documentation write'); });
  syncBuiltinESMExports();
  try {
    assert.deepEqual(checkDocumentation(root), []);
    assert.equal(writes.mock.callCount(), 0, 'documentation checks must be read-only');
    generateDocumentation(root);
    assert.equal(writes.mock.callCount(), 0, 'unchanged generation must not write');
  } finally {
    writes.mock.restore();
    syncBuiltinESMExports();
  }
  assert.match(get(root, 'docs/开发/接口说明.md'), /人工说明保持/);
  assert(!get(root, 'docs/参考/依赖清单.md').includes(root));
});

test('A new route requires regeneration and an actual request/response contract', t => {
  const root = fixture(t);
  edit(root, 'server/index.ts', source => source + "app.post('/api/new',c=>c.json({}));\n");
  let errors = checkDocumentation(root);
  assert(errors.some(error => error.includes('routes 区块已过期')));
  assert(errors.some(error => error.includes('缺少接口说明：POST /api/new')));
  generateDocumentation(root);
  assert(checkDocumentation(root).some(error => error.includes('缺少接口说明：POST /api/new')));
  edit(root, 'docs/开发/接口说明.md', source => source + '| POST | `/api/new` | 对象 | 对象 |\n');
  assert.deepEqual(checkDocumentation(root), []);
  edit(root, 'docs/开发/接口说明.md', source => source.replace('| POST | `/api/new` | 对象 | 对象 |', '| POST | `/api/new` | 对象 | |'));
  assert(checkDocumentation(root).some(error => error.includes('接口请求或响应说明缺失')));
});

test('Assembly follows real mounts; package HEAD declarations are included', t => {
  const root = fixture(t);
  let routes = collectRoutes(root).endpoints;
  assert.equal(routes.find(route => route.path === '/api/song-library').status.startsWith('独立模块'), true);
  assert(routes.some(route => route.method === 'HEAD' && route.path === '/v1/media/:id'));
  assert(collectRoutes(root).gateways.some(route => route.path === '/api/song-library/*'));
  edit(root, 'server/index.ts', source => source + "import { createSongLibraryRouter } from './song-library-http.js';\napp.route('/api/song-library',createSongLibraryRouter());\n");
  routes = collectRoutes(root).endpoints;
  assert.equal(routes.filter(route => route.path === '/api/song-library').length, 1);
  assert.equal(routes.find(route => route.path === '/api/song-library').status, '已装配');
  assert(checkDocumentation(root).some(error => error.includes('区块已过期')));
});

test('Unknown dynamic declarations fail visibly rather than disappearing', () => {
  const parsed = parseRouteSource("import { Hono } from 'hono';const app=new Hono();app.get(computedPath,handler);app.route('/api',unknownRouter);");
  assert.equal(parsed.errors.length, 2);
  const on = parseRouteSource("import { Hono } from 'hono';const app=new Hono();app.on(['GET','HEAD'],'/api/test',handler);");
  assert.deepEqual(on.routes.map(route => route.method), ['GET', 'HEAD']);
});

test('Dependency versions and commands drift; missing provenance is an error', t => {
  const root = fixture(t);
  const pkg = JSON.parse(get(root, 'package.json')); pkg.scripts.start = 'node scripts/start.mjs --no-open'; putJSON(root, 'package.json', pkg);
  assert(checkDocumentation(root).some(error => error.includes('commands 区块已过期')));
  generateDocumentation(root);
  const lock = JSON.parse(get(root, 'package-lock.json')); lock.packages['node_modules/@studio/music-sources'].version = '1.0.1'; putJSON(root, 'package-lock.json', lock);
  assert(checkDocumentation(root).some(error => error.includes('已安装版本与锁文件不一致')));
  const installed = JSON.parse(get(root, 'node_modules/@studio/music-sources/package.json')); installed.version = '1.0.1'; putJSON(root, 'node_modules/@studio/music-sources/package.json', installed);
  assert(checkDocumentation(root).some(error => error.includes('dependencies 区块已过期')));
  putJSON(root, 'vendor/provenance.json', { entries: [] });
  assert(checkDocumentation(root).some(error => error.includes('缺少当前固定制品或来源记录')));
});

test('Markdown checks resolve reference links, Chinese/repeated anchors and ignore code fences', t => {
  const root = fixture(t);
  edit(root, 'docs/运维/运行维护.md', source => source + '\n## 使用配置\n\n## 使用配置\n\n[正确][配置]\n\n[配置]: #使用配置-1\n\n```md\n[示例](不存在.md)\n```\n');
  assert.deepEqual(checkDocumentation(root), []);
  edit(root, 'docs/运维/运行维护.md', source => source + '\n[失效](#没有这个标题)\n\n[丢失](丢失.md)\n');
  const errors = checkDocumentation(root);
  assert(errors.some(error => error.includes('章节不存在')));
  assert(errors.some(error => error.includes('链接目标不存在')));
  put(root, 'docs/产品/遗漏.md', '# 遗漏\n');
  assert(checkDocumentation(root).some(error => error.includes('未列入 docs/文档导航.md')));
  assert.deepEqual([...parseMarkdown('# 相同\n\n# 相同\n').anchors], ['相同', '相同-1']);
  put(root, 'AGENTS.md', '# Rules\n\n[Outside](../../platform/README.md)\n');
  assert(checkLocalLinks(root).some(error => error.includes('AGENTS.md') && error.includes('越出项目')));
});

test('Release packages final docs and rejects broken navigation before creating output', t => {
  const root = fixture(t);
  for (const file of ['dist/client/index.html', 'dist/server/index.js', 'start.cmd', '服务启动.cmd', '一键启动.cmd', 'stop.cmd', 'scripts/start.mjs', 'scripts/launch.mjs', 'scripts/control.mjs', 'scripts/reset-access.mjs', 'scripts/instance-path.mjs']) put(root, file, 'fixture');
  put(root, 'start.cmd', 'desktop entry'); put(root, '服务启动.cmd', 'service entry');
  putJSON(root, 'config.example.json', { example: true });
  putJSON(root, 'config.local.json', { private: 'must-not-ship' });
  putJSON(root, 'workspace.paths.json', { schemaVersion: 1, project: 'slowtune' });
  put(root, 'AGENTS.md', '# 项目协作准则\n');
  edit(root, 'docs/运维/运行维护.md', source => source + '\n[开发路径](../../workspace.paths.json)\n\n[协作规则](../../AGENTS.md)\n');
  assert.deepEqual(checkDocumentation(root), []);
  const target = join(root, 'release');
  const run = output => spawnSync(process.execPath, [join(project, 'scripts/package-release.mjs')], { env: { ...process.env, MUSIC_APP_RELEASE_SOURCE: root, MUSIC_APP_RELEASE_DIRECTORY: output }, encoding: 'utf8', windowsHide: true });
  const result = run(target);
  assert.equal(result.status, 0, result.stderr);
  assert(existsSync(join(target, 'docs/文档导航.md')));
  assert(!existsSync(join(target, 'config.local.json')));
  assert(!existsSync(join(target, 'node_modules')));
  assert(!existsSync(join(target, 'workspace.paths.json')), 'standalone runtime deliveries omit development-only paths');
  assert.equal(existsSync(join(target, 'start.cmd')), false, 'internal service deliveries do not add public CMD entries');
  assert.deepEqual(checkLocalLinks(target, { delivery: true }), []);
  const manifest = JSON.parse(get(target, 'delivery.json'));
  assert(manifest.files.some(file => file.path === 'docs/开发/接口说明.md'));
  edit(root, 'docs/文档导航.md', source => source + '\n[失效](不存在.md)\n');
  const rejected = join(root, 'rejected');
  const failure = run(rejected);
  assert.notEqual(failure.status, 0);
  assert.match(failure.stderr, /链接目标不存在/);
  assert(!existsSync(rejected));
});

test('Build checks documentation before generating product artifacts', () => {
  const pkg = JSON.parse(get(project, 'package.json'));
  assert(pkg.scripts.build.startsWith('npm run docs:check && '));
});
