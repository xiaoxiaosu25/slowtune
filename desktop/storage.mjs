import { existsSync, readFileSync } from 'node:fs';
import { mkdir, open, rename } from 'node:fs/promises';
import { join, dirname } from 'node:path';

export const preferenceKey = key => typeof key === 'string' && /^slow-listening:[\w:%.-]{1,500}$/.test(key);
export async function savePreferences(file, json) {
  await mkdir(dirname(file), { recursive: true });
  const handle = await open(file + '.tmp', 'w', 0o600);
  try { await handle.writeFile(json + '\n'); await handle.sync(); }
  finally { await handle.close(); }
  await rename(file + '.tmp', file);
}
// The same ordered atomic writer serves preferences, window state and artwork.
export class DesktopFile {
  constructor(file, { persist = savePreferences, onState = () => {}, delay = 40 } = {}) {
    this.file = file;
    this.values = {}; this.revision = 0; this.committed = 0;
    this.persist = persist; this.onState = onState; this.delay = delay; this.waiters = [];
  }
  read() { return { ...this.values }; }
  state() { return { pending: this.revision !== this.committed, error: this.error ?? null }; }
  notify() { this.onState(this.state()); }
  writeSnapshot(value) { this.values = structuredClone(value); return this.stage(); }
  stage() {
    const revision = ++this.revision;
    const done = new Promise((resolve, reject) => this.waiters.push({ revision, resolve, reject }));
    if (!this.running && !this.timer) this.timer = setTimeout(() => { this.timer = undefined; void this.flush().catch(() => {}); }, this.delay);
    this.notify();
    return done;
  }
  async flush() {
    clearTimeout(this.timer); this.timer = undefined;
    if (this.running) { await this.running; return this.flush(); }
    if (this.committed === this.revision) return;
    this.running = (async () => {
      try {
        while (this.committed !== this.revision) {
          const revision = this.revision, json = JSON.stringify(this.values);
          await this.persist(this.file, json);
          this.committed = revision; this.error = null;
          const completed = this.waiters.filter(item => item.revision <= revision);
          this.waiters = this.waiters.filter(item => item.revision > revision);
          for (const item of completed) item.resolve();
          this.notify();
        }
      } catch (error) {
        this.error = ['ENOSPC', 'EACCES', 'EPERM'].includes(error.code) ? error.code : 'write-failed';
        for (const item of this.waiters.splice(0)) item.reject(new Error('本地设置尚未保存，请检查磁盘空间和资料目录权限后重试。'));
        this.notify(); throw error;
      }
    })();
    try { await this.running; } finally { this.running = undefined; }
    // A resolved write acknowledgement can enqueue another edit before this
    // continuation runs. Drain it too rather than leaving it without a timer.
    if (this.committed !== this.revision) return this.flush();
  }
}

export class DesktopStorage extends DesktopFile {
  constructor(data, options) {
    super(join(data, 'preferences.json'), options);
    if (existsSync(this.file)) {
      const saved = JSON.parse(readFileSync(this.file, 'utf8'));
      if (!saved || typeof saved !== 'object' || Array.isArray(saved)) throw new Error('本地偏好文件损坏，请从备份恢复。');
      for (const [key, value] of Object.entries(saved)) {
        if (!preferenceKey(key) || typeof value !== 'string') throw new Error('本地偏好文件格式无效。');
        this.values[key] = value;
      }
    }
    this.bytes = Buffer.byteLength(JSON.stringify(this.values)) + (Object.keys(this.values).length ? 1 : 0);
    this.entries = Object.keys(this.values).length;
  }
  write(key, value) {
    if (!preferenceKey(key) || value !== null && (typeof value !== 'string' || Buffer.byteLength(value) > 8 * 1024 * 1024)) throw new Error('无效的桌面偏好。');
    const entryBytes = item => Buffer.byteLength(JSON.stringify(key)) + 1 + Buffer.byteLength(JSON.stringify(item)) + 1;
    const previous = Object.hasOwn(this.values, key), nextBytes = this.bytes - (previous ? entryBytes(this.values[key]) : 0) + (value === null ? 0 : entryBytes(value));
    const nextEntries = this.entries - Number(previous) + Number(value !== null);
    if (nextBytes - Number(nextEntries > 0) > 32 * 1024 * 1024) throw new Error('桌面偏好超过保存上限。');
    if (value === null) delete this.values[key]; else this.values[key] = value;
    this.bytes = nextBytes; this.entries = nextEntries;
    return this.stage();
  }
}

const object = value => !!value && typeof value === 'object' && !Array.isArray(value);
export function readDesktopState(file, read = readFileSync) {
  let json;
  try { json = read(file, 'utf8'); }
  catch (error) {
    if (error.code === 'ENOENT') return {};
    throw Object.assign(new Error('desktop-state.json 读取失败（权限、磁盘或文件访问错误）。原文件未改动；请检查资料目录权限、磁盘及文件占用后点击重试。'), { code: 'state-read-failed', cause: error });
  }
  let value;
  try { value = JSON.parse(json); }
  catch (error) { throw Object.assign(new Error('desktop-state.json 的 JSON 已损坏。原文件未改动；请打开资料文件夹，保留原文件后从备份恢复；或将原文件另行改名以重建窗口及歌词设置，再点击重试。'), { code: 'state-json-invalid', cause: error }); }
  const bounds = input => input === undefined || object(input) && ['x', 'y', 'width', 'height'].every(key => input[key] === undefined || Number.isFinite(input[key]));
  const lyrics = value?.lyrics;
  if (!object(value) || !bounds(value.windowBounds) || !bounds(value.overlayBounds)
    || value.windowTheme !== undefined && !['dark', 'light'].includes(value.windowTheme)
    || value.lyricsDefaultsVersion !== undefined && !Number.isInteger(value.lyricsDefaultsVersion)
    || lyrics !== undefined && (!object(lyrics)
      || ['visible', 'locked', 'translations'].some(key => lyrics[key] !== undefined && typeof lyrics[key] !== 'boolean')
      || lyrics.fontSize !== undefined && !Number.isInteger(lyrics.fontSize)
      || lyrics.lines !== undefined && ![1, 2].includes(lyrics.lines)
      || ['color', 'highlight'].some(key => lyrics[key] !== undefined && (typeof lyrics[key] !== 'string' || !/^#[\da-f]{6}$/i.test(lyrics[key]))))) {
    throw Object.assign(new Error('desktop-state.json 格式无效。原文件未改动；请打开资料文件夹，保留原文件后恢复有效备份；或将原文件另行改名以重建窗口及歌词设置，再点击重试。'), { code: 'state-format-invalid' });
  }
  return value;
}

export class DesktopState extends DesktopFile {
  constructor(data, options) {
    super(join(data, 'desktop-state.json'), { delay: 200, ...options });
    // No writer is returned on read failure: defaults can never overwrite it.
    this.values = readDesktopState(this.file);
  }
}
