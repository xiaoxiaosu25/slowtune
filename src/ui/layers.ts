export const OPEN_LAYER = 'dialog[open],[popover]:popover-open,[data-layer][data-state="open"]';
export const OPEN_DIALOG = 'dialog[open],[data-layer="dialog"][data-state="open"]';
export const openLayers = (root: ParentNode = document) => Array.from(root.querySelectorAll<HTMLElement>(OPEN_LAYER));
export const topDialog = () => Array.from(document.querySelectorAll<HTMLElement>(OPEN_DIALOG)).at(-1);
export const requestLayerClose = (element: Element) => element.dispatchEvent(new Event('cancel', { cancelable: true }));
export const closeLayer = (element: HTMLElement) => element.matches('[popover]:popover-open') ? element.hidePopover() : requestLayerClose(element);

export function closeNestedPopover(parent: HTMLElement | null, event: KeyboardEvent) {
  const nested = Array.from(parent?.querySelectorAll<HTMLElement>('[popover]:popover-open') ?? []).at(-1);
  if (!nested) return;
  event.preventDefault();
  nested.hidePopover();
}
