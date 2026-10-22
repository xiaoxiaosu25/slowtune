import { selectMusicParts, type EntryRef, type MusicEntry } from '@studio/music-sources';
import type { MusicClient } from '@studio/music-sources/client';
import type { Track } from './api';
import type { QueueTrack } from './chart-playback';

export type PartPlaybackMode = 'single' | 'all';
export type EntryContext = 'video' | 'part';
export type MusicActionIntent = 'overview' | 'parts' | 'play-choice' | 'favorite' | 'playlist' | 'enqueue';
export const partPreferenceKey = 'slow-listening:parts-preferences:v1';
export function readPartPreferences(storage: Pick<Storage, 'getItem'>): Record<string, PartPlaybackMode> {
  try {
    const value = JSON.parse(storage.getItem(partPreferenceKey) ?? '{}');
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    return Object.fromEntries(Object.entries(value).filter(([id, mode]) => /^BV[a-zA-Z0-9]{10}$/.test(id) && (mode === 'single' || mode === 'all')).slice(-500)) as Record<string, PartPlaybackMode>;
  } catch { return {}; }
}

interface Waiter { resolve: (entry: MusicEntry) => void; reject: (error: unknown) => void; ref: EntryRef; signal?: AbortSignal; detach: () => void }
interface Job { id: string; waiters: Set<Waiter>; controller: AbortController; priority: boolean; started: boolean }
/** One cancellable, bounded metadata scheduler shared by visible badges and user actions. */
export class PartMetadataStore {
  private cache = new Map<string, { entry: MusicEntry; until: number }>();
  private jobs = new Map<string, Job>();
  private listeners = new Set<() => void>();
  private active = 0;
  private version = 0;
  getVersion = () => this.version;
  constructor(privateClient: Pick<MusicClient, 'metadata'>) { this.client = privateClient; }
  private client: Pick<MusicClient, 'metadata'>;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  peek = (id: string) => this.cache.get(id)?.entry;
  seed(entry: MusicEntry) {
    if (entry.ref.provider !== 'bilibili') return;
    const parts = selectMusicParts(entry, { mode: 'all' });
    if (this.cache.size >= 240 && !this.cache.has(entry.ref.id)) this.cache.delete(this.cache.keys().next().value!);
    this.cache.set(entry.ref.id, { entry: { ...parts[0], parts }, until: Date.now() + 300000 });
    this.version++; this.listeners.forEach(listener => listener());
  }
  private select(entry: MusicEntry, ref: EntryRef) {
    if (ref.provider !== 'bilibili') return entry;
    const part = selectMusicParts(entry, { mode: 'single', ...(ref.part ? { part: ref.part } : {}) })[0];
    return { ...part, parts: entry.parts ?? [entry] };
  }
  read = (ref: EntryRef, signal?: AbortSignal, priority = true): Promise<MusicEntry> => {
    if (signal?.aborted) return Promise.reject({ code: 'cancelled' });
    if (ref.provider !== 'bilibili') return this.client.metadata(ref, { signal });
    const cached = this.cache.get(ref.id);
    if (cached && cached.until > Date.now()) {
      try { return Promise.resolve(this.select(cached.entry, ref)); } catch (error) { return Promise.reject(error); }
    }
    let job = this.jobs.get(ref.id);
    if (!job) { job = { id: ref.id, waiters: new Set(), controller: new AbortController(), priority, started: false }; this.jobs.set(ref.id, job); }
    if (priority) job.priority = true;
    const current = job;
    return new Promise((resolve, reject) => {
      const abort = () => {
        current.waiters.delete(waiter); waiter.detach(); reject({ code: 'cancelled' });
        if (!current.waiters.size) { current.controller.abort(); if (this.jobs.get(current.id) === current) this.jobs.delete(current.id); }
      };
      const waiter: Waiter = { resolve, reject, ref: { ...ref }, signal, detach: () => signal?.removeEventListener('abort', abort) };
      current.waiters.add(waiter); signal?.addEventListener('abort', abort, { once: true }); this.pump();
    });
  };
  private pump() {
    while (this.active < 2) {
      const job = [...this.jobs.values()].filter(value => !value.started && value.waiters.size).sort((a, b) => Number(b.priority) - Number(a.priority))[0];
      if (!job) return;
      job.started = true; this.active++;
      void this.client.metadata({ provider: 'bilibili', kind: 'video', id: job.id }, { signal: job.controller.signal }).then(entry => {
        job.controller.signal.throwIfAborted();
        if(entry.ref.provider!=='bilibili'||entry.ref.id!==job.id)throw {code:'protocol'};
        this.seed(entry);
        for (const waiter of job.waiters) {
          waiter.detach();
          try { waiter.resolve(this.select(entry, waiter.ref)); } catch (error) { waiter.reject(error); }
        }
      }).catch(error => { for (const waiter of job.waiters) { waiter.detach(); waiter.reject(error); } }).finally(() => {
        job.waiters.clear(); this.active--; if (this.jobs.get(job.id) === job) this.jobs.delete(job.id); this.pump();
      });
    }
  }
  dispose() { for (const job of this.jobs.values()) { job.controller.abort(); for (const waiter of job.waiters) { waiter.detach(); waiter.reject({ code: 'cancelled' }); } job.waiters.clear(); } this.jobs.clear(); this.listeners.clear(); }
}

/** Validate the whole expansion before changing the live queue. Keep occurrence IDs, not just refs. */
export function planPartExpansion(items: QueueTrack[], anchorId: string, input: Track[], newId: () => string) {
  const at = items.findIndex(item => item.resourceId === anchorId), anchor = items[at];
  if (at < 0 || !anchor || !('ref' in anchor) || anchor.ref.provider !== 'bilibili') throw { code: 'cancelled' };
  if (!input.length) throw { code: 'invalid-input' };
  const parts = selectMusicParts({ ...input[0], parts: input }, { mode: 'all' });
  if (parts[0].ref.id !== anchor.ref.id || !parts.some(part => part.ref.part === anchor.ref.part)) throw { code: 'not-found' };
  const groupId = anchor.partsGroupId ?? newId();
  const members = items.filter((item): item is Track => 'ref' in item && (item.resourceId === anchorId || item.partsGroupId === groupId) && item.ref.provider === 'bilibili' && item.ref.id === anchor.ref.id);
  const existing = new Map(members.map(item => [item.ref.part, item]));
  const additions: Track[] = [];
  const group = parts.map(part => {
    const saved = existing.get(part.ref.part);
    if (saved) return { ...saved, partsGroupId: groupId };
    const value = { ...part, resourceId: newId(), partsGroupId: groupId }; additions.push(value); return value;
  });
  // Keep a previously queued P if an updated upstream snapshot no longer lists it.
  group.push(...members.filter(item => !parts.some(part => part.ref.part === item.ref.part)).map(item => ({ ...item, partsGroupId: groupId })));
  if (items.length + additions.length > 500) throw { code: 'queue-limit' };
  const memberIds = new Set(members.map(item => item.resourceId));
  const before = items.slice(0, at).filter(item => !memberIds.has(item.resourceId)).length;
  const remaining = items.filter(item => !memberIds.has(item.resourceId));
  return { additions, group, items: [...remaining.slice(0, before), ...group, ...remaining.slice(before)] };
}
