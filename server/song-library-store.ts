import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';
import { SongLibraryError as LibraryError } from './song-library-errors.js';
import { decodeSongLibrarySnapshot, emptySongLibrary, object, text, list } from './song-library-codec.js';
import type { SongLibraryDocument, SongLibraryEvent, SongMember } from './song-library-types.js';
import { DesktopLibraryWorker, type DesktopLibraryOperation } from './song-library-worker-client.js';

export const memberKey = (member: SongMember) => member.kind === 'favorite' ? JSON.stringify(['favorite', member.favoriteId]) : JSON.stringify(['playlist-entry', member.playlistId, member.entryId]);
export const emptySongDocument = (): SongLibraryDocument => ({ snapshot: emptySongLibrary(), origins: [], syncMappings: [], syncLinks: [] });
export function members(document: SongLibraryDocument) {
  return new Map([
    ...document.snapshot.favorites.map(f => [memberKey({ kind: 'favorite', favoriteId: f.favoriteId }), f.songId] as const),
    ...document.snapshot.playlists.flatMap(p => p.entries.map(e => [memberKey({ kind: 'playlist-entry', playlistId: p.id, entryId: e.entryId }), e.songId] as const)),
  ]);
}
export function validateMember(value: unknown): asserts value is SongMember {
  object(value, (value as any)?.kind === 'favorite' ? ['kind', 'favoriteId'] : ['kind', 'playlistId', 'entryId']);
  if (value.kind === 'favorite') text(value.favoriteId, 200);
  else { if (value.kind !== 'playlist-entry') throw new LibraryError('invalid-input'); text(value.playlistId, 200); text(value.entryId, 200); }
}
export function decodeSongDocument(input: unknown, copy = true): SongLibraryDocument {
  object(input, ['snapshot', 'origins', 'syncMappings', 'syncLinks']);
  const snapshot = decodeSongLibrarySnapshot(input.snapshot,copy);
  list(input.origins, 200000); list(input.syncMappings, 200000); list(input.syncLinks, 1000);
  const document = { ...input, snapshot } as unknown as SongLibraryDocument;
  const memberSongs = members(document), originKeys = new Set<string>(), links = new Map<string, SongLibraryDocument['syncLinks'][number]>(), targets = new Set<string>(), folders = new Set<string>();
  for (const link of document.syncLinks) {
    object(link, ['id', 'accountId', 'folderId', 'targetId', 'state', 'issues', 'title', 'observed', 'lastSync', 'creation', 'importCursor']); text(link.id, 200); text(link.targetId, 200); list(link.issues, 100); link.issues.forEach(issue => text(issue, 100));
    if (link.importCursor !== undefined && (typeof link.importCursor !== 'string' || !/^BV[\da-zA-Z]{10}$/.test(link.importCursor))) throw new LibraryError('invalid-input');
    if (link.creation !== undefined) {
      object(link.creation, ['title', 'private', 'beforeIds']); text(link.creation.title, 20); list(link.creation.beforeIds, 1000);
      if (typeof link.creation.private !== 'boolean' || link.creation.beforeIds.some(id => typeof id !== 'string' || !/^\d{1,20}$/.test(id)) || link.folderId !== '0' || link.state !== 'review') throw new LibraryError('invalid-input');
    }
    if (link.title !== undefined) text(link.title, 1000);
    if (link.lastSync !== undefined && (!Number.isSafeInteger(link.lastSync) || link.lastSync < 0)) throw new LibraryError('invalid-input');
    if (link.observed !== undefined) { list(link.observed, 10000); if (new Set(link.observed).size !== link.observed.length || link.observed.some(id => !/^BV[\da-zA-Z]{10}$/.test(id))) throw new LibraryError('invalid-input'); }
    text(link.accountId, 20); text(link.folderId, 20);
    if (!/^\d{1,20}$/.test(link.accountId) || !/^\d{1,20}$/.test(link.folderId) || !['ready', 'review'].includes(link.state)) throw new LibraryError('invalid-input');
    const target = JSON.stringify([link.accountId, link.targetId]), folder = JSON.stringify([link.accountId, link.folderId]);
    if (links.has(link.id) || targets.has(target) || folders.has(folder)) throw new LibraryError('duplicate');
    if (link.state === 'ready' && link.targetId !== 'system:favorites' && !snapshot.playlists.some(p => p.id === link.targetId)) throw new LibraryError('invalid-input');
    links.set(link.id, link); targets.add(target); folders.add(folder);
  }
  for (const origin of document.origins) {
    object(origin, ['member', 'local']); validateMember(origin.member); const key = memberKey(origin.member);
    if (!memberSongs.has(key) || originKeys.has(key) || !['present', 'absent'].includes(origin.local)) throw new LibraryError('invalid-input'); originKeys.add(key);
  }
  if (originKeys.size !== memberSongs.size) throw new LibraryError('invalid-input');
  const versions = new Map(snapshot.versions.map(v => [v.id, v])), mappingKeys = new Set<string>(), contributions = new Set<string>();
  for (const mapping of document.syncMappings) {
    object(mapping, ['linkId', 'member', 'bvid', 'versionId']); validateMember(mapping.member); text(mapping.linkId, 200); text(mapping.versionId, 200);
    const key = memberKey(mapping.member), link = links.get(mapping.linkId), version = versions.get(mapping.versionId);
    if (!link || !memberSongs.has(key) || !version || version.songId !== memberSongs.get(key) || version.ref.provider !== 'bilibili' || version.ref.id !== mapping.bvid) throw new LibraryError('invalid-input');
    if (mapping.member.kind === 'favorite' ? link.targetId !== 'system:favorites' : link.targetId !== mapping.member.playlistId) throw new LibraryError('invalid-input');
    const identity = JSON.stringify([mapping.linkId, key, mapping.bvid]); if (mappingKeys.has(identity)) throw new LibraryError('duplicate'); mappingKeys.add(identity);
    contributions.add(key);
  }
  for (const origin of document.origins) {
    const key = memberKey(origin.member);
    if (origin.local === 'absent' && !contributions.has(key)) throw new LibraryError('invalid-input');
  }
  return copy?structuredClone(document):document;
}
export type EventDraft = Omit<SongLibraryEvent, 'id' | 'revision' | 'createdAt'>;
export interface TransactionContext { document: SongLibraryDocument; events: EventDraft[]; acknowledge: string[]; }
export interface StoredSongLibrary { modelVersion: 1; revision: string | null; document: SongLibraryDocument; }

/** No default path or scheduler. A reducer must be synchronous and perform no I/O. */
export class SongLibraryStore {
  private db: DatabaseSync;
  private cached?: StoredSongLibrary;
  private encoded?:{revision:string|null;json:string};
  private surface=new AsyncLocalStorage<boolean>();
  private desktopWorker?: DesktopLibraryWorker;
  /** Scoped by the authenticated HTTP adapter; no mobile/default behavior changes. */
  onSurface<T>(desktop:boolean,task:()=>T):T{return this.surface.run(desktop,task);}
  constructor(readonly path: string, readonly userSpace: string, private now = Date.now) {
    text(userSpace, 500); this.db = new DatabaseSync(path);
    try {
      const tables = this.db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(row => String(row.name));
      if (tables.some(name => !['song_library', 'song_library_events'].includes(name))) throw new LibraryError('invalid-input');
      const schema = Number(this.db.prepare('PRAGMA user_version').get()!.user_version);
      if (![0, 1].includes(schema)) throw new LibraryError('unknown-version');
      this.db.exec(`PRAGMA busy_timeout=1000; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA user_version=1;
        CREATE TABLE IF NOT EXISTS song_library(scope TEXT PRIMARY KEY,revision TEXT NOT NULL,document TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS song_library_events(scope TEXT,id TEXT,revision TEXT,document TEXT NOT NULL,PRIMARY KEY(scope,id));`);
    } catch (error) { this.db.close(); throw error; }
  }
  revision(): string | null {
    const row = this.db.prepare('SELECT revision FROM song_library WHERE scope=?').get(this.userSpace);
    return row ? String(row.revision) : null;
  }
  read(): StoredSongLibrary {
    if(this.surface.getStore()){
      const revision=this.revision();
      if(this.encoded?.revision===revision)return JSON.parse(this.encoded.json);
      const row=this.db.prepare('SELECT revision,document FROM song_library WHERE scope=?').get(this.userSpace);
      const saved={modelVersion:1 as const,revision:row?String(row.revision):null,document:row?decodeSongDocument(JSON.parse(String(row.document)),false):emptySongDocument()};
      this.encoded={revision:saved.revision,json:JSON.stringify(saved)};return saved;
    }
    // Check SQLite even on cache hits so writes by another store remain visible.
    if (this.cached && this.cached.revision === this.revision()) return structuredClone(this.cached);
    const row = this.db.prepare('SELECT revision,document FROM song_library WHERE scope=?').get(this.userSpace);
    this.cached = { modelVersion: 1, revision: row ? String(row.revision) : null, document: row ? decodeSongDocument(JSON.parse(String(row.document))) : emptySongDocument() };
    return structuredClone(this.cached);
  }
  private check(signal?: AbortSignal) { if (signal?.aborted) throw new LibraryError('cancelled'); }
  transaction(expected: string | null, reduce: (context: TransactionContext) => void, signal?: AbortSignal): StoredSongLibrary {
    this.check(signal);
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const current = this.read();
      if (expected !== current.revision) throw new LibraryError('conflict', current.revision);
      const context: TransactionContext = { document: current.document, events: [], acknowledge: [] };
      const returned: unknown = reduce(context); if (returned && typeof (returned as any).then === 'function') throw new LibraryError('invalid-input');
      const desktop=this.surface.getStore()===true;
      const document = decodeSongDocument(context.document,!desktop), encoded = JSON.stringify(document);
      const reviewed = new Set(document.syncLinks.filter(link => link.state === 'review' && !(link.issues.length === 1 && link.issues[0] === 'paused')).map(link => link.id));
      context.events = context.events.filter(event => event.type !== 'sync-intent' || !reviewed.has(event.linkId!));
      const row = this.db.prepare('SELECT document FROM song_library WHERE scope=?').get(this.userSpace);
      const changed = !row || row.document !== encoded || context.events.length > 0 || context.acknowledge.length > 0;
      const revision = changed ? randomUUID() : current.revision!;
      if (context.events.length > 10000 || context.acknowledge.length > 100000) throw new LibraryError('invalid-input');
      if (changed) {
        this.db.prepare('INSERT INTO song_library VALUES(?,?,?) ON CONFLICT(scope) DO UPDATE SET revision=excluded.revision,document=excluded.document').run(this.userSpace, revision, encoded);
        // Readers only need the newest invalidation; sync work stays durable until acknowledged.
        this.db.prepare("DELETE FROM song_library_events WHERE scope=? AND json_extract(document,'$.type')='library-changed'").run(this.userSpace);
        for (const linkId of reviewed) this.db.prepare("DELETE FROM song_library_events WHERE scope=? AND json_extract(document,'$.type')='sync-intent' AND json_extract(document,'$.linkId')=?").run(this.userSpace, linkId);
        for (const event of [{ type: 'library-changed' as const }, ...context.events]) {
          object(event, event.type === 'library-changed' ? ['type'] : event.type === 'sync-review' ? ['type', 'linkId'] : ['type', 'linkId', 'bvid', 'action']);
          if (!['library-changed', 'sync-review', 'sync-intent'].includes(event.type)) throw new LibraryError('invalid-input');
          if (event.type !== 'library-changed' && !document.syncLinks.some(l => l.id === event.linkId)) throw new LibraryError('invalid-input');
          if (event.type === 'sync-intent' && (!/^BV[\da-zA-Z]{10}$/.test(event.bvid ?? '') || !['add', 'remove'].includes(event.action ?? ''))) throw new LibraryError('invalid-input');
          if (event.type === 'sync-intent') {
            const referenced = document.syncMappings.some(mapping => mapping.linkId === event.linkId && mapping.bvid === event.bvid);
            if (referenced !== (event.action === 'add')) throw new LibraryError('invalid-input');
            // Each BV has one current durable intention per link; later edits supersede earlier work.
            this.db.prepare("DELETE FROM song_library_events WHERE scope=? AND json_extract(document,'$.type')='sync-intent' AND json_extract(document,'$.linkId')=? AND json_extract(document,'$.bvid')=?").run(this.userSpace, event.linkId!, event.bvid!);
          }
          if (event.type === 'sync-review') this.db.prepare("DELETE FROM song_library_events WHERE scope=? AND json_extract(document,'$.type')='sync-review' AND json_extract(document,'$.linkId')=?").run(this.userSpace, event.linkId!);
          const value: SongLibraryEvent = { ...event, id: randomUUID(), revision, createdAt: this.now() };
          this.db.prepare('INSERT INTO song_library_events VALUES(?,?,?,?)').run(this.userSpace, value.id, revision, JSON.stringify(value));
        }
        for (const id of context.acknowledge) { text(id, 200); this.db.prepare('DELETE FROM song_library_events WHERE scope=? AND id=?').run(this.userSpace, id); }
        if (Number(this.db.prepare('SELECT COUNT(*) AS n FROM song_library_events WHERE scope=?').get(this.userSpace)!.n) > 100000) throw new LibraryError('invalid-input');
      }
      this.check(signal); this.db.exec('COMMIT');
      const saved = { modelVersion: 1 as const, revision, document };
      this.encoded=desktop?{revision,json:'{"modelVersion":1,"revision":'+JSON.stringify(revision)+',"document":'+encoded+'}'}:undefined;
      this.cached = desktop?undefined:structuredClone(saved);
      return saved;
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  events(): SongLibraryEvent[] { return this.db.prepare('SELECT document FROM song_library_events WHERE scope=? ORDER BY rowid').all(this.userSpace).map(r => JSON.parse(String(r.document))); }
  /** File-backed desktop HTTP only; private in-memory fixtures keep their own store. */
  desktopResponse(operation: DesktopLibraryOperation, signal?: AbortSignal) {
    if (!this.surface.getStore() || !this.path || this.path === ':memory:' || this.now !== Date.now) return undefined;
    this.desktopWorker ??= new DesktopLibraryWorker(this.path, this.userSpace);
    return this.desktopWorker.request(operation, signal);
  }
  close() { const stopped = this.desktopWorker?.close(); this.db.close(); return stopped; }
}
