import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import ts from 'typescript';
import MarkdownIt from 'markdown-it';
import GithubSlugger from 'github-slugger';
import { mergePath } from 'hono/utils/url';

const markdown = new MarkdownIt({ html: true });
const methods = new Set(['get', 'post', 'put', 'patch', 'delete', 'head', 'options', 'all']);
const apiDocument = 'docs/开发/接口说明.md';
const slash = value => value.replaceAll('\\', '/');
const read = (root, file) => readFileSync(join(root, file), 'utf8');
const json = (root, file) => JSON.parse(read(root, file));
const cell = value => String(value).replaceAll('|', '\\|').replaceAll('\n', ' ');
const code = value => '`' + cell(value) + '`';
const literal = node => node && ts.isStringLiteralLike(node) ? node.text : undefined;
function visit(node, callback) { callback(node); ts.forEachChild(node, child => visit(child, callback)); }

/** Parse declarations only. Never import the service, its configuration or its lifecycle. */
export function parseRouteSource(source, file = 'routes.ts') {
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const imports = new Map(), variables = new Map(), receivers = new Set();
  for (const statement of ast.statements) {
    if (ts.isImportDeclaration(statement) && statement.importClause?.namedBindings && ts.isNamedImports(statement.importClause.namedBindings)) {
      for (const binding of statement.importClause.namedBindings.elements) imports.set(binding.name.text, { module: statement.moduleSpecifier.text, exported: (binding.propertyName ?? binding.name).text });
    }
  }
  visit(ast, node => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
      variables.set(node.name.text, node.initializer);
      if (ts.isNewExpression(node.initializer) && ts.isIdentifier(node.initializer.expression) && (imports.get(node.initializer.expression.text)?.exported === 'Hono')) receivers.add(node.name.text);
    }
  });
  const routes = [], mounts = [], forwarded = [], errors = [];
  visit(ast, node => {
    if (!ts.isCallExpression(node) || !ts.isPropertyAccessExpression(node.expression) || !ts.isIdentifier(node.expression.expression) || !receivers.has(node.expression.expression.text)) return;
    const method = node.expression.name.text;
    if (!methods.has(method) && method !== 'route' && method !== 'on') return;
    const path = literal(node.arguments[method === 'on' ? 1 : 0]);
    if (path === undefined) { errors.push(`${file}: 无法静态解析 ${method} 路径`); return; }
    if (method === 'route') {
      let router = node.arguments[1];
      if (router && ts.isIdentifier(router)) router = variables.get(router.text);
      const imported = router && ts.isCallExpression(router) && ts.isIdentifier(router.expression) ? imports.get(router.expression.text) : undefined;
      if (!imported) errors.push(`${file}: 无法静态解析挂载 ${path}，请扩展文档提取器`);
      else mounts.push({ path, ...imported });
      return;
    }
    const declaredMethods = method === 'on' ? (ts.isArrayLiteralExpression(node.arguments[0]) ? node.arguments[0].elements.map(literal) : [literal(node.arguments[0])]) : [method.toUpperCase()];
    if (declaredMethods.some(value => !value || !methods.has(value.toLowerCase()))) { errors.push(`${file}: 无法静态解析 on 方法`); return; }
    for (const declared of declaredMethods) routes.push({ method: declared.toUpperCase(), path, file });
    const handlers = node.arguments.slice(method === 'on' ? 2 : 1);
    for (const handler of handlers) visit(handler, child => {
      if (ts.isCallExpression(child) && ts.isIdentifier(child.expression)) {
        const imported = imports.get(child.expression.text);
        if (imported?.exported === 'createMusicService') forwarded.push({ gate: path, ...imported });
      }
    });
  });
  return { routes, mounts, forwarded, errors };
}

function moduleFile(root, from, module) {
  if (module.startsWith('.')) {
    const target = resolve(root, dirname(from), module);
    return slash(relative(root, target.replace(/\.js$/, '.ts')));
  }
  const parts = module.split('/'), packageName = parts[0].startsWith('@') ? parts.splice(0, 2).join('/') : parts.shift();
  const directory = 'node_modules/' + packageName;
  const pkg = json(root, directory + '/package.json');
  const entry = pkg.exports?.[parts.length ? './' + parts.join('/') : '.'];
  const path = typeof entry === 'string' ? entry : entry?.import;
  if (!path) throw new Error(`无法解析固定依赖导出：${module}`);
  return slash(join(directory, path));
}

export function collectRoutes(root) {
  const endpoints = [], gateways = [], errors = [], mounted = new Set(), seen = new Set();
  function collect(file, prefix = '', status = '已装配', detached = false) {
    const identity = `${file}:${prefix}`;
    if (seen.has(identity)) throw new Error(`循环或重复路由挂载：${identity}`);
    seen.add(identity); mounted.add(file);
    const parsed = parseRouteSource(read(root, file), file); errors.push(...parsed.errors);
    for (const route of parsed.routes) {
      const path = prefix ? mergePath(prefix, route.path) : route.path;
      if (!detached && !path.startsWith('/api/') && !path.startsWith('/internal/') && !path.startsWith('/v1/')) continue;
      const record = { ...route, path, status };
      if (route.method === 'ALL' || path.includes('*')) gateways.push(record);
      else endpoints.push(record);
    }
    for (const mount of parsed.mounts) collect(moduleFile(root, file, mount.module), prefix ? mergePath(prefix, mount.path) : mount.path, status, detached);
    for (const forward of parsed.forwarded) {
      if (forward.gate !== '/v1/*') errors.push(`${file}: 来源服务转发边界变化，请核对 ${forward.gate}`);
      collect(moduleFile(root, file, forward.module), '', status);
    }
  }
  collect('server/index.ts');
  const detachedFile = 'server/song-library-http.ts';
  if (!mounted.has(detachedFile) && existsSync(join(root, detachedFile))) collect(detachedFile, '/api/song-library', '独立模块，未装配；路径为拟挂载地址', true);
  const keys = new Set();
  for (const route of endpoints) {
    const key = `${route.method} ${route.path}`;
    if (keys.has(key)) errors.push(`重复接口：${key}`);
    keys.add(key);
  }
  if (errors.length) throw new Error(errors.join('\n'));
  const sort = (a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : a.method.localeCompare(b.method, 'en');
  return { endpoints: endpoints.sort(sort), gateways: gateways.sort(sort) };
}

function sourceLink(root, document, file) {
  if (file.startsWith('node_modules/')) {
    const name = file.split('/').slice(1, 3).join('/');
    const lock = json(root, 'package-lock.json').packages['node_modules/' + name];
    if (!lock?.resolved?.startsWith('file:vendor/')) throw new Error(`固定来源服务未使用 vendor 制品：${name}`);
    return `[固定包制品](${slash(relative(dirname(document), lock.resolved.slice(5)))})`;
  }
  return `[${file}](${slash(relative(dirname(document), file))})`;
}

function routeTable(root, routes) {
  return ['| 方法 | 路径 | 接入状态 | 实现 |', '| --- | --- | --- | --- |', ...routes.map(route => `| ${route.method} | ${code(route.path)} | ${route.status} | ${sourceLink(root, apiDocument, route.file)} |`)].join('\n');
}

export function generatedSections(root) {
  const routes = collectRoutes(root), pkg = json(root, 'package.json'), lock = json(root, 'package-lock.json'), provenance = json(root, 'vendor/provenance.json');
  const dependencies = [];
  for (const [kind, entries] of [['运行依赖', pkg.dependencies], ['开发依赖', pkg.devDependencies]]) {
    dependencies.push(`### ${kind}`, '', '| 包 | 声明 | 锁定版本 | 固定制品 |', '| --- | --- | --- | --- |');
    for (const [name, declaration] of Object.entries(entries ?? {}).sort(([a], [b]) => a.localeCompare(b, 'en'))) {
      const record = lock.packages?.['node_modules/' + name];
      if (!record || lock.packages['']?.[kind === '运行依赖' ? 'dependencies' : 'devDependencies']?.[name] !== declaration) throw new Error(`包清单与锁文件不一致：${name}`);
      const installed = json(root, `node_modules/${name}/package.json`);
      if (installed.version !== record.version) throw new Error(`已安装版本与锁文件不一致：${name}，请运行 npm ci`);
      let artifact = '—';
      if (name.startsWith('@studio/')) {
        const path = record.resolved?.startsWith('file:vendor/') ? record.resolved.slice(5) : undefined;
        if (!path || !existsSync(join(root, path)) || !provenance.entries.some(entry => entry.file === path.slice('vendor/'.length))) throw new Error(`缺少当前固定制品或来源记录：${name}`);
        artifact = `[${path.slice('vendor/'.length)}](../../${path})`;
      }
      dependencies.push(`| ${code(name)} | ${code(declaration)} | ${code(record.version)} | ${artifact} |`);
    }
    dependencies.push('');
  }
  const warning = '此区块由 `npm run docs:generate` 生成，禁止手动修改。';
  return [
    { file: apiDocument, id: 'routes', body: [warning, '', '### 当前可调用接口', '', routeTable(root, routes.endpoints.filter(r => r.status === '已装配')), '', '### 未装配的独立模块', '', routeTable(root, routes.endpoints.filter(r => r.status !== '已装配')), '', '### 转发与方法兜底', '', routeTable(root, routes.gateways), '', 'ALL 表示转发或兜底规则，不代表所有 HTTP 方法均有业务能力。GET 的 HEAD 行为沿用 Hono；媒体范围读取见下文。'].join('\n') },
    { file: 'docs/参考/依赖清单.md', id: 'dependencies', body: [warning, '', `Node 要求：${code(pkg.engines.node)}。产品版本：${code(pkg.version)}。`, '', ...dependencies].join('\n').trimEnd() },
    { file: 'docs/运维/运行维护.md', id: 'commands', body: [warning, '', '下表为源码工作区命令；文档生成、检查、测试和构建需要开发依赖，服务交付包只提供已有构建的运行入口。', '', '| 命令 | 实际执行 |', '| --- | --- |', ...Object.entries(pkg.scripts).sort(([a], [b]) => a.localeCompare(b, 'en')).map(([name, command]) => `| ${code('npm run ' + name)} | ${code(command)} |`)].join('\n') },
  ];
}

export function replaceSection(source, id, body) {
  const start = `<!-- generated:${id}:start -->`, end = `<!-- generated:${id}:end -->`;
  if (source.split(start).length !== 2 || source.split(end).length !== 2 || source.indexOf(start) > source.indexOf(end)) throw new Error(`生成区块 ${id} 缺失或重复`);
  const newline = source.includes('\r\n') ? '\r\n' : '\n';
  return source.slice(0, source.indexOf(start) + start.length) + newline + body.replaceAll('\n', newline) + newline + source.slice(source.indexOf(end));
}

export function generateDocumentation(root) {
  // Resolve every output before writing, so an invalid source cannot cause a partial update.
  const outputs = generatedSections(root).map(section => ({ file: section.file, value: replaceSection(read(root, section.file), section.id, section.body) }));
  for (const output of outputs) if (read(root, output.file) !== output.value) writeFileSync(join(root, output.file), output.value);
  return outputs.map(output => output.file);
}

function filesBelow(root, directory) {
  return readdirSync(join(root, directory), { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? filesBelow(root, `${directory}/${entry.name}`) : entry.name.endsWith('.md') ? [`${directory}/${entry.name}`] : []).sort();
}
const plain = token => token.children?.map(child => ['text', 'code_inline'].includes(child.type) ? child.content : child.type === 'softbreak' ? ' ' : '').join('') ?? token.content;
export function parseMarkdown(source) {
  const tokens = markdown.parse(source, {}), slugger = new GithubSlugger(), anchors = new Set(), links = [], contracts = [];
  let row, line = 1;
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (token.map) line = token.map[0] + 1;
    if (token.type === 'heading_open') anchors.add(slugger.slug(plain(tokens[i + 1])));
    if (token.type === 'tr_open') row = [];
    if (token.type === 'inline' && row) row.push(plain(token));
    if (token.type === 'tr_close') {
      if (row && /^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)$/.test(row[0] ?? '') && row[1]?.startsWith('/')) contracts.push({ key: `${row[0]} ${row[1]}`, complete: row.length >= 4 && !!row[2]?.trim() && !!row[3]?.trim() });
      row = undefined;
    }
    if (token.type === 'html_block') for (const match of token.content.matchAll(/\bid=["']([^"']+)["']/g)) anchors.add(match[1]);
    for (const child of token.children ?? []) {
      const target = child.type === 'link_open' ? child.attrGet('href') : child.type === 'image' ? child.attrGet('src') : undefined;
      if (target) links.push({ target, line });
    }
  }
  return { anchors, links, contracts };
}

export function checkLocalLinks(root, { delivery = false } = {}) {
  const publicEntries = ['README.md', 'vendor/README.md'].filter(file => existsSync(join(root, file)));
  const documents = [...publicEntries, '项目说明.md', '第三方声明.md', ...filesBelow(root, 'docs')], parsed = new Map(), errors = [];
  for (const file of documents) parsed.set(file, parseMarkdown(read(root, file)));
  const navigation = new Set(['docs/文档导航.md']);
  for (const [file, data] of parsed) for (const { target, line } of data.links) {
    if (/^[a-z][a-z\d+.-]*:/i.test(target) || target.startsWith('//')) continue;
    try {
      const hash = target.indexOf('#'), pathname = decodeURIComponent(hash < 0 ? target : target.slice(0, hash)), fragment = hash < 0 ? '' : decodeURIComponent(target.slice(hash + 1));
      const destination = pathname ? resolve(root, dirname(file), pathname) : join(root, file);
      const destinationName = slash(relative(root, destination));
      if (destinationName.startsWith('../') || pathname.startsWith('/') || /^[A-Za-z]:/.test(pathname)) { errors.push(`${file}:${line} 本地链接越出项目：${target}`); continue; }
      if (!existsSync(destination)) {
        const repositorySource = /^(src|server|tests|scripts|public|legal)(\/|$)/.test(destinationName) || /^(AGENTS\.md|workspace\.paths\.json|tsconfig[^/]*\.json|vite\.config\.ts)$/.test(destinationName);
        if (!(delivery && repositorySource)) errors.push(`${file}:${line} 链接目标不存在：${target}`);
        continue;
      }
      if (file === 'docs/文档导航.md' && destinationName.startsWith('docs/') && destinationName.endsWith('.md')) navigation.add(destinationName);
      if (fragment && destinationName.endsWith('.md')) {
        if (!parsed.has(destinationName)) parsed.set(destinationName, parseMarkdown(read(root, destinationName)));
        if (!parsed.get(destinationName).anchors.has(fragment)) errors.push(`${file}:${line} 章节不存在：${target}`);
      }
    } catch (error) { errors.push(`${file}:${line} 链接无效：${target} (${error.message})`); }
  }
  for (const file of documents.filter(file => file.startsWith('docs/'))) {
    if (!navigation.has(file)) errors.push(`${file} 未列入 docs/文档导航.md`);
    if (file !== 'docs/文档导航.md' && !/^docs\/(产品|开发|运维|计划|参考)\/[^/]+\.md$/.test(file)) errors.push(`${file} 不符合最终文档目录结构`);
  }
  if (delivery && !read(root, 'docs/文档导航.md').includes('源码链接仅适用于源码工作区')) errors.push('交付文档缺少源码链接适用范围说明');
  return errors;
}

export function checkDocumentation(root) {
  const errors = [];
  try {
    for (const section of generatedSections(root)) {
      const source = read(root, section.file);
      if (replaceSection(source, section.id, section.body) !== source) errors.push(`${section.file} 的 ${section.id} 区块已过期；运行 npm run docs:generate`);
    }
    const source = read(root, apiDocument).replace(/<!-- generated:routes:start -->[\s\S]*?<!-- generated:routes:end -->/, '');
    const contracts = parseMarkdown(source).contracts, expected = new Set(collectRoutes(root).endpoints.map(route => `${route.method} ${route.path}`)), documented = new Set();
    for (const contract of contracts) {
      if (documented.has(contract.key)) errors.push(`重复接口说明：${contract.key}`);
      documented.add(contract.key);
      if (!contract.complete) errors.push(`接口请求或响应说明缺失：${contract.key}`);
      if (!expected.has(contract.key)) errors.push(`接口说明已失效：${contract.key}`);
    }
    for (const key of expected) if (!documented.has(key)) errors.push(`缺少接口说明：${key}，请更新 ${apiDocument} 并运行 npm run docs:generate`);
  } catch (error) { errors.push(error.message); }
  try { errors.push(...checkLocalLinks(root)); } catch (error) { errors.push(error.message); }
  return errors;
}
