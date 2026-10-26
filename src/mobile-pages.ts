import { useSyncExternalStore } from 'react';

let revision = 0;
let suspended = new Set<Element>();
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
export const mobilePagesSuspended = () => [...suspended].some(element=>element.isConnected&&element.matches('dialog.mobile-page[open]'));
export const mobilePageSuspended = (element: Element | null) => !!element && suspended.has(element);
const changed = () => { revision++; listeners.forEach(listener => listener()); };
/** Keep editors mounted while listening, so returning restores their drafts. */
export function suspendMobilePages(value: boolean, elements?: Element[]) {
  const next=value?new Set(elements??[...suspended,...document.querySelectorAll('dialog.mobile-page[open]:not([hidden])')]):new Set<Element>();
  if(next.size===suspended.size&&[...next].every(element=>suspended.has(element)))return;
  suspended=next;changed();
}
export function useMobilePagesSuspended() { return useSyncExternalStore(subscribe, mobilePagesSuspended); }
export function useMobilePageSuspension() { useSyncExternalStore(subscribe, () => revision); return mobilePageSuspended; }
const pageOpen = () => !!document.querySelector('dialog.mobile-page[open]:not([hidden])');
const observePages = (listener: () => void) => {
  const observer = new MutationObserver(() => {
    const remaining=[...suspended].filter(element=>element.isConnected&&element.matches('dialog.mobile-page[open]'));
    if(remaining.length!==suspended.size)suspendMobilePages(true,remaining);
    listener();
  });
  observer.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['open', 'hidden', 'class'] });
  return () => observer.disconnect();
};
export function useMobilePageOpen() { return useSyncExternalStore(observePages, pageOpen); }
