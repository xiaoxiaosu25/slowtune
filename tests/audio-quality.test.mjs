import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MusicSources } from '@studio/music-sources';
import { MusicClient } from '@studio/music-sources/client';
import { createMusicService } from '@studio/music-sources/service';
import { bestAudioFormat, prepareBestAudio, audioMime, audioQualityLabel } from '../dist/server/audio-quality.js';
import { PlaybackDelivery, playbackContext } from '../dist/server/playback-delivery.js';

const ref = { provider: 'bilibili', kind: 'video', id: 'BV1uK4y127K2', part: '1423220857' };
const aac = { id: '30280', codec: 'mp4a.40.2', container: 'mp4', mimeType: 'audio/mp4', bitrate: 240689 };
const opus = { id: '251', codec: 'opus', container: 'webm', mimeType: 'audio/webm', bitrate: 152633, sampleRate: 48000 };
const flac = { id: '30251', codec: 'fLaC', container: 'mp4', mimeType: 'audio/mp4' };

test('lossless has priority even without bitrate; unsupported codecs cannot win', () => {
  const formats = [aac, opus, flac, { ...flac, id: 'alac', codec: 'alac', bitrate: 2000000 }];
  assert.equal(bestAudioFormat(formats, format => format.codec !== 'alac').id, flac.id);
  assert.equal(bestAudioFormat(formats, format => format.codec === 'opus').id, opus.id);
  assert.equal(bestAudioFormat([opus, { ...aac, bitrate: 129512 }], () => true).id, opus.id);
  assert.equal(bestAudioFormat([opus, aac], () => true).id, aac.id);
  const dolby = { id: '30250', codec: 'ec-3', mimeType: 'audio/mp4', container: 'mp4', bitrate: 384000 };
  assert.equal(bestAudioFormat([aac, dolby], () => true).id, dolby.id, 'an actually supported audio codec is not discarded by a fixed AAC/Opus whitelist');
  assert.equal(bestAudioFormat([aac, dolby], format => format.codec !== 'ec-3').id, aac.id);
  assert.equal(bestAudioFormat([aac, { ...dolby, mimeType: 'video/mp4' }], () => true).id, aac.id);
  assert.equal(bestAudioFormat(formats, () => false), undefined);
  assert.equal(audioMime({ ...flac, codec: 'flac' }), 'audio/mp4; codecs="fLaC"');
  assert.equal(audioQualityLabel(flac), 'FLAC 无损');
  assert.equal(audioQualityLabel(opus), 'OPUS · 153 kbps · 48 kHz');
  assert.equal(audioQualityLabel(aac), 'AAC · 241 kbps');
});

test('preparation pins the actual compatible rendition and refresh rechecks current formats', async () => {
  let formats = [aac, opus, flac], selected, formatCalls = 0;
  const options = { signal: new AbortController().signal };
  const api = {
    capabilities: () => ({ operations: ['prepare', 'formats'] }),
    formats: async (requested, forwarded) => { assert.deepEqual(requested, ref); assert.equal(forwarded, options); formatCalls++; return formats; },
    prepare: async (request, forwarded) => { assert.equal(forwarded, options); selected = request; return request; },
  };
  await prepareBestAudio(api, { ref }, options, () => true);
  assert.deepEqual(selected, { ref, codecs: ['fLaC'], formatId: flac.id, quality: 'highest' });
  formats = [{ ...aac, bitrate: 129512 }, opus];
  await prepareBestAudio(api, { ref }, options, () => true);
  assert.equal(selected.formatId, opus.id);
  await prepareBestAudio(api, { ref }, options, format => format.codec !== 'opus');
  assert.equal(selected.formatId, aac.id, 'AAC remains usable on browsers without WebM Opus');
  assert.equal(formatCalls, 3);
  await assert.rejects(prepareBestAudio(api, { ref }, options, () => false), { code: 'unsupported' });
});

test('cancellation and source errors stop quality preparation before creating a lease', async () => {
  const controller = new AbortController();
  const api = {
    capabilities: () => ({ operations: ['formats'] }),
    formats: async () => { controller.abort(); return [aac]; },
    prepare: async () => assert.fail('cancelled lookup must not prepare audio'),
  };
  await assert.rejects(prepareBestAudio(api, { ref }, { signal: controller.signal }, () => true), { name: 'AbortError' });
  const error = Object.assign(new Error('account expired'), { code: 'authentication' });
  api.formats = async () => { throw error; };
  await assert.rejects(prepareBestAudio(api, { ref }, undefined, () => true), candidate => candidate === error);
});

test('older source interfaces receive only browser-supported codec families', async () => {
  let prepared;
  const api = { capabilities: () => ({ operations: ['prepare'] }), prepare: async request => prepared = request };
  await prepareBestAudio(api, { ref }, undefined, format => format.codec === 'mp4a.40.2');
  assert.deepEqual(prepared.codecs, ['mp4a']);
  await assert.rejects(prepareBestAudio(api, { ref }, undefined, () => false), { code: 'unsupported' });
});

test('audio login context and leases survive anonymous-to-account transitions and revoke on logout', async t => {
  let loggedIn = false, revision = 'account-1';
  const calls = [];
  const credentialRef = 'bilibili:quality-test';
  const entry = { ref, resourceId: 'bilibili:quality-test-track', title: '音质测试', url: 'https://www.bilibili.com/video/' + ref.id };
  const host = { now: Date.now, credentials: { read: async requested => {
    assert.equal(requested, credentialRef);
    return { provider: 'bilibili', revision, cookie: 'fixture-account' };
  } }, fetch: async (_input, options) => {
    assert.equal(new Headers(options.headers).get('Cookie'), null, 'account cookie must not be sent to a media CDN');
    return new Response(new Uint8Array([1, 2, 3]), { headers: { 'Content-Length': '3' } });
  } };
  const provider = {
    capabilities: { provider: 'bilibili', operations: ['formats', 'prepare'], anonymous: true, limitations: [] },
    formats: async (_ref, context) => { calls.push(['formats', !!context.credential]); return context.credential ? [aac, flac] : [aac]; },
    prepare: async (request, context) => {
      calls.push(['prepare', !!context.credential]);
      const available = context.credential ? [aac, flac] : [aac];
      const format = available.find(format => format.id === request.formatId);
      assert(format, 'prepare must use a rendition available to this identity');
      return { resourceId: entry.resourceId, entry, format, delivery: { url: 'https://test.bilivideo.com/quality.m4a', requiresHost: true } };
    },
  };
  const api = new MusicSources(host, { bilibili: provider });
  const delivery = new PlaybackDelivery(host);
  const accounts = { options: () => loggedIn ? { credentialRef } : {} };
  const service = createMusicService(api, delivery, { baseUrl: 'http://music.test', providers: ['bilibili'], context: (request, provider) => playbackContext(request, provider, accounts, delivery) });
  const client = await MusicClient.connect('http://music.test', { fetch: (input, options) => service.request(new Request(input, options)) });
  t.after(async () => { client.dispose(); await delivery.dispose(); await api.dispose(); });
  const anonymous = await prepareBestAudio(client, { ref }, undefined, () => true);
  assert.equal(anonymous.format.id, aac.id);
  loggedIn = true;
  const authenticated = await prepareBestAudio(client, { ref }, undefined, () => true);
  assert.equal(authenticated.format.id, flac.id);
  assert.deepEqual(calls, [['formats', false], ['prepare', false], ['formats', true], ['prepare', true]]);
  for (const playback of [anonymous, authenticated]) {
    const response = await service.request(playback.delivery.url);
    assert.equal(response.status, 200);
    assert.deepEqual([...new Uint8Array(await response.arrayBuffer())], [1, 2, 3]);
  }
  assert.equal(JSON.stringify(authenticated).includes('fixture-account'), false);
  await client.touch(anonymous.leaseId);
  await client.touch(authenticated.leaseId);
  assert.deepEqual(playbackContext(new Request('http://music.test/v1/call/search'), 'bilibili', accounts, delivery), {});
  assert.deepEqual(playbackContext(new Request('http://music.test/v1/call/formats'), 'youtube', accounts, delivery), {});
  revision = 'account-2';
  assert.equal((await service.request(authenticated.delivery.url)).status, 401, 'a replaced login cannot read an old signed audio URL');
  const renewed = await prepareBestAudio(client, { ref }, undefined, () => true);
  await delivery.revoke(credentialRef);
  loggedIn = false;
  assert.equal((await service.request(renewed.delivery.url)).status, 404);
  const stillAnonymous = await service.request(anonymous.delivery.url);
  assert.equal(stillAnonymous.status, 200);
  await stillAnonymous.arrayBuffer();
  await client.release(anonymous.leaseId);
  assert.equal(delivery.diagnostics().leases, 0);
  assert.deepEqual(delivery.context(new Request(anonymous.delivery.url)), {});
});
