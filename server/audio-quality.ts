import type { AudioFormat, MusicApi, MusicEntry, EntryRef, PrepareRequest, CallOptions } from '@studio/music-sources';
import { losslessAudio } from '@studio/music-sources/audio';
export { audioSupportFormats, supportedAudioTypes, supportsAudioType, losslessAudio, audioMime, bestAudioFormat, prepareBestAudio } from '@studio/music-sources/audio';

/** Product capability and transient selection facts; never persist delivery addresses or leases. */
export interface VerifiedAudio { ref: EntryRef; format: AudioFormat; preparationToken?: string }
export interface VerifiedMusicEntry extends MusicEntry { verifiedAudio?: VerifiedAudio }
export const desktopAudioCapability = 'slowtune-desktop-audio';
export interface DesktopAudioApi extends MusicApi {
  prepareDesktopAudio?(request: PrepareRequest, options: CallOptions | undefined, support: string[], preparationToken?: string): ReturnType<MusicApi['prepare']>;
}
export function audioQualityLabel(format?: AudioFormat) {
  if (!format) return '';
  const codec = /^mp4a/i.test(format.codec) ? 'AAC' : format.codec.split('.')[0].toUpperCase();
  return [losslessAudio(format) ? `${codec} 无损` : codec,
    ...(format.bitrate ? [`${Math.round(format.bitrate / 1000)} kbps`] : []),
    ...(format.sampleRate ? [`${format.sampleRate / 1000} kHz`] : [])].join(' · ');
}
