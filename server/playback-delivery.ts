import { MediaDelivery } from '@studio/music-sources/service';
import { MusicSourceError, type CallOptions, type PreparedPlayback, type ProviderId } from '@studio/music-sources';
import type { BilibiliAccounts } from './bilibili-accounts.js';

export function playbackContext(request: Request, provider: ProviderId | undefined, accounts: Pick<BilibiliAccounts, 'options'>, delivery: PlaybackDelivery): CallOptions {
  const path = new URL(request.url).pathname;
  if (provider === 'bilibili' && ['/v1/call/discover', '/v1/call/formats', '/v1/call/prepare'].includes(path)) return accounts.options();
  return delivery.context(request);
}

/** Media keeps the identity that created its lease, including across login changes. */
export class PlaybackDelivery extends MediaDelivery {
  private owners = new Map<string, string>();
  private providerLeases = new Map<string,ProviderId>();
  private desktopLeases = new Set<string>();
  desktopContext?:()=>boolean;
  desktopReadTimeouts={connectMs:30000,firstByteMs:30000,idleMs:120000};
  enabled?: (provider:ProviderId) => boolean;
  canPublish?: (playback:PreparedPlayback) => boolean;
  context(request: Request): CallOptions {
    const match = /^\/v1\/(?:media|leases)\/([^/]+)(?:\/|$)/.exec(new URL(request.url).pathname);
    const credentialRef = match ? this.owners.get(match[1]) : undefined;
    return credentialRef ? { credentialRef } : {};
  }
  override async publish(playback: PreparedPlayback, baseUrl: string, options: CallOptions = {}) {
    const desktop=this.desktopContext?.()===true;
    if(this.enabled&&!this.enabled(playback.entry.ref.provider)||this.canPublish&&!this.canPublish(playback))throw new MusicSourceError({code:'unsupported',provider:playback.entry.ref.provider,retryable:false});
    const published = await super.publish(playback, baseUrl, options);
    if(published.leaseId)this.providerLeases.set(published.leaseId,playback.entry.ref.provider);
    if(published.leaseId&&desktop)this.desktopLeases.add(published.leaseId);
    if(this.enabled&&!this.enabled(playback.entry.ref.provider)||this.canPublish&&!this.canPublish(playback)){if(published.leaseId)await this.release(published.leaseId,options);throw new MusicSourceError({code:'unsupported',provider:playback.entry.ref.provider,retryable:false});}
    if (published.leaseId && options.credentialRef) this.owners.set(published.leaseId, options.credentialRef);
    return published;
  }
  override async release(id: string, options?: CallOptions) {
    await super.release(id, options);
    this.owners.delete(id);
    this.providerLeases.delete(id);
    this.desktopLeases.delete(id);
  }
  override read(id:string,request:Request,options?:CallOptions,resource?:string){
    return super.read(id,request,options,resource,this.desktopLeases.has(id)?this.desktopReadTimeouts:undefined);
  }
  async releaseProvider(provider:ProviderId){await Promise.allSettled([...this.providerLeases].filter(([,value])=>value===provider).map(([id])=>this.release(id,this.owners.get(id)?{credentialRef:this.owners.get(id)}:{})));}
}
