import { MediaDelivery } from '@studio/music-sources/service';
import { MusicSourceError, type MusicApi, type MusicHost, type MusicEntry, type EntryRef, type CallOptions, type AudioFormat, type PreparedPlayback } from '@studio/music-sources';
import { bestAudioFormat, audioSupportFormats, supportsAudioType, type VerifiedAudio } from './audio-quality.js';
import { SearchCandidateMismatch } from './search-policy.js';

export function audioPrefixRecognized(bytes:Uint8Array,format:AudioFormat):boolean {
  const ascii=(start:number,end:number)=>new TextDecoder().decode(bytes.subarray(start,end));
  if(bytes.length<12)return false;
  if(format.container==='mp4'||format.mimeType==='audio/mp4')return ascii(4,8)==='ftyp'&&new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength).getUint32(0)>=8;
  if(format.container==='webm')return bytes[0]===0x1a&&bytes[1]===0x45&&bytes[2]===0xdf&&bytes[3]===0xa3;
  if(format.container==='ogg')return ascii(0,4)==='OggS';
  if(format.container==='flac')return ascii(0,4)==='fLaC';
  if(format.container==='wav')return ascii(0,4)==='RIFF'&&ascii(8,12)==='WAVE';
  if(format.container==='mp3'||format.mimeType==='audio/mpeg')return ascii(0,3)==='ID3'||bytes[0]===0xff&&(bytes[1]&0xe0)===0xe0;
  return false;
}

/** A successful prepare can still point at a CDN that rejects the media request. */
export async function verifySearchPlayback(api: Pick<MusicApi, 'prepare'> & Partial<Pick<MusicApi, 'formats' | 'capabilities'>>, host: MusicHost, ref: EntryRef, options: CallOptions & {signal: AbortSignal}, audioSupport?: string[], verified?:(playback:PreparedPlayback)=>string|undefined,accept?:(facts:MusicEntry)=>boolean): Promise<VerifiedAudio> {
  const signal = AbortSignal.any([options.signal, AbortSignal.timeout(10000)]);
  options = {...options, signal};
  const delivery = new MediaDelivery(host, {maxLeases: 1, maxReads: 1, readTimeoutMs: 10000});
  try {
    const playable = (format: AudioFormat) => !audioSupport || supportsAudioType(audioSupport, format);
    const formats = audioSupport && api.formats && api.capabilities?.(ref.provider).operations.includes('formats')
      ? await api.formats(ref, options) : undefined;
    options.signal.throwIfAborted();
    const remaining = formats?.filter(format => format.mimeType.startsWith('audio/') && playable(format));
    const codecs = audioSupport ? audioSupportFormats.filter(playable).map(format => format.codec) : undefined;
    if ((!remaining && audioSupport && !codecs?.length) || (remaining && !remaining.length)) throw new MusicSourceError({code: 'unsupported', provider: ref.provider, retryable: false});
    for (;;) {
      options.signal.throwIfAborted();
      const selected = remaining ? bestAudioFormat(remaining, playable) : undefined;
      let leaseId: string | undefined, reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
      try {
        const playback = await api.prepare({ref, media: 'audio', quality: 'highest', ...(selected ? {formatId: selected.id, codecs: [selected.codec]} : codecs ? {codecs} : {})}, options);
        options.signal.throwIfAborted();
        if(accept&&!accept(playback.entry))throw new SearchCandidateMismatch();
        if (!playable(playback.format)) throw new MusicSourceError({code: 'unsupported', provider: ref.provider, retryable: false});
        const published = await delivery.publish(playback, 'http://localhost', options);
        leaseId = published.leaseId;
        if (!leaseId) throw new MusicSourceError({code: 'unsupported', provider: ref.provider, retryable: false});
        const response = await delivery.read(leaseId, new Request(published.delivery.url, {headers: {Range: 'bytes=0-1023'}, signal: options.signal}), options);
        reader = response.body?.getReader();
        const range=response.headers.get('content-range')?.match(/^bytes 0-(\d+)\/(\d+)$/);
        const expected=range?Number(range[1])+1:0;
        if(!reader||!expected||expected>1024)throw new MusicSourceError({code:'protocol',provider:ref.provider,retryable:false});
        const prefix=new Uint8Array(expected);let received=0;
        while(received<expected){
          const chunk=await reader.read();options.signal.throwIfAborted();
          if(chunk.done||!chunk.value?.length||chunk.value.length>expected-received)throw new MusicSourceError({code:'protocol',provider:ref.provider,retryable:false});
          prefix.set(chunk.value,received);received+=chunk.value.length;
        }
        // Only a bounded container prefix is checked here. Completeness and decode
        // success remain unknown until the actual player consumes the media.
        if(!audioPrefixRecognized(prefix,playback.format))throw new MusicSourceError({code:'unsupported',provider:ref.provider,retryable:false});
        const preparationToken=verified?.(playback);
        return {ref: playback.entry.ref, format: playback.format,...(preparationToken?{preparationToken}:{})};
      } catch (error) {
        options.signal.throwIfAborted();
        // A rejected rendition does not make the other audio tracks unavailable.
        if (!selected || !(error instanceof MusicSourceError) || !['not-found', 'restricted', 'unsupported', 'expired'].includes(error.code)) throw error;
        remaining!.splice(remaining!.indexOf(selected), 1);
        if (!remaining!.length) throw error;
      } finally {
        await reader?.cancel().catch(() => {});
        if (leaseId) await delivery.release(leaseId, options);
      }
    }
  } catch (error) {
    if (signal.aborted && signal.reason?.name === 'TimeoutError') throw new MusicSourceError({code: 'timeout', provider: ref.provider, retryable: true});
    throw error;
  } finally {
    await delivery.dispose();
  }
}
