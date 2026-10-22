export type CommentProvider = 'bilibili' | 'youtube';
export type CommentOrder = 'hot' | 'new';
export interface VideoComment {
  id: string;
  author: string;
  avatar?: string;
  text: string;
  time: string;
  likes?: string;
  replyCount?: string;
  replyCursor?: string;
  pinned?: boolean;
}
export interface CommentPage {
  items: VideoComment[];
  nextCursor?: string;
  total?: string;
  status: 'available' | 'unavailable';
}
