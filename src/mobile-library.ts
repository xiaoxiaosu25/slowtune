export function mobilePlaylistRoute(id: string) { return 'library/' + encodeURIComponent(id); }
export function mobilePlaylistId(route: unknown): string | undefined {
  if (typeof route !== 'string' || !route.startsWith('library/')) return;
  try { return decodeURIComponent(route.slice(8)) || undefined; } catch { return; }
}
