import { MusicSourceError, type AudioFormat, type MusicApi, type MusicEntry, type EntryRef, type PrepareRequest, type CallOptions } from '@studio/music-sources';

export const audioCodecs = ['flac', 'alac', 'mp4a', 'opus', 'vorbis'];
const fallbackFormats: AudioFormat[] = [
  { id: 'flac', codec: 'fLaC', mimeType: 'audio/mp4', container: 'mp4' },
  { id: 'alac', codec: 'alac', mimeType: 'audio/mp4', container: 'mp4' },
  { id: 'mp4a', codec: 'mp4a.40.2', mimeType: 'audio/mp4', container: 'mp4' },
  { id: 'opus', codec: 'opus', mimeType: 'audio/webm', container: 'webm' },
  { id: 'vorbis', codec: 'vorbis', mimeType: 'audio/webm', container: 'webm' },
];
// Container/codec combinations exposed by the desktop's current sources.
export const audioSupportFormats: AudioFormat[] = [...fallbackFormats,
  { id: 'ec-3', codec: 'ec-3', mimeType: 'audio/mp4', container: 'mp4' },
  { id: 'ac-3', codec: 'ac-3', mimeType: 'audio/mp4', container: 'mp4' },
  { id: 'opus-mp4', codec: 'opus', mimeType: 'audio/mp4', container: 'mp4' },
  { id: 'mp3', codec: 'mp3', mimeType: 'audio/mpeg', container: 'mp3' },
  { id: 'wav', codec: 'pcm', mimeType: 'audio/wav', container: 'wav' },
];
/** Transient selection facts only; never persist media addresses or leases. */
export interface VerifiedAudio { ref: EntryRef; format: AudioFormat; preparationToken?:string }
export interface VerifiedMusicEntry extends MusicEntry { verifiedAudio?: VerifiedAudio }
export const desktopAudioCapability = 'slowtune-desktop-audio';
export interface DesktopAudioApi extends MusicApi {
  prepareDesktopAudio?(request:PrepareRequest,options:CallOptions|undefined,support:string[],preparationToken?:string):ReturnType<MusicApi['prepare']>;
}
export function supportedAudioTypes(playable: (format: AudioFormat) => boolean) {
  return audioSupportFormats.filter(playable).map(audioMime);
}
export function supportsAudioType(types: string[], format: AudioFormat) {
  return types.some(type => type.toLowerCase() === audioMime(format).toLowerCase());
}
export function losslessAudio(format: Pick<AudioFormat, 'codec'>) { return /^(flac|alac)(?:\.|$)/i.test(format.codec); }
export function audioMime(format: Pick<AudioFormat, 'codec' | 'mimeType'>) {
  const codec = /^flac$/i.test(format.codec) && format.mimeType === 'audio/mp4' ? 'fLaC' : format.codec;
  return `${format.mimeType}; codecs="${codec}"`;
}
/** Lossless takes precedence. Bitrate orders available lossy renditions, not their masters. */
export function bestAudioFormat(formats: AudioFormat[], playable: (format: AudioFormat) => boolean) {
  return formats.filter(format => format.mimeType.startsWith('audio/') && playable(format))
    .sort((a, b) => Number(losslessAudio(b)) - Number(losslessAudio(a)) || (b.bitrate ?? 0) - (a.bitrate ?? 0) || a.id.localeCompare(b.id))[0];
}
export function audioQualityLabel(format?: AudioFormat) {
  if (!format) return '';
  const codec = /^mp4a/i.test(format.codec) ? 'AAC' : format.codec.split('.')[0].toUpperCase();
  return [losslessAudio(format) ? `${codec} 无损` : codec,
    ...(format.bitrate ? [`${Math.round(format.bitrate / 1000)} kbps`] : []),
    ...(format.sampleRate ? [`${format.sampleRate / 1000} kHz`] : [])].join(' · ');
}

export async function prepareBestAudio(api: MusicApi, request: PrepareRequest, options: CallOptions | undefined, playable: (format: AudioFormat) => boolean) {
  if (request.media === 'video' || request.formatId || request.quality === 'lowest' || request.quality === 'lossless') return api.prepare(request, options);
  if (!api.formats || !api.capabilities(request.ref.provider).operations.includes('formats')) {
    const codecs = request.codecs ?? fallbackFormats.filter(playable).map(format => format.id);
    if (!codecs.length) throw new MusicSourceError({ code: 'unsupported', provider: request.ref.provider, retryable: false });
    return api.prepare({ ...request, codecs }, options);
  }
  const formats = await api.formats(request.ref, options);
  options?.signal?.throwIfAborted();
  const selected = bestAudioFormat(formats.filter(format => !request.codecs || request.codecs.some(codec => format.codec.toLowerCase().startsWith(codec.toLowerCase()))), playable);
  if (!selected) throw new MusicSourceError({ code: 'unsupported', provider: request.ref.provider, retryable: false });
  // Explicit codec and ID prevent the provider's default AAC filter from discarding FLAC.
  return api.prepare({ ...request, codecs: [selected.codec], formatId: selected.id, quality: 'highest' }, options);
}
