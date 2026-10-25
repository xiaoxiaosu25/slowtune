import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { startupFixture } from './startup-fixture.mjs';
import {installSongFixture,queueRecord} from './song-fixture.mjs';

// Two distinct tones in a seekable PCM file prove that the visual reads music.
function toneFixture(seconds, changing = false) {
  const sampleRate = 16000, samples = seconds * sampleRate, bytes = Buffer.alloc(44 + samples * 2);
  bytes.write('RIFF', 0); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write('WAVEfmt ', 8);
  bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(sampleRate, 24); bytes.writeUInt32LE(sampleRate * 2, 28);
  bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34);
  bytes.write('data', 36); bytes.writeUInt32LE(samples * 2, 40);
  for (let i = 0; i < samples; i++) {
    const frequency = changing && i >= sampleRate * 8 ? 1760 : 440;
    bytes.writeInt16LE(Math.round(9000 * Math.sin(i * 2 * Math.PI * frequency / sampleRate)), 44 + i * 2);
  }
  return bytes;
}

export async function createPlayingArtworkFixture({ preview = false, artwork, librarySeed, handleRequest, beforeWrite } = {}) {
  const root = resolve(process.env.MUSIC_APP_TEST_BUILD ?? '.');
  const tracks = [
    { ref: { provider: 'bilibili', kind: 'video', id: 'BV1tX4y1W7Xm', part: '900' }, resourceId: 'artwork-first', url: 'https://www.bilibili.com/video/BV1tX4y1W7Xm?p=1', title: '海边慢听 · 风从远方来', uploader: { name: 'SlowTune' }, artwork: 'https://i1.hdslb.com/fixture-artwork.png', durationSeconds: 24 },
    { ref: { provider: 'bilibili', kind: 'video', id: 'BV1234567890', part: '901' }, resourceId: 'artwork-second', url: 'https://www.bilibili.com/video/BV1234567890?p=1', title: '下一首 · 无封面测试', uploader: { name: 'SlowTune' }, durationSeconds: 6 },
  ];
  if (artwork) tracks[0].artwork = artwork;
  const tones = [toneFixture(24, true), toneFixture(6)], preparations = [];
  let base;
  const server = createServer(async (request, response) => {
    const url = new URL(request.url, base);
    const json = (value, status = 200) => { response.writeHead(status, { 'Content-Type': 'application/json' }); response.end(JSON.stringify(value)); };
    if (handleRequest && await handleRequest({ request, response, url, json })) return;
    if (['/api/bootstrap', '/api/settings/welcome', '/api/settings/access'].includes(url.pathname)) return json(startupFixture(url.pathname));
    if (url.pathname === '/api/status') return json({ version: 'fixture', providers: { youtube: { enabled: false, available: false } }, delivery: { leases: 0 }, tool: {}, build: { stale: false } });
    if (url.pathname === '/api/follows') return json({ revision: '1', creators: [] });
    if (url.pathname === '/api/bilibili/account') return json({ state: 'anonymous' });
    if (url.pathname === '/api/discovery/bilibili') return json([]);
    if (url.pathname === '/api/settings/sources') return json({ revision: 'fixture', youtube: { enabled: false, available: false, disabledDisplay: 'dim' } });
    if (url.pathname === '/v1/handshake') return json({ protocol: 2, capabilities: [{ provider: 'bilibili', operations: ['metadata', 'discover', 'prepare'], limitations: [], anonymous: true }] });
    if (url.pathname.startsWith('/v1/call/')) {
      const chunks = []; for await (const chunk of request) chunks.push(chunk);
      const input = JSON.parse(Buffer.concat(chunks).toString());
      const ref = input.ref ?? input.request?.ref, index = tracks.findIndex(track => track.ref.id === ref?.id), track = tracks[index];
      if (track && url.pathname.endsWith('/metadata')) return json({ protocol: 2, result: track });
      if (track && url.pathname.endsWith('/prepare')) {
        preparations.push(track.resourceId);
        return json({ protocol: 2, result: { entry: track, resourceId: track.resourceId, format: { codec: 'pcm', mimeType: 'audio/wav', container: 'wav' }, delivery: { url: base + '/media/' + index + '.wav', requiresHost: false } } });
      }
      return json({ protocol: 2, error: { code: 'unsupported', retryable: false } }, 400);
    }
    if (/^\/media\/[01]\.wav$/.test(url.pathname)) {
      const audio = tones[Number(url.pathname[7])], range = /^bytes=(\d+)-(\d*)$/.exec(request.headers.range ?? '');
      const start = range ? Number(range[1]) : 0, end = range?.[2] ? Math.min(Number(range[2]), audio.length - 1) : audio.length - 1;
      response.writeHead(range ? 206 : 200, { 'Content-Type': 'audio/wav', 'Accept-Ranges': 'bytes', 'Content-Length': end - start + 1, ...(range ? { 'Content-Range': `bytes ${start}-${end}/${audio.length}` } : {}) });
      return response.end(audio.subarray(start, end + 1));
    }
    try {
      const path = join(root, 'dist/client', url.pathname === '/' ? 'index.html' : url.pathname);
      response.setHeader('Content-Type', ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.webp': 'image/webp', '.woff2': 'font/woff2' })[extname(path)] ?? 'application/octet-stream');
      if (preview && url.pathname === '/') {
        const saved = JSON.stringify(queueRecord(tracks,{volume:.3}));
        const seed = `<script>if(!localStorage.getItem('slow-listening:playback:v3'))localStorage.setItem('slow-listening:playback:v3',${JSON.stringify(saved)});</script>`;
        return response.end(readFileSync(path, 'utf8').replace('<head>', '<head>' + seed));
      }
      response.end(readFileSync(path));
    } catch { response.writeHead(404); response.end(); }
  });
  installSongFixture(server, { seed: typeof librarySeed === 'function' ? librarySeed(tracks) : librarySeed, beforeWrite });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  base = 'http://127.0.0.1:' + server.address().port;
  return { base, tracks, preparations, close: async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); } };
}
