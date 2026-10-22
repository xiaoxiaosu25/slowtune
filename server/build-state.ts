import { statSync } from 'node:fs';
import { join } from 'node:path';

// The running server code is frozen at startup while the browser page is read from disk on every
// request, so a rebuild silently pairs a new page with the routes of the previous build. These two
// artifacts identify the pair: a newer mtime than the one captured at startup means the process is
// still serving its own build while other clients of this directory already moved on.
export const buildArtifacts = { server: 'dist/server/index.js', client: 'dist/client/index.html' } as const;
export type BuildArtifact = keyof typeof buildArtifacts;
export interface BuildCapture { root: string; startedAt: number; builtAt: Record<BuildArtifact, number> }
export interface BuildState { startedAt: number; stale: boolean; changed: BuildArtifact[]; started: Record<BuildArtifact, number>; current: Record<BuildArtifact, number> }
const artifacts = Object.keys(buildArtifacts) as BuildArtifact[];
function modified(root: string, artifact: BuildArtifact) {
  try { return statSync(join(root, buildArtifacts[artifact])).mtimeMs; } catch { return 0; }
}
export function captureBuild(root: string): BuildCapture {
  return { root, startedAt: Date.now(), builtAt: { server: modified(root, 'server'), client: modified(root, 'client') } };
}
export function buildState(capture: BuildCapture): BuildState {
  const current: Record<BuildArtifact, number> = { server: modified(capture.root, 'server'), client: modified(capture.root, 'client') };
  const changed = artifacts.filter(artifact => current[artifact] > capture.builtAt[artifact]);
  return { startedAt: capture.startedAt, stale: changed.length > 0, changed, started: capture.builtAt, current };
}
