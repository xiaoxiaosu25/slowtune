import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

// An emitted module URL lets a failed network import be retried with a fresh URL,
// without reloading the application or its audio element.
export default defineConfig(({ command }) => ({ plugins: [react(), {
  name: 'desktop-feature-urls',
  resolveId(id) { if (id === 'virtual:desktop-feature-urls') return '\0desktop-feature-urls'; },
  load(id) {
    if (id !== '\0desktop-feature-urls') return;
    const names = ['DesktopSongDialog', 'DesktopPlaylistCoverDialog', 'PlaybackVersionsDialog'];
    const url = command === 'serve' ? '"/src/desktop-features.ts"' : `import.meta.ROLLUP_FILE_URL_${this.emitFile({ type: 'chunk', id: fileURLToPath(new URL('./src/desktop-features.ts', import.meta.url)), name: 'desktop-features', preserveSignature: 'strict' })}`;
    return `const url = ${url};\nexport { ${names.map(name => `url as ${name}`).join(', ')} };`;
  },
}, {
  name: 'desktop-lyric-engine-url',
  resolveId(id) { if (id === 'virtual:desktop-lyric-engine-url') return '\0desktop-lyric-engine-url'; },
  load(id) {
    if (id !== '\0desktop-lyric-engine-url') return;
    if (command === 'serve') return 'export default "/src/desktop-lyric-engine.ts";';
    const ref = this.emitFile({ type: 'chunk', id: fileURLToPath(new URL('./src/desktop-lyric-engine.ts', import.meta.url)), name: 'desktop-lyric-engine', preserveSignature: 'strict' });
    return `export default import.meta.ROLLUP_FILE_URL_${ref};`;
  },
}], build: { outDir: 'dist/client' } }));
