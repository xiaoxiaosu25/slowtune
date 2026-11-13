import { useEffect, useState } from 'react';
import { preferenceStorage } from '../preference-storage';

export const mobileVisuals = { vinyl: '唱片', square: '方形', disc: '圆形', spectrum: '音波', halo: '音环' } as const;
export type MobileVisual = keyof typeof mobileVisuals;

const storageKey = 'slow-listening:mobile-playing-visual:v1';
const legacyKey = 'slow-listening:playing-visual:v1';
const parse = (mode: string | null): MobileVisual => mode && mode in mobileVisuals ? mode as MobileVisual : 'vinyl';

/** 移动完整播放页的封面样式：读取、保存并跟随其他标签页的修改。 */
export function useMobileVisual() {
  const [mobileVisual, setMobileVisual] = useState<MobileVisual>(() => {
    try { return parse(preferenceStorage().getItem(storageKey) ?? preferenceStorage().getItem(legacyKey)); }
    catch { return 'vinyl'; }
  });
  useEffect(() => {
    const sync = (event: StorageEvent) => {
      if (event.key !== storageKey && event.key !== null) return;
      try {
        if (event.storageArea !== preferenceStorage()) return;
        setMobileVisual(parse(preferenceStorage().getItem(storageKey)));
      } catch {}
    };
    window.addEventListener('storage', sync);
    return () => window.removeEventListener('storage', sync);
  }, []);
  const selectMobileVisual = (mode: MobileVisual) => {
    setMobileVisual(mode);
    try { preferenceStorage().setItem(storageKey, mode); } catch {}
  };
  return { mobileVisual, selectMobileVisual };
}
