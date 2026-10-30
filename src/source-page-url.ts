import type { EntryRef } from '@studio/music-sources';

/** Public page links only; never copy a resolved media delivery URL. */
export function sourcePageUrl(entry: { ref: EntryRef; url?: string }) {
  if (entry.url) {
    try { const url = new URL(entry.url); if (url.protocol === 'https:' || url.protocol === 'http:') return url.href; } catch { /* use the canonical page */ }
  }
  return entry.ref.provider === 'bilibili' ? 'https://www.bilibili.com/video/' + encodeURIComponent(entry.ref.id) : 'https://www.youtube.com/watch?v=' + encodeURIComponent(entry.ref.id);
}

export async function copySourceLink(url: string) {
  // Some service origins do not expose Clipboard; surface that as the same retryable failure.
  await navigator.clipboard.writeText(url);
}
