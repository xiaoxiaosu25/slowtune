import { MusicSourceError, type Account, type CallOptions, type MusicSources } from '@studio/music-sources';
import type { BilibiliCredentials } from './bilibili-credentials.js';
import { artworkUrl } from './artwork-url.js';

export type BilibiliAccountState = { state: 'anonymous' | 'expired' | 'unavailable'; account?: never; issue?: string } | { state: 'authenticated'; account: Account; issue?: never };

export class BilibiliAccounts {
  private cached?: { revision: string; account: Account; until: number };
  private pending?: { owner: string; id: string; expiresAt: number };
  private generating?: { owner: string; controller: AbortController; completed: Promise<void> };
  private changing = false;
  private expired = false;
  constructor(private api: MusicSources, private credentials: BilibiliCredentials, private revoke: (ref: string) => Promise<void>) {}
  options(signal?: AbortSignal): CallOptions { return { ...(signal ? { signal } : {}), ...(this.credentials.revision ? { credentialRef: this.credentials.ref } : {}) }; }
  async expire(revision: string | undefined) {
    if (!revision || this.credentials.revision !== revision || this.changing) return;
    this.changing = true;
    try { await this.api.disconnect('bilibili', { credentialRef: this.credentials.ref }); await this.revoke(this.credentials.ref); this.cached = undefined; this.expired = true; }
    finally { this.changing = false; }
  }
  async status(signal: AbortSignal): Promise<BilibiliAccountState> {
    const revision = this.credentials.revision;
    if (!revision) return { state: this.expired ? 'expired' : this.credentials.loadFailed ? 'unavailable' : 'anonymous' };
    if (this.cached?.revision === revision && this.cached.until > Date.now()) return { state: 'authenticated', account: this.cached.account };
    try {
      const raw = await this.api.account('bilibili', this.options(signal));
      const account = { ...raw, artwork: artworkUrl(raw.artwork) };
      if (this.credentials.revision !== revision) return this.status(signal);
      this.cached = { revision, account, until: Date.now() + 60000 };
      return { state: 'authenticated', account };
    } catch (e) {
      if (e instanceof MusicSourceError && e.code === 'authentication') { await this.expire(revision); return { state: 'expired' }; }
      throw e;
    }
  }
  async begin(owner: string, signal: AbortSignal) {
    if (this.changing || (this.pending && this.pending.owner !== owner && this.pending.expiresAt > Date.now())) throw new MusicSourceError({ code: 'busy', retryable: true });
    this.changing = true;
    const controller = new AbortController();
    let complete!: () => void;
    const generation = { owner, controller, completed: new Promise<void>(resolve => { complete = resolve; }) };
    this.generating = generation;
    const loginSignal = AbortSignal.any([signal, controller.signal]);
    try {
      const previous = this.pending;
      if (previous) {
        await this.api.cancelLogin('bilibili', previous.id, { credentialRef: this.credentials.ref, signal: loginSignal });
        if (this.pending === previous) this.pending = undefined;
      }
      loginSignal.throwIfAborted();
      const challenge = await this.api.beginLogin('bilibili', { credentialRef: this.credentials.ref, signal: loginSignal });
      if (loginSignal.aborted) { await this.api.cancelLogin('bilibili', challenge.id, { credentialRef: this.credentials.ref }); loginSignal.throwIfAborted(); }
      this.pending = { owner, id: challenge.id, expiresAt: challenge.expiresAt };
      return challenge;
    } catch (e) {
      if (loginSignal.aborted) throw new MusicSourceError({ code: 'cancelled', provider: 'bilibili', retryable: false });
      throw e;
    } finally { this.generating = undefined; this.changing = false; complete(); }
  }
  private owned(owner: string, id: unknown) {
    if (typeof id !== 'string' || !this.pending || this.pending.owner !== owner || this.pending.id !== id) throw new MusicSourceError({ code: 'expired', provider: 'bilibili', retryable: false });
    return this.pending;
  }
  async poll(owner: string, id: unknown, signal: AbortSignal) {
    const pending = this.owned(owner, id);
    if (this.changing) throw new MusicSourceError({ code: 'busy', retryable: true });
    const result = await this.api.pollLogin('bilibili', pending.id, { credentialRef: this.credentials.ref, signal });
    if (result.state === 'authenticated') {
      this.cached = undefined;
      this.expired = false;
      await this.revoke(this.credentials.ref);
    }
    if (result.state === 'authenticated' || result.state === 'expired') if (this.pending === pending) this.pending = undefined;
    return result.account ? { ...result, account: { ...result.account, artwork: artworkUrl(result.account.artwork) } } : result;
  }
  async cancel(owner: string, id: unknown, signal?: AbortSignal) {
    if (!this.pending) return;
    const pending = this.owned(owner, id);
    await this.api.cancelLogin('bilibili', pending.id, { credentialRef: this.credentials.ref, signal });
    if (this.pending === pending) this.pending = undefined;
  }
  async cancelOwner(owner: string) {
    const generation = this.generating;
    if (generation?.owner === owner) {
      generation.controller.abort();
      await generation.completed;
    }
    if (this.pending?.owner === owner) await this.cancel(owner, this.pending.id);
  }
  async disconnect(signal: AbortSignal) {
    if (this.changing) throw new MusicSourceError({ code: 'busy', retryable: true });
    this.changing = true;
    try {
      if (this.pending) { await this.api.cancelLogin('bilibili', this.pending.id, { credentialRef: this.credentials.ref, signal }); this.pending = undefined; }
      await this.api.disconnect('bilibili', { credentialRef: this.credentials.ref, signal });
      await this.revoke(this.credentials.ref);
      this.cached = undefined;
      this.expired = false;
      return { state: 'anonymous' } as const;
    } finally { this.changing = false; }
  }
}
