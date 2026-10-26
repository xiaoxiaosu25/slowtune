import type { CreatorCollection, CreatorProfile } from './api';

export type FollowView = { tab: 'creators' | 'updates'; selected?: CreatorProfile; collection?: CreatorCollection; view: 'collections' | 'videos' };
export const initialFollowView: FollowView = { tab: 'creators', view: 'collections' };
export const mobileFollowRoute = (view: FollowView) => view.selected || view.tab === 'updates' ? 'follows/' + encodeURIComponent(JSON.stringify({tab:view.tab,selected:view.selected&&{provider:view.selected.provider,id:view.selected.id,name:view.selected.name,url:view.selected.url},collection:view.collection,view:view.view})) : 'follows';
export function readMobileFollowView(route: string): FollowView | undefined {
  if (route === 'follows') return initialFollowView;
  if (!route.startsWith('follows/') || route.length > 16000) return;
  try {
    const value = JSON.parse(decodeURIComponent(route.slice(8))) as FollowView;
    if (!value || !['creators','updates'].includes(value.tab) || !['collections','videos'].includes(value.view)) return;
    if (value.selected && (!['bilibili','youtube'].includes(value.selected.provider) || typeof value.selected.id !== 'string' || typeof value.selected.name !== 'string' || typeof value.selected.url !== 'string')) return;
    if (value.collection && (!value.selected || typeof value.collection.id !== 'string' || typeof value.collection.title !== 'string' || typeof value.collection.url !== 'string' || !['season','series','playlist'].includes(value.collection.kind))) return;
    return value;
  } catch { return; }
}
