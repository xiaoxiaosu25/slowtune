import { DatabaseSync } from 'node:sqlite';

/** Disposable source snapshots, isolated from the library and account credentials. */
export class BrowseCache {
  private db: DatabaseSync;
  constructor(path: string, private user: string) {
    this.db = new DatabaseSync(path);
    this.db.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=1000; CREATE TABLE IF NOT EXISTS browse_cache(user TEXT,kind TEXT,cache_key TEXT,value TEXT,updated INTEGER,PRIMARY KEY(user,kind,cache_key));');
  }
  read<T>(kind: string, key: string): T | undefined {
    const row = this.db.prepare('SELECT value FROM browse_cache WHERE user=? AND kind=? AND cache_key=?').get(this.user,kind,key);
    try { return row ? JSON.parse(String(row.value)) as T : undefined; } catch { return undefined; }
  }
  write(kind: string, key: string, value: unknown, limit = 32) {
    const encoded = JSON.stringify(value);
    if (Buffer.byteLength(encoded) > 4 * 1024 * 1024) return;
    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.db.prepare('INSERT OR REPLACE INTO browse_cache VALUES(?,?,?,?,?)').run(this.user,kind,key,encoded,Date.now());
      this.db.prepare('DELETE FROM browse_cache WHERE user=? AND kind=? AND cache_key NOT IN (SELECT cache_key FROM browse_cache WHERE user=? AND kind=? ORDER BY updated DESC,rowid DESC LIMIT ?)').run(this.user,kind,this.user,kind,limit);
      this.db.exec('COMMIT');
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  entries<T>(kind: string): [string,T][] {
    return this.db.prepare('SELECT cache_key,value FROM browse_cache WHERE user=? AND kind=? ORDER BY updated,rowid').all(this.user,kind).flatMap(row => {
      try { return [[String(row.cache_key),JSON.parse(String(row.value)) as T] as [string,T]]; } catch { return []; }
    });
  }
  close() { this.db.close(); }
}
