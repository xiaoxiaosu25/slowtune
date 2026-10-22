import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lyricFill, lyricWords } from '../src/lyric-timing.ts';

test('line sweeps clamp to media time, use the next timestamp and handle final/untimed lines', () => {
  const lines = [{ startMs: 1000, text: '第一句' }, { startMs: 5000, text: '最后一句' }];
  assert.equal(lyricFill(lines, 0, 0), 0);
  assert.equal(lyricFill(lines, 0, 3000), .5);
  assert.equal(lyricFill(lines, 0, 7000), 1);
  assert.equal(lyricFill(lines, 1, 7500, 10000), .5);
  assert.equal(lyricFill(lines, 1, 7500), .5);
  assert.equal(lyricFill([{ startMs: null, text: '纯文本' }], 0, 100000), 0);
  assert.equal(lyricFill(lines, -1, 1000), 0);
  assert.equal(lyricFill(lines, 0, NaN), 0);
});

test('real word timestamps retain pauses and reject incomplete/invalid word sequences', () => {
  const line = { startMs: 1000, text: '晚风', words: [{ startMs: 1000, endMs: 2000, text: '晚' }, { startMs: 3000, endMs: 4000, text: '风' }] };
  assert.equal(lyricWords(line), line.words);
  assert.equal(lyricFill([line], 0, 1500, undefined, 0), .5);
  assert.equal(lyricFill([line], 0, 2500, undefined, 0), 1);
  assert.equal(lyricFill([line], 0, 2500, undefined, 1), 0);
  assert.equal(lyricFill([line], 0, 3500, undefined, 1), .5);
  assert.equal(lyricWords({ ...line, text: '不同正文' }), undefined);
  assert.equal(lyricWords({ ...line, words: [{ startMs: 2000, endMs: 1000, text: '晚风' }] }), undefined);
});
