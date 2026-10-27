import { verifyAudioPlayback } from '@studio/music-sources/audio-probe';
import type { MusicApi, MusicHost, MusicEntry, EntryRef, CallOptions, PreparedPlayback } from '@studio/music-sources';
import { supportsAudioType, type VerifiedAudio } from './audio-quality.js';
import { SearchCandidateMismatch } from './search-policy.js';

export { audioPrefixRecognized } from '@studio/music-sources/audio-probe';

/** Product matching and preparation tickets wrap the shared bounded media check. */
export async function verifySearchPlayback(api: Pick<MusicApi, 'prepare'> & Partial<Pick<MusicApi, 'formats' | 'capabilities'>>, host: MusicHost, ref: EntryRef, options: CallOptions & { signal: AbortSignal }, audioSupport?: string[], verified?: (playback: PreparedPlayback) => string | undefined, accept?: (facts: MusicEntry) => boolean): Promise<VerifiedAudio> {
  let preparationToken: string | undefined;
  const checked = await verifyAudioPlayback(api, host, ref, {
    ...options,
    ...(audioSupport ? { playable: (format: Parameters<typeof supportsAudioType>[1]) => supportsAudioType(audioSupport, format) } : {}),
    validateEntry(entry) { if (accept && !accept(entry)) throw new SearchCandidateMismatch(); },
    onPrepared(playback) { preparationToken = verified?.(playback); },
  });
  return { ...checked, ...(preparationToken ? { preparationToken } : {}) };
}
