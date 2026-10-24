import type { ReactNode } from 'react';
import { CaretDownIcon, CaretRightIcon, CompassIcon, DatabaseIcon, GearIcon, HeadphonesIcon, InfoIcon, LinkIcon, ListBulletsIcon, MagnifyingGlassIcon, PaletteIcon, PlugsConnectedIcon, QueueIcon, SlidersHorizontalIcon, UserCircleIcon } from '@phosphor-icons/react';
import type { BilibiliAccountState } from './api';
import type { SettingsSectionId } from './SettingsPage';

const destinations = [
  { id: 'discover', label: '发现', icon: CompassIcon },
  { id: 'library', label: '歌单', icon: ListBulletsIcon },
  { id: 'profile', label: '我的', icon: UserCircleIcon },
];

export function MobileHeader({ page, onSearch, onLink, onBack, options }: { page: string; onSearch: () => void; onLink: () => void; onBack: () => void; options: ReactNode }) {
  return <header className={'topbar mobile-header' + (page === 'playing' ? ' listening-header' : '')}>
    {page === 'playing' ? <>
      <button className="btn btn-icon" aria-label="返回浏览音乐" onClick={onBack}><CaretDownIcon size={25}/></button>
      <h1>正在播放</h1>{options}
    </> : <>
      <div className="mobile-header-title"><HeadphonesIcon size={23}/><strong>{page === 'library' ? '歌单' : page === 'profile' ? '我的' : page === 'settings' ? '设置' : '慢听'}</strong></div>
      <div className="mobile-header-actions">
        <button className="btn btn-icon" aria-label="搜索歌曲或视频" onClick={onSearch}><MagnifyingGlassIcon size={23}/></button>
        <button className="btn btn-icon" aria-label="粘贴链接" onClick={onLink}><LinkIcon size={22}/></button>
      </div>
    </>}
  </header>;
}

export function MobileNavigation({ page, onNavigate }: { page: string; onNavigate: (page: string) => void }) {
  const active = ['charts', 'follows'].includes(page) ? 'discover' : page === 'settings' ? 'profile' : page;
  return <nav className="mobile-nav" aria-label="手机导航">{destinations.map(item => <button key={item.id} className={active === item.id ? 'active' : ''} aria-current={active === item.id ? 'page' : undefined} onClick={() => onNavigate(item.id)}>
    <item.icon size={23} weight={active === item.id ? 'fill' : 'regular'}/><span>{item.label}</span>
  </button>)}</nav>;
}

export function MobileDiscoveryNavigation({ page, onNavigate }: { page: string; onNavigate: (page: string) => void }) {
  return <nav className="mobile-discovery-nav" aria-label="发现栏目">{[{id:'discover', label:'推荐'}, {id:'charts', label:'音乐榜单'}, {id:'follows', label:'关注'}].map(item => <button key={item.id} aria-current={page === item.id ? 'page' : undefined} className={page === item.id ? 'active' : ''} onClick={() => onNavigate(item.id)}>{item.label}</button>)}</nav>;
}

export function MobileMiniPlayer({ cover, title, artist, progress, transport, onOpen, onQueue, queueOpen }: { cover: ReactNode; title: string; artist: string; progress: ReactNode; transport: ReactNode; onOpen: () => void; onQueue: () => void; queueOpen: boolean }) {
  return <footer className="mobile-mini-player" aria-label="播放器">
    <div className="mobile-mini-progress">{progress}</div>
    <div className="mobile-mini-row">
      <button className="now-playing" aria-label="打开正在播放" onClick={onOpen}>{cover}<span><strong title={title}>{title}</strong><small>{artist}</small></span></button>
      <div className="mobile-mini-transport">{transport}</div>
      <button className="btn btn-icon" aria-label="打开播放队列" aria-expanded={queueOpen} onClick={onQueue}><QueueIcon size={24}/></button>
    </div>
  </footer>;
}

const profileLinks = [
  { id: 'appearance', label: '外观与主题', description: '明暗与配色', icon: PaletteIcon },
  { id: 'account', label: 'B站账号', description: '登录与收藏夹关联', icon: UserCircleIcon },
  { id: 'sources', label: '音乐来源', description: '来源开关与状态', icon: PlugsConnectedIcon },
  { id: 'recommendation', label: '推荐偏好', description: '推荐与选歌规则', icon: SlidersHorizontalIcon },
  { id: 'diagnostics', label: '数据与诊断', description: '备份、恢复与运行状态', icon: DatabaseIcon },
  { id: 'about', label: '关于慢听', description: '版本、许可与声明', icon: InfoIcon },
] as const;

export function MobileProfile({ account, onSettings }: { account?: BilibiliAccountState; onSettings: (section: SettingsSectionId) => void }) {
  const accountText = account?.state === 'authenticated' ? 'B站账号已登录' : account?.state === 'expired' ? 'B站登录已过期' : account?.state === 'unavailable' ? '账号状态暂不可用' : account?.state === 'anonymous' ? 'B站账号未登录' : '正在读取账号状态…';
  return <section className="mobile-profile" aria-label="我的">
    <div className="mobile-profile-intro"><HeadphonesIcon size={36} weight="light"/><h1>自己的音乐，慢慢听。</h1><p>{accountText}</p></div>
    <div className="mobile-profile-links">{profileLinks.map(item => <button key={item.id} onClick={() => onSettings(item.id)}><item.icon size={23}/><span><strong>{item.label}</strong><small>{item.description}</small></span><CaretRightIcon size={18}/></button>)}</div>
    <button className="btn btn-ghost mobile-profile-settings" onClick={() => onSettings('appearance')}><GearIcon size={19}/>打开设置</button>
  </section>;
}
