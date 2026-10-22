import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { instanceIdentity } from '../../desktop/service.mjs';
export function markOwnedFixture(product, file, config, pid, key) {
  mkdirSync(config.runtimeDirectory, { recursive: true });
  writeFileSync(join(config.runtimeDirectory, 'service.json'), JSON.stringify({ pid, port: config.port, key }));
  writeFileSync(join(config.runtimeDirectory, 'desktop-service.json'), JSON.stringify({ identity: instanceIdentity(file, product, config), pid, keyHash: createHash('sha256').update(key).digest('hex') }));
}
