import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { chromium } from './helpers/browser.mjs';
import { queueRecord } from './helpers/song-fixture.mjs';
import { createMobileFixture } from './helpers/mobile-fixture.mjs';
import { developmentPaths } from '../scripts/workspace-paths.mjs';

test('mobile navigation, player and direct lyrics keep one audio session and fit compact screens', {timeout:120000}, async t => {
  const fixture = await createMobileFixture(), browser = await chromium.launch({headless:true});
  t.after(async () => { await browser.close(); await fixture.close(); });
  const context = await browser.newContext({viewport:{width:390,height:844},hasTouch:true,colorScheme:'light'});
  await context.route('https://i1.hdslb.com/fixture-artwork.png',route=>route.fulfill({contentType:'image/png',body:readFileSync(resolve('public/assets/coast.png'))}));
  await context.addInitScript(record=>{localStorage.setItem('slow-listening:playback:v3',JSON.stringify(record));localStorage.setItem('slow-listening:theme:v1','light');},queueRecord(fixture.tracks));
  const page = await context.newPage(), errors = [], artifacts = join(developmentPaths().artifacts,'mobile-layout');
  mkdirSync(artifacts,{recursive:true}); page.on('pageerror',error=>errors.push(error.message)); page.setDefaultTimeout(10000);
  await page.goto(fixture.base);
  const primary = page.getByRole('navigation',{name:'手机导航',exact:true});
  await primary.waitFor();
  const miniPlay=await page.locator('.mobile-mini-transport .play-toggle').boundingBox();assert(miniPlay.width>=48&&miniPlay.height>=48,'mini-player playback has a 48px touch target');
  assert.deepEqual(await primary.getByRole('button').allTextContents(),['发现','音乐库','我的']);
  await page.getByRole('navigation',{name:'发现栏目'}).getByRole('button',{name:'音乐榜单',exact:true}).click();
  await page.getByRole('heading',{name:'演示榜单',exact:true}).waitFor();
  assert.equal(await primary.getByRole('button',{name:'发现',exact:true}).getAttribute('aria-current'),'page');
  await primary.getByRole('button',{name:'我的',exact:true}).click();
  await page.getByRole('button',{name:'音乐来源 来源开关与状态',exact:true}).click();
  await page.locator('[data-settings-section="sources"]:visible').waitFor();
  await page.getByRole('button',{name:'返回上一级',exact:true}).click();
  await page.getByRole('region',{name:'我的',exact:true}).waitFor();
  await primary.getByRole('button',{name:'音乐库',exact:true}).click();
  await page.locator('.mobile-library').getByRole('button',{name:'我的收藏 2 首歌曲',exact:true}).click();
  const firstSong = await page.locator('.song-library-row').first().boundingBox(), mini = await page.locator('.mobile-mini-player').boundingBox();
  assert(firstSong.y+firstSong.height<=mini.y,'the first library song is visible above the mini player without scrolling');
  assert.equal(await page.getByRole('textbox',{name:'搜索歌单内音乐'}).evaluate(e=>getComputedStyle(e).fontSize),'16px','mobile text inputs avoid focus zoom');
  await page.getByRole('button',{name:'播放 风从远方来',exact:true}).click();
  await page.waitForFunction(()=>{const a=document.querySelector('audio');return a&&!a.paused&&a.currentTime>.1;});
  await page.evaluate(()=>{window.__mobileAudio=document.querySelector('audio');});
  assert.equal(await page.locator('.bottom-lyrics').count(),0,'mobile browsing never renders the desktop lyric dock');
  assert.equal(await page.locator('.mobile-mini-player').evaluate(e=>e.getBoundingClientRect().height),72);
  const preparations = fixture.preparations.length;
  await page.screenshot({path:join(artifacts,'library-390.png')});
  await page.getByRole('button',{name:'打开正在播放',exact:true}).click();
  assert.equal(await page.locator('.mobile-player .vinyl-record').count(),1);
  assert.equal(await page.getByRole('button',{name:'收藏当前歌曲',exact:true}).count(),1);
  assert.equal(await page.locator('.bottom-lyrics').count(),0,'the cover player keeps lyrics behind its direct view toggle');
  await page.getByRole('button',{name:'更多播放选项',exact:true}).click();
  assert.equal(await page.getByRole('checkbox',{name:'底部歌词',exact:true}).count(),0);
  await page.keyboard.press('Escape');
  await page.screenshot({path:join(artifacts,'player-390.png')});
  const before = await page.locator('.mobile-player-controls').boundingBox();
  await page.getByRole('button',{name:'查看歌词',exact:true}).click();
  await page.getByRole('region',{name:'当前版本歌词'}).getByRole('button',{name:'把窗打开，让晚风进来',exact:true}).waitFor();
  const after = await page.locator('.mobile-player-controls').boundingBox();
  assert(Math.abs(before.y-after.y)<2,'switching display keeps playback controls in place');
  assert.equal(fixture.preparations.length,preparations);
  assert.equal(await page.locator('.bottom-lyrics').count(),0);
  assert.equal(await page.evaluate(()=>window.__mobileAudio===document.querySelector('audio')&&!window.__mobileAudio.paused),true);
  await page.getByRole('button',{name:'暂停',exact:true}).click();
  await page.locator('audio').evaluate(audio=>{audio.currentTime=8;audio.dispatchEvent(new Event('timeupdate'));});
  await page.waitForFunction(()=>document.querySelector('.lyrics-scroll [aria-current="true"]')?.textContent==='风从远方来，停在你身旁');
  for (const theme of ['light','dark']) for (const width of [320,360,390,430]) {
    await page.setViewportSize({width,height:844});
    await page.evaluate(theme=>{document.documentElement.dataset.theme=theme;},theme);
    const layout = await page.evaluate(()=>{const player=document.querySelector('.mobile-player'),controls=player.querySelector('.mobile-player-controls').getBoundingClientRect(),reading=player.querySelector('.lyrics-scroll').getBoundingClientRect();return {overflow:document.documentElement.scrollWidth>innerWidth,top:controls.top,bottom:controls.bottom,reading:reading.height,height:innerHeight};});
    assert.equal(layout.overflow,false); assert(layout.top>=0&&layout.bottom<=layout.height,JSON.stringify({width,theme,...layout})); assert(layout.reading>=140);
    await page.screenshot({path:join(artifacts,`lyrics-${theme}-${width}.png`)});
  }
  await page.setViewportSize({width:360,height:640});
  const short = await page.locator('.mobile-player-controls').boundingBox(); assert(short.y+short.height<=640);
  await page.getByRole('button',{name:'播放队列',exact:true}).click();
  await page.getByRole('dialog',{name:'播放队列',exact:true}).waitFor(); await page.goBack();
  await page.getByRole('dialog',{name:'播放队列',exact:true}).waitFor({state:'detached'});
  await page.goBack(); await primary.waitFor();
  await page.getByRole('button',{name:'搜索歌曲或视频',exact:true}).click();
  const search = page.getByRole('main',{name:'搜索音乐',exact:true});
  await search.getByRole('searchbox',{name:'搜索关键词',exact:true}).fill('风从远方来'); await search.getByRole('button',{name:'搜索',exact:true}).click();
  await search.getByRole('button',{name:'播放 风从远方来',exact:true}).waitFor();
  const box = await search.boundingBox(); assert.equal(box.x,0); assert.equal(box.y,0); assert.equal(box.width,360); assert.equal(box.height,640);
  await page.setViewportSize({width:320,height:568});
  const searchTitle = await search.locator('.row-info').first().boundingBox();
  assert(searchTitle.width>=110,'narrow search rows keep useful space for song titles');
  await page.goBack(); await search.waitFor({state:'detached'});
  assert.equal(await page.evaluate(()=>window.__mobileAudio===document.querySelector('audio')&&window.__mobileAudio.paused),true);
  await primary.getByRole('button',{name:'我的',exact:true}).click();
  await page.getByRole('region',{name:'我的',exact:true}).waitFor();
  await page.reload();await primary.waitFor();await page.goBack();
  await page.locator('.song-library-page').waitFor();
  assert.equal(await page.locator('audio').evaluate(audio=>audio.paused),true,'reload restores the queue without autoplay');
  await page.evaluate(()=>{window.__mobileAudio=document.querySelector('audio');});
  await primary.getByRole('button',{name:'我的',exact:true}).click();
  await page.setViewportSize({width:1280,height:800});
  await page.locator('.app[data-layout="desktop"]').waitFor();
  await page.locator('.settings-view').waitFor();
  await page.getByRole('button',{name:'返回浏览音乐',exact:true}).click();
  await page.locator('.settings-view').waitFor({state:'detached'});
  await page.locator('.sidebar-nav').waitFor(); assert.deepEqual(await page.locator('.sidebar-nav button').allTextContents(),['发现','音乐榜单','关注','歌单']);
  assert.equal(await page.locator('.mobile-mini-player').count(),0);
  assert.equal(await page.evaluate(()=>window.__mobileAudio===document.querySelector('audio')),true);
  assert.deepEqual(errors,[]);
});

test('mobile long titles leave lyrics and queue readable on short portrait and landscape screens', {timeout:60000}, async t => {
  const title = '风从远方来，陪你走过城市里每一段安静又漫长的夜晚 · 现场特别版本';
  const fixture = await createMobileFixture({title,artists:['SlowTune 演示与一位名字很长的合作歌手']}), browser = await chromium.launch({headless:true});
  t.after(async()=>{await browser.close();await fixture.close();});
  const context = await browser.newContext({viewport:{width:320,height:568},hasTouch:true});
  await context.addInitScript(record=>localStorage.setItem('slow-listening:playback:v3',JSON.stringify(record)),queueRecord(fixture.tracks));
  const page = await context.newPage(); page.setDefaultTimeout(5000);
  await page.goto(fixture.base);
  await page.getByRole('button',{name:'打开正在播放',exact:true}).click();
  await page.getByRole('button',{name:'播放',exact:true}).click();
  await page.getByRole('button',{name:'查看歌词',exact:true}).click();
  await page.locator('.lyrics-scroll').waitFor();
  await page.getByRole('button',{name:'暂停',exact:true}).click();
  for (const viewport of [{width:320,height:568},{width:360,height:640},{width:390,height:844},{width:430,height:932},{width:667,height:375}]) {
    await page.setViewportSize(viewport);
    const layout = await page.evaluate(()=>{
      const box=selector=>document.querySelector(selector).getBoundingClientRect().toJSON();
      return {song:box('.mobile-player-song'),reading:box('.lyrics-scroll'),controls:box('.mobile-player-controls'),progress:box('.mobile-player .progress input'),title:box('.playing-title-trigger'),line:box('.lyrics-scroll li>button'),overflow:document.documentElement.scrollWidth>innerWidth};
    });
    assert.equal(layout.overflow,false);
    assert(layout.controls.bottom<=viewport.height+1,JSON.stringify({viewport,...layout}));
    assert(layout.reading.height>=100,'short screens retain a usable lyric reading area');
    const overlaps=layout.song.x<layout.reading.right&&layout.song.right>layout.reading.x&&layout.song.y<layout.reading.bottom&&layout.song.bottom>layout.reading.y;
    assert.equal(overlaps,false,'long song metadata does not cover the lyric reading area');
    for(const target of ['progress','title','line'])assert(layout[target].height>=48,target+' has a 48px touch target');
  }
  await page.setViewportSize({width:320,height:568});
  await page.getByRole('button',{name:'播放队列',exact:true}).click();
  const content=await page.locator('.queue-content').boundingBox();
  assert(content.height>=140,'queue instructions leave room to read and scroll songs on a short screen');
});

test('short landscape keeps version selection separate from seeking and playback controls reachable', {timeout:60000}, async t => {
  const fixture = await createMobileFixture(), browser = await chromium.launch({headless:true});
  t.after(async()=>{await browser.close();await fixture.close();});
  const context = await browser.newContext({viewport:{width:568,height:320},hasTouch:true});
  await context.addInitScript(record=>localStorage.setItem('slow-listening:playback:v3',JSON.stringify(record)),queueRecord(fixture.tracks));
  const page = await context.newPage(); page.setDefaultTimeout(5000);
  await page.goto(fixture.base);
  await page.getByRole('button',{name:'打开正在播放',exact:true}).click();
  await page.getByRole('button',{name:'播放',exact:true}).click();
  await page.waitForFunction(()=>{const audio=document.querySelector('audio');return audio&&!audio.paused&&audio.currentTime>.1;});
  await page.getByRole('button',{name:'暂停',exact:true}).click();
  for (const view of ['artwork','lyrics']) {
    if (view==='lyrics') await page.getByRole('button',{name:'查看歌词',exact:true}).click();
    const song = await page.locator('.mobile-player-song').boundingBox(), controls = await page.locator('.mobile-player-controls').boundingBox();
    assert(controls.y>=song.y+song.height,'short landscape keeps playback controls below song metadata');
    const position = await page.locator('audio').evaluate(audio=>audio.currentTime);
    await page.getByRole('button',{name:'选择播放版本 风从远方来',exact:true}).click();
    const versions = page.getByRole('dialog',{name:'歌曲与版本',exact:true});
    await versions.waitFor();
    assert.equal(await page.locator('audio').evaluate(audio=>audio.currentTime),position,'opening versions does not seek');
    await versions.getByRole('button',{name:'关闭',exact:true}).click();
    const queue = page.getByRole('button',{name:'播放队列',exact:true});
    await queue.scrollIntoViewIfNeeded();
    const target = await queue.boundingBox();
    assert(target.y>=64&&target.y+target.height<=320,'scrolling exposes the bottom controls below the fixed header');
    await queue.click();
    const drawer = page.getByRole('dialog',{name:'播放队列',exact:true});
    await drawer.waitFor();
    assert.equal(Math.round((await drawer.boundingBox()).height),320,'short landscape uses the viewport height for the queue');
    assert((await drawer.locator('.queue-content').boundingBox()).height>=100,'short landscape leaves space for queue songs and actions');
    await drawer.getByRole('button',{name:'关闭播放队列',exact:true}).click();
  }
});

test('mobile Back skips replaced playback menus after lyrics settings close', {timeout:60000}, async t => {
  const fixture = await createMobileFixture(), browser = await chromium.launch({headless:true});
  t.after(async () => { await browser.close(); await fixture.close(); });
  for (const closeWithBack of [false, true]) {
    const context = await browser.newContext({viewport:{width:390,height:844},hasTouch:true});
    const page = await context.newPage(); page.setDefaultTimeout(5000);
    await page.goto(fixture.base);
    await page.getByRole('button',{name:'打开正在播放',exact:true}).click();
    await page.getByRole('button',{name:'更多播放选项',exact:true}).click();
    await page.getByRole('button',{name:'歌词设置',exact:true}).click();
    const settings = page.getByRole('dialog',{name:'歌词设置',exact:true});
    await settings.waitFor();
    if (closeWithBack) await page.goBack();
    else await settings.getByRole('button',{name:'关闭',exact:true}).click();
    await settings.waitFor({state:'detached'});
    assert.equal(await page.locator('.mobile-player').count(),1,'closing settings keeps the player open');
    assert.equal(await page.locator('[popover]:popover-open').count(),0,'Back does not recreate the replaced menu');
    await page.goBack();
    await page.getByRole('navigation',{name:'手机导航',exact:true}).waitFor();
    await page.goForward();
    await page.locator('.mobile-player').waitFor();
    assert.equal(await page.locator('dialog[open],[popover]:popover-open').count(),0,'Forward restores the player without its closed layers');
    await context.close();
  }
});

test('mobile song hierarchy keeps canonical metadata, source versions and queue edits usable on compact screens', {timeout:60000}, async t => {
  const originalTitle='【现场完整收录】风从远方来 · 音乐会特别加长原始视频标题', artists=['名字很长的演唱者与另一位合作音乐人','还有一位一起演出的朋友'], label='音乐会特别现场录音与加长返场版本';
  const fixture=await createMobileFixture({title:originalTitle,artists}), browser=await chromium.launch({headless:true});
  t.after(async()=>{await browser.close();await fixture.close();});
  const context=await browser.newContext({viewport:{width:390,height:844},hasTouch:true,colorScheme:'light'});
  await context.addInitScript(record=>localStorage.setItem('slow-listening:playback:v3',JSON.stringify(record)),queueRecord(fixture.tracks));
  const page=await context.newPage(),errors=[],artifacts=join(developmentPaths().artifacts,'mobile-layout');page.setDefaultTimeout(8000);
  page.on('pageerror',error=>errors.push(error.message));
  let metadataAvailable=true;
  await page.route('**/api/song-library',async route=>{
    const response=await route.fetch(),state=await response.json();
    if(metadataAvailable){state.snapshot.songs[0].title='风从远方来';state.snapshot.versions[0].label=label;}
    else for(const field of ['songs','versions','favorites','playlists'])state.snapshot[field]=[];
    await route.fulfill({json:state});
  });
  await page.goto(fixture.base);await page.getByRole('button',{name:'打开正在播放',exact:true}).click();
  await page.getByRole('button',{name:'播放',exact:true}).click();
  await page.waitForFunction(()=>{const audio=document.querySelector('audio');return audio&&!audio.paused&&audio.currentTime>.1;});
  await page.evaluate(()=>{window.__hierarchyAudio=document.querySelector('audio');});
  const preparations=fixture.preparations.length;
  assert.equal(await page.locator('.mobile-player .playing-title-trigger').textContent(),'风从远方来');
  assert.equal(await page.locator('.mobile-player-artist').textContent(),artists.join(' / '));
  await page.locator('.mobile-player .playing-title-trigger').click();
  const title=page.getByRole('dialog',{name:'完整标题',exact:true});
  await title.getByText(originalTitle,{exact:true}).waitFor();
  assert.equal(await title.locator('.mobile-track-details dd').nth(1).textContent(),artists.join(' / '));
  assert.equal(await title.locator('.mobile-track-details dd').last().textContent(),'B站 · '+label);
  await title.getByRole('button',{name:'关闭',exact:true}).click();
  await page.getByRole('button',{name:'暂停',exact:true}).click();
  const position=await page.locator('audio').evaluate(audio=>audio.currentTime);
  for(const view of ['artwork','lyrics']) {
    if(view==='lyrics')await page.getByRole('button',{name:'查看歌词',exact:true}).click();
    for(const viewport of [{width:320,height:568},{width:360,height:640},{width:390,height:844},{width:430,height:932},{width:568,height:320},{width:667,height:375}]) {
      await page.setViewportSize(viewport);
      const layout=await page.evaluate(()=>{
        const box=selector=>document.querySelector(selector).getBoundingClientRect().toJSON();
        return {song:box('.mobile-player-song'),controls:box('.mobile-player-controls'),version:box('.mobile-player-version'),count:box('.mobile-version-count'),platform:box('.mobile-source-platform'),overflow:document.documentElement.scrollWidth>innerWidth};
      });
      assert.equal(layout.overflow,false);
      assert(layout.platform.right<=layout.count.x,'platform and version action do not overlap');
      assert(layout.count.right<=layout.version.right+1&&layout.version.height>=48);
      assert(layout.controls.y>=layout.song.bottom,'metadata stays above playback controls');
      await page.getByRole('button',{name:'选择播放版本 风从远方来',exact:true}).click();
      const versions=page.getByRole('dialog',{name:'歌曲与版本',exact:true});await versions.waitFor();
      assert.equal(await page.locator('audio').evaluate(audio=>audio.currentTime),position);
      await versions.getByRole('button',{name:'关闭',exact:true}).click();
      await page.getByRole('button',{name:'播放队列',exact:true}).scrollIntoViewIfNeeded();
      await page.screenshot({path:join(artifacts,`metadata-${view}-${viewport.width}-${viewport.height}.png`)});
    }
  }
  await page.getByRole('button',{name:'播放',exact:true}).click();
  await page.getByRole('button',{name:'播放队列',exact:true}).click();
  const queue=page.getByRole('dialog',{name:'播放队列',exact:true});await queue.waitFor();
  assert((await queue.locator('.queue-content').boundingBox()).height>=100,'short landscape keeps a usable scrollable queue');
  await queue.getByRole('button',{name:'队列操作 下一首 · 无封面测试',exact:true}).click();
  await queue.locator('[popover]:popover-open').waitFor();
  await page.waitForFunction(()=>document.querySelector('.queue-actions[data-open="true"]'));
  await page.screenshot({path:join(artifacts,'metadata-queue-menu.png')});
  await queue.getByRole('button',{name:'上移',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('.queue-track-main')?.getAttribute('aria-label')==='播放队列歌曲 下一首 · 无封面测试');
  await queue.getByRole('button',{name:'队列操作 下一首 · 无封面测试',exact:true}).click();
  await queue.getByRole('button',{name:'移除',exact:true}).click();
  await page.waitForFunction(()=>document.querySelectorAll('.queue-track').length===1);
  await queue.getByRole('button',{name:'关闭播放队列',exact:true}).click();
  assert.equal(await page.evaluate(()=>window.__hierarchyAudio===document.querySelector('audio')&&!window.__hierarchyAudio.paused),true);
  assert.equal(fixture.preparations.length,preparations);
  metadataAvailable=false;await page.reload();await page.locator('.mobile-player').waitFor();
  assert.equal(await page.locator('.mobile-player .playing-title-trigger').textContent(),originalTitle,'missing song metadata retains the real original title');
  assert.equal(await page.getByRole('button',{name:'查看当前来源',exact:true}).isVisible(),true);
  assert.deepEqual(errors,[]);
});
