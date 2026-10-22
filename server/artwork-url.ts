// Bilibili still returns HTTP artwork URLs. The application's img-src policy permits HTTPS.
// This pure helper is also used by the browser for URLs saved by older app versions.
export function artworkUrl(value: unknown): string | undefined {
  if (typeof value !== 'string' || !value) return;
  try {
    const url = new URL(value.startsWith('//') ? 'https:' + value : value);
    if (!['https:', 'http:'].includes(url.protocol)) return;
    url.protocol = 'https:';
    return url.href;
  } catch { return; }
}
