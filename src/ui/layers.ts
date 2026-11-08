export const OPEN_LAYER = 'dialog[open],[popover]:popover-open,[data-layer][data-state="open"]';
export const OPEN_DIALOG = 'dialog[open],[data-layer="dialog"][data-state="open"]';
export const openLayers = (root: ParentNode = document) => Array.from(root.querySelectorAll<HTMLElement>(OPEN_LAYER));
export const topDialog = () => Array.from(document.querySelectorAll<HTMLElement>(OPEN_DIALOG)).at(-1);
export const isDialogLayer = (element: Element) => element instanceof HTMLDialogElement || element.matches('[data-layer="dialog"]');
export const requestLayerClose = (element: Element) => element.dispatchEvent(new Event('cancel', { cancelable: true }));
