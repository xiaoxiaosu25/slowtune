import { useEffect, useRef, useState, useSyncExternalStore, type ComponentProps } from 'react';
import { CaretDownIcon, CheckCircleIcon } from '@phosphor-icons/react';
import type { SettingsPage } from './SettingsPage';
import { BilibiliAccountControls } from './BilibiliAccountControls';
import { SongSyncControls } from './SongSyncControls';
import { SourceSettings } from './SourceSettings';
import { SearchPreferencesSettings } from './SearchPreferences';
import { RecommendationSettings } from './RecommendationSettings';
import { AccessSettings } from './AccessSettings';
import { WelcomeSettings } from './WelcomeSettings';
import { DiagnosticsPanel } from './DiagnosticsPanel';
import { AboutPanel } from './AboutPanel';
import { getThemeState, subscribeTheme, setThemePalette, setThemePreference, themePalettes } from './theme';
import { MobileSettingRow } from './MobileSettingsControls';
import { mobileSettingsTitles, type MobileSettingsSection } from './mobile-settings';

const modes = [{ value: 'system', label: '跟随系统' }, { value: 'light', label: '白天' }, { value: 'dark', label: '黑夜' }] as const;

function MobileAppearance({ onWelcome }: { onWelcome: () => void }) {
  const theme = useSyncExternalStore(subscribeTheme, getThemeState);
  return <>
    <section className="mobile-appearance-section" aria-labelledby="mobile-mode-heading">
      <h2 id="mobile-mode-heading">明暗模式</h2>
      <div className="mobile-theme-modes" role="group" aria-labelledby="mobile-mode-heading">{modes.map(mode =>
        <button key={mode.value} aria-pressed={theme.preference === mode.value} onClick={() => setThemePreference(mode.value)}>{mode.label}</button>
      )}</div>
      <p className="mobile-setting-note">跟随系统时，夜间也会自动使用黑夜模式。</p>
    </section>
    <section className="mobile-appearance-section" aria-labelledby="mobile-palette-heading">
      <h2 id="mobile-palette-heading">主题配色</h2>
      <div className="mobile-theme-options" role="group" aria-labelledby="mobile-palette-heading">{themePalettes.map(palette =>
        <button key={palette.id} className="mobile-theme-choice" aria-label={palette.label} aria-pressed={theme.palette === palette.id} onClick={() => setThemePalette(palette.id)}>
          <span className="mobile-theme-colors" aria-hidden="true">{(['light', 'dark'] as const).map(mode =>
            <span key={mode} className="theme-preview mobile-theme-color" data-palette={palette.id} data-theme={mode}/>
          )}</span>
          <span className="mobile-theme-name">{palette.label}<CheckCircleIcon size={20} weight="fill" aria-hidden="true"/></span>
        </button>
      )}</div>
    </section>
    <div className="mobile-setting-group"><MobileSettingRow label="欢迎页" description="背景图片与构图" onClick={onWelcome}/></div>
    {!theme.persistent && <p className="mobile-setting-note" role="status">当前浏览器无法保存外观，刷新后可能恢复默认。</p>}
  </>;
}

type Props = Omit<ComponentProps<typeof SettingsPage>, 'desktopLyricsRequest' | 'onSectionChanged' | 'onBack'> & {
  active: boolean; section: MobileSettingsSection; onSection: (section: MobileSettingsSection) => void;
};

/** Mobile owns the page structure; account, data and save operations stay shared. */
export function MobileSettings({ active, section, onSection, ...props }: Props) {
  const host = useRef<HTMLElement>(null);
  const [visited, setVisited] = useState<Set<MobileSettingsSection>>(() => new Set([section]));
  useEffect(() => { setVisited(previous => previous.has(section) ? previous : new Set([...previous, section])); }, [section]);
  const reload = useRef(props.onReload); reload.current = props.onReload;
  useEffect(() => { reload.current(); }, []);
  useEffect(() => {
    if (!active) host.current?.querySelectorAll<HTMLDialogElement>('dialog[open]').forEach(dialog => dialog.dispatchEvent(new Event('cancel', {cancelable:true})));
  }, [active]);
  const openAbout = () => onSection('about');
  const youtubeEnabled = props.sources?.youtube.enabled ?? props.status?.providers.youtube.enabled ?? props.status?.providers.youtube.available ?? false;
  return <section ref={host} className="mobile-settings" aria-label="手机设置" hidden={!active}>
    {(Object.keys(mobileSettingsTitles) as MobileSettingsSection[]).filter(id => visited.has(id) || id === section).map(id =>
      <section key={id} data-settings-section={id} className="mobile-settings-panel" aria-label={mobileSettingsTitles[id]} hidden={id !== section}>
        {id === 'appearance' && <MobileAppearance onWelcome={() => onSection('welcome')}/>}
        {id === 'welcome' && <WelcomeSettings mobile/>}
        {id === 'sources' && <SourceSettings mobile state={props.sources} onChanged={props.onSourcesChanged} onOpenAbout={openAbout}/>}
        {id === 'account' && <><BilibiliAccountControls status={props.account} onChange={props.onAccountChange} onOpenAbout={openAbout}/><SongSyncControls key={props.account?.account?.id ?? props.account?.state} library={props.library} authenticated={props.account?.state === 'authenticated'} onChange={props.onLibraryChange}/></>}
        {id === 'recommendation' && <><RecommendationSettings onChanged={props.onRecommendationChanged} accountAuthenticated={props.account?.state === 'authenticated'} youtubeEnabled={youtubeEnabled}/><details className="mobile-setting-details mobile-search-rules"><summary><span>搜索与自动选歌<small>筛选规则与优先版本</small></span><CaretDownIcon size={18}/></summary><SearchPreferencesSettings onChanged={props.onSearchPreferencesChanged}/></details></>}
        {id === 'access' && <AccessSettings onChanged={props.onReload}/>}
        {id === 'diagnostics' && <DiagnosticsPanel status={props.status} checkedAt={props.statusCheckedAt} account={props.account} library={props.library} onRefresh={props.onRefreshDiagnostics} onStopPlayback={props.onStopPlayback} onLogout={props.onLogout} onOpenBackup={props.onOpenBackup} onOpenSources={() => onSection('sources')} onOpenAccount={() => onSection('account')} onOpenAbout={openAbout}/>}
        {id === 'about' && <AboutPanel active={active && section === 'about'} status={props.status}/>}
      </section>
    )}
  </section>;
}
