import type { Song, SongLibrarySnapshot, SongLibraryState } from './song-library-types.js';

type ArtworkContext = Pick<SongLibrarySnapshot, 'versions' | 'catalogLinks'>;
const coverOrigins = new WeakMap<ArtworkContext, Map<string, Set<string>>>();

/** Infer old cover provenance conservatively; an unexplained old cover is retained. */
export function protectedSongArtwork(song: Song, snapshot: ArtworkContext): boolean {
  if (song.fields.artwork) return song.fields.artwork.protected;
  if (!song.artwork) return false;
  let origins = coverOrigins.get(snapshot);
  if (!origins) {
    origins = new Map();
    for (const item of [...snapshot.versions.map(v => ({ songId: v.songId, artwork: v.facts.artwork })), ...snapshot.catalogLinks.map(l => ({ songId: l.songId, artwork: l.context.artwork }))]) {
      if (!item.artwork) continue;
      const covers = origins.get(item.songId) ?? new Set<string>(); covers.add(item.artwork); origins.set(item.songId, covers);
    }
    coverOrigins.set(snapshot, origins);
  }
  return !origins.get(song.id)?.has(song.artwork);
}

export function desktopCatalogSong(song: Song, snapshot: ArtworkContext): Song {
  const record = song.desktopCatalog?.state === 'matched' ? song.desktopCatalog.record : undefined;
  if (!record) return song;
  return { ...song, title: song.fields.title.protected ? song.title : record.title,
    artists: song.fields.artists.protected ? song.artists : record.artists,
    artwork: protectedSongArtwork(song, snapshot) ? song.artwork : record.artwork ?? song.artwork };
}

const views = new WeakMap<SongLibraryState, SongLibraryState>();
export function desktopCatalogLibrary(state: SongLibraryState): SongLibraryState {
  let view = views.get(state);
  if (!view) {
    view = { ...state, snapshot: { ...state.snapshot, songs: state.snapshot.songs.map(song => desktopCatalogSong(song, state.snapshot)) } };
    views.set(state, view);
    views.set(view, view);
  }
  return view;
}
