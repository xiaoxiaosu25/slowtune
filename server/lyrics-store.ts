import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { songSourceKey } from './song-library-policy.js';
import type { SongVideoRef } from './song-library-types.js';
import { LyricsError, type LyricDocument, type LyricState } from './lyrics-types.js';

export function lyricSource(value: unknown): SongVideoRef {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !['provider', 'kind', 'id', 'part'].includes(key))) throw new LyricsError('invalid-input');
  try { songSourceKey(value as SongVideoRef); } catch { throw new LyricsError('invalid-input'); }
  return value as SongVideoRef;
}
export function lyricRevision(value: unknown): string | null {
  if (value === null || typeof value === 'string' && value.length > 0 && value.length <= 100) return value;
  throw new LyricsError('invalid-input');
}
export function lyricOffset(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || Math.abs(value) > 600000) throw new LyricsError('invalid-input');
  return value;
}

/** Choices are durable snapshots; a refreshed or evicted provider cache cannot alter them. */
export class LyricsStore {
  private db: DatabaseSync;
  constructor(path: string, private user: string) {
    this.db = new DatabaseSync(path);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=1000;
      CREATE TABLE IF NOT EXISTS lyric_choices(user TEXT,source TEXT,revision TEXT,offset INTEGER,document TEXT,PRIMARY KEY(user,source));
      CREATE TABLE IF NOT EXISTS lyric_cache(user TEXT,id TEXT,updated INTEGER,document TEXT,PRIMARY KEY(user,id));`);
  }
  read(ref: SongVideoRef): LyricState {
    const row = this.db.prepare('SELECT revision,offset,document FROM lyric_choices WHERE user=? AND source=?').get(this.user, songSourceKey(ref));
    return row ? { revision: String(row.revision), offsetMs: Number(row.offset), document: row.document ? JSON.parse(String(row.document)) : null } : { revision: null, offsetMs: 0, document: null };
  }
  update(ref: SongVideoRef, expected: string | null, edit: (state: LyricState) => void, signal: AbortSignal): LyricState {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const state = this.read(ref);
      if (state.revision !== expected) throw new LyricsError('conflict', state.revision);
      edit(state);
      if (state.revision === null && Number(this.db.prepare('SELECT count(*) AS n FROM lyric_choices WHERE user=?').get(this.user)?.n) >= 5000) throw new LyricsError('busy');
      signal.throwIfAborted();
      this.db.prepare('INSERT OR REPLACE INTO lyric_choices VALUES(?,?,?,?,?)').run(this.user, songSourceKey(ref), randomUUID(), state.offsetMs, state.document ? JSON.stringify(state.document) : null);
      this.db.exec('COMMIT');
      return this.read(ref);
    } catch (error) { this.db.exec('ROLLBACK'); if (signal.aborted) throw new LyricsError('cancelled'); throw error; }
  }
  cached(id: string, now: number): LyricDocument | undefined {
    const row = this.db.prepare('SELECT document FROM lyric_cache WHERE user=? AND id=? AND updated>?').get(this.user, id, now - 86400000);
    return row ? JSON.parse(String(row.document)) : undefined;
  }
  cache(document: LyricDocument, now: number) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.db.prepare('INSERT OR REPLACE INTO lyric_cache VALUES(?,?,?,?)').run(this.user, document.provider + ':' + document.id, now, JSON.stringify(document));
      this.db.prepare('DELETE FROM lyric_cache WHERE user=? AND id NOT IN (SELECT id FROM lyric_cache WHERE user=? ORDER BY updated DESC,id LIMIT 200)').run(this.user, this.user);
      this.db.exec('COMMIT');
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  close() { this.db.close(); }
}
