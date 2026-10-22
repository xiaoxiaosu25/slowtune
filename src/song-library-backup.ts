import { decodeSongLibrarySnapshot } from '../server/song-library-codec';
import { maxSongLibrarySnapshotBytes, type SongLibrarySnapshot, type SongLibraryState } from '../server/song-library-types';
import { ApiError, request } from './api';

export function previewSongBackup(text: string): SongLibrarySnapshot { return decodeSongLibrarySnapshot(text); }
export async function readSongBackupFile(file: Blob): Promise<string> {
  if (file.size > maxSongLibrarySnapshotBytes) throw new ApiError('invalid-input');
  const text = new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer());
  // File selection and paste share the same UTF-8 and schema validation.
  previewSongBackup(text); return text;
}
export async function previewSongBackupImport(text: string, mode: 'append' | 'replace', revision: string | null, signal?: AbortSignal) {
  previewSongBackup(text);
  try {
    const response = await fetch('/api/song-library/imports/preview?mode=' + mode, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Music-App': '1', 'X-SlowTune-Revision': revision ?? 'null' }, body: text, signal });
    const result = await response.json();
    if (!response.ok) {
      if (response.status === 401 && result.error?.code === 'authentication') window.dispatchEvent(new Event('slowtune:session-expired'));
      throw new ApiError(result.error?.code ?? 'network', result.error?.currentRevision);
    }
    return result;
  } catch (issue) { if (issue instanceof ApiError || (issue as Error).name === 'AbortError') throw issue; throw new ApiError('network'); }
}
export const commitSongBackupImport = (token: string, revision: string | null, signal?: AbortSignal) => request<SongLibraryState>('/api/song-library/imports/commit', { token, revision }, signal);
