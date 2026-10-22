import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { Track } from '../../src/api';
import { useLyrics, type LyricsController } from '../../src/useLyrics';
import type { SongVersion } from '../../server/song-library-types';

declare global {
  interface Window {
    lyricTrack: Track;
    lyricsMetadataProbe: { lyrics: LyricsController; version?: SongVersion; setVersion: (version: SongVersion) => void };
  }
}

function Probe() {
  const [version, setVersion] = useState<SongVersion>();
  const lyrics = useLyrics(window.lyricTrack, 60, version, true);
  window.lyricsMetadataProbe = { lyrics, version, setVersion };
  return <div>{lyrics.document?.title ?? '等待版本资料'}</div>;
}

createRoot(document.getElementById('root')!).render(<Probe/>);
