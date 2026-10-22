import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
export interface Config { host: string; port: number; allowedHosts: string[]; accessKey: string; userSpace: string; database: string; runtimeDirectory: string; logDirectory?: string; mediaLeaseTtlMs: number; ytDlp?: {executable: string; prefixArgs?: string[]; nodeRuntime: string}; }
export const root = fileURLToPath(new URL('../..', import.meta.url));
export function readConfig(): Config {
  const file = resolve(process.env.MUSIC_APP_CONFIG ?? resolve(root, 'config.local.json'));
  const c = JSON.parse(readFileSync(file, 'utf8')) as Config;
  if (typeof c.accessKey !== 'string' || c.accessKey.length < 6 || c.accessKey.startsWith('REPLACE_')) throw new Error('配置需要至少 6 字符的私人访问码。');
  if (!c.userSpace || !c.database || !c.runtimeDirectory || !Number.isInteger(c.port) || c.port < 1 || c.port > 65535 || !['127.0.0.1','0.0.0.0','::1'].includes(c.host) || !Array.isArray(c.allowedHosts) || !c.allowedHosts.length || c.allowedHosts.some(h => !/^[a-zA-Z0-9.:-]+$/.test(h))) throw new Error('无效的服务、用户空间或路径配置。');
  c.database = resolve(dirname(file), c.database); c.runtimeDirectory = resolve(dirname(file), c.runtimeDirectory);
  if (c.logDirectory !== undefined) { if (typeof c.logDirectory !== 'string' || !c.logDirectory.trim()) throw new Error('无效日志路径。'); c.logDirectory = resolve(dirname(file), c.logDirectory); }
  c.mediaLeaseTtlMs ??= 300000;
  if (!Number.isInteger(c.mediaLeaseTtlMs) || c.mediaLeaseTtlMs < 85000 || c.mediaLeaseTtlMs > 3600000) throw new Error('租约期限需在 85000–3600000 毫秒。');
  if (c.ytDlp) { c.ytDlp.executable = resolve(dirname(file), c.ytDlp.executable); c.ytDlp.nodeRuntime = resolve(dirname(file), c.ytDlp.nodeRuntime); if (c.ytDlp.prefixArgs?.some(v => typeof v !== 'string')) throw new Error('无效取源工具配置'); }
  return c;
}
