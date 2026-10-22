import { SongLibraryError } from './song-library-errors.js';
import { object, text } from './song-library-codec.js';
import { artworkUrl } from './artwork-url.js';
import { desktopCatalogSong } from './song-catalog-display.js';
import type { SongLibraryService } from './song-library-service.js';

const maxBytes = 8 * 1024 * 1024;
const imageHosts = ['music.126.net', 'hdslb.com', 'ytimg.com', 'ggpht.com', 'gtimg.cn', 'qpic.cn', 'mzstatic.com'];

/** Fetch only a current member's saved cover, never a caller-supplied URL or credentials. */
export class PlaylistCoverImages {
  private active = 0;
  constructor(private library: SongLibraryService, private fetcher: typeof fetch = fetch) {}
  async source(input: unknown, requestSignal: AbortSignal): Promise<{ image: string }> {
    object(input, ['targetId', 'songId']); text(input.targetId, 200); text(input.songId, 200);
    const snapshot = this.library.read().snapshot;
    const entries = input.targetId === 'system:favorites' ? snapshot.favorites : snapshot.playlists.find(p => p.id === input.targetId)?.entries;
    const song = snapshot.songs.find(s => s.id === input.songId);
    if (!entries?.some(e => e.songId === input.songId) || !song) throw new SongLibraryError('not-found');
    const artwork = artworkUrl(desktopCatalogSong(song, snapshot).artwork);
    if (!artwork) throw new SongLibraryError('not-found');
    const url = new URL(artwork);
    if (url.username || url.password || url.port || url.hash || !imageHosts.some(host => url.hostname === host || url.hostname.endsWith('.' + host))) throw new SongLibraryError('unsupported');
    if (this.active >= 4) throw new SongLibraryError('busy');
    const signal = AbortSignal.any([requestSignal, AbortSignal.timeout(12000)]);
    this.active++;
    try {
      signal.throwIfAborted();
      const response = await this.fetcher(url, { signal, redirect: 'error', headers: { 'User-Agent': 'Mozilla/5.0', ...(url.hostname.endsWith('.hdslb.com') ? { Referer: 'https://www.bilibili.com/' } : {}) } });
      if (!response.ok || Number(response.headers.get('content-length')) > maxBytes) {
        await response.body?.cancel(); throw new SongLibraryError('invalid-input');
      }
      const reader = response.body?.getReader(); if (!reader) throw new SongLibraryError('invalid-input');
      const chunks: Uint8Array[] = []; let length = 0;
      const abort = () => { void reader.cancel().catch(() => {}); }; signal.addEventListener('abort', abort, { once: true });
      try {
        while (true) {
          signal.throwIfAborted(); const row = await reader.read(); signal.throwIfAborted(); if (row.done) break;
          length += row.value.byteLength; if (length > maxBytes) throw new SongLibraryError('invalid-input'); chunks.push(row.value);
        }
        const bytes = Buffer.concat(chunks);
        // Some cover CDNs label both JPEG and PNG bodies as image/jpg. Use the
        // bounded body's signature so the browser receives its actual format.
        const mime = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff ? 'image/jpeg'
          : bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ? 'image/png'
          : bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP' ? 'image/webp' : undefined;
        if (!mime) throw new SongLibraryError('invalid-input');
        return { image: 'data:' + mime + ';base64,' + bytes.toString('base64') };
      } finally { signal.removeEventListener('abort', abort); await reader.cancel().catch(() => {}); reader.releaseLock(); }
    } catch (error) {
      if (requestSignal.aborted) throw new SongLibraryError('cancelled');
      if (signal.aborted) throw new SongLibraryError('timeout');
      if (error instanceof SongLibraryError) throw error;
      throw new SongLibraryError('network');
    } finally { this.active--; }
  }
}
