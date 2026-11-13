// 样式变量检查：字号、圆角、颜色、层级和过渡时长统一取自 src/styles/tokens.css。
// 其他样式文件不写死 font-size／font／border-radius 中的 px 值、hex 颜色、正整数 z-index 和过渡时长；
// 遮罩渐变的颜色只表示透明度，url() 中的内容无法引用变量，均不计入。负 z-index 只用于在隔离容器内
// 把背景放到内容之后；keyframes 动画（加载旋转、唱片转动等内容动画）不计入时长检查。
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { controlViolations } from './check-controls.mjs';

const tokenFile = 'src/styles/tokens.css';
const sizedProperty = /^(font|font-size|border(-[a-z]+)*-radius)$/;
const maskProperty = /^(-webkit-)?mask(-image)?$/;
const transitionProperty = /^transition(-duration|-delay)?$/;
/** 设计变量的前缀；引用这些前缀的变量必须在 tokens.css 中定义。 */
const tokenReference = /var\(\s*(--(?:fs|lh|r|z|dur|ease|motion|shadow)-[a-z0-9-]+)/g;

/** 逐条列出声明（属性、值、行号）；注释先替换为等长空白以保留行号。 */
export function* declarations(text) {
  const css = text.replace(/\/\*[\s\S]*?\*\//g, comment => comment.replace(/[^\n]/g, ' '));
  let start = 0, depth = 0;
  for (let index = 0; index < css.length; index++) {
    const char = css[index];
    if (char === '"' || char === "'") {
      for (index++; index < css.length && css[index] !== char; index++) if (css[index] === '\\') index++;
      continue;
    }
    if (char === '(') depth++;
    else if (char === ')') depth = Math.max(0, depth - 1);
    else if (depth) continue;
    else if (char === '{') start = index + 1;
    else if (char === ';' || char === '}') {
      const segment = css.slice(start, index), colon = segment.indexOf(':'), offset = segment.search(/\S/);
      if (colon > 0 && offset >= 0 && segment[offset] !== '@') {
        const property = segment.slice(0, colon).trim().toLowerCase();
        if (/^(--)?[a-z][a-z0-9-]*$/.test(property)) {
          yield { property, value: segment.slice(colon + 1).trim(), line: css.slice(0, start + offset).split('\n').length };
        }
      }
      start = index + 1;
    }
  }
}

/** 变量文件中定义的设计变量名。 */
export function definedTokens(text) {
  return new Set([...declarations(text)].filter(({ property }) => property.startsWith('--')).map(({ property }) => property));
}

/** 返回变量文件自身的问题：字号与圆角按用途命名，不再按数值命名。 */
export function tokenFileViolations(file, text) {
  return [...declarations(text)].filter(({ property }) => /^--(fs|r)-\d+$/.test(property))
    .map(({ property, line }) => `${file}:${line} ${property} 按数值命名；请按用途命名`);
}

/** 返回一个样式文件中的写死值；传入变量表时同时检查未定义的设计变量。 */
export function fileViolations(file, text, tokens) {
  const found = [];
  for (const { property, value, line } of declarations(text)) {
    const plain = value.replace(/url\([^)]*\)/g, 'url()');
    if (sizedProperty.test(property) && /(^|[^\w.-])\d*\.?\d+px\b/.test(plain)) found.push(`${file}:${line} ${property} 写死了 px：${value}`);
    if (!maskProperty.test(property) && /#[0-9a-f]{3,8}\b/i.test(plain)) found.push(`${file}:${line} ${property} 写死了颜色：${value}`);
    if (property === 'z-index' && /^\+?\d+$/.test(value.replace(/\s*!important$/, '')) && Number(value.replace(/\s*!important$/, '')) > 0) found.push(`${file}:${line} z-index 写死了层级：${value}；请用 --z-* 档位`);
    if (transitionProperty.test(property) && [...plain.replace(/var\([^)]*\)/g, '').matchAll(/(^|[^\w.-])(\d*\.?\d+)(m?s)\b/g)].some(match => Number(match[2]) !== 0)) found.push(`${file}:${line} ${property} 写死了时长：${value}；请用 --dur-*／--motion-*`);
    if (tokens) for (const [, name] of plain.matchAll(tokenReference)) if (!tokens.has(name)) found.push(`${file}:${line} ${property} 引用了未定义的设计变量 ${name}`);
  }
  return found;
}

/** 列出 src 下（含子目录）的样式文件，路径相对项目根。 */
function styleFiles(root, directory = 'src') {
  return readdirSync(join(root, directory), { withFileTypes: true }).flatMap(entry => entry.isDirectory()
    ? styleFiles(root, `${directory}/${entry.name}`)
    : entry.name.endsWith('.css') ? [`${directory}/${entry.name}`] : []).sort();
}

/** 检查变量文件和其余全部样式文件。 */
export function styleViolations(root) {
  const tokenText = readFileSync(join(root, tokenFile), 'utf8'), tokens = definedTokens(tokenText);
  return [...tokenFileViolations(tokenFile, tokenText), ...styleFiles(root).filter(file => file !== tokenFile)
    .flatMap(file => fileViolations(file, readFileSync(join(root, file), 'utf8'), tokens))];
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const root = fileURLToPath(new URL('..', import.meta.url));
  const errors = [...styleViolations(root), ...controlViolations(root)];
  if (errors.length) { console.error(errors.join('\n') + `\n共 ${errors.length} 处问题；请使用设计变量及公共按钮／标题栏组件。`); process.exitCode = 1; }
  else console.log('样式变量与按钮组件检查通过。');
}
