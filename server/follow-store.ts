import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { SongLibraryError as LibraryError } from './song-library-errors.js';
import type { MusicEntry } from '@studio/music-sources';
import { creatorKey, type CreatorRef, type FollowedCreator, type FollowState } from './follow-types.js';
import { artworkUrl } from './artwork-url.js';

export function validateCreator(value: unknown): CreatorRef {
  const creator = value as CreatorRef;
  if (!creator || !['bilibili','youtube'].includes(creator.provider) || typeof creator.id !== 'string' ||
    !(creator.provider === 'bilibili' ? /^[1-9]\d{0,19}$/ : /^UC[\w-]{22}$/).test(creator.id)) throw new LibraryError('invalid-input');
  return { provider: creator.provider, id: creator.id };
}

export class FollowStore {
  private db: DatabaseSync;
  constructor(path: string, private user: string) {
    this.db = new DatabaseSync(path);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=1000;
      CREATE TABLE IF NOT EXISTS follow_state(user TEXT PRIMARY KEY, revision TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS followed_creator(user TEXT, provider TEXT, id TEXT, value TEXT NOT NULL, PRIMARY KEY(user,provider,id));
      CREATE TABLE IF NOT EXISTS creator_updates(user TEXT, creator TEXT, fetched_at INTEGER, value TEXT NOT NULL, PRIMARY KEY(user,creator));`);
    this.db.prepare('INSERT OR IGNORE INTO follow_state VALUES(?,?)').run(user, randomUUID());
  }
  read(): FollowState {
    return { revision: String(this.db.prepare('SELECT revision FROM follow_state WHERE user=?').get(this.user)!.revision),
      creators: this.db.prepare('SELECT value FROM followed_creator WHERE user=? ORDER BY rowid DESC').all(this.user).map(row => JSON.parse(String(row.value))) };
  }
  check(revision: unknown) { const current = this.read(); if (revision !== current.revision) throw new LibraryError('conflict', current.revision); return current; }
  change(revision: unknown, creator: CreatorRef | FollowedCreator, follow: boolean, signal: AbortSignal): FollowState {
    const ref = validateCreator(creator);
    signal.throwIfAborted();
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const current = this.check(revision), exists = current.creators.some(c => creatorKey(c) === creatorKey(ref));
      if (follow && !exists) {
        if (current.creators.length >= 100) throw new LibraryError('invalid-input');
        const value = creator as FollowedCreator;
        if (!value.name?.trim() || !value.url || !Number.isFinite(value.followedAt)) throw new LibraryError('invalid-input');
        this.db.prepare('INSERT INTO followed_creator VALUES(?,?,?,?)').run(this.user,ref.provider,ref.id,JSON.stringify(value));
      } else if (!follow && exists) {
        this.db.prepare('DELETE FROM followed_creator WHERE user=? AND provider=? AND id=?').run(this.user,ref.provider,ref.id);
        this.db.prepare('DELETE FROM creator_updates WHERE user=? AND creator=?').run(this.user,creatorKey(ref));
      }
      signal.throwIfAborted();
      if (exists !== follow) this.db.prepare('UPDATE follow_state SET revision=? WHERE user=?').run(randomUUID(),this.user);
      this.db.exec('COMMIT'); return this.read();
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  cached(creator: CreatorRef): { fetchedAt: number; items: MusicEntry[] } | undefined {
    const row = this.db.prepare('SELECT fetched_at,value FROM creator_updates WHERE user=? AND creator=?').get(this.user,creatorKey(creator));
    return row ? { fetchedAt: Number(row.fetched_at), items: JSON.parse(String(row.value)) } : undefined;
  }
  updateArtwork(creator: CreatorRef, artwork: unknown, signal: AbortSignal) {
    const ref=validateCreator(creator),url=artworkUrl(artwork);signal.throwIfAborted();if(!url)return;
    const row=this.db.prepare('SELECT value FROM followed_creator WHERE user=? AND provider=? AND id=?').get(this.user,ref.provider,ref.id);
    if(!row)return;const current=JSON.parse(String(row.value)) as FollowedCreator;
    if(current.artwork===url)return;
    // Enrich existing metadata only; keep membership, follow time and conditional-write revision.
    this.db.prepare('UPDATE followed_creator SET value=? WHERE user=? AND provider=? AND id=? AND value=?').run(JSON.stringify({...current,artwork:url}),this.user,ref.provider,ref.id,String(row.value));
  }
  remember(creator: CreatorRef, items: MusicEntry[], fetchedAt: number) {
    // A request that completed after an unfollow must not restore that author's cache.
    if (!this.read().creators.some(c => creatorKey(c) === creatorKey(creator))) return;
    const previous = this.cached(creator)?.items ?? [];
    const merged = [...new Map([...previous,...items].map(item => [item.ref.id,item])).values()]
      .sort((a,b) => (b.publishedAt ?? 0)-(a.publishedAt ?? 0)).slice(0,300);
    this.db.prepare('INSERT OR REPLACE INTO creator_updates VALUES(?,?,?,?)').run(this.user,creatorKey(creator),fetchedAt,JSON.stringify(merged));
  }
  close() { this.db.close(); }
}
