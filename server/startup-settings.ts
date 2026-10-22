import { DatabaseSync } from 'node:sqlite';
import { randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto';
import { SongLibraryError as LibraryError } from './song-library-errors.js';
import { defaultWelcome, type AccessState, type WelcomeSettings, type WelcomeState } from './startup-types.js';

export class StartupError extends Error {
  constructor(public code: 'access-code-invalid' | 'access-code-format' | 'welcome-image-invalid') { super(code); }
}
type AccessRecord = AccessState & { salt: string; digest: string };
const hash = (code: string, salt: string) => scryptSync(code, salt, 32).toString('hex');
const newSecret = (code: string) => { const salt = randomBytes(16).toString('hex'); return { salt, digest: hash(code, salt) }; };
const validCode = (code: unknown): code is string => typeof code === 'string' && code.length >= 6 && code.length <= 256 && code.trim().length > 0;

// Only decoded raster formats are accepted. Uploads are re-encoded by the browser;
// these independent checks bound storage, dimensions and served content type.
export function decodeWelcomeImage(value: unknown): { bytes: Buffer; mime: string } {
  if (typeof value !== 'string' || value.length > 4 * 1024 * 1024) throw new StartupError('welcome-image-invalid');
  const match = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
  if (!match) throw new StartupError('welcome-image-invalid');
  const bytes = Buffer.from(match[2], 'base64');
  if (!bytes.length || bytes.length > 3 * 1024 * 1024) throw new StartupError('welcome-image-invalid');
  let width = 0, height = 0;
  try {
    if (match[1] === 'png' && bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) && bytes.toString('ascii', 12, 16) === 'IHDR') {
      width = bytes.readUInt32BE(16); height = bytes.readUInt32BE(20);
    } else if (match[1] === 'jpeg' && bytes.readUInt16BE(0) === 0xffd8) {
      let offset = 2;
      while (offset + 4 <= bytes.length) {
        if (bytes[offset++] !== 0xff) break;
        while (bytes[offset] === 0xff) offset++;
        const marker = bytes[offset++];
        if (marker === 0xda || marker === 0xd9) break;
        const size = bytes.readUInt16BE(offset);
        if (size < 2 || offset + size > bytes.length) break;
        if ([0xc0,0xc1,0xc2].includes(marker) && size >= 8) { height = bytes.readUInt16BE(offset+3); width = bytes.readUInt16BE(offset+5); break; }
        offset += size;
      }
    } else if (match[1] === 'webp' && bytes.toString('ascii',0,4) === 'RIFF' && bytes.toString('ascii',8,12) === 'WEBP' && bytes.readUInt32LE(4) === bytes.length-8) {
      const kind = bytes.toString('ascii',12,16);
      if (kind === 'VP8X' && !(bytes[20] & 2)) { width = bytes.readUIntLE(24,3)+1; height = bytes.readUIntLE(27,3)+1; }
      if (kind === 'VP8 ' && bytes.subarray(23,26).equals(Buffer.from([157,1,42]))) { width = bytes.readUInt16LE(26)&0x3fff; height = bytes.readUInt16LE(28)&0x3fff; }
      if (kind === 'VP8L' && bytes[20] === 47) { const bits=bytes.readUInt32LE(21); width=(bits&0x3fff)+1; height=((bits>>>14)&0x3fff)+1; }
    }
  } catch { throw new StartupError('welcome-image-invalid'); }
  if (width < 1 || height < 1 || width > 4096 || height > 4096 || width*height > 12_000_000) throw new StartupError('welcome-image-invalid');
  return { bytes, mime: 'image/'+match[1] };
}

export class StartupSettingsStore {
  private db: DatabaseSync;
  constructor(path: string, private user: string, initialCode: string) {
    this.db = new DatabaseSync(path);
    this.db.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=1000; CREATE TABLE IF NOT EXISTS startup_access(user TEXT PRIMARY KEY,value TEXT NOT NULL); CREATE TABLE IF NOT EXISTS startup_welcome(user TEXT PRIMARY KEY,revision TEXT NOT NULL,value TEXT NOT NULL); CREATE TABLE IF NOT EXISTS startup_image(user TEXT PRIMARY KEY,id TEXT NOT NULL,mime TEXT NOT NULL,bytes BLOB NOT NULL);');
    if (!this.db.prepare('SELECT 1 FROM startup_access WHERE user=?').get(this.user)) this.db.prepare('INSERT INTO startup_access VALUES(?,?)').run(this.user, JSON.stringify({ revision: randomUUID(), authenticationRequired: true, ...newSecret(initialCode) }));
  }
  private accessRecord(): AccessRecord {
    const row = this.db.prepare('SELECT value FROM startup_access WHERE user=?').get(this.user);
    if (!row) throw new Error('Missing access settings');
    return JSON.parse(String(row.value));
  }
  access(): AccessState { const {revision,authenticationRequired}=this.accessRecord(); return {revision,authenticationRequired}; }
  verify(code: unknown) {
    if (typeof code !== 'string' || code.length > 256) return false;
    const {salt,digest}=this.accessRecord();
    return timingSafeEqual(Buffer.from(hash(code,salt),'hex'),Buffer.from(digest,'hex'));
  }
  changeAccess(input: {revision?:unknown;currentAccessKey?:unknown;authenticationRequired?:unknown;newAccessKey?:unknown}): AccessState {
    if(!input||typeof input!=='object'||Array.isArray(input))throw new LibraryError('invalid-input');
    const previous=this.accessRecord();
    if (!this.verify(input.currentAccessKey)) throw new StartupError('access-code-invalid');
    if (input.revision !== previous.revision) throw new LibraryError('conflict',previous.revision);
    if (typeof input.authenticationRequired !== 'boolean') throw new LibraryError('invalid-input');
    if (input.newAccessKey !== undefined && !validCode(input.newAccessKey)) throw new StartupError('access-code-format');
    const next={...previous,revision:randomUUID(),authenticationRequired:input.authenticationRequired,...(typeof input.newAccessKey==='string'?newSecret(input.newAccessKey):{})};
    this.db.prepare('UPDATE startup_access SET value=? WHERE user=?').run(JSON.stringify(next),this.user);
    return this.access();
  }
  welcome(): WelcomeState {
    const row=this.db.prepare('SELECT revision,value FROM startup_welcome WHERE user=?').get(this.user);
    return row?{revision:String(row.revision),welcome:JSON.parse(String(row.value))}:{revision:'initial',welcome:defaultWelcome()};
  }
  saveWelcome(input: {revision?:unknown;welcome?:unknown;image?:unknown}): WelcomeState {
    if(!input||typeof input!=='object'||Array.isArray(input))throw new LibraryError('invalid-input');
    const value=input.welcome as WelcomeSettings;
    const focus=(point: WelcomeSettings['desktopFocus'])=>point&&[point.x,point.y].every(n=>typeof n==='number'&&Number.isFinite(n)&&n>=0&&n<=100);
    if (!value || !['builtin','custom','plain'].includes(value.background) || !['left','center','right'].includes(value.position) || !focus(value.desktopFocus) || !focus(value.mobileFocus) || !Number.isFinite(value.shade) || value.shade<0 || value.shade>70) throw new LibraryError('invalid-input');
    const image=input.image===undefined?undefined:decodeWelcomeImage(input.image);
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const previous=this.welcome();
      if(input.revision!==previous.revision)throw new LibraryError('conflict',previous.revision);
      const saved=this.db.prepare('SELECT id FROM startup_image WHERE user=?').get(this.user);
      const imageId=image?randomUUID():saved?String(saved.id):undefined;
      if(value.background==='custom'&&!imageId)throw new StartupError('welcome-image-invalid');
      if(image)this.db.prepare('INSERT OR REPLACE INTO startup_image VALUES(?,?,?,?)').run(this.user,imageId!,image.mime,image.bytes);
      const next:WelcomeState={revision:randomUUID(),welcome:{background:value.background,desktopFocus:{...value.desktopFocus},mobileFocus:{...value.mobileFocus},shade:value.shade,position:value.position,...(imageId?{imageId}:{})}};
      this.db.prepare('INSERT OR REPLACE INTO startup_welcome VALUES(?,?,?)').run(this.user,next.revision,JSON.stringify(next.welcome));
      this.db.exec('COMMIT');return next;
    } catch(error){this.db.exec('ROLLBACK');throw error;}
  }
  image(id: string) { const row=this.db.prepare('SELECT mime,bytes FROM startup_image WHERE user=? AND id=?').get(this.user,id); return row?{mime:String(row.mime),bytes:row.bytes as Uint8Array}:undefined; }
  exportWelcome() {
    const {welcome}=this.welcome(),image=welcome.imageId?this.image(welcome.imageId):undefined;
    return {format:'slowtune-welcome',version:1,welcome,...(image?{image:`data:${image.mime};base64,${Buffer.from(image.bytes).toString('base64')}`}:{})};
  }
  resetAccess(code: string) {
    if(!validCode(code))throw new StartupError('access-code-format');
    this.db.prepare('UPDATE startup_access SET value=? WHERE user=?').run(JSON.stringify({revision:randomUUID(),authenticationRequired:true,...newSecret(code)}),this.user);
  }
  close(){this.db.close();}
}
