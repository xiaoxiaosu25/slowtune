import {test} from 'node:test';
import assert from 'node:assert/strict';
import {chromium} from 'playwright-core';
import {createPlayingArtworkFixture} from './helpers/playing-artwork-fixture.mjs';
import {queueRecord} from './helpers/song-fixture.mjs';
test('measured large-library background writes wait during playback and resume after pause', {timeout:30000},async t=>{
  const fixture=await createPlayingArtworkFixture(),browser=await chromium.launch({channel:'msedge',headless:true,args:['--autoplay-policy=no-user-gesture-required']});t.after(async()=>{await browser.close();await fixture.close();});
  const page=await browser.newPage({viewport:{width:1440,height:1000}});let backfills=0;
  await page.addInitScript(record=>localStorage.setItem('slow-listening:playback:v3',JSON.stringify(record)),queueRecord(fixture.tracks));
  await page.route('**/api/song-library',async route=>{const response=await route.fetch(),state=await response.json(),song=state.snapshot.songs[0];for(let n=0;n<1000;n++)state.snapshot.songs.push({...song,id:'large-'+n,defaultVersionId:null});await route.fulfill({json:state});});
  await page.route('**/api/song-library/catalog/backfill',route=>{backfills++;return route.fulfill({json:{revision:'unchanged',more:false}});});
  await page.goto(fixture.base);await page.getByRole('button',{name:'打开正在播放',exact:true}).click();await page.locator('.listening-transport .play-toggle').click();await page.waitForFunction(()=>document.querySelector('audio').currentTime>.2);
  await page.waitForTimeout(3500);assert.equal(backfills,0,'automatic large snapshots do not compete with active media');
  await page.locator('.listening-transport .play-toggle').click();await page.waitForFunction(()=>document.querySelector('audio').paused);await page.waitForResponse(response=>response.url().endsWith('/api/song-library/catalog/backfill'));assert.equal(backfills,1,'paused playback releases the background gate');
});
