export type SongLibraryErrorCode = 'invalid-input' | 'unknown-version' | 'not-found' | 'duplicate' | 'conflict' | 'storage' | 'cancelled' | 'expired' | 'authentication' | 'origin-denied' | 'source-disabled' | 'busy' | 'unsupported' | 'network' | 'timeout';
export class SongLibraryError extends Error {
  constructor(readonly code: SongLibraryErrorCode, readonly currentRevision?: string | null) { super(code); }
}
