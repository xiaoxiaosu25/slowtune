import { randomUUID } from 'node:crypto';
import { SongLibraryError as LibraryError } from './song-library-errors.js';
import { encodeSongLibrarySnapshot, text, list } from './song-library-codec.js';
import { decodeSongBackup, planSongImport, type ImportImpact } from './song-library-backup.js';
import { SongLibraryStore, type TransactionContext } from './song-library-store.js';
import type { SongLibrarySnapshot } from './song-library-types.js';
import { applySongEdits } from './song-library-edits.js';
import { planSongMaintenance, type SongMaintenanceAction, type SongMaintenanceImpact } from './song-library-maintenance.js';
import { planSongOrganization, type SongOrganizationPreview, type SongOrganizationField } from './song-library-organization.js';

type ImportPreview = { token: string; revision: string | null; expiresAt: number; mode: 'append' | 'replace'; impact: ImportImpact };
type HeldImport = ImportPreview & { owner: string; snapshot: SongLibrarySnapshot };

/** Product authority. Callers provide the authenticated userSpace through the store, never request JSON. */
export class SongLibraryService {
  private previews = new Map<string, HeldImport>();
  private maintenance = new Map<string, { owner: string; revision: string | null; expiresAt: number; action: SongMaintenanceAction; impact: SongMaintenanceImpact }>();
  private organization = new Map<string, SongOrganizationPreview & { owner: string }>();
  constructor(readonly store: SongLibraryStore, private now = Date.now) {}
  revision() { return this.store.revision(); }
  read() { const state = this.store.read(); return { modelVersion: 1 as const, revision: state.revision, snapshot: state.document.snapshot }; }
  export() { return encodeSongLibrarySnapshot(this.store.read().document.snapshot); }
  /** Trusted product adapters only; HTTP clients cannot provide reducers or sync authority. */
  transaction(expected: string | null, reduce: (context: TransactionContext) => void, signal?: AbortSignal) { return this.store.transaction(expected, reduce, signal); }
  execute(expected: string | null, edits: unknown, signal?: AbortSignal) {
    const state = this.store.transaction(expected, context => applySongEdits(context, edits, this.now()), signal);
    return { modelVersion: state.modelVersion, revision: state.revision, snapshot: state.document.snapshot };
  }
  previewImport(owner: string, value: unknown, mode: 'append' | 'replace', expected: string | null, signal?: AbortSignal): ImportPreview {
    if (signal?.aborted) throw new LibraryError('cancelled');
    text(owner, 500);
    for (const [key, preview] of this.previews) if (preview.expiresAt <= this.now()) this.previews.delete(key);
    // One large retained preview per session, at most four per service.
    for (const [key, preview] of this.previews) if (preview.owner === owner) this.previews.delete(key);
    if (this.previews.size >= 4) throw new LibraryError('invalid-input');
    const state = this.store.read(); if (expected !== state.revision) throw new LibraryError('conflict', state.revision);
    const snapshot = decodeSongBackup(value), { impact } = planSongImport(state.document, snapshot, mode);
    const preview = { token: randomUUID(), revision: state.revision, expiresAt: this.now() + 5 * 60000, mode, impact };
    if (signal?.aborted) throw new LibraryError('cancelled');
    this.previews.set(preview.token, { ...preview, owner, snapshot }); return structuredClone(preview);
  }
  commitImport(owner: string, token: string, expected: string | null, signal?: AbortSignal) {
    const preview = this.previews.get(token);
    if (!preview || preview.owner !== owner || preview.expiresAt <= this.now()) throw new LibraryError('expired');
    if (preview.revision !== expected) throw new LibraryError('conflict', this.store.read().revision);
    if (preview.impact.conflicts.length) throw new LibraryError('duplicate');
    const state = this.store.transaction(expected, context => {
      const plan = planSongImport(context.document, preview.snapshot, preview.mode);
      if (plan.impact.conflicts.length) throw new LibraryError('duplicate');
      context.document = plan.document;
      // Replaced or affected targets must never replay old pending remote actions.
      const affected = new Set(plan.impact.reviewLinks);
      context.acknowledge = this.store.events().filter(e => e.linkId && affected.has(e.linkId)).map(e => e.id);
      context.events.push(...plan.impact.reviewLinks.map(linkId => ({ type: 'sync-review' as const, linkId })));
    }, signal);
    this.previews.delete(token); return { modelVersion: state.modelVersion, revision: state.revision, snapshot: state.document.snapshot };
  }
  previewMaintenance(owner: string, action: unknown, expected: string | null, signal?: AbortSignal) {
    if (signal?.aborted) throw new LibraryError('cancelled'); text(owner, 500);
    for (const [id, preview] of this.maintenance) if (preview.owner === owner || preview.expiresAt <= this.now()) this.maintenance.delete(id);
    if (this.maintenance.size >= 32) throw new LibraryError('busy');
    const state = this.store.read(); if (state.revision !== expected) throw new LibraryError('conflict', state.revision);
    const { impact } = planSongMaintenance(state.document, action, this.now()), token = randomUUID(), expiresAt = this.now() + 5 * 60000;
    this.maintenance.set(token, { owner, revision: expected, expiresAt, action: structuredClone(action) as SongMaintenanceAction, impact });
    return { token, revision: expected, expiresAt, impact };
  }
  commitMaintenance(owner: string, token: string, expected: string | null, signal?: AbortSignal) {
    const preview = this.maintenance.get(token);
    if (!preview || preview.owner !== owner || preview.expiresAt <= this.now()) throw new LibraryError('expired');
    if (expected !== preview.revision) throw new LibraryError('conflict', this.read().revision);
    const saved = this.store.transaction(expected, context => {
      const plan = planSongMaintenance(context.document, preview.action, this.now());
      context.document = plan.document; context.events.push(...plan.events);
    }, signal);
    this.maintenance.delete(token); return { modelVersion: 1 as const, revision: saved.revision, snapshot: saved.document.snapshot };
  }
  previewOrganization(owner: string, songId: string, expected: string | null, signal?: AbortSignal): SongOrganizationPreview {
    if (signal?.aborted) throw new LibraryError('cancelled');
    text(owner, 500); text(songId, 200);
    for (const [id, preview] of this.organization) if (preview.owner === owner || preview.expiresAt <= this.now()) this.organization.delete(id);
    if (this.organization.size >= 32) throw new LibraryError('busy');
    const state = this.read();
    if (state.revision !== expected) throw new LibraryError('conflict', state.revision);
    const preview = { ...planSongOrganization(state.snapshot, songId), token: randomUUID(), revision: expected, expiresAt: this.now() + 5 * 60000 };
    if (signal?.aborted) throw new LibraryError('cancelled');
    this.organization.set(preview.token, { ...structuredClone(preview), owner });
    return preview;
  }
  adoptOrganization(owner: string, token: string, candidateId: string, fields: unknown, expected: string | null, signal?: AbortSignal) {
    text(owner, 500); text(token, 200); text(candidateId, 200); list(fields, 2);
    if (!fields.length || new Set(fields).size !== fields.length || fields.some(field => !['title', 'artists'].includes(field))) throw new LibraryError('invalid-input');
    const preview = this.organization.get(token);
    if (!preview || preview.owner !== owner || preview.expiresAt <= this.now()) throw new LibraryError('expired');
    if (expected !== preview.revision) throw new LibraryError('conflict', this.revision());
    const candidate = preview.candidates.find(candidate => candidate.id === candidateId);
    if (!candidate) throw new LibraryError('invalid-input');
    const state = this.store.transaction(expected, context => {
      const song = context.document.snapshot.songs.find(song => song.id === preview.songId);
      if (!song) throw new LibraryError('not-found');
      const edit: Record<string, unknown> = { type: 'edit-song', songId: song.id, organization: 'organized' };
      for (const field of fields as SongOrganizationField[]) {
        if (candidate.patch[field] === undefined || song.fields[field].protected) throw new LibraryError('invalid-input');
        edit[field] = structuredClone(candidate.patch[field]);
      }
      applySongEdits(context, [edit], this.now());
    }, signal);
    this.organization.delete(token);
    return { modelVersion: 1 as const, revision: state.revision, snapshot: state.document.snapshot };
  }
  cancelOwner(owner: string) {
    this.store.cancelDesktopOwner(owner);
    for (const [id, preview] of this.previews) if (preview.owner === owner) this.previews.delete(id);
    for (const [id, preview] of this.maintenance) if (preview.owner === owner) this.maintenance.delete(id);
    for (const [id, preview] of this.organization) if (preview.owner === owner) this.organization.delete(id);
  }
}
