import { useEffect, useRef, useState } from 'react';
import { ArrowLeftIcon, PaletteIcon, PlugsConnectedIcon, UserCircleIcon, SlidersHorizontalIcon, DatabaseIcon, InfoIcon, LockKeyIcon, MusicNotesIcon } from '@phosphor-icons/react';
import type { BilibiliAccountState, ServerStatus } from './api';
import type { SongLibraryState as LibraryData } from '../server/song-library-types';
import { BilibiliAccountControls } from './BilibiliAccountControls';
import { RecommendationSettings } from './RecommendationSettings';
import { ThemeSettings } from './ThemeControls';
import { AboutPanel } from './AboutPanel';
import { DiagnosticsPanel } from './DiagnosticsPanel';
import { SourceSettings } from './SourceSettings';
import type { SourceSettingsState } from './source-settings';
import { WelcomeSettings } from './WelcomeSettings';
import { AccessSettings } from './AccessSettings';
import { SearchPreferencesSettings } from './SearchPreferences';
import type { SearchSettings } from '../server/search-policy';
import { SongSyncControls } from './SongSyncControls';
import { DesktopLyricsSettings, DesktopDataSettings } from './DesktopSettings';

const sections = [
  { id: 'appearance', label: '外观', icon: PaletteIcon },
  { id: 'desktop-lyrics', label: '桌面歌词', icon: MusicNotesIcon },
  { id: 'access', label: '启动与访问', icon: LockKeyIcon },
  { id: 'local-data', label: '本地资料', icon: DatabaseIcon },
  { id: 'sources', label: '音乐来源', icon: PlugsConnectedIcon },
  { id: 'account', label: 'B站账号', icon: UserCircleIcon },
  { id: 'recommendation', label: '推荐偏好', icon: SlidersHorizontalIcon },
  { id: 'diagnostics', label: '诊断与数据', icon: DatabaseIcon },
  { id: 'about', label: '关于与声明', icon: InfoIcon },
] as const;
type SectionId = typeof sections[number]['id'];

export function SettingsPage({ desktopLyricsRequest = 0, status, statusCheckedAt, onRefreshDiagnostics, sources, onSourcesChanged, account, library, onLibraryChange, onAccountChange, onRecommendationChanged, onSearchPreferencesChanged, onReload, onBack, onOpenBackup, onStopPlayback, onLogout }: {
  desktopLyricsRequest?: number;
  onSearchPreferencesChanged?:(state:SearchSettings)=>void;
  sources?:SourceSettingsState;
  onSourcesChanged:(value:SourceSettingsState)=>void;
  status?: ServerStatus;
  statusCheckedAt?: number;
  onRefreshDiagnostics: () => Promise<void>;
  account?: BilibiliAccountState;
  library: LibraryData|null;
  onLibraryChange: (state: LibraryData) => void;
  onAccountChange: (status: BilibiliAccountState) => void;
  onRecommendationChanged: (column: string) => void;
  onReload: () => void;
  onBack: () => void;
  onOpenBackup: () => void;
  onStopPlayback: () => Promise<boolean | undefined>;
  onLogout: () => Promise<void>;
}) {
  const [section, setSection] = useState<SectionId>(desktopLyricsRequest ? 'desktop-lyrics' : 'appearance');
  const navigation = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!desktopLyricsRequest) return;
    setSection('desktop-lyrics');
    const frame = requestAnimationFrame(() => navigation.current?.querySelector<HTMLElement>('[aria-current="true"]')?.focus({preventScroll:true}));
    return () => cancelAnimationFrame(frame);
  }, [desktopLyricsRequest]);
  useEffect(() => {
    const nav = navigation.current;
    if (!nav) return;
    const revealCurrent = () => {
      const current = nav.querySelector<HTMLElement>('[aria-current="true"]');
      if (!current || nav.scrollWidth <= nav.clientWidth) return;
      const item = current.getBoundingClientRect(), bounds = nav.getBoundingClientRect();
      nav.scrollTo({left: nav.scrollLeft + item.left - bounds.left - (nav.clientWidth - item.width) / 2});
    };
    revealCurrent();
    const observer = new ResizeObserver(revealCurrent);
    observer.observe(nav);
    return () => observer.disconnect();
  }, [section]);
  const reload = useRef(onReload);
  reload.current = onReload;
  useEffect(() => { reload.current(); }, []);
  const panels = useRef<HTMLDivElement>(null);
  const openAbout = () => {
    setSection('about');
    requestAnimationFrame(() => panels.current?.querySelector<HTMLElement>('[data-about-heading]')?.focus());
  };
  const openSection = (next: SectionId) => {
    setSection(next);
    window.scrollTo(0,0);
    requestAnimationFrame(() => navigation.current?.querySelector<HTMLElement>('[aria-current="true"]')?.focus({preventScroll:true}));
  };
  return <section className="settings-view" aria-labelledby="settings-heading">
    <div className="page-heading">
      <button className="btn btn-icon" aria-label="返回浏览音乐" onClick={onBack}><ArrowLeftIcon size={22}/></button>
      <h1 id="settings-heading">设置</h1>
    </div>
    <div className="settings-body">
      <nav className="settings-nav" ref={navigation} aria-label="设置分组">{sections.filter(item => item.id === 'access' ? !window.slowTuneDesktop : ['desktop-lyrics','local-data'].includes(item.id) ? !!window.slowTuneDesktop : true).map(item =>
        <button key={item.id} className={'nav-item ' + (section === item.id ? 'active' : '')} aria-current={section === item.id ? 'true' : undefined} onClick={() => openSection(item.id)}><item.icon size={19}/>{item.id === 'diagnostics' && window.slowTuneDesktop ? '运行信息' : item.label}</button>
      )}</nav>
      <div className="settings-panels" ref={panels}>
        <section className="panel" data-settings-section="appearance" hidden={section !== 'appearance'} aria-label="外观">
          <ThemeSettings/>
          <WelcomeSettings/>
        </section>
        {window.slowTuneDesktop&&<section className="panel" data-settings-section="desktop-lyrics" hidden={section !== 'desktop-lyrics'} aria-label="桌面歌词"><DesktopLyricsSettings/></section>}
        {!window.slowTuneDesktop&&<section className="panel" data-settings-section="access" hidden={section !== 'access'} aria-label="启动与访问"><AccessSettings onChanged={onReload}/></section>}
        {window.slowTuneDesktop&&<section className="panel" data-settings-section="local-data" hidden={section !== 'local-data'} aria-label="本地资料"><DesktopDataSettings onOpenBackup={onOpenBackup}/></section>}
        <section className="panel" data-settings-section="sources" hidden={section !== 'sources'} aria-label="音乐来源"><SourceSettings state={sources} onChanged={onSourcesChanged} onOpenAbout={openAbout}/></section>
        <section className="panel" data-settings-section="account" hidden={section !== 'account'} aria-label="B站账号">
          <BilibiliAccountControls status={account} onChange={onAccountChange} onOpenAbout={openAbout}/>
          <SongSyncControls key={account?.account?.id ?? account?.state} library={library} authenticated={account?.state === 'authenticated'} onChange={onLibraryChange}/>
        </section>
        <section className="panel" data-settings-section="recommendation" hidden={section !== 'recommendation'} aria-label="推荐偏好">
          {section==='recommendation'&&<SearchPreferencesSettings onChanged={onSearchPreferencesChanged}/>}
          <RecommendationSettings onChanged={onRecommendationChanged} accountAuthenticated={account?.state === 'authenticated'} youtubeEnabled={sources?.youtube.enabled??status?.providers.youtube.enabled??status?.providers.youtube.available??false}/>
        </section>
        <section className="panel" data-settings-section="diagnostics" hidden={section !== 'diagnostics'} aria-label={window.slowTuneDesktop ? '运行信息' : '诊断与数据'}>
          <DiagnosticsPanel status={status} checkedAt={statusCheckedAt} account={account} library={library} onRefresh={onRefreshDiagnostics} onStopPlayback={onStopPlayback} onLogout={onLogout} onOpenBackup={onOpenBackup} onOpenSources={() => openSection('sources')} onOpenAccount={() => openSection('account')} onOpenAbout={openAbout}/>
        </section>
        <section className="panel" data-settings-section="about" hidden={section !== 'about'} aria-label="关于与声明"><AboutPanel active={section === 'about'} status={status}/></section>
      </div>
    </div>
  </section>;
}
