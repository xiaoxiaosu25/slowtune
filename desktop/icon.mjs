import { deflateSync } from 'node:zlib';

function crc32(bytes) {
  let crc = -1;
  for (const byte of bytes) { crc ^= byte; for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0); }
  return (crc ^ -1) >>> 0;
}
function chunk(type, bytes) {
  const body = Buffer.concat([Buffer.from(type), bytes]), header = Buffer.alloc(4), checksum = Buffer.alloc(4);
  header.writeUInt32BE(bytes.length); checksum.writeUInt32BE(crc32(body)); return Buffer.concat([header, body, checksum]);
}
export function iconPng(size = 64) {
  const pixels = Buffer.alloc(size * (size * 4 + 1)), header = Buffer.alloc(13);
  header.writeUInt32BE(size); header.writeUInt32BE(size, 4); header[8] = 8; header[9] = 6;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const px = x / size, py = y / size, inside = (px - .5) ** 2 + (py - .5) ** 2 < .235;
    const note = (px > .51 && px < .60 && py > .25 && py < .66) || (px > .55 && px < .75 && py > .25 && py < .34) || ((px - .43) / .15) ** 2 + ((py - .68) / .10) ** 2 < 1;
    const offset = y * (size * 4 + 1) + 1 + x * 4;
    pixels.set(note ? [248, 230, 196, 255] : [62, 83, 71, inside ? 255 : 0], offset);
  }
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', deflateSync(pixels)), chunk('IEND', Buffer.alloc(0))]);
}
export function iconIco() {
  const png = iconPng(256), header = Buffer.alloc(22); header.writeUInt16LE(1, 2); header.writeUInt16LE(1, 4);
  header.writeUInt16LE(1, 10); header.writeUInt16LE(32, 12); header.writeUInt32LE(png.length, 14); header.writeUInt32LE(22, 18);
  return Buffer.concat([header, png]);
}
