import { randomUUID } from 'node:crypto';
import type { EntryRef, MusicEntry } from '@studio/music-sources';
import type { BilibiliFavorites, FavoriteContext } from './bilibili-favorites.js';
import { SongLibraryError } from './song-library-errors.js';
import { object, text, list } from './song-library-codec.js';
import { memberKey, validateMember } from './song-library-store.js';
import { applySongEdits } from './song-library-edits.js';
import { pruneUnretainedMembers, syncProjection } from './song-library-relations.js';
import type { SongLibraryService } from './song-library-service.js';
import type { SongLibraryDocument, SongMember, SongSyncMapping } from './song-library-types.js';
import type { SongSyncPreview, SongSyncState } from './song-library-sync-types.js';
import {applySyncLocal,localSyncState,type SyncLocalOperation} from './song-library-sync-local.js';

type Remote = Pick<BilibiliFavorites, 'context' | 'check' | 'folders' | 'videos' | 'aid' | 'change' | 'createFolder'>;
const fail = (code: 'invalid-input' | 'not-found' | 'duplicate' | 'cancelled' | 'busy' = 'invalid-input'): never => { throw new SongLibraryError(code); };
function targetMembers(document: SongLibraryDocument, target: string) {
  const s = document.snapshot;
  const defaults = new Map(s.songs.map(song => [song.id, song.defaultVersionId]));
  if (target === 'system:favorites') return s.favorites.map(f => ({ member: { kind: 'favorite', favoriteId: f.favoriteId } as SongMember, songId: f.songId, versionId: defaults.get(f.songId) }));
  const playlist = s.playlists.find(p => p.id === target) ?? fail('not-found');
  return playlist.entries.map(entry => ({ member: { kind: 'playlist-entry', playlistId: target, entryId: entry.entryId } as SongMember, songId: entry.songId, versionId: entry.pinnedVersionId ?? defaults.get(entry.songId) }));
}
/** All authority and pending work live with songs in the same SQLite aggregate. No sidecar or old model. */
export class SongLibrarySync {
  private stop = new AbortController();
  private work?: Promise<void>;
  private timer?: ReturnType<typeof setInterval>;
  private previews = new Map<string, SongSyncPreview & { owner: string; linkId: string; newPlaylist: boolean; credentialRevision: string | number | undefined; creation?: { title: string; private: boolean; beforeIds: string[] } }>();
  constructor(private library: SongLibraryService, private remote: Remote, private metadata: (ref: EntryRef, c: FavoriteContext) => Promise<MusicEntry>, private now = Date.now) {}
  start() { if (this.timer || this.stop.signal.aborted) return; this.timer = setInterval(() => { void this.run().catch(() => {}); }, 120000); this.timer.unref(); }
  cancelOwner(owner: string) { for (const [id, preview] of this.previews) if (preview.owner === owner) this.previews.delete(id); }
  async state(signal: AbortSignal, folders = false): Promise<SongSyncState> {
    const c = await this.remote.context(AbortSignal.any([signal, this.stop.signal]));
    const response=this.library.store.desktopResponse({type:'sync-state',accountId:c.accountId,busy:!!this.work},c.signal);
    const result:SongSyncState=response?JSON.parse(new TextDecoder().decode(await response)):localSyncState(this.library.store.read(),c.accountId,!!this.work);
    if (folders) result.folders = await this.remote.folders(c);
    this.remote.check(c); return result;
  }
  async preview(owner: string, expected: string | null, input: unknown, signal: AbortSignal) {
    object(input, ['folderId', 'targetId', 'linkId', 'assignments', 'create']); text(owner, 500); text(input.targetId, 200);
    if (input.create !== undefined) {
      object(input.create, ['title', 'private']); text(input.create.title, 20);
      if (typeof input.create.private !== 'boolean' || input.folderId !== undefined || input.linkId !== undefined || input.targetId === 'new') fail();
    } else { text(input.folderId, 20); if (!/^\d{1,20}$/.test(input.folderId)) fail(); }
    if (input.linkId !== undefined) text(input.linkId, 200);
    for (const [id, preview] of this.previews) if (preview.owner === owner || preview.expiresAt <= this.now()) this.previews.delete(id);
    if (this.previews.size >= 4) fail('busy');
    const c = await this.remote.context(AbortSignal.any([signal, this.stop.signal])), stored = this.library.store.read();
    if (stored.revision !== expected) throw new SongLibraryError('conflict', stored.revision);
    const existing = input.linkId ? stored.document.syncLinks.find(link => link.id === input.linkId && link.accountId === c.accountId) ?? fail('not-found') : undefined;
    if (existing && (existing.folderId !== input.folderId || existing.targetId !== input.targetId)) fail();
    if (stored.document.syncLinks.some(link => link.accountId === c.accountId && link.id !== existing?.id && (link.folderId === (input.create ? '0' : input.folderId) || link.targetId === input.targetId))) fail('duplicate');
    const folders = await this.remote.folders(c), folder = input.create ? { id: '0', title: input.create.title.trim(), private: input.create.private, count: 0 } : folders.find(folder => folder.id === input.folderId) ?? fail('not-found');
    const remote = input.create ? [] : await this.remote.videos(folder.id, c); this.remote.check(c);
    const newPlaylist = input.targetId === 'new', targetId = newPlaylist ? randomUUID() : input.targetId;
    const members = newPlaylist ? [] : targetMembers(stored.document, targetId);
    const versions = new Map(stored.document.snapshot.versions.map(version => [version.id, version]));
    if (input.assignments !== undefined) {
      list(input.assignments, 10000); const keys = new Set<string>();
      const memberIndex = new Map(members.map(member => [memberKey(member.member), member]));
      for (const assignment of input.assignments) {
        object(assignment, ['member', 'versionId']); text(assignment.versionId, 200); validateMember(assignment.member);
        const member = memberIndex.get(memberKey(assignment.member)) ?? fail();
        const version = versions.get(assignment.versionId);
        if (!version || version.songId !== member.songId || version.ref.provider !== 'bilibili') fail();
        if (keys.has(memberKey(member.member))) fail(); keys.add(memberKey(member.member)); member.versionId = assignment.versionId;
      }
      // Explicit selection can narrow membership; omitted entries have no remote mapping.
      for (const member of members) if (!keys.has(memberKey(member.member))) member.versionId = null;
    } else if (existing) {
      const previous = new Map<string, SongSyncMapping>();
      for (const mapping of stored.document.syncMappings) if (mapping.linkId === existing.id && !previous.has(memberKey(mapping.member))) previous.set(memberKey(mapping.member), mapping);
      for (const member of members) {
        // An established mapping survives default changes. Only unmapped members get a proposal.
        const mapping = previous.get(memberKey(member.member));
        if (mapping) member.versionId = mapping.versionId;
      }
    }
    const songs = new Map(stored.document.snapshot.songs.map(song => [song.id, song]));
    const assignments = members.flatMap(member => {
      const version = member.versionId ? versions.get(member.versionId) : undefined;
      if (!version || version.songId !== member.songId || version.ref.provider !== 'bilibili') return [];
      return [{ member: member.member, versionId: version.id, title: songs.get(member.songId)!.title, version: version.label || version.facts.title, bvid: version.ref.id }];
    });
    const wanted = new Set(assignments.map(a => a.bvid)), previous = existing ? syncProjection(stored.document, existing.id) : new Set<string>(), actual = new Set(remote.map(v => v.bvid));
    if (assignments.length > 10000 || new Set([...wanted, ...actual]).size > 10000) fail();
    const pendingRemovals = existing ? this.library.store.events().filter(event => event.type === 'sync-intent' && event.linkId === existing.id && event.action === 'remove').map(event => event.bvid!) : [];
    const preview: SongSyncPreview = { token: randomUUID(), revision: expected, expiresAt: this.now() + 5 * 60000, accountId: c.accountId, folder, targetId,
      assignments, remoteCount: remote.length, remoteAdditions: [...wanted].filter(id => !actual.has(id)), remoteRemovals: [...new Set([...previous, ...pendingRemovals])].filter(id => !wanted.has(id) && actual.has(id)), unmapped: members.length - assignments.length };
    this.previews.set(preview.token, { ...preview, owner, linkId: existing?.id ?? randomUUID(), newPlaylist, credentialRevision: c.credential.revision, ...(input.create ? { creation: { title: folder.title, private: folder.private, beforeIds: folders.map(folder => folder.id) } } : {}) });
    return preview;
  }
  async commit(owner: string, token: string, expected: string | null, signal: AbortSignal) {
    const preview = this.previews.get(token);
    if (!preview || preview.owner !== owner || preview.expiresAt <= this.now()) throw new SongLibraryError('expired');
    if (preview.revision !== expected) throw new SongLibraryError('conflict', this.library.read().revision);
    const c = await this.remote.context(AbortSignal.any([signal, this.stop.signal]));
    if (c.accountId !== preview.accountId || c.credential.revision !== preview.credentialRevision) fail('cancelled');
    const committed = this.library.transaction(expected, context => {
      this.remote.check(c);
      if (preview.newPlaylist) applySongEdits(context, [{ type: 'create-playlist', id: preview.targetId, name: preview.folder.title }], this.now());
      let link = context.document.syncLinks.find(link => link.id === preview.linkId);
      if (!link) { link = { id: preview.linkId, accountId: c.accountId, folderId: preview.folder.id, targetId: preview.targetId, state: 'ready', issues: [], observed: [], title: preview.folder.title }; context.document.syncLinks.push(link); }
      link.state = 'ready'; link.issues = []; link.title = preview.folder.title;
      if (preview.creation) { link.state = 'review'; link.issues = ['folder-create-uncertain']; link.creation = preview.creation; }
      const previous = syncProjection(context.document, link.id);
      context.document.syncMappings = context.document.syncMappings.filter(m => m.linkId !== link!.id);
      context.document.syncMappings.push(...preview.assignments.map(a => ({ linkId: link!.id, member: a.member, versionId: a.versionId, bvid: a.bvid })));
      // Explicit mapping replacement grants no local retention to removed remote-only entries.
      pruneUnretainedMembers(context);
      const wanted = syncProjection(context.document, link.id);
      for (const bvid of new Set([...previous, ...wanted])) if (previous.has(bvid) !== wanted.has(bvid) || wanted.has(bvid) && preview.remoteAdditions.includes(bvid)) context.events.push({ type: 'sync-intent', linkId: link.id, bvid, action: wanted.has(bvid) ? 'add' : 'remove' });
    }, signal);
    this.previews.delete(token);
    if (preview.creation) {
      // The possible creation is durable before transmission. Never repeat an uncertain create.
      this.remote.check(c);
      const folder = await this.remote.createFolder(preview.creation.title, preview.creation.private, c);
      this.remote.check(c); const current = this.library.store.read();
      this.library.transaction(current.revision, context => {
        const link = context.document.syncLinks.find(link => link.id === preview.linkId && link.creation && link.accountId === c.accountId) ?? fail('cancelled');
        delete link.creation; link.folderId = folder.id; link.title = folder.title;
        if (current.revision === committed.revision) {
          link.state = 'ready'; link.issues = [];
          for (const bvid of syncProjection(context.document, link.id)) context.events.push({ type: 'sync-intent', linkId: link.id, bvid, action: 'add' });
        } else { link.state = 'review'; link.issues = ['folder-created-review']; context.events.push({ type: 'sync-review', linkId: link.id }); }
      }, signal);
      if (current.revision !== committed.revision) return { library: this.library.read(), sync: await this.state(signal) };
    }
    await this.run(preview.linkId, signal);
    return { library: this.library.read(), sync: await this.state(signal) };
  }
  async control(expected: string | null, input: unknown, signal: AbortSignal) {
    object(input, ['action', 'linkId']); text(input.linkId, 200); if (!['pause', 'unlink', 'run', 'recover-creation'].includes(input.action)) fail();
    const c = await this.remote.context(AbortSignal.any([signal, this.stop.signal]));
    const stored = this.library.store.read(), link = stored.document.syncLinks.find(l => l.id === input.linkId && l.accountId === c.accountId) ?? fail('not-found');
    if (stored.revision !== expected) throw new SongLibraryError('conflict', stored.revision);
    if (input.action === 'recover-creation') {
      if (!link.creation) fail();
      const folders = await this.remote.folders(c); this.remote.check(c);
      const matches = folders.filter(folder => !link.creation!.beforeIds.includes(folder.id) && folder.title === link.creation!.title && folder.private === link.creation!.private);
      if (matches.length !== 1) fail('busy');
      this.library.transaction(expected, context => {
        this.remote.check(c); const current = context.document.syncLinks.find(l => l.id === link.id)!;
        current.folderId = matches[0].id; current.title = matches[0].title; delete current.creation; current.state = 'review'; current.issues = ['folder-created-review']; context.events.push({ type: 'sync-review', linkId: link.id });
      }, signal);
    } else if (input.action === 'run') { if (link.state !== 'ready') fail(); await this.run(link.id, signal); }
    else this.library.transaction(expected, context => {
      this.remote.check(c);
      const current = context.document.syncLinks.find(l => l.id === link.id)!;
      if (input.action === 'pause') { current.state = 'review'; current.issues = ['paused']; context.events.push({ type: 'sync-review', linkId: link.id }); }
      else {
        // Disconnect retains visible members locally and never deletes remote videos.
        const keys = new Set(context.document.syncMappings.filter(m => m.linkId === link.id).map(m => memberKey(m.member)));
        for (const origin of context.document.origins) if (keys.has(memberKey(origin.member))) origin.local = 'present';
        context.document.syncMappings = context.document.syncMappings.filter(m => m.linkId !== link.id);
        context.document.syncLinks = context.document.syncLinks.filter(l => l.id !== link.id);
        context.acknowledge = this.library.store.events().filter(e => e.linkId === link.id).map(e => e.id);
      }
    }, signal);
    return { library: this.library.read(), sync: await this.state(signal) };
  }
  async run(linkId?: string, signal = this.stop.signal) {
    if (this.stop.signal.aborted) return;
    if (!linkId && !this.library.store.read().document.syncLinks.some(link => link.state === 'ready')) return;
    if (this.work) fail('busy');
    const task = this.perform(linkId, AbortSignal.any([signal, this.stop.signal, AbortSignal.timeout(120000)])); this.work = task;
    try { await task; } finally { if (this.work === task) this.work = undefined; }
  }
  private async perform(linkId: string | undefined, signal: AbortSignal) {
    const c = await this.remote.context(signal), initial = this.library.store.read();
    await new Promise<void>(resolve=>setImmediate(resolve));this.remote.check(c);
    const links = initial.document.syncLinks.filter(link => link.accountId === c.accountId && link.state === 'ready' && (!linkId || link.id === linkId));
    if (linkId && !links.length) fail('not-found');
    for (const link of links) {
      this.remote.check(c);
      try { await this.reconcile(link.id, c); }
      catch (error) {
        this.remote.check(c); const latest = this.library.store.read(), current = latest.document.syncLinks.find(l => l.id === link.id && l.accountId === c.accountId);
        if (current && current.state === 'ready') this.library.transaction(latest.revision, context => { context.document.syncLinks.find(l => l.id === link.id)!.issues = [(error as { code?: string }).code ?? 'upstream']; });
        throw error;
      }
    }
  }
  private current(linkId: string, c: FavoriteContext) {
    this.remote.check(c); const stored = this.library.store.read(), link = stored.document.syncLinks.find(link => link.id === linkId && link.accountId === c.accountId && link.state === 'ready') ?? fail('cancelled');
    return { ...stored, link };
  }
  private async local(operation:SyncLocalOperation,c:FavoriteContext){
    this.remote.check(c);
    const pending=this.library.store.desktopSyncTransaction(operation,c.signal,()=>this.remote.check(c));
    if(pending)await pending;
    else this.library.transaction(operation.revision,context=>{this.remote.check(c);applySyncLocal(context,operation);},c.signal);
    this.remote.check(c);
  }
  private async reconcile(linkId: string, c: FavoriteContext) {
    const initial = this.current(linkId, c), folders = await this.remote.folders(c);
    await new Promise<void>(resolve=>setImmediate(resolve));this.remote.check(c);
    if (!folders.some(folder => folder.id === initial.link.folderId)) {
      const current = this.current(linkId, c); this.library.transaction(current.revision, context => { const link = context.document.syncLinks.find(l => l.id === linkId)!; link.state = 'review'; link.issues = ['folder-missing']; context.events.push({ type: 'sync-review', linkId }); }, c.signal); return;
    }
    const videos = await this.remote.videos(initial.link.folderId, c), before = this.current(linkId, c), actual = new Set(videos.map(v => v.bvid));
    const pending = this.library.store.events().filter(e => e.type === 'sync-intent' && e.linkId === linkId), pendingIds = new Set(pending.map(e => e.bvid!));
    const observed = new Set(before.link.observed ?? []), mapped = syncProjection(before.document, linkId);
    const removed = new Set([...observed].filter(id => !actual.has(id) && !pendingIds.has(id)));
    const cursor = videos.findIndex(video => video.bvid === before.link.importCursor), ordered = cursor < 0 ? videos : [...videos.slice(cursor + 1), ...videos.slice(0, cursor + 1)];
    const additions = ordered.filter(video => !observed.has(video.bvid) && !mapped.has(video.bvid) && !pendingIds.has(video.bvid));
    const added = additions.slice(0, 100), deferred = new Set(additions.slice(100).map(video => video.bvid));
    const entries: MusicEntry[] = [], unavailable: string[] = [];
    for (const video of added) {
      this.current(linkId, c);
      try {
        const entry = await this.metadata({ provider: 'bilibili', kind: 'video', id: video.bvid }, c); this.remote.check(c);
        const exact = (entry.ref.part ? entry : entry.parts?.[0]) ?? fail(); if (exact.ref.provider !== 'bilibili' || exact.ref.id !== video.bvid || !exact.ref.part) fail(); entries.push(exact);
      } catch (error) { this.remote.check(c); if ((error as { code?: string }).code === 'not-found') unavailable.push(video.bvid); else throw error; }
    }
    await this.local({type:'observe',revision:before.revision,linkId,accountId:c.accountId,now:this.now(),removed:[...removed],entries,videos:videos.map(video=>video.bvid),unavailable,deferred:[...deferred],...(added.length?{importCursor:added.at(-1)!.bvid}:{})},c);
    // Re-read current account, link, mappings and durable intention after every asynchronous step.
    for (const event of this.library.store.events().filter(event => event.type === 'sync-intent' && event.linkId === linkId)) {
      let current = this.current(linkId, c), desired = syncProjection(current.document, linkId).has(event.bvid!);
      const stillPending = () => this.library.store.events().some(e => e.id === event.id);
      if (!stillPending() || desired !== (event.action === 'add')) {
        this.library.transaction(current.revision, context => { context.acknowledge.push(event.id); }, c.signal); continue;
      }
      const aid = videos.find(video => video.bvid === event.bvid)?.aid ?? await this.remote.aid(event.bvid!, c);
      current = this.current(linkId, c); desired = syncProjection(current.document, linkId).has(event.bvid!);
      if (!stillPending() || desired !== (event.action === 'add')) continue;
      if (actual.has(event.bvid!) !== desired) await this.remote.change(current.link.folderId, aid, desired, c);
      current = this.current(linkId, c);
      if (!stillPending()) continue;
      // A concurrent opposite edit keeps its newer intention; this acknowledgement only owns this event.
      this.library.transaction(current.revision, context => {
        const link = context.document.syncLinks.find(l => l.id === linkId)!;
        const seen = new Set(link.observed ?? []); if (desired) seen.add(event.bvid!); else seen.delete(event.bvid!); link.observed = [...seen]; context.acknowledge.push(event.id);
      }, c.signal);
    }
    const final=this.current(linkId,c);await this.local({type:'complete',revision:final.revision,linkId,accountId:c.accountId,now:this.now()},c);
  }
  async dispose() { this.stop.abort(); clearInterval(this.timer); this.previews.clear(); await Promise.allSettled([this.work]); }
}
