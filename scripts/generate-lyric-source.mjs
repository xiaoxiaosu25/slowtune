import { lstatSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { gzipSync } from 'node:zlib';
import { publicSourceFiles } from './public-source.mjs';

function header(name, size, type = '0') {
  const block = Buffer.alloc(512);
  block.write(name, 0, 100, 'ascii');
  const octal = (value, offset, length) => block.write(value.toString(8).padStart(length - 1, '0') + '\0', offset, length, 'ascii');
  octal(0o644, 100, 8); octal(0, 108, 8); octal(0, 116, 8); octal(size, 124, 12); octal(0, 136, 12);
  block.fill(32, 148, 156); block.write(type, 156, 1); block.write('ustar\0', 257, 6); block.write('00', 263, 2);
  block.write([...block].reduce((sum, byte) => sum + byte, 0).toString(8).padStart(6, '0') + '\0 ', 148, 8, 'ascii');
  return block;
}

function paxPath(path) {
  const field = ' path=' + path + '\n';
  let length = Buffer.byteLength(field) + 1;
  while (String(length).length + Buffer.byteLength(field) !== length) length = String(length).length + Buffer.byteLength(field);
  return Buffer.from(String(length) + field);
}

// Explicit source inputs only. Never package local configs, credentials, databases or runtime files.
export function generateLyricSource(root = resolve('.')) {
  const files = publicSourceFiles(root);
  const output = join(root, 'public/legal'); mkdirSync(output, { recursive: true });
  const list = join(output, 'source-files.txt');
  writeFileSync(list, files.join('\n') + '\n');
  // PAX paths preserve Chinese filenames on Windows without shell/codepage dependencies.
  const blocks = [];
  const append = (name, data, type) => { blocks.push(header(name, data.length, type), data); if (data.length % 512) blocks.push(Buffer.alloc(512 - data.length % 512)); };
  files.forEach((path, index) => {
    if (!lstatSync(join(root, path)).isFile()) throw new Error('Source bundle requires regular files: ' + path);
    append('PaxHeaders/' + index, paxPath(path), 'x');
    append('source-' + index, readFileSync(join(root, path)), '0');
  });
  blocks.push(Buffer.alloc(1024));
  writeFileSync(join(output, 'desktop-lyrics-source.tar.gz'), gzipSync(Buffer.concat(blocks)));
  return files;
}
