import { useEffect, useState } from 'react';
import { Command } from 'cmdk';
import { MagnifyingGlassIcon } from '@phosphor-icons/react';
import { Dialog } from '../../ui/Dialog';
import { OPEN_LAYER } from '../../ui/layers';
import { nav } from '../shared';
import { useWorkspace } from '../workspace-context';

export function DesktopCommandPalette() {
  const { desktop, navigate, openSettings } = useWorkspace();
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!desktop) {
      setOpen(false);
      return;
    }
    const shortcut = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing || event.repeat || event.altKey || event.shiftKey ||
          (!event.ctrlKey && !event.metaKey) || event.key.toLowerCase() !== 'k' ||
          document.querySelector(OPEN_LAYER)) return;
      event.preventDefault();
      setOpen(true);
    };
    window.addEventListener('keydown', shortcut);
    return () => window.removeEventListener('keydown', shortcut);
  }, [desktop]);

  if (!open || !desktop) return null;
  const choose = (route: string) => {
    setOpen(false);
    if (route === 'settings') openSettings();
    else navigate(route);
  };
  return (
    <Dialog className="form-modal command-palette" title="快捷指令" onClose={() => setOpen(false)}>
      <Command loop label="快捷指令">
        <label className="search-field">
          <MagnifyingGlassIcon size={18} aria-hidden="true" />
          <Command.Input aria-label="筛选快捷指令" placeholder="查找操作或页面" data-autofocus="true" />
        </label>
        <Command.List>
          <Command.Empty>没有匹配的指令</Command.Empty>
          <Command.Item value="搜索音乐" onSelect={() => choose('search')}>搜索音乐</Command.Item>
          {nav.map(({ id, label }) => <Command.Item key={id} value={label} onSelect={() => choose(id)}>{label}</Command.Item>)}
          <Command.Item value="设置" onSelect={() => choose('settings')}>设置</Command.Item>
        </Command.List>
      </Command>
    </Dialog>
  );
}
