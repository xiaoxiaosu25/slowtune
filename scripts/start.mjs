import { existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolveConfigFile } from './instance-path.mjs';
const entry = fileURLToPath(new URL('../dist/server/index.js', import.meta.url));
if (!existsSync(entry)) throw new Error('请先执行 npm run build，正式启动只使用 dist。');
process.env.MUSIC_APP_CONFIG = resolveConfigFile();
await import(pathToFileURL(entry).href);
