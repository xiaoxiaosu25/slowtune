import { SongLibraryError } from './song-library-errors.js';

export const playlistCoverSize = 512;
export const maxPlaylistCoverLength = 512 * 1024;

/** Browser-safe validation for the bounded, re-encoded image stored in a snapshot. */
export function validatePlaylistCover(value: unknown): asserts value is string {
  const fail = (): never => { throw new SongLibraryError('invalid-input'); };
  if (typeof value !== 'string' || value.length > maxPlaylistCoverLength) fail();
  const match = /^data:image\/jpeg;base64,([A-Za-z0-9+/]+={0,2})$/.exec(value as string);
  if (!match || match[1].length % 4) fail();
  let bytes: string;
  try { bytes = atob(match![1]); } catch { return fail(); }
  const byte = (at: number) => bytes.charCodeAt(at);
  const word = (at: number) => byte(at) * 256 + byte(at + 1);
  if (word(0) !== 0xffd8 || word(bytes.length - 2) !== 0xffd9) fail();
  let square = false, scan = false;
  for (let at = 2; at + 4 <= bytes.length;) {
    if (byte(at++) !== 0xff) fail();
    while (byte(at) === 0xff) at++;
    const marker = byte(at++), length = word(at);
    if (length < 2 || at + length > bytes.length) fail();
    if ([0xc0, 0xc1, 0xc2].includes(marker)) {
      if (length < 8 || word(at + 3) !== playlistCoverSize || word(at + 5) !== playlistCoverSize) fail();
      square = true;
    }
    if (marker === 0xda) { scan = true; break; }
    at += length;
  }
  if (!square || !scan) fail();
}
