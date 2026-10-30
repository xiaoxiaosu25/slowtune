import assert from 'node:assert/strict';

async function settleLayout(page) {
  await page.locator('.app').waitFor();
  await page.waitForFunction(()=>document.querySelector('.app')?.getAttribute('data-layout')===(matchMedia('(min-width:761px)').matches?'desktop':'mobile'));
}

async function leaveMobileSettings(page) {
  for (let depth=0;depth<8&&await page.getByRole('button',{name:'返回上一级',exact:true}).isVisible();depth++) {
    const title=await page.locator('.mobile-subpage-header h1').textContent();
    await page.getByRole('button',{name:'返回上一级',exact:true}).click();
    await page.waitForFunction(title=>document.querySelector('.mobile-subpage-header h1')?.textContent!==title,title);
  }
}

async function leaveMobileDetails(page) {
  for(let depth=0;depth<8;depth++) {
    const back=page.locator('.mobile-header').getByRole('button',{name:/^(返回音乐库|返回关注|返回作者合集)$/});
    if(!await back.isVisible())break;
    await back.click();
  }
}

export async function selectRate(container, rate) {
  await container.getByRole('button', { name: '播放速度', exact: true }).click();
  const menu = container.getByRole('menu', { name: '播放速度', exact: true });
  await menu.getByRole('menuitemradio', { name: rate + '×', exact: true }).click();
  await menu.waitFor({ state: 'hidden' });
}

export async function navigate(page, name) {
  await settleLayout(page);
  const search=page.getByRole('dialog',{name:'搜索音乐',exact:true});
  if(await search.count())await search.getByRole('button',{name:'关闭',exact:true}).click();
  if(await page.locator('.mobile-search-page').count())await page.getByRole('button',{name:'关闭搜索',exact:true}).click();
  if(name==='搜索'){await page.getByRole('button',{name:await page.locator('.app').getAttribute('data-layout')==='mobile'?'搜索歌曲或视频':'开始搜索',exact:true}).click();return;}
  if(name==='收藏'){await navigate(page,'歌单');await selectPlaylist(page,'我的收藏');return;}
  if(await page.locator('.app').getAttribute('data-layout')==='mobile'){await leaveMobileSettings(page);await leaveMobileDetails(page);}
  const targetName=name==='歌单'&&await page.locator('.app').getAttribute('data-layout')==='mobile'?'音乐库':name;
  const button = page.locator('nav:visible').getByRole('button', { name:targetName, exact: true });
  if (!await button.count()) {
    const back=page.getByRole('button',{name:'返回浏览音乐',exact:true});
    if(await back.isVisible())await back.click();
    if(['音乐榜单','关注'].includes(name)&&await page.locator('.app').getAttribute('data-layout')==='mobile')await page.locator('.mobile-nav').getByRole('button',{name:'发现',exact:true}).click();
  }
  await button.click();
}

export async function createPlaylist(page, name) {
  await navigate(page, '歌单');
  await libraryAction(page, '新建歌单');
  await page.getByLabel('歌单名称').fill(name);
  await page.getByRole('button', { name: '保存歌单', exact: true }).click();
  await page.locator('dialog').waitFor({ state: 'detached' });
}

export async function libraryAction(page, name) {
  await settleLayout(page);
  if(await page.locator('.mobile-library').isVisible()) {
    const direct=page.locator('.mobile-library').getByRole('button',{name,exact:true});
    if(await direct.isVisible()){await direct.click();return;}
    await page.getByRole('button',{name:'音乐库管理',exact:true}).click();
    await page.getByRole('dialog',{name:'音乐库管理',exact:true}).getByRole('button',{name,exact:true}).click();return;
  }
  const library = page.locator('.song-library-page');
  const mobile = await page.locator('.app').getAttribute('data-layout')==='mobile';
  const action = (mobile?page:library).getByRole(mobile?'button':'menuitem', { name, exact: true });
  if (!await action.isVisible()) await library.getByRole('button', { name: '歌单管理', exact: true }).click();
  await action.click();
}

export async function selectPlaylist(page, name) {
  await settleLayout(page);
  if(await page.locator('.app').getAttribute('data-layout')==='mobile') {
    if(await page.locator('.mobile-library').isVisible()){await page.locator('.mobile-library').getByRole('button').filter({hasText:name}).first().click();return;}
    await page.getByRole('button',{name:'选择歌单',exact:true}).click();
    await page.getByRole('dialog',{name:'选择歌单',exact:true}).getByRole('button').filter({hasText:name}).first().click();
    return;
  }
  await page.locator('.sidebar-playlist:visible, .playlist-switcher button:visible').filter({ hasText: name }).first().click();
}

export async function openTrackMenu(page, title) {
  const row = page.locator('.track-row').filter({ has: page.getByTitle(title, { exact: true }) }).first();
  await row.getByRole('button', { name: '更多操作 ' + title, exact: true }).click();
  if(await row.locator('.context-menu:popover-open').count()) await row.getByRole('menuitem', { name:'歌曲详情与分 P…', exact:true }).click();
  const dialog=page.locator('.music-action-modal');
  await dialog.locator('.music-more .action-list').first().waitFor({state:'visible'});
  return dialog;
}

export async function openSourceDetails(page, title) {
  await page.getByRole('button', { name: '更多操作 ' + title, exact: true }).first().click();
  const menu = page.locator('.context-menu:popover-open');
  if (await menu.count()) await menu.getByRole('menuitem', { name: '歌曲详情与分 P…', exact: true }).click();
}

export async function queueTrackMenu(page, title) {
  const row = page.locator('.queue-track').filter({ has: page.getByRole('button', { name: '播放队列歌曲 ' + title, exact: true }) });
  const menu = row.locator('.queue-actions');
  await menu.getByRole('button', { name: '队列操作 ' + title, exact: true }).click();
  await menu.locator('[popover]').waitFor({ state: 'visible' });
  return menu;
}

export async function openSettingsPage(page, section = '外观') {
  await settleLayout(page);
  if(await page.locator('.app').getAttribute('data-layout')==='mobile'){
    await leaveMobileSettings(page);
    const back=page.getByRole('button',{name:'返回浏览音乐',exact:true});if(await back.isVisible())await back.click();
    await leaveMobileDetails(page);
    await page.locator('.mobile-nav').getByRole('button',{name:'我的',exact:true}).click();
    const profile=page.getByRole('region',{name:'我的',exact:true});
    if(section==='B站账号')await profile.locator('.mobile-profile-account').click();
    else {
      const name=({'外观':'外观与主题','诊断与数据':'数据与诊断','关于与声明':'关于慢听'})[section]??section;
      await profile.locator('.mobile-profile-links>button').filter({hasText:name}).click();
    }
    await page.locator('.mobile-settings:not([hidden])').waitFor();
    return;
  }else await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.locator('.settings-view').waitFor();
  if (section !== '外观') await page.locator('.settings-nav').getByRole('button', { name: section, exact: true }).click();
}

export async function closeSettingsPage(page) {
  await settleLayout(page);
  if(await page.locator('.app').getAttribute('data-layout')==='mobile') {await leaveMobileSettings(page);return;}
  await page.getByRole('button', { name: '返回浏览音乐', exact: true }).click();
  await page.locator('.settings-view').waitFor({ state: 'detached' });
}

export async function verifyDefaultDiscovery(page, expectedShelves = 3) {
  // The default view combines the B站 shelves with the YouTube selection when that source is available.
  await page.waitForFunction(expected => {
    const shelves = [...document.querySelectorAll('.discovery-shelf')];
    return shelves.length === expected && !document.querySelector('.loading');
  }, expectedShelves, { timeout: 60000 });
  const shelves = page.locator('.discovery-shelf');
  const results = [];
  for (const shelf of await shelves.all()) {
    const title = await shelf.locator('h2').textContent();
    const kind = await shelf.getAttribute('data-shelf-kind');
    const counts = await shelf.locator('.catalog-count').count()?(await shelf.locator('.catalog-count').textContent())?.match(/^(\d+) 首$/):null;
    const shown = Number(counts?.[1]??0);
    assert.equal(await shelf.locator('select[aria-label$="展示数量"]').count(),0,title+': fixed display limit');
    assert(shown<=12);
    const covers = kind === 'recommendation';
    assert.equal(await shelf.getByRole('button', { name: title + (covers ? '封面视图' : '列表视图'), exact: true }).getAttribute('aria-pressed'), 'true');
    assert.equal(await shelf.locator(covers ? '.music-card:not(.catalog-empty-slot)' : '.track-row').count(), shown);
    if(covers&&counts)assert.equal(await shelf.locator('.music-card').count(),12,'fixed cover slots');
    results.push({ title, kind, shown, view: covers ? 'covers' : 'list' });
  }
  return results;
}
