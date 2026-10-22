import { existsSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const productRoot = fileURLToPath(new URL('..', import.meta.url));

function studioDirectory(root) {
  const parent = dirname(resolve(root));
  const studio = basename(parent).toLowerCase() === 'projects' ? dirname(parent) : parent;
  return basename(studio).toLowerCase() === 'studio'
    && ['slowtune', 'music-app'].includes(basename(resolve(root)).toLowerCase()) ? studio : undefined;
}

export const workspaceRoot = studioDirectory(productRoot) ?? resolve(productRoot);

export function resolveConfigFile(root = productRoot, env = process.env) {
  if (env.MUSIC_APP_CONFIG !== undefined) return resolve(env.MUSIC_APP_CONFIG);
  const local = resolve(root, 'config.local.json');
  if (existsSync(local)) return local;
  const studio = studioDirectory(root);
  const instance = studio && resolve(studio, '../instances/slowtune/config.local.json');
  return instance && existsSync(instance) ? instance : local;
}
