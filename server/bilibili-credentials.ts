import { spawn } from 'node:child_process';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { MusicSourceError, type Credential } from '@studio/music-sources';

// DPAPI binds saved credentials to the Windows user running this personal service.
async function dpapi(value: string, decrypt: boolean): Promise<string> {
  if (process.platform !== 'win32') throw new Error('Secure credential storage requires Windows.');
  const operation = decrypt ? 'Unprotect' : 'Protect';
  const input = decrypt ? '[Convert]::FromBase64String($inputText)' : '[Text.Encoding]::UTF8.GetBytes($inputText)';
  const output = decrypt ? '[Text.Encoding]::UTF8.GetString($result)' : '[Convert]::ToBase64String($result)';
  const script = `$ErrorActionPreference='Stop'; Add-Type -AssemblyName System.Security; $inputText=[Console]::In.ReadToEnd(); $result=[Security.Cryptography.ProtectedData]::${operation}(${input},$null,[Security.Cryptography.DataProtectionScope]::CurrentUser); [Console]::Out.Write(${output})`;
  return new Promise((resolve, reject) => {
    const child = spawn(join(process.env.SystemRoot ?? 'C:/Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe'), ['-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    let result = '', bytes = 0;
    const timer = setTimeout(() => { child.kill(); reject(new Error('Credential encryption timed out.')); }, 15000);
    child.stdout.on('data', chunk => { bytes += chunk.length; if (bytes > 131072) child.kill(); else result += chunk.toString(); });
    // Never forward PowerShell errors, which can contain sensitive input.
    child.stderr.resume();
    child.once('error', () => { clearTimeout(timer); reject(new Error('Credential encryption unavailable.')); });
    child.once('close', code => { clearTimeout(timer); if (code === 0 && result && bytes <= 131072) resolve(result); else reject(new Error('Credential encryption failed.')); });
    child.stdin.on('error', () => {});
    child.stdin.end(value);
  });
}

export class BilibiliCredentials {
  private value?: Credential;
  private pending: Promise<unknown> = Promise.resolve();
  loadFailed = false;
  constructor(readonly file: string, readonly ref: string) {}
  get revision() { return this.value?.revision; }
  async open() {
    try {
      const saved = JSON.parse(await readFile(this.file, 'utf8'));
      if (saved.version !== 1 || typeof saved.protected !== 'string') throw new Error('Invalid credential envelope.');
      const value = JSON.parse(await dpapi(saved.protected, true));
      this.validate(value);
      this.value = value;
    } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') this.loadFailed = true; }
    return this;
  }
  private validate(value: Credential) {
    if (value?.provider !== 'bilibili' || !value.revision || typeof value.revision !== 'string' || value.revision.length > 200 || typeof value.cookie !== 'string' || !value.cookie || value.cookie.length > 65536 || /[\r\n]/.test(value.cookie)) throw new Error('Invalid credential.');
  }
  private serial<T>(work: () => Promise<T>): Promise<T> {
    const result = this.pending.then(work);
    this.pending = result.catch(() => {});
    return result;
  }
  async read(ref: string, signal: AbortSignal): Promise<Credential> {
    signal.throwIfAborted();
    if (ref !== this.ref || !this.value) throw new MusicSourceError({ code: 'authentication', provider: 'bilibili', retryable: false });
    return { ...this.value };
  }
  write(ref: string, value: Credential, signal: AbortSignal) {
    if (ref !== this.ref) return Promise.reject(new MusicSourceError({ code: 'authentication', retryable: false }));
    this.validate(value);
    const copy = { ...value };
    return this.serial(async () => {
      signal.throwIfAborted();
      const protectedValue = await dpapi(JSON.stringify(copy), false);
      signal.throwIfAborted();
      await mkdir(dirname(this.file), { recursive: true });
      const temporary = this.file + '.' + randomBytes(8).toString('hex') + '.tmp';
      try {
        await writeFile(temporary, JSON.stringify({ version: 1, protected: protectedValue }), { mode: 0o600, flag: 'wx' });
        signal.throwIfAborted();
        await rename(temporary, this.file);
        this.value = copy;
        this.loadFailed = false;
      } finally { await unlink(temporary).catch(() => {}); }
    });
  }
  remove(ref: string, signal: AbortSignal) {
    if (ref !== this.ref) return Promise.reject(new MusicSourceError({ code: 'authentication', retryable: false }));
    return this.serial(async () => {
      signal.throwIfAborted();
      await unlink(this.file).catch(e => { if (e.code !== 'ENOENT') throw e; });
      this.value = undefined;
      this.loadFailed = false;
    });
  }
}
