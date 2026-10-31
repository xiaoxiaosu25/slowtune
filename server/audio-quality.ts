import type { AudioFormat, MusicApi, MusicEntry, EntryRef, PrepareRequest, CallOptions } from '@studio/music-sources';
import { losslessAudio } from '@studio/music-sources/audio';
import type {AudioSelection} from './audio-selection.js';
export { audioSupportFormats, supportedAudioTypes, supportsAudioType, losslessAudio, audioMime, bestAudioFormat, prepareBestAudio } from '@studio/music-sources/audio';

/** Product capability and transient selection facts; never persist delivery addresses or leases. */
export interface VerifiedAudio { ref: EntryRef; format: AudioFormat; preparationToken?: string;selection?:AudioSelection }
export interface VerifiedMusicEntry extends MusicEntry { verifiedAudio?: VerifiedAudio }
export interface PlaybackFailureFact {attempt:number;state:'pending'|'ready'|'complete'|'failed';code?:string;status?:number;retryAfterMs?:number;provider?:'bilibili'}
export const desktopAudioCapability = 'slowtune-desktop-audio';
export interface DesktopAudioApi extends MusicApi {
  prepareDesktopAudio?(request: PrepareRequest, options: CallOptions | undefined, support: string[], preparationToken?: string,selection?:AudioSelection): ReturnType<MusicApi['prepare']>;
  playbackFailure?(leaseId:string,options?:CallOptions):Promise<PlaybackFailureFact|null>;
}
export function audioQualityLabel(format?: AudioFormat) {
  if (!format) return '';
  const codec = /^mp4a/i.test(format.codec) ? 'AAC' : /^(ec-3|ac-3)/i.test(format.codec)?'杜比 '+format.codec.toUpperCase():format.codec.split('.')[0].toUpperCase();
  return [losslessAudio(format) ? `${codec} 无损` : codec,
    ...(format.bitrate ? [`${Math.round(format.bitrate / 1000)} kbps`] : []),
    ...(format.sampleRate ? [`${format.sampleRate / 1000} kHz`] : []),...(format.bitDepth?[`${format.bitDepth} bit`]:[]),...(format.channels?[`${format.channels} 声道`]:[])].join(' · ');
}
