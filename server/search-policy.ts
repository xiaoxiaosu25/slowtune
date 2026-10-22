import type { EntryRef, MusicEntry, Page, ErrorData } from '@studio/music-sources';
import type { VerifiedMusicEntry } from './audio-quality.js';

export type SearchRule = 'allow' | 'requested' | 'manual';
export const partitionLabels = {
  original:'原创音乐', mv:'MV', radio:'电台·歌单', other:'音乐综合', live:'音乐现场',
  fan:'乐迷饭拍', cover:'翻唱', perform:'演奏', vocaloid:'VOCALOID', ai:'AI音乐',
  tutorial:'音乐教学', commentary:'乐评盘点', nonmusic:'非音乐分区', unknown:'分区未知',
} as const;
export type SearchPartition = keyof typeof partitionLabels;
export const versionTerms = {
  live:['现场','live','演唱会','饭拍'], cover:['翻唱','cover'], perform:['演奏','纯音乐','instrumental'],
  ai:['AI翻唱','AI音乐','AI版','AI cover'], accompaniment:['伴奏','卡拉OK','karaoke'],
  remix:['remix','混音','DJ版'], compilation:['串烧','合集','混剪','歌单'],
} as const;
export const versionLabels: Record<keyof typeof versionTerms,string> = {
  live:'现场／饭拍',cover:'翻唱',perform:'演奏／纯音乐',ai:'AI版本',accompaniment:'伴奏',remix:'混音／Remix',compilation:'合集／串烧',
};
export interface SearchConfig {
  filterByDefault:boolean;
  partitions:Record<SearchPartition,SearchRule>;
  versions:Record<keyof typeof versionTerms,SearchRule>;
  excludeTerms:string[];
  strictMatch:boolean;
}
export const searchDefaultsVersion = 'music-search-v1';
export function defaultSearchConfig():SearchConfig {
  return {filterByDefault:true,strictMatch:true,
    partitions:{original:'allow',mv:'allow',radio:'allow',other:'allow',live:'requested',fan:'requested',cover:'requested',perform:'requested',vocaloid:'requested',ai:'requested',tutorial:'manual',commentary:'manual',nonmusic:'manual',unknown:'manual'},
    versions:{live:'requested',cover:'requested',perform:'requested',ai:'requested',accompaniment:'requested',remix:'requested',compilation:'requested'},
    excludeTerms:['教程','教学','解说','乐评','盘点']};
}
export interface SongQuery {title:string;artists?:string[];durationSeconds?:number}
export type SongSearchMode = 'title' | 'title-artists';
export interface SongSearchQuery extends SongQuery {searchMode?:SongSearchMode;audioSupport?:string[]}
export interface SearchEntry extends VerifiedMusicEntry {searchPartition?:SearchPartition}
export interface PreferredSong {key:string;song:SongQuery;entry:MusicEntry;updatedAt:number}
export interface SearchSettings {revision:string;defaultsVersion:string;config:SearchConfig;preferred:PreferredSong[];defaults:{version:string;config:SearchConfig}}
export interface SearchPage extends Page<SearchEntry> {config:SearchConfig;revision:string;preferred?:PreferredSong;preferredVersions:PreferredSong[];classificationIssue?:ErrorData}
export class SearchCandidateMismatch extends Error {constructor(){super('candidate-mismatch');this.name='SearchCandidateMismatch';}}

// Identity comparisons normalize typography, never remove version words or infer aliases.
export const normalizeSongText=(text:string)=>text.normalize('NFKC').toLocaleLowerCase().replace(/[\s\p{P}\p{S}]/gu,'');
export const songKey=(song:SongQuery)=>JSON.stringify([normalizeSongText(song.title),[...new Set((song.artists??[]).map(normalizeSongText).filter(Boolean))].sort()]);
export function songSearchText(song:SongQuery):string {
  let query=song.title.trim();const seen=new Set<string>();
  for(const name of song.artists??[]){
    const artist=name.trim(),key=normalizeSongText(artist);
    if(!key||seen.has(key))continue;
    seen.add(key);
    // Keep complete names and the existing upstream query budget.
    if(query.length+artist.length+1<=512)query+=' '+artist;
  }
  return query;
}
export function preferredSong(items:PreferredSong[],song:SongQuery):PreferredSong|undefined {
  return items.find(item=>item.key===songKey(song)) ?? (song.artists?.length?items.find(item=>item.key===songKey({title:song.title})):undefined);
}
export function searchPreferredVersions(items:PreferredSong[],song:SongQuery):PreferredSong[]{
  if(song.artists?.length){const selected=preferredSong(items,song);return selected?[selected]:[];}
  return items.filter(item=>normalizeSongText(item.song.title)===normalizeSongText(song.title));
}
const legacyPartitions:Record<number,SearchPartition>={3:'other',28:'original',29:'live',30:'vocaloid',31:'cover',54:'other',59:'perform',130:'other',193:'mv',194:'other',243:'commentary',244:'tutorial',265:'ai',266:'fan',267:'radio'};
const currentPartitions:Record<number,SearchPartition>={1003:'other',2016:'original',2017:'mv',2018:'live',2019:'fan',2020:'cover',2021:'perform',2022:'vocaloid',2023:'ai',2024:'radio',2025:'tutorial',2026:'commentary',2027:'other'};
export function bilibiliSearchPartition(raw:Record<string,unknown>):SearchPartition {
  const current=Number(raw.tid_v2??raw.tidv2),legacy=Number(raw.tid??raw.typeid);
  // A current partition is authoritative, including when the legacy field disagrees.
  if(Number.isSafeInteger(current)&&current>0)return currentPartitions[current]??'nonmusic';
  if(Number.isSafeInteger(legacy)&&legacy>0)return currentPartitions[legacy]??legacyPartitions[legacy]??'nonmusic';
  return 'unknown';
}
const partitionVersion:Partial<Record<SearchPartition,keyof typeof versionTerms>>={live:'live',fan:'live',cover:'cover',perform:'perform',ai:'ai'};
const contains=(haystack:string,needle:string)=>normalizeSongText(haystack).includes(normalizeSongText(needle));
const versionTerm=(text:string,term:string)=>/^[a-z ]+$/i.test(term)
  ?new RegExp('(?:^|[^a-z0-9])'+term.replace(/ /g,'[\\s_-]*')+'(?=$|[^a-z0-9])','i').test(text.normalize('NFKC'))
  :contains(text,term);
const requestsVersion=(query:string,version:keyof typeof versionTerms)=>versionTerms[version].some(term=>versionTerm(query,term));
export function searchFilterReasons(entry:SearchEntry,config:SearchConfig,query:string,checkPartition=true):string[] {
  const reasons:string[]=[];
  if(checkPartition&&entry.ref.provider==='bilibili'){
    const partition=entry.searchPartition??bilibiliSearchPartition({tid:entry.board}),rule=config.partitions[partition];
    const requested=partitionVersion[partition]?requestsVersion(query,partitionVersion[partition]!):contains(query,partitionLabels[partition]);
    if(rule==='manual'||rule==='requested'&&!requested)reasons.push(partitionLabels[partition]);
  }
  for(const [version,terms] of Object.entries(versionTerms) as [keyof typeof versionTerms,readonly string[]][]){
    const rule=config.versions[version];
    if(rule!=='allow'&&terms.some(term=>versionTerm(entry.title,term))&&(rule==='manual'||!requestsVersion(query,version)))reasons.push(versionLabels[version]);
  }
  for(const term of config.excludeTerms)if(contains(entry.title,term))reasons.push('排除词：'+term);
  return [...new Set(reasons)];
}
export function songMatchReasons(entry:SearchEntry,config:SearchConfig,song:SongQuery,checkPartition=true):string[] {
  const reasons=searchFilterReasons(entry,config,[song.title,...song.artists??[]].join(' '),checkPartition);
  if(!config.strictMatch)return reasons;
  if(!contains(entry.title,song.title))reasons.push('歌名不符');
  const artists=song.artists?.filter(name=>normalizeSongText(name));
  if(artists?.length){
    const facts=[entry.title,...entry.artists??[]].join(' ');
    if(!artists.some(name=>contains(facts,name)))reasons.push('歌手不符');
  }else if(normalizeSongText(song.title).length<=3)reasons.push('短歌名缺少歌手信息');
  return reasons;
}
/** Desktop automatic selection only. Titles are evidence, never proof of a performance. */
export function desktopSongMatchReasons(entry:SearchEntry,config:SearchConfig,song:SongQuery,checkPartition=true):string[] {
  const baseTitle=song.title.replace(/\s*(?:[(（][^()（）]*(?:live|现场|翻唱|cover|remix|混音)[^()（）]*[)）]|(?:\s+|·)(?:live|现场|翻唱|cover|remix|混音))\s*$/iu,'').trim();
  const reasons=searchFilterReasons(entry,config,[song.title,...song.artists??[]].join(' '),checkPartition);
  if(!config.strictMatch)return reasons;
  reasons.push(...songMatchReasons(entry,config,{...song,title:baseTitle},false).filter(reason=>['歌名不符','歌手不符','短歌名缺少歌手信息'].includes(reason)));
  const title=entry.title.normalize('NFKC'),wanted=normalizeSongText(baseTitle);
  const quoted=[...title.matchAll(/《([^《》]+)》/gu)].map(match=>normalizeSongText(match[1]));
  // Do not turn a title embedded in another song name into an exact identity.
  if(quoted.length&&(!quoted.includes(wanted)||new Set(quoted).size>1))reasons.push('歌名歧义');
  if(!quoted.length&&wanted.length<=3){
    const escaped=baseTitle.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
    if(!new RegExp('(?:^|[\\s\\p{P}\\p{S}])'+escaped+'(?=$|[\\s\\p{P}\\p{S}])','iu').test(title))reasons.push('短歌名边界不符');
  }
  for(const version of Object.keys(versionTerms) as (keyof typeof versionTerms)[]){
    if(checkPartition&&requestsVersion(song.title,version)&&!requestsVersion(title,version)&&partitionVersion[entry.searchPartition??'unknown']!==version)reasons.push('缺少指定版本证据');
  }
  let annotations=title;
  for(const identity of [baseTitle,...song.artists??[]]){
    const letters=[...normalizeSongText(identity)];
    if(letters.length)annotations=annotations.replace(new RegExp(letters.map(char=>char.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')).join('[\\s\\p{P}\\p{S}]*'),'giu'),' ');
  }
  const aiSignal=/(?:^|[^a-z0-9])ai(?=$|[^a-z0-9])|人工智能/iu;
  if(config.versions.ai!=='allow'&&aiSignal.test(annotations)&&!aiSignal.test(song.title))reasons.push('AI版本');
  // Explicit derivative/partial-content claims cannot be repaired by a matching artist substring.
  for(const terms of [/风格|仿作|模仿|致敬之作|片段|预告|试听版/iu, /(?:^|[^a-z0-9])(?:style|teaser|preview|snippet)(?=$|[^a-z0-9])/iu]){
    if(terms.test(annotations))reasons.push('仿作或片段');
  }
  const artists=(song.artists??[]).map(normalizeSongText).filter(Boolean);
  const performanceTitle=requestsVersion(title,'cover')||requestsVersion(title,'ai')?title.replace(/原唱\s*[:：]?\s*[^《》()（）【】\n]+/gu,''):title;
  const facts=[performanceTitle,...entry.artists??[]].join(' ');
  if(artists.some(name=>!normalizeSongText(facts).includes(name)))reasons.push('歌手证据不全');
  // A reliable source artist field must corroborate every requested performer.
  if(entry.artists?.length&&artists.length&&artists.some(name=>!entry.artists!.some(value=>normalizeSongText(value)===name)))reasons.push('演唱者不符');
  if(song.durationSeconds!==undefined&&entry.durationSeconds!==undefined&&Math.abs(song.durationSeconds-entry.durationSeconds)>Math.max(12,song.durationSeconds*.08))reasons.push('时长不符');
  return [...new Set(reasons)];
}
export const sameVideoPart=(a:EntryRef,b:EntryRef)=>a.provider===b.provider&&a.kind===b.kind&&a.id===b.id&&a.part===b.part;
