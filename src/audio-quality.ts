import type { MusicApi, MusicEntry, EntryRef, CallOptions } from '@studio/music-sources';
import { MusicPlayerBridge } from '@studio/music-sources/player';
import type { PlaybackPlan } from '@studio/player';
import { audioMime, prepareBestAudio, supportedAudioTypes, desktopAudioCapability, type DesktopAudioApi, type VerifiedAudio, type VerifiedMusicEntry } from '../server/audio-quality';
import { sameVideoPart } from '../server/search-policy';
import { desktopSurface } from './song-search';
export { audioQualityLabel } from '../server/audio-quality';

export function retainVerifiedAudio(previous: Pick<PlaybackPlan,'metadata'>, next: PlaybackPlan): PlaybackPlan {
  const checked = previous.metadata?.verifiedAudio as VerifiedAudio | undefined;
  const format = next.metadata?.format as VerifiedAudio['format'] | undefined;
  return checked && format?.id === checked.format.id ? {...next,metadata:{...next.metadata,verifiedAudio:checked}} : next;
}
export function desktopPlaybackPlan(plan:PlaybackPlan):PlaybackPlan{
  return desktopSurface()?{...plan,timeouts:{resolve:60,initial:30,stall:30,...plan.timeouts}}:plan;
}

export class BestAudioBridge extends MusicPlayerBridge {
  private preparedEntries: Map<string, MusicEntry>;
  private verifiedAudio: WeakMap<EntryRef, VerifiedAudio>;
  private sourceApi: MusicApi;
  readonly audioSupport: string[];
  constructor(api: MusicApi, audio: Pick<HTMLAudioElement, 'canPlayType'>) {
    const preparedEntries = new Map<string, MusicEntry>();
    const verifiedAudio = new WeakMap<EntryRef, VerifiedAudio>();
    const playable = (format: Parameters<typeof audioMime>[0]) => !!audio.canPlayType(audioMime(format));
    const support=supportedAudioTypes(playable);
    const prepare: MusicApi['prepare'] = (request, options) => {
      const checked = verifiedAudio.get(request.ref);
      const selected=checked && playable(checked.format) && request.media !== 'video' && !request.formatId
        ? {...request,formatId:checked.format.id,codecs:[checked.format.codec],quality:'highest' as const} : request;
      const desktop=api as DesktopAudioApi;
      return desktopSurface()&&desktop.prepareDesktopAudio&&api.capabilities(request.ref.provider).operations.includes(desktopAudioCapability)
        ?desktop.prepareDesktopAudio(selected,options,support,checked?.preparationToken)
        :prepareBestAudio(api,selected,options,playable);
    };
    const best = new Proxy(api, { get(target, property) {
      if (property === 'prepare') return prepare;
      if (property === 'metadata') return (ref: EntryRef, options?: CallOptions) => {
        options?.signal?.throwIfAborted();
        const entry = preparedEntries.get(JSON.stringify(ref));
        return entry ? Promise.resolve(entry) : api.metadata(ref, options);
      };
      const value = Reflect.get(target, property);
      return typeof value === 'function' ? value.bind(target) : value;
    } });
    super(best);
    this.preparedEntries = preparedEntries;
    this.verifiedAudio = verifiedAudio;
    this.sourceApi = api;
    this.audioSupport = support;
    const resolveUrl=this.resolver.resolveUrl,recoverSource=this.resolver.recoverSource;
    if(resolveUrl)this.resolver.resolveUrl=async(...args)=>{const plan=await resolveUrl(...args);return typeof plan==='string'?plan:desktopPlaybackPlan(plan);};
    if(recoverSource)this.resolver.recoverSource=async(...args)=>{const plan=await recoverSource(...args);return plan?desktopPlaybackPlan(plan):plan;};
  }
  /** Reuse this selection's metadata without changing later source checks or refreshes. */
  async sourceFrom(entry: VerifiedMusicEntry, options: CallOptions = {}) {
    entry = {...entry,ref:{...entry.ref}};
    const key = JSON.stringify(entry.ref); this.preparedEntries.set(key, entry);
    const checked = entry.verifiedAudio && sameVideoPart(entry.ref,entry.verifiedAudio.ref) ? entry.verifiedAudio : undefined;
    // Bind to this source object, so a cancelled selection cannot retune an older plan.
    if(checked)this.verifiedAudio.set(entry.ref,checked);
    try {
      const source = await this.source(entry.ref, options);
      return checked ? {...source,prepare:async(context:Parameters<typeof source.prepare>[0])=>{
        const plan = await source.prepare(context);
        return retainVerifiedAudio({metadata:{verifiedAudio:checked}},plan);
      }} : source;
    }
    finally { if (this.preparedEntries.get(key) === entry) this.preparedEntries.delete(key); }
  }
  async sourceForPlan(ref: EntryRef, plan: PlaybackPlan, options: CallOptions = {}) {
    const checked = plan.metadata?.verifiedAudio as VerifiedAudio | undefined;
    if(!checked || !sameVideoPart(ref,checked.ref))return this.source(ref,options);
    const entry = await this.sourceApi.metadata(ref,options);
    return this.sourceFrom({...entry,verifiedAudio:checked},options);
  }
  override async source(...args: Parameters<MusicPlayerBridge['source']>) {
    const source=await super.source(...args);
    return { ...source, resolveTimeoutSeconds: 60,prepare:async(context:Parameters<typeof source.prepare>[0])=>desktopPlaybackPlan(await source.prepare(context)) };
  }
}
