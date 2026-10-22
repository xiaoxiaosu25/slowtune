import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { SongLibraryError as LibraryError } from './song-library-errors.js';
import type { SourceSettings } from './source-settings-types.js';

export class SourceSettingsStore {
  private db: DatabaseSync;
  constructor(path: string, private user: string) {
    this.db = new DatabaseSync(path);
    this.db.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=1000; CREATE TABLE IF NOT EXISTS source_settings(user TEXT PRIMARY KEY,revision TEXT,value TEXT);');
  }
  read(): SourceSettings {
    const row = this.db.prepare('SELECT revision,value FROM source_settings WHERE user=?').get(this.user);
    return row ? { revision: String(row.revision), youtube: JSON.parse(String(row.value)) } : { revision: 'initial', youtube: { enabled: false, disabledDisplay: 'dim' } };
  }
  save(input: unknown): SourceSettings {
    const value = input as SourceSettings;
    if (!value || typeof value.revision !== 'string' || typeof value.youtube?.enabled !== 'boolean' || !['show','dim','hide'].includes(value.youtube.disabledDisplay)) throw new LibraryError('invalid-input');
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const previous = this.read();
      if (value.revision !== previous.revision) throw new LibraryError('conflict', previous.revision);
      const next = { revision: randomUUID(), youtube: { enabled: value.youtube.enabled, disabledDisplay: value.youtube.disabledDisplay } };
      this.db.prepare('INSERT OR REPLACE INTO source_settings VALUES(?,?,?)').run(this.user,next.revision,JSON.stringify(next.youtube));
      this.db.exec('COMMIT'); return next;
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  close() { this.db.close(); }
}
