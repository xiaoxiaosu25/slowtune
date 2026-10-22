import React from 'react';
import { createRoot } from 'react-dom/client';
import { SongBackupPanel } from '../../src/SongBackupPanel';
import '../../src/styles.css';

const initial = await fetch('/api/song-library').then(response => response.json());
function Fixture() {
  const [library, setLibrary] = React.useState(initial);
  return <main style={{ maxWidth: 800, margin: '32px auto', padding: 20 }}><SongBackupPanel library={library} onCommitted={value => { window.committedSongLibrary = value; setLibrary(value); }}/></main>;
}
createRoot(document.getElementById('root')).render(<Fixture/>);
