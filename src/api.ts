import type { EntryRef, Account, Shelf } from '@studio/music-sources';
import type { VerifiedMusicEntry } from '../server/audio-quality';
import { desktopSurface } from './song-search';
import { observeSourceRequest } from './playback-diagnostics';
export type { CreatorRef, CreatorProfile, FollowedCreator, FollowState, CreatorCollection, CreatorCollections, CreatorVideos, FollowFeed } from '../server/follow-types';
export class ApiError extends Error { constructor(public code:string, public currentRevision?:string|null, public provider?:string,public upstreamCode?:string){super(code);} }
export async function request<T>(path:string, body?:unknown, signal?:AbortSignal):Promise<T> {
  try {
    const start=performance.now(),r=await fetch(path,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json','X-Music-App':'1',...(desktopSurface()?{'X-SlowTune-Surface':'desktop'}:{})},...(body!==undefined?{body:JSON.stringify(body)}:{}),signal});
    observeSourceRequest(path,r,start);
    // A missing route falls through to the static page on an older running service: report that
    // instead of parsing the document as this endpoint's JSON.
    if(!(r.headers.get('Content-Type')??'').includes('json'))throw new ApiError('version-mismatch');
    const data=await r.json(); if(!r.ok){if(r.status===401&&data.error?.code==='authentication'&&!data.error?.provider&&!['/api/login','/api/session','/api/bootstrap'].includes(path))window.dispatchEvent(new Event('slowtune:session-expired'));throw new ApiError(data.error?.code??'network',data.error?.currentRevision,data.error?.provider,data.error?.upstreamCode);} return data;
  } catch(e) {if(desktopSurface()&&(e as Error).name==='TimeoutError')throw new ApiError('timeout');if(e instanceof ApiError || (e as Error).name==='AbortError')throw e;throw new ApiError('network');}
}
export const messages:Record<string,string>={'no-results':'本次没有取得符合当前规则的歌曲。',authentication:'访问会话已失效，请重新输入服务访问码。',restricted:'来源限制了此请求（地区或平台风控）。可以稍后重试或选择另一来源。','rate-limited':'来源请求过于频繁，请稍后重试。',network:'网络或服务连接中断，请检查服务后重试。','version-mismatch':'服务端与当前页面不是同一次构建：运行中的服务仍是旧版本。请运行 stop.cmd 后重新启动慢听，再刷新页面。',upstream:'来源暂时无法返回有效内容，请重试。','not-found':'来源内容不存在或无法访问。',unsupported:'此来源或功能当前不可用，请查看服务状态。','stale-cursor':'分页已失效，请重新搜索。',expired:'媒体地址已失效，请重试以重新取源。',timeout:'来源响应超时，可以取消或重试。',busy:'来源正在处理其他请求，请稍后重试。',conflict:'资料已被另一页面修改。当前编辑已保留，请重读后检查并重新提交。',storage:'资料保存失败，原资料保留。请检查存储和服务状态。','invalid-input':'输入格式不正确，请检查内容。','unknown-version':'无法导入这个版本的快照，原资料保留。',duplicate:'导入的标识与现有资料冲突，原资料保留。','queue-limit':'当前列表超过 500 首，播放队列最多支持 500 首，请筛选后再播放。','incomplete-queue':'歌单中有歌曲暂不可用。资料和当前队列保留，请检查条目后重试。'};
export function errorText(e:unknown) {const code=(e as {code?:string})?.code;if(code==='cancelled')return '操作已取消，原资料保留。可以重新发起操作。';if(code==='bilibili-authentication'||code==='authentication'&&(e as {provider?:string}).provider==='bilibili')return 'B站登录已失效，请在设置中重新扫码登录，或重试使用匿名音轨。';return messages[code??'']??'操作失败，请重试。';}
messages['bilibili-folder-create-uncertain']='上次新建收藏夹的结果尚未确认。请先读取 B站收藏夹，选择已创建的项关联；为避免重复新建，暂不再次创建。';
export function cancelled(e:unknown){return (e as Error).name==='AbortError'||(e as {code?:string}).code==='cancelled';}
messages['no-match']='没有找到符合当前偏好的可靠版本，可以搜索并显示全部结果，或指定播放版本。';
messages['preferred-unavailable']='已指定的优先版本暂不可用。请搜索后重新选择，或在偏好中取消指定版本。';
messages['source-disabled']='YouTube 已关闭，请在设置的音乐来源中开启。';
messages['access-code-invalid']='当前访问码不正确，请重新输入。';
messages['access-code-format']='新访问码需为 6–256 个字符，且不能全部为空格。';
messages['welcome-image-invalid']='图片无效或过大，请重新选择 JPG、PNG 或 WebP 图片。';
export interface BilibiliAccountState {state:'anonymous'|'authenticated'|'expired'|'unavailable';account?:Account;issue?:string}
export type BuildArtifact='server'|'client';
export interface ServerBuildState {startedAt:number;stale:boolean;changed:BuildArtifact[];started:Record<BuildArtifact,number>;current:Record<BuildArtifact,number>}
export interface ServerStatus {authenticationRequired?:boolean;version:string;node:string;providers:{bilibili:{available:boolean};youtube:{available:boolean;enabled?:boolean;checking?:boolean;toolVersion?:string;issue?:string}};sourceSettings?:import('../server/source-settings-types').SourceSettingsState;delivery:{leases:number;activeReads:number};tool:{active:number};build?:ServerBuildState}
export interface ChartPeriod {id:number;number:number;publishedAt:number}
export interface BilibiliChart {shelf:Shelf;periods:ChartPeriod[];period:ChartPeriod;sourceUrl:string;fetchedAt:number}
export interface Track extends VerifiedMusicEntry {unavailable?:string; songId?:string; versionId?:string; chartContext?:import('../server/song-library-types').ChartSongContext; targetSongId?:string; selection?:import('../server/song-library-types').SongPlaybackSelection; partsGroupId?:string;searchPartition?:import('../server/search-policy').SearchPartition;
  /** Desktop projection keeps the source cover separately; null means the source has none. */
  sourceArtwork?:string|null;
  /** Original title before desktop song metadata is projected onto this source. */
  sourceTitle?:string;
}
export function availabilityText(code:string) {return code==='not-found'?'已失效 · 内容不存在或无法访问':`暂时无法确认 · ${errorText({code})}`;}
export function key(ref:EntryRef){return `${ref.provider}:${ref.kind}:${encodeURIComponent(ref.id)}${ref.part?':'+encodeURIComponent(ref.part):''}`;}
export function time(seconds?:number){if(seconds===undefined || !Number.isFinite(seconds))return '—';const n=Math.max(0,Math.floor(seconds));return `${Math.floor(n/60).toString().padStart(2,'0')}:${(n%60).toString().padStart(2,'0')}`;}
export function creator(t:Track){return t.artists?.join(' / ') || t.uploader?.name || '作者未知';}
