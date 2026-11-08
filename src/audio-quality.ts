import {MusicSourceError,type MusicApi,type MusicEntry,type EntryRef,type CallOptions} from '@studio/music-sources';
import { MusicPlayerBridge } from '@studio/music-sources/player';
import type { PlaybackPlan } from '@studio/player';
import { audioMime, prepareBestAudio, supportedAudioTypes, desktopAudioCapability, type DesktopAudioApi, type VerifiedAudio, type VerifiedMusicEntry } from '../server/audio-quality';
import { sameVideoPart } from '../server/search-policy';
import { desktopSurface } from './song-search';
import { tracePlaybackApi, invokingPlaybackOperation, withPlaybackDiagnostic } from './playback-diagnostics';
import {audioSelection,audioSelector,sameAudioSelection,type AudioSelection} from '../server/audio-selection';
export { audioQualityLabel } from '../server/audio-quality';

export function retainVerifiedAudio(previous: Pick<PlaybackPlan,'metadata'>, next: PlaybackPlan): PlaybackPlan {
  const checked = previous.metadata?.verifiedAudio as VerifiedAudio | undefined;
  const format = next.metadata?.format as VerifiedAudio['format'] | undefined;
  return checked && format?.id === checked.format.id && (previous.metadata?.audioGeneration===undefined||previous.metadata.audioGeneration===next.metadata?.audioGeneration) && sameAudioSelection(checked.selection,next.metadata?.audioSelection as AudioSelection|undefined) ? {...next,metadata:{...next.metadata,verifiedAudio:checked}} : next;
}
export function desktopPlaybackPlan(plan:PlaybackPlan):PlaybackPlan{
  return desktopSurface()?{...plan,timeouts:{resolve:60,initial:30,stall:30,...plan.timeouts}}:plan;
}

/** Read the candidate delivery before the player releases its current lease. */
export async function checkAudioDelivery(playUrl: string, signal: AbortSignal) {
  const prefixBytes = 1024;
  const budget = AbortSignal.any([signal, AbortSignal.timeout(20000)]);
  let response: Response | undefined;
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  try {
    response = await fetch(playUrl, { headers: { Range: `bytes=0-${prefixBytes - 1}` }, signal: budget });
    if (!response.ok) {
      const code = response.status === 403 ? 'restricted' : response.status === 429 ? 'rate-limited' : 'network';
      throw { code };
    }
    if (!response.body || !response.headers.get('Content-Type')?.toLowerCase().startsWith('audio/')) throw { code: 'protocol' };
    // A direct server may ignore Range. In that case, read one nonempty chunk and cancel the stream.
    const end = response.headers.get('Content-Range')?.match(/^bytes 0-(\d+)\/\d+$/)?.[1];
    const expected = response.status === 206 ? Number(end) + 1 : 1;
    if (!Number.isInteger(expected) || expected < 1 || expected > prefixBytes) throw { code: 'protocol' };
    reader = response.body.getReader();
    let received = 0;
    while (received < expected) {
      const { done, value } = await reader.read();
      budget.throwIfAborted();
      if (done) throw { code: 'protocol' };
      received += value.byteLength;
    }
  } catch (error) {
    signal.throwIfAborted();
    if (budget.aborted) throw { code: 'timeout' };
    throw error;
  } finally {
    await (reader ? reader.cancel() : response?.body?.cancel())?.catch(() => {});
  }
}

export class BestAudioBridge extends MusicPlayerBridge {
  private preparedEntries: Map<string, MusicEntry>;
  private verifiedAudio: WeakMap<EntryRef, VerifiedAudio>;
  private sourceApi: MusicApi;
  private selections:WeakMap<EntryRef,AudioSelection>;
  private playable:(format:Parameters<typeof audioMime>[0])=>boolean;
  private epoch:{value:number};
  private verifiedEpoch:WeakMap<EntryRef,number>;
  readonly audioSupport: string[];
  constructor(api: MusicApi, audio: Pick<HTMLAudioElement, 'canPlayType'>, private readonly diagnosticContext?:()=>string|undefined,private readonly selectionDefault:()=>AudioSelection=()=>audioSelection()) {
    if(diagnosticContext)api=tracePlaybackApi(api,diagnosticContext);
    const preparedEntries = new Map<string, MusicEntry>();
    const verifiedAudio = new WeakMap<EntryRef, VerifiedAudio>();
    const selections=new WeakMap<EntryRef,AudioSelection>();
    const epoch={value:0},verifiedEpoch=new WeakMap<EntryRef,number>();
    const playable = (format: Parameters<typeof audioMime>[0]) => !!audio.canPlayType(audioMime(format));
    const support=supportedAudioTypes(playable);
    const prepare: MusicApi['prepare'] = async(request, options) => {
      const generation=epoch.value,checked = verifiedEpoch.get(request.ref)===generation?verifiedAudio.get(request.ref):undefined;
      const selection=selections.get(request.ref)??audioSelection(selectionDefault());
      const selected=checked && sameAudioSelection(checked.selection,selection) && playable(checked.format) && request.media !== 'video' && !request.formatId&&!selection.formatId
        ? {...request,formatId:checked.format.id,codecs:[checked.format.codec],quality:'highest' as const} : request;
      const desktop=api as DesktopAudioApi;
      const result=await (desktopSurface()&&desktop.prepareDesktopAudio&&api.capabilities(request.ref.provider).operations.includes(desktopAudioCapability)
        ?desktop.prepareDesktopAudio({...selected,...(selection.formatId?{formatId:selection.formatId}:{})},options,support,sameAudioSelection(checked?.selection,selection)?checked?.preparationToken:undefined,selection)
        :prepareBestAudio(api,{...selected,...(selection.formatId?{formatId:selection.formatId}:{})},options,playable,audioSelector(selection)));
      if(epoch.value!==generation){if(result.leaseId)await api.release?.(result.leaseId).catch(()=>{});throw new MusicSourceError({code:'cancelled',retryable:false});}
      return result;
    };
    const best = new Proxy(api, { get(target, property) {
      if (property === 'prepare') return prepare;
      if (property === 'metadata') return (ref: EntryRef, options?: CallOptions) => {
        options?.signal?.throwIfAborted();
        const entry = preparedEntries.get(JSON.stringify(ref));
        if(entry)return Promise.resolve(entry);
        const selection=selections.get(ref)??audioSelection(selectionDefault());
        return api.metadata(ref, options).then(entry=>{entry={...entry,ref:{...entry.ref}};selections.set(entry.ref,selection);return entry;});
      };
      const value = Reflect.get(target, property);
      return typeof value === 'function' ? value.bind(target) : value;
    } });
    super(best);
    this.preparedEntries = preparedEntries;
    this.verifiedAudio = verifiedAudio;
    this.sourceApi = api;
    this.selections=selections;this.playable=playable;
    this.epoch=epoch;this.verifiedEpoch=verifiedEpoch;
    this.audioSupport = support;
    const resolveUrl=this.resolver.resolveUrl,recoverSource=this.resolver.recoverSource;
    if(resolveUrl)this.resolver.resolveUrl=async(...args)=>{const plan=await resolveUrl(...args);return typeof plan==='string'?plan:desktopPlaybackPlan({...plan,metadata:{...plan.metadata,audioSelection:audioSelection(args[1].metadata?.audioSelection),audioGeneration:this.epoch.value}});};
    if(recoverSource)this.resolver.recoverSource=async(...args)=>{const plan=await recoverSource(...args);return plan?desktopPlaybackPlan({...plan,metadata:{...plan.metadata,audioSelection:audioSelection(args[1].metadata?.audioSelection),audioGeneration:this.epoch.value}}):plan;};
  }
  /** Reuse this selection's metadata without changing later source checks or refreshes. */
  async sourceFrom(entry: VerifiedMusicEntry, options: CallOptions = {},selection:AudioSelection=audioSelection(entry.verifiedAudio?.selection??this.selectionDefault())) {
    const generation=this.epoch.value;
    entry = {...entry,ref:{...entry.ref}};
    const key = JSON.stringify(entry.ref); this.preparedEntries.set(key, entry);
    this.selections.set(entry.ref,audioSelection(selection));
    const checked = entry.verifiedAudio && sameVideoPart(entry.ref,entry.verifiedAudio.ref)&&sameAudioSelection(entry.verifiedAudio.selection,selection) ? entry.verifiedAudio : undefined;
    // Bind to this source object, so a cancelled selection cannot retune an older plan.
    if(checked){this.verifiedAudio.set(entry.ref,checked);this.verifiedEpoch.set(entry.ref,generation);}
    try {
      const source = await this.source(entry.ref, options);
      return checked ? {...source,prepare:async(context:Parameters<typeof source.prepare>[0])=>{
        const plan = await source.prepare(context);
        return retainVerifiedAudio({metadata:{verifiedAudio:checked,audioGeneration:generation}},plan);
      }} : source;
    }
    finally { if (this.preparedEntries.get(key) === entry) this.preparedEntries.delete(key); }
  }
  async sourceForPlan(ref: EntryRef, plan: PlaybackPlan, options: CallOptions = {}) {
    const checked = plan.metadata?.audioGeneration===this.epoch.value?plan.metadata?.verifiedAudio as VerifiedAudio|undefined:undefined;
    const entry = await this.sourceApi.metadata(ref,options);
    return this.sourceFrom({...entry,...(checked&&sameVideoPart(ref,checked.ref)?{verifiedAudio:checked}:{})},options,audioSelection(plan.metadata?.audioSelection));
  }
  canPlay(format:Parameters<typeof audioMime>[0]){return this.playable(format);}
  invalidateVerification(){this.epoch.value++;}
  override async source(...args: Parameters<MusicPlayerBridge['source']>) {
    const selection=this.selections.get(args[0])??audioSelection(this.selectionDefault());this.selections.set(args[0],selection);
    const operationId=invokingPlaybackOperation()??this.diagnosticContext?.();
    const source=await super.source(...args);
    return { ...source, resolveTimeoutSeconds: 60,prepare:async(context:Parameters<typeof source.prepare>[0])=>{const plan=await withPlaybackDiagnostic(operationId,()=>source.prepare(context));return desktopPlaybackPlan({...plan,metadata:{...plan.metadata,audioSelection:selection,audioGeneration:this.epoch.value}});} };
  }
}
