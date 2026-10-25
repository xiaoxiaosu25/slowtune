import type { ReactNode } from 'react';
import { ArrowLeftIcon, CaretDownIcon, CaretRightIcon, CompassIcon, DatabaseIcon, HeadphonesIcon, InfoIcon, LinkIcon, ListBulletsIcon, LockKeyIcon, MagnifyingGlassIcon, PaletteIcon, PlugsConnectedIcon, QueueIcon, SlidersHorizontalIcon, UserCircleIcon } from '@phosphor-icons/react';
import type { BilibiliAccountState } from './api';
import { mobileSettingsTitles, type MobileSettingsSection } from './mobile-settings';

const destinations = [
  { id: 'discover', label: '发现', icon: CompassIcon },
  { id: 'library', label: '音乐库', icon: ListBulletsIcon },
  { id: 'profile', label: '我的', icon: UserCircleIcon },
];

export function MobileHeader({ page, settingsSection, onSearch, onLink, onBack, options }: { page: string; settingsSection: MobileSettingsSection; onSearch: () => void; onLink: () => void; onBack: () => void; options: ReactNode }) {
  return <header className={'topbar mobile-header' + (page === 'playing' ? ' listening-header' : ['settings','playlist'].includes(page) ? ' mobile-subpage-header' : '')}>
    {page === 'playing' ? <>
      <button className="btn btn-icon" aria-label="返回浏览音乐" onClick={onBack}><CaretDownIcon size={25}/></button>
      <h1>正在播放</h1>{options}
    </> : ['settings','playlist'].includes(page) ? <>
      <button className="btn btn-icon" aria-label={page==='playlist'?'返回音乐库':'返回上一级'} onClick={onBack}><ArrowLeftIcon size={24}/></button>
      <h1>{page==='playlist'?'歌单':mobileSettingsTitles[settingsSection]}</h1>
      {page==='playlist'&&<button className="btn btn-icon mobile-detail-search" aria-label="搜索歌曲或视频" onClick={onSearch}><MagnifyingGlassIcon size={23}/></button>}
    </> : <>
      <div className="mobile-header-title"><HeadphonesIcon size={23}/><h1>{page === 'library' ? '音乐库' : page === 'profile' ? '我的' : '慢听'}</h1></div>
      <div className="mobile-header-actions">
        <button className="btn btn-icon" aria-label="搜索歌曲或视频" onClick={onSearch}><MagnifyingGlassIcon size={23}/></button>
        <button className="btn btn-icon" aria-label="粘贴链接" onClick={onLink}><LinkIcon size={22}/></button>
      </div>
    </>}
  </header>;
}

export function MobileNavigation({ page, onNavigate }: { page: string; onNavigate: (page: string) => void }) {
  const active = ['charts', 'follows'].includes(page) ? 'discover' : page === 'settings' ? 'profile' : page==='playlist'?'library':page;
  return <nav className="mobile-nav" aria-label="手机导航">{destinations.map(item => <button key={item.id} className={active === item.id ? 'active' : ''} aria-current={active === item.id ? 'page' : undefined} onClick={() => onNavigate(item.id)}>
    <item.icon size={23} weight={active === item.id ? 'fill' : 'regular'}/><span>{item.label}</span>
  </button>)}</nav>;
}

export function MobileDiscoveryNavigation({ page, onNavigate }: { page: string; onNavigate: (page: string) => void }) {
  return <nav className="mobile-discovery-nav" aria-label="发现栏目">{[{id:'discover', label:'推荐'}, {id:'charts', label:'音乐榜单'}, {id:'follows', label:'关注'}].map(item => <button key={item.id} aria-current={page === item.id ? 'page' : undefined} className={page === item.id ? 'active' : ''} onClick={() => onNavigate(item.id)}>{item.label}</button>)}</nav>;
}

export function MobileMiniPlayer({ cover, title, artist, progress, transport, onOpen, onQueue, queueOpen }: { cover: ReactNode; title: string; artist: string; progress: number; transport: ReactNode; onOpen: () => void; onQueue: () => void; queueOpen: boolean }) {
  return <footer className="mobile-mini-player" aria-label="播放器">
    <div className="mobile-mini-progress" aria-hidden="true"><span style={{width:Math.min(100,Math.max(0,progress*100))+'%'}}/></div>
    <div className="mobile-mini-row">
      <button className="now-playing" aria-label="打开正在播放" onClick={onOpen}>{cover}<span><strong title={title}>{title}</strong><small>{artist}</small></span></button>
      <div className="mobile-mini-transport">{transport}</div>
      <button className="btn btn-icon" aria-label="打开播放队列" aria-expanded={queueOpen} onClick={onQueue}><QueueIcon size={24}/></button>
    </div>
  </footer>;
}

const profileGroups = [
  { title: '外观', items: [{ id: 'appearance', label: '外观与主题', description: '明暗与配色', icon: PaletteIcon }] },
  { title: '音乐与播放', items: [
    { id: 'sources', label: '音乐来源', description: '来源开关与状态', icon: PlugsConnectedIcon },
    { id: 'recommendation', label: '推荐偏好', description: '推荐与选歌规则', icon: SlidersHorizontalIcon },
  ] },
  { title: '数据与帮助', items: [
    { id: 'access', label: '启动与访问', description: '进入方式与访问码', icon: LockKeyIcon },
    { id: 'diagnostics', label: '数据与诊断', description: '备份、恢复与运行状态', icon: DatabaseIcon },
    { id: 'about', label: '关于慢听', description: '版本、许可与声明', icon: InfoIcon },
  ] },
] as const;

export function MobileProfile({ account, onSettings }: { account?: BilibiliAccountState; onSettings: (section: MobileSettingsSection) => void }) {
  const accountText = account?.state === 'authenticated' ? 'B站账号已登录' : account?.state === 'expired' ? 'B站登录已过期' : account?.state === 'unavailable' ? '账号状态暂不可用' : account?.state === 'anonymous' ? 'B站账号未登录' : '正在读取账号状态…';
  return <section className="mobile-profile" aria-label="我的">
    <button className="mobile-profile-account" onClick={() => onSettings('account')}><UserCircleIcon size={48} weight="light"/><span><strong>{accountText}</strong><small>账号与收藏夹关联</small></span><CaretRightIcon size={20}/></button>
    {profileGroups.map(group => <section className="mobile-profile-group" key={group.title} aria-label={group.title}><h2>{group.title}</h2><div className="mobile-profile-links">{group.items.map(item => <button key={item.id} onClick={() => onSettings(item.id)}><item.icon size={23}/><span><strong>{item.label}</strong><small>{item.description}</small></span><CaretRightIcon size={18}/></button>)}</div></section>)}
  </section>;
}
