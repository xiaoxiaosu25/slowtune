import { fileURLToPath } from 'node:url';
import { generateDocumentation } from './documentation.mjs';
try {
  const files = generateDocumentation(fileURLToPath(new URL('..', import.meta.url)));
  console.log(`已同步 ${files.length} 个文档生成区块。`);
} catch (error) { console.error(error.message); process.exitCode = 1; }
