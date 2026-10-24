import { useLayoutEffect, useRef } from 'react';

type Entry = { session: string; id: number; key: string; page: string; layers: number[]; scroll: number };
const stateKey = 'slowTuneMobileNavigation';
const pages = new Set(['discover', 'charts', 'follows', 'library', 'profile', 'settings', 'playing']);

/** Keep mobile browser Back inside the current flow before leaving the app. */
export function useMobileNavigationHistory(enabled: boolean, page: string, onRestore: (page: string) => void) {
  const latest = useRef({ page, onRestore }); latest.current = { page, onRestore };
  const refresh = useRef<() => void>(() => {});
  const back = useRef<(page: string, fallback: () => void) => void>((_page, fallback) => fallback());
  useLayoutEffect(() => {
    if (!enabled) return;
    const session = 'mobile-' + Date.now() + '-' + Math.random();
    const tokens = new WeakMap<Element, number>(); let token = 0, serial = 0, restoring = false, disposed = false;
    let pendingClose: string | undefined, frame = 0;
    const entries: Entry[] = []; let index = 0;
    const layers = () => Array.from(document.querySelectorAll<HTMLElement>('dialog[open],[popover]:popover-open'));
    const identity = (element: Element) => { if (!tokens.has(element)) tokens.set(element, ++token); return tokens.get(element)!; };
    const snapshot = (): Entry => {
      const open = layers().map(identity), currentPage = latest.current.page;
      return { session, id: ++serial, key: JSON.stringify([currentPage, open]), page: currentPage, layers: open, scroll: window.scrollY };
    };
    const write = (entry: Entry, replace: boolean) => {
      const state = history.state && typeof history.state === 'object' ? history.state : {};
      history[replace ? 'replaceState' : 'pushState']({ ...state, [stateKey]: entry }, '');
      if (replace) entries[index] = entry;
      else { entries.splice(index + 1); entries.push(entry); index = entries.length - 1; }
    };
    const commit = () => {
      if (restoring || disposed) return;
      const next = snapshot(), current = entries[index];
      if (current?.key === next.key) return;
      if (pendingClose) return;
      if (current?.page === next.page && current.layers.some(layer => !next.layers.includes(layer))) {
        // A menu replaced by a dialog occupies the same history step.
        if (next.layers.some(layer => !current.layers.includes(layer))) { write(next, true); return; }
        let previous = index - 1;
        while (previous >= 0 && entries[previous].page === next.page && entries[previous].key !== next.key) previous--;
        if (previous >= 0 && entries[previous].key === next.key) {
          pendingClose = next.key; history.go(previous - index);
        } else write(next, true);
        return;
      }
      write(next, !current);
    };
    const pop = (event: PopStateEvent) => {
      const incoming = event.state?.[stateKey] as Entry | undefined;
      if (!incoming || !pages.has(incoming.page)) return;
      let target: Entry = incoming;
      let at = target.session === session ? entries.findIndex(entry => entry.id === target.id) : -1;
      if (at < 0) {
        // Reloads create a new session, but earlier page entries still belong to this app.
        target = { session, id: ++serial, page: target.page, layers: [], key: JSON.stringify([target.page, []]), scroll: Number.isFinite(target.scroll) ? target.scroll : 0 };
        entries.splice(0, entries.length, target); at = 0;
      }
      index = at;
      const actual = snapshot();
      // A rapid close-and-open must not let the queued Back dismiss the new UI.
      if (pendingClose && actual.key !== pendingClose) {
        pendingClose = undefined; write({ ...target, id: ++serial }, true); commit(); return;
      }
      pendingClose = undefined; restoring = true;
      for (const element of layers().reverse()) {
        if (target.layers.includes(identity(element))) continue;
        if (element instanceof HTMLDialogElement) element.dispatchEvent(new Event('cancel', { cancelable: true }));
        else element.hidePopover();
      }
      if (latest.current.page !== target.page) latest.current.onRestore(target.page);
      const retainedLayers = layers().map(identity).filter(id => target.layers.includes(id));
      const base = { ...target, id: ++serial, layers: retainedLayers, key: JSON.stringify([target.page, retainedLayers]) };
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        if (disposed) return;
        // Closed dialogs are intentionally not recreated by browser Forward.
        if (!layers().length) window.scrollTo(0, target.scroll);
        const next = snapshot();
        write(next.key === base.key ? next : base, true); restoring = false; commit();
      });
    };
    const scroll = () => {
      const current = entries[index];
      if (restoring || pendingClose || !current || current.key !== snapshot().key) return;
      const next = { ...current, scroll: window.scrollY }; entries[index] = next;
      const state = history.state && typeof history.state === 'object' ? history.state : {};
      history.replaceState({ ...state, [stateKey]: next }, '');
    };
    write(snapshot(), true); refresh.current = commit;
    back.current = (targetPage, fallback) => {
      const previous = entries[index - 1];
      if (!pendingClose && !restoring && previous?.key === JSON.stringify([targetPage, []])) {
        pendingClose = previous.key; fallback(); history.back();
      } else fallback();
    };
    const observer = new MutationObserver(commit);
    observer.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['open'] });
    window.addEventListener('popstate', pop);
    window.addEventListener('scroll', scroll, { passive: true });
    document.addEventListener('toggle', commit, true);
    return () => { disposed = true; observer.disconnect(); cancelAnimationFrame(frame); window.removeEventListener('popstate', pop); window.removeEventListener('scroll', scroll); document.removeEventListener('toggle', commit, true); refresh.current = () => {}; back.current = (_page, fallback) => fallback(); };
  }, [enabled]);
  useLayoutEffect(() => { refresh.current(); }, [enabled, page]);
  return (targetPage: string, fallback: () => void) => back.current(targetPage, fallback);
}
