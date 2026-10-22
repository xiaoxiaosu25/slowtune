import { useSyncExternalStore } from 'react';
import { CheckCircleIcon, DesktopIcon, MoonIcon, SunIcon } from '@phosphor-icons/react';
import { getThemeState, setThemePalette, setThemePreference, subscribeTheme, themePalettes } from './theme';

const choices = [
  { value: 'system', label: '跟随系统', Icon: DesktopIcon },
  { value: 'light', label: '白天', Icon: SunIcon },
  { value: 'dark', label: '黑夜', Icon: MoonIcon },
] as const;

export function ThemeToggle({ labeled = false }: { labeled?: boolean }) {
  const { resolved } = useSyncExternalStore(subscribeTheme, getThemeState);
  const next = resolved === 'dark' ? 'light' : 'dark';
  const label = `切换为${next === 'light' ? '浅色' : '深色'}`;
  const Icon = next === 'light' ? SunIcon : MoonIcon;
  return <button className={labeled ? 'nav-item' : 'btn btn-icon'} aria-label={label} title={label} onClick={() => setThemePreference(next)}><Icon size={22}/>{labeled && <span>{label}</span>}</button>;
}

export function ThemeSettings() {
  const { preference, resolved, palette, persistent } = useSyncExternalStore(subscribeTheme, getThemeState);
  const selectedPalette = themePalettes.find(item => item.id === palette)!;
  return <section className="theme-settings" aria-labelledby="appearance-heading">
    <h3 id="appearance-heading">外观</h3>
    <p className="settings-section-description">选择适合此刻的音乐空间。</p>
    <p className="field-label theme-field-label">明暗模式</p>
    <div className="segmented theme-mode-options" role="group" aria-label="明暗模式">{choices.map(({ value, label, Icon }) =>
      <button key={value} className={preference === value ? 'selected' : ''} aria-pressed={preference === value} onClick={() => setThemePreference(value)}>
        <Icon size={18}/><span>{label}</span>
      </button>
    )}</div>
    <p className="muted theme-mode-help">系统使用深色，或本机时间为 18:00–次日 06:00 时，自动使用黑夜模式；其余时间使用白天模式。快捷切换会改为手动模式，可在此重新选择跟随系统。</p>
    <p className="field-label">主题配色</p>
    <div className="segmented theme-options" role="group" aria-label="主题配色">{themePalettes.map(item =>
      <button key={item.id} aria-label={item.label} className={palette === item.id ? 'selected' : ''} aria-pressed={palette === item.id} onClick={() => setThemePalette(item.id)}>
        <span className="theme-preview-pair" aria-hidden="true">{(['light', 'dark'] as const).map(mode =>
          <span className="theme-preview-sample" key={mode}>
            <span className="theme-preview" data-palette={item.id} data-theme={mode}><span className="theme-preview-sidebar"/><span className="theme-preview-content"><span/><span/><span/></span></span>
            <span className="theme-preview-caption">{mode === 'light' ? '白天' : '黑夜'}</span>
          </span>
        )}</span>
        <span className="theme-option-label">{item.label}{palette===item.id&&<CheckCircleIcon className="theme-check" size={18} weight="fill"/>}</span>
        <span className="theme-description">{item.description}</span>
      </button>
    )}</div>
    <p className="muted" aria-live="polite">当前为{selectedPalette.label} · {resolved === 'dark' ? '黑夜' : '白天'}{preference === 'system' ? '，明暗随系统与本机时间自动变化' : '，所有页面保持一致'}。</p>
    <p className="muted" role="status">{persistent ? '外观偏好保存在当前浏览器。' : '当前浏览器无法保存外观，刷新后可能恢复默认。'}</p>
  </section>;
}
