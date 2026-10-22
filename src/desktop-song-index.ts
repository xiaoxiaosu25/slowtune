import type { Song, SongLibrarySnapshot, SongPlaylist, SongVersion } from '../server/song-library-types';
import { isMissingVersion } from './song-management';
import { desktopCatalogSong } from '../server/song-catalog-display';

/** Desktop views share one index for an immutable library snapshot. */
const snapshots = new WeakMap<SongLibrarySnapshot, ReturnType<typeof buildIndex>>();
function buildIndex(snapshot: SongLibrarySnapshot) {
  const songs = new Map(snapshot.songs.map(song => [song.id, desktopCatalogSong(song, snapshot)]));
  const versions = new Map(snapshot.versions.map(version => [version.id, version]));
  const favorites = new Map(snapshot.favorites.map(favorite => [favorite.songId, favorite]));
  const versionsBySong = new Map<string, SongVersion[]>(), playlistsBySong = new Map<string, SongPlaylist[]>();
  const retained = new Set(favorites.keys()), missing = new Set<string>(), pending = new Set<string>();
  for (const playlist of snapshot.playlists) {
    for (const songId of new Set(playlist.entries.map(entry => entry.songId))) {
      retained.add(songId);
      const lists = playlistsBySong.get(songId) ?? [];
      lists.push(playlist); playlistsBySong.set(songId, lists);
    }
  }
  const retainedVersionIds = new Set<string>();
  for (const version of snapshot.versions) {
    const list = versionsBySong.get(version.songId) ?? [];
    list.push(version); versionsBySong.set(version.songId, list);
    if (!retained.has(version.songId)) continue;
    retainedVersionIds.add(version.id);
    if (isMissingVersion(version)) missing.add(version.songId);
    if (version.availability.state === 'unknown' || version.availability.state === 'uncertain') pending.add(version.songId);
  }
  const retainedSongs: Song[] = [...songs.values()].filter(song => retained.has(song.id));
  const searchText = new Map(retainedSongs.map(song => [song.id, `${song.title} ${song.artists?.join(' ') ?? ''}`.toLocaleLowerCase()]));
  return { songs, versions, favorites, versionsBySong, playlistsBySong, retainedSongs, retainedSongIds: retained, retainedVersionIds, missing, pending, searchText,
    counts: { all: retainedSongs.length, missing: missing.size, pending: pending.size } };
}

export function desktopSongIndex(snapshot: SongLibrarySnapshot) {
  let index = snapshots.get(snapshot);
  if (!index) { index = buildIndex(snapshot); snapshots.set(snapshot, index); }
  return index;
}
