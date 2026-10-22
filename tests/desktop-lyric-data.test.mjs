import { test } from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
registerHooks({ resolve(specifier, context, next) {
  return next(specifier === './lyric-timing' && context.parentURL?.endsWith('/desktop-lyric-data.ts') ? specifier + '.ts' : specifier, context);
} });
const { desktopLyricLines, desktopLyricTime } = await import('../src/desktop-lyric-data.ts');

test('desktop adapter preserves saved lyrics, translations and real word gaps without inventing word timing', () => {
  const document = { provider: 'local', id: 'fixture', title: '测试', artists: [], synced: true, lines: [
    { startMs: 1000, text: '普通歌词', translation: 'A line' },
    { startMs: 5000, text: '晚风', words: [{ startMs: 5000, endMs: 5500, text: '晚' }, { startMs: 6500, endMs: 7000, text: '风' }] },
    { startMs: 9000, text: '最后一句', words: [{ startMs: 9000, endMs: 10000, text: '错误正文' }] },
  ] };
  const original = structuredClone(document), lines = desktopLyricLines(document, 12, true);
  assert.deepEqual(document, original);
  assert.deepEqual(lines[0].words, [{ word: '普通歌词', startTime: 1000, endTime: 5000 }]);
  assert.equal(lines[0].translatedLyric, 'A line');
  assert.equal(lines[1].words[1].startTime, 6500);
  assert.equal(lines[2].words.length, 1); assert.equal(lines[2].endTime, 12000);
  assert.equal(desktopLyricLines(document, undefined, false)[0].translatedLyric, '');
  assert.equal(desktopLyricLines(document, undefined, false)[2].endTime, 14000);
  assert.equal(desktopLyricTime(.5, 1000), 0);
  assert.equal(desktopLyricTime(6.25, 1500), 4750);
});
