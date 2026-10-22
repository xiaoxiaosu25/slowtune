import type { EntryRef } from '@studio/music-sources';
import type { CreatorRef } from './follow-types.js';

export type ListImportSource =
  | {kind:'playlist';ref:EntryRef}
  | {kind:'creator-collection';creator:CreatorRef;collectionId:string}
  | {kind:'entries';items:{ref:EntryRef;context:'video'|'part'}[]};
