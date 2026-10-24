import assert from 'node:assert/strict';

export async function selectRate(container, rate) {
  await container.getByRole('button', { name: '播放速度', exact: true }).click();
  const menu = container.getByRole('menu', { name: '播放速度', exact: true });
  await menu.getByRole('menuitemradio', { name: rate + '×', exact: true }).click();
  await menu.waitFor({ state: 'hidden' });
}

export async function navigate(page, name) {
  await page.locator('.app').waitFor();
  const search=page.getByRole('dialog',{name:'搜索音乐',exact:true});
  if(await search.count())await search.getByRole('button',{name:'关闭',exact:true}).click();
  if(name==='搜索'){await page.getByRole('button',{name:await page.locator('.app').getAttribute('data-layout')==='mobile'?'搜索歌曲或视频':'开始搜索',exact:true}).click();return;}
  if(name==='收藏'){await navigate(page,'歌单');await selectPlaylist(page,'我的收藏');return;}
  const button = page.locator('nav:visible').getByRole('button', { name, exact: true });
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
  const library = page.locator('.song-library-page');
  const action = library.getByRole('button', { name, exact: true });
  if (!await action.isVisible()) await library.getByRole('button', { name: '歌单管理', exact: true }).click();
  await action.click();
}

export async function selectPlaylist(page, name) {
  await page.locator('.sidebar-playlist:visible, .playlist-switcher button:visible').filter({ hasText: name }).first().click();
}

export async function openTrackMenu(page, title) {
  const row = page.locator('.track-row').filter({ has: page.getByTitle(title, { exact: true }) }).first();
  await row.getByRole('button', { name: '更多操作 ' + title, exact: true }).click();
  const dialog=page.locator('.music-action-modal');
  await dialog.locator('.music-more .action-list').first().waitFor({state:'visible'});
  return dialog;
}

export async function queueTrackMenu(page, title) {
  const row = page.locator('.queue-track').filter({ has: page.getByRole('button', { name: '播放队列歌曲 ' + title, exact: true }) });
  const menu = row.locator('.queue-actions');
  await menu.getByRole('button', { name: '队列操作 ' + title, exact: true }).click();
  await menu.locator('[popover]').waitFor({ state: 'visible' });
  return menu;
}

export async function openSettingsPage(page, section = '外观') {
  if(await page.locator('.app').getAttribute('data-layout')==='mobile'){
    const back=page.getByRole('button',{name:'返回浏览音乐',exact:true});if(await back.isVisible())await back.click();
    await page.locator('.mobile-nav').getByRole('button',{name:'我的',exact:true}).click();
    await page.getByRole('button',{name:'打开设置',exact:true}).click();
  }else await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.locator('.settings-view').waitFor();
  if (section !== '外观') await page.locator('.settings-nav').getByRole('button', { name: section, exact: true }).click();
}

export async function closeSettingsPage(page) {
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
