import { preferenceStorage } from './preference-storage';
export type ThemePreference = 'system' | 'light' | 'dark';
export type Theme = 'light' | 'dark';
const backgrounds = { light: '#F3F0E9', dark: '#1B1916' } as const;
export const themePalettes = [
  { id: 'paper', label: '暖纸炭黑', description: '暖纸与砖红，复古唱片感', backgrounds },
  { id: 'mint', label: '经典薄荷', description: '暖纸底色，鲜绿点缀，清爽自然', backgrounds },
  { id: 'ocean', label: '晴樱粉', description: '暖纸底色，明粉点缀，轻快明亮', backgrounds },
  { id: 'plum', label: '珊瑚红', description: '暖纸底色，珊瑚红点缀，简洁鲜明', backgrounds },
] as const;
export type ThemePalette = typeof themePalettes[number]['id'];
export interface ThemeState { preference: ThemePreference; resolved: Theme; palette: ThemePalette; persistent: boolean }

export const themeStorageKey = 'slow-listening:theme:v1';
export const paletteStorageKey = 'slow-listening:palette:v1';
const listeners = new Set<() => void>();
let media: MediaQueryList;
let state: ThemeState;
let boundaryTimer: number | undefined;

function preferenceOf(value: string | null): ThemePreference {
  return value === 'light' || value === 'dark' ? value : 'system';
}

function paletteOf(value: string | null): ThemePalette {
  return themePalettes.find(palette => palette.id === value)?.id ?? 'paper';
}

function apply(preference: ThemePreference, palette: ThemePalette, persistent: boolean) {
  const hour = new Date().getHours();
  const resolved = preference === 'system' ? (media.matches || hour < 6 || hour >= 18 ? 'dark' : 'light') : preference;
  const root = document.documentElement;
  root.dataset.theme = resolved;
  root.dataset.themePreference = preference;
  root.dataset.palette = palette;
  root.style.colorScheme = resolved;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', themePalettes.find(item => item.id === palette)!.backgrounds[resolved]);
  if (state?.preference === preference && state.resolved === resolved && state.palette === palette && state.persistent === persistent) return;
  state = { preference, resolved, palette, persistent };
  for (const listener of listeners) listener();
}

function refreshAutomaticTheme() {
  if (state.preference === 'system') apply('system', state.palette, state.persistent);
  window.clearTimeout(boundaryTimer);
  const now = new Date();
  const boundary = new Date(now);
  boundary.setHours(now.getHours() < 6 ? 6 : now.getHours() < 18 ? 18 : 30, 0, 0, 0);
  boundaryTimer = window.setTimeout(refreshAutomaticTheme, boundary.getTime() - now.getTime());
}

export function initializeTheme() {
  if (media) return;
  media = window.matchMedia('(prefers-color-scheme: dark)');
  let preference: ThemePreference = 'system';
  let palette: ThemePalette = 'paper';
  let persistent = true;
  try {
    preference = preferenceOf(preferenceStorage().getItem(themeStorageKey));
    palette = paletteOf(preferenceStorage().getItem(paletteStorageKey));
  }
  catch { persistent = false; }
  apply(preference, palette, persistent);
  media.addEventListener('change', () => {
    if (state.preference === 'system') apply('system', state.palette, state.persistent);
  });
  refreshAutomaticTheme();
  window.addEventListener('focus', refreshAutomaticTheme);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) refreshAutomaticTheme();
  });
  window.addEventListener('storage', event => {
    if (event.key === themeStorageKey || event.key === paletteStorageKey || event.key === null) {
      try {
        if (event.storageArea !== preferenceStorage()) return;
        if (event.key === null) apply('system', 'paper', true);
        else if (event.key === themeStorageKey) apply(preferenceOf(event.newValue), state.palette, true);
        else apply(state.preference, paletteOf(event.newValue), true);
      } catch { /* The current theme remains usable when storage is blocked. */ }
    }
  });
}

export function setThemePreference(preference: ThemePreference) {
  let persistent = true;
  try { preferenceStorage().setItem(themeStorageKey, preference); }
  catch { persistent = false; }
  apply(preference, state.palette, persistent);
}

export function setThemePalette(palette: ThemePalette) {
  let persistent = true;
  try { preferenceStorage().setItem(paletteStorageKey, palette); }
  catch { persistent = false; }
  apply(state.preference, palette, persistent);
}

export const getThemeState = () => state;
export function subscribeTheme(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
