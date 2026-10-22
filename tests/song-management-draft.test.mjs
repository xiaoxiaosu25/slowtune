import { test } from 'node:test';
import assert from 'node:assert/strict';
import { changedSongFields, rebaseSongDraft, songDraftEdits, isMissingVersion } from '../src/song-management.ts';

const draft = () => ({ title: '晴天', artists: ['周杰伦'], defaultVersionId: 'a', pinnedVersionId: null, versions: { a: { label: '原唱', kind: 'studio', performers: [] }, b: { label: '现场', kind: 'live', performers: [] } } });
const context = { songId: 'sun', playlistId: 'repeat', entryId: 'second' };
test('unified save contains only touched fields and the exact playlist occurrence', () => {
  const base = draft(), next = structuredClone(base); next.title = ' 晴天（整理） '; next.versions.b.label = '巡演现场'; next.defaultVersionId = 'b'; next.pinnedVersionId = 'a';
  assert.deepEqual(songDraftEdits(base, next, context), [
    { type: 'edit-song', songId: 'sun', title: '晴天（整理）' }, { type: 'edit-version', versionId: 'b', label: '巡演现场' },
    { type: 'set-default', songId: 'sun', versionId: 'b' }, { type: 'pin-entry', playlistId: 'repeat', entryId: 'second', versionId: 'a' },
  ]);
  assert.deepEqual(songDraftEdits(base, structuredClone(base), context), []);
});
test('rebasing keeps untouched concurrent fields and drops deleted version identities', () => {
  const base = draft(), pending = structuredClone(base), latest = structuredClone(base);
  pending.title = '人工修改'; pending.versions.b.label = '待保存现场'; pending.defaultVersionId = 'b'; pending.pinnedVersionId = 'b';
  latest.artists = ['另一页面的歌手']; delete latest.versions.b; latest.defaultVersionId = null; delete latest.pinnedVersionId;
  const rebased = rebaseSongDraft(base, pending, latest);
  assert.equal(rebased.title, '人工修改'); assert.deepEqual(rebased.artists, latest.artists); assert.equal(rebased.defaultVersionId, null);
  assert.equal('b' in rebased.versions, false); assert.equal('pinnedVersionId' in rebased, false);
  assert.match(changedSongFields(base, pending, latest).find(v => v.field.includes('版本名称')).current, /已移除/);
});
test('only a confirmed not-found source can be batch cleaned', () => {
  assert(isMissingVersion({ availability: { state: 'unavailable', code: 'not-found' } }));
  for (const availability of [{ state: 'unknown' }, { state: 'available' }, { state: 'uncertain', code: 'network' }, { state: 'unavailable', code: 'network' }]) assert.equal(isMissingVersion({ availability }), false);
});
