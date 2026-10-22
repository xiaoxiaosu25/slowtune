import { fileURLToPath } from 'node:url';
import { checkDocumentation } from './documentation.mjs';
const errors = checkDocumentation(fileURLToPath(new URL('..', import.meta.url)));
if (errors.length) { console.error(errors.join('\n')); process.exitCode = 1; }
else console.log('文档生成内容、接口覆盖、导航与本地链接检查通过。');
