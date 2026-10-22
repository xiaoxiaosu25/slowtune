import { useLayoutEffect } from 'react';
import { getThemeState, subscribeTheme } from './theme';
import './desktop-chrome.css';

type WindowMode = 'standard' | 'welcome' | 'welcome-artwork' | 'immersive';
let mode: WindowMode = 'welcome';

function syncAppearance() {
  window.slowTuneDesktop?.setWindowAppearance({ theme: getThemeState().resolved, mode });
}

export function initializeDesktopChrome() {
  const api = window.slowTuneDesktop;
  if (!api) return;
  document.documentElement.dataset.desktopHost = 'true';
  document.documentElement.dataset.desktopMode = mode;
  api.onWindowState(state => { document.documentElement.dataset.desktopFullscreen = String(state.fullscreen); });
  subscribeTheme(syncAppearance);
  syncAppearance();
}

export function useDesktopWindowMode(next: WindowMode, enabled = true) {
  useLayoutEffect(() => {
    if (!enabled || !window.slowTuneDesktop) return;
    mode = next;
    document.documentElement.dataset.desktopMode = mode;
    syncAppearance();
  }, [next, enabled]);
}

export function DesktopImmersiveChrome() {
  if (!window.slowTuneDesktop) return null;
  return <div className="desktop-immersive-chrome"><div className="desktop-window-drag" aria-hidden="true"/></div>;
}
