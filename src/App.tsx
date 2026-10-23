import { preferenceStorage } from './preference-storage';
import { createContext, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { MusicClient } from '@studio/music-sources/client';
import type { EntryRef, MusicEntry, Shelf } from '@studio/music-sources';
import { PlayIcon, PauseIcon, SkipBackIcon, SkipForwardIcon, SpeakerHighIcon, QueueIcon, HeartIcon, MagnifyingGlassIcon, CompassIcon, XIcon, PlusIcon, TrashIcon, YoutubeLogoIcon, TelevisionSimpleIcon, DotsThreeIcon, ListBulletsIcon, GearIcon, ShuffleIcon, RepeatIcon, RepeatOnceIcon, ArrowUpIcon, ArrowDownIcon, LinkIcon, StopIcon, ArrowClockwiseIcon, ArrowLeftIcon, RewindIcon, FastForwardIcon, SpeakerSlashIcon, MoonIcon, ArrowCounterClockwiseIcon, MusicNotesIcon, UsersIcon } from '@phosphor-icons/react';
import { request, availabilityText, type Track, type BilibiliAccountState, type ServerStatus, key, time, creator, errorText, cancelled } from './api';
import type { SongLibraryState as LibraryData, Song, ChartSongContext } from '../server/song-library-types';
import { desktopCatalogLibrary } from '../server/song-catalog-display';
import { useDesktopSongCatalog } from './use-desktop-song-catalog';
import { SongLibraryWorkspace, SongCover } from './SongLibraryPage';
import { PlaylistCover } from './PlaylistCover';
import { DesktopOperationFeedback, PlaybackFeedback } from './DesktopFeedback';
import { SongVersionDialog } from './SongVersionDialog';
import { catalogSongKey, songSourceKey } from '../server/song-library-policy';
import { usePlayback } from './playback';
import { DesktopPlaybackProgress } from './DesktopPlaybackProgress';
import { audioQualityLabel } from './audio-quality';
import { readYoutubeRegion, youtubeMusicPath } from './youtube-candidates';
import { PartsPanel, type PartBatchAction } from './PartsPanel';
import { SleepPanel } from './SleepPanel';
import { DiscoveryShelf } from './DiscoveryShelf';
import { SettingsPage } from './SettingsPage';
import { YoutubeDiscovery } from './YoutubeDiscovery';
import { ThemeToggle } from './ThemeControls';
import { artworkUrl } from '../server/artwork-url';
import { FollowsPage, FollowTrackButton, updateTime } from './FollowsPage';
import type { FollowState, CreatorRef, CreatorProfile } from './api';
import type { SongDuplicatePolicy as DuplicatePolicy } from '../server/song-library-types';
import { ControlPopover } from './ControlPopover';
import { RateControl } from './RateControl';
import { PlaybackQueue } from './PlaybackQueue';
import { CommentsPanel } from './CommentsPanel';
import { ChatCircleTextIcon } from '@phosphor-icons/react';
import { SpinnerGapIcon } from '@phosphor-icons/react';
import { ChartsPage } from './ChartsPage';
import { FollowUpdatesShelf } from './FollowUpdatesShelf';
import { isTrack, readSavedPlayback, type QueueTrack } from './chart-playback';
import { discoverySize } from './CatalogView';
import type { RecommendedShelf } from '../server/recommendation';
import { PlayAllButton, RefreshButton } from './ListActions';
import { PartMetadataStore, readPartPreferences, partPreferenceKey, type EntryContext, type MusicActionIntent, type PartPlaybackMode } from './multipart';
import { PartBadge } from './PartBadge';
import { Modal } from './Modal';
import type { ListImportRequest } from './SongListImportPanel';
import { SongListImportPanel } from './SongListImportPanel';
import { AddToPlaylistButton } from './ListActions';
import { SongBackupPanel } from './SongBackupPanel';
import { refreshSourceCapabilities, type SourceSettingsState } from './source-settings';
import { ArrowRightIcon, HeadphonesIcon } from '@phosphor-icons/react';
import { PlayingTitle } from './PlayingTitle';
import { EntryGate } from './EntryGate';
import { bilibiliDiscoveryPath, type StartupPreload } from './startup';
import { brand } from '../server/brand';
import { usePlayerStyle } from './usePlayerStyle';
import { PlayingArtwork } from './PlayingArtwork';
import { BottomLyrics, LyricsView, type LyricPlayback } from './LyricsView';
import { LyricsSettings } from './LyricsSettings';
import { useLyrics } from './useLyrics';
import { PreferSongAction } from './SearchPreferences';
import { DesktopLyricsView, LyricsToggle } from './DesktopLyricsView';
import { DesktopLyricFont } from './DesktopLyricFont';
import { PlaybackSource } from './PlaybackSource';
import type { PlaybackManagementTab } from './PlaybackManagement';
import type { ComponentProps } from 'react';
import { DesktopRegion, desktopFeature } from './DesktopRegion';
import { PlaybackManagement as managementUrl } from 'virtual:desktop-feature-urls';
import { PagedList } from './Pagination';
import { useDesktopHost } from './desktop-host';
import { useDesktopWindowMode } from './desktop-chrome';
import { preferredSong, searchPreferredVersions, searchFilterReasons, songSearchText, type SearchConfig, type SearchSettings, type SearchPage, type PreferredSong, type SongQuery } from '../server/search-policy';

const PlaybackManagement = desktopFeature<ComponentProps<typeof import('./PlaybackManagement').PlaybackManagement>>(managementUrl, 'PlaybackManagement', '版本与歌词', false);
const names={all:'全部',bilibili:'B站',youtube:'YouTube 视频'};
const nav=[{id:'discover',label:'发现',icon:CompassIcon},{id:'charts',label:'音乐榜单',icon:MusicNotesIcon},{id:'follows',label:'关注',icon:UsersIcon},{id:'library',label:'歌单',icon:ListBulletsIcon}];
const favoritesId='system:favorites';
const ArtworkContext=createContext<Record<string,string>>({});
const YoutubeEnabledContext=createContext(true);
const artworkKey=(t:Track)=>`${t.ref.provider}:${t.ref.id}`;
const displayTitle=(t:QueueTrack)=>{const divider=t.title.lastIndexOf(' / ');return isTrack(t)&&!t.songId&&t.ref.provider==='bilibili'&&t.ref.part&&divider>=0?t.title.slice(divider+3):t.title;};
function Badge({provider}:{provider:string}) {const Icon=provider==='bilibili'?TelevisionSimpleIcon:YoutubeLogoIcon;return <span className={'source-badge '+provider}>
<Icon size={18}/>{provider==='bilibili'?'B站':'YouTube 视频'}</span>;}
function Cover({track,className=''}:{track?:QueueTrack|null;className?:string}) {const cache=useContext(ArtworkContext),youtubeEnabled=useContext(YoutubeEnabledContext),artwork=track&&(youtubeEnabled||!isTrack(track)||track.ref.provider!=='youtube')?artworkUrl(track.artwork??(isTrack(track)?cache[artworkKey(track)]:undefined)):undefined;const [failed,setFailed]=useState('');return artwork&&failed!==artwork?<img className={className} src={artwork} alt="" loading="lazy" referrerPolicy="no-referrer" onError={()=>setFailed(artwork)}/>:<span className={'unknown-cover '+className} aria-label="封面未知">
<MusicNotesIcon size={28}/>
</span>;}
export function App() {
  return <EntryGate>{(client,preload,onLogout)=><Workspace client={client} preload={preload} onLogout={onLogout}/>}</EntryGate>;
}
type Result={items:Track[];cursor?:string;error?:unknown;busy?:boolean;config?:SearchConfig;preferred?:PreferredSong;preferredVersions?:PreferredSong[];classificationIssue?:SearchPage['classificationIssue']};
type Popup={type:'new'|'rename'|'delete'|'backup'|'maintenance'|'link'|'parts'|'track'|'sleep';track?:Track;id?:string;parts?:MusicEntry[];origin?:{tracks:Track[];index:number};entryContext?:EntryContext;intent?:MusicActionIntent;targetId?:string;anchorId?:string;session?:number;step?:number;searchSong?:SongQuery};
function Workspace({client,preload,onLogout}:{client:MusicClient;preload:StartupPreload;onLogout:()=>void}) {
  const [playerStyle,selectPlayerStyle]=usePlayerStyle();
  const [statusCheckedAt,setStatusCheckedAt]=useState<number>();
  const [desktop,setDesktop]=useState(()=>window.matchMedia('(min-width:761px)').matches);
  const [page,setPage]=useState('discover'),[source,setSource]=useState<keyof typeof names>('all'),[query,setQuery]=useState(''),[searched,setSearched]=useState(''),[results,setResults]=useState<Record<string,Result>>({}),[shelves,setShelves]=useState<Shelf[]>([]),[discoverBusy,setDiscoverBusy]=useState(false),[discoverError,setDiscoverError]=useState<unknown>(),[rawLibrary,setLib]=useState<LibraryData|null>(null),[status,setStatus]=useState<ServerStatus>(),[selected,setSelected]=useState<string>(favoritesId),[popup,setPopup]=useState<Popup|null>(null),[notice,setNotice]=useState(''),[error,setError]=useState(''),[saving,setSaving]=useState(false),[pending,setPending]=useState<any>(),[field,setField]=useState(''),[linkRef,setLinkRef]=useState<EntryRef>(),[online,setOnline]=useState(navigator.onLine);
  const [canonical,setCanonical]=useState<Record<string,EntryRef>>({});
  const lib=useMemo(()=>rawLibrary&&desktop?desktopCatalogLibrary(rawLibrary):rawLibrary,[rawLibrary,desktop]);
  const [partsStore]=useState(()=>new PartMetadataStore(client));
  useSyncExternalStore(partsStore.subscribe,partsStore.getVersion);
  const [partPreferences,setPartPreferences]=useState(()=>readPartPreferences(preferenceStorage()));
  const preferenceRef=useRef(partPreferences);preferenceRef.current=partPreferences;
  const [actionBusy,setActionBusy]=useState(false),[metadataBusy,setMetadataBusy]=useState(false),[metadataRetry,setMetadataRetry]=useState(0),[linkBusy,setLinkBusy]=useState(false);
  const actionWork=useRef<AbortController|null>(null),modalSession=useRef(0);
  const [favoriteTarget,setFavoriteTarget]=useState<string>();
  const favoriteWork=useRef<{key:string;controller:AbortController}|undefined>(undefined);
  const [chartFavoriteAction,setChartFavoriteAction]=useState<{key:string;body:unknown}>();
  const [noticeAction,setNoticeAction]=useState<{label:string;run:()=>void}>();
  const [sources,setSources]=useState<SourceSettingsState>();
  const sourceStateRef=useRef<SourceSettingsState|undefined>(undefined);
  const capabilityReady=useRef(false);
  const youtubeEnabled=sources?.youtube.enabled??status?.providers.youtube.enabled??status?.providers.youtube.available??false;
  const youtubeAvailable=sources?.youtube.available??status?.providers.youtube.available??false;
  const youtubeDisplay=sources?.youtube.disabledDisplay??'dim';
  const sourceBlocked=(track:QueueTrack)=>!youtubeEnabled&&isTrack(track)&&track.ref.provider==='youtube';
  const sourceVisible=(track:QueueTrack)=>youtubeDisplay!=='hide'||!sourceBlocked(track);
  const sourcesChanged=(value:SourceSettingsState)=>{
    if(!value||typeof value.revision!=='string'||typeof value.youtube?.enabled!=='boolean'||typeof value.youtube.available!=='boolean')return;
    if((value.sequence??0)<(sourceStateRef.current?.sequence??0))return;
    sourceStateRef.current=value;
    const show=(state:SourceSettingsState)=>{setSources(state);setStatus(old=>old?{...old,providers:{...old.providers,youtube:state.youtube}}:old);};
    const apply=()=>{if(sourceStateRef.current===value)show(value);};
    if(value.youtube.available&&!capabilityReady.current){
      show({...value,youtube:{...value.youtube,available:false,checking:true}});
      void refreshSourceCapabilities(client).then(()=>{if(!sourceStateRef.current?.youtube.available)return;capabilityReady.current=true;apply();}).catch(()=>{if(sourceStateRef.current===value)show({...value,youtube:{...value.youtube,available:false,checking:false,issue:'无法更新来源能力，请重新检查服务。'}});});
    }else{if(!value.youtube.available)capabilityReady.current=false;apply();}
  };
  const playback=usePlayback(client,youtubeAvailable,partsStore,youtubeEnabled),{snapshot}=playback;
  useEffect(()=>{if(desktop)playback.sourceChanged();},[desktop,sources?.revision,sources?.sequence,youtubeAvailable]);
  useEffect(()=>{if(lib)playback.updateSongs(lib.snapshot.songs,lib.snapshot.versions,lib.snapshot.catalogLinks,lib.snapshot.redirects);},[lib?.revision,desktop]);
  const [restoredQueue]=useState(()=>readSavedPlayback(preferenceStorage()).tracks.length>0),restorationNotified=useRef(false);
  const [queueOpen,setQueueOpen]=useState(false),[listFilter,setListFilter]=useState(''),[previousPage,setPreviousPage]=useState('discover');
  const [listeningReturnPage,setListeningReturnPage]=useState('discover');
  const [desktopSettingsRequest,setDesktopSettingsRequest]=useState(0);
  const [listeningPanel,setListeningPanel]=useState<'queue'|'comments'>('queue');
  const [playAction,setPlayAction]=useState<{controller:AbortController;track:Track;origin?:{tracks:Track[];index:number};entryContext:EntryContext;loading:boolean;error?:string}>();
  const preparationRetry=useRef<(() => Promise<unknown>)|undefined>(undefined),playRequestSerial=useRef(0),playMetadataWork=useRef<AbortController|undefined>(undefined);
  const startPlayback=async(task:()=>Promise<unknown>,remember=true,continuing?:AbortController)=>{
    if(!desktop)return task();
    if(playMetadataWork.current!==continuing)playMetadataWork.current?.abort();
    playMetadataWork.current=undefined;
    const sequence=++playRequestSerial.current;preparationRetry.current=undefined;setPlayAction(undefined);
    const result=await task();
    if(playRequestSerial.current===sequence)preparationRetry.current=result===false&&remember?task:undefined;
    return result;
  };
  const cancelPlayback=()=>{++playRequestSerial.current;preparationRetry.current=undefined;if(desktop&&playAction?.loading){playAction.controller.abort();setActionBusy(false);}setPlayAction(undefined);playback.cancel();};
  const preparingPlayback=playback.preparing||snapshot.loading||!!(desktop&&playAction?.loading);
  const [desktopLyrics,setDesktopLyrics]=useState(false);
  const [management,setManagement]=useState<PlaybackManagementTab>();
  const managementSection=useRef<'select'|'offset'|undefined>(undefined);
  const managementVisible=desktop&&page==='playing'&&!!management;
  const desktopLyricsOpen=desktop&&page==='playing'&&desktopLyrics;
  useDesktopWindowMode(desktopLyricsOpen?'immersive':'standard');
  const lyricToggleOrigin=useRef<HTMLElement|null>(null);
  const closeDesktopLyrics=()=>{setDesktopLyrics(false);requestAnimationFrame(()=>{const origin=lyricToggleOrigin.current;if(origin?.isConnected&&origin.getClientRects().length)origin.focus({preventScroll:true});});};
  const toggleDesktopLyrics=()=>{if(desktopLyricsOpen)closeDesktopLyrics();else{lyricToggleOrigin.current=document.activeElement as HTMLElement;setDesktopLyrics(true);}};
  useEffect(()=>{const media=window.matchMedia('(min-width:761px)'),changed=()=>setDesktop(media.matches);media.addEventListener('change',changed);return()=>media.removeEventListener('change',changed);},[]);
  useEffect(()=>{if(!desktop||page!=='playing')setDesktopLyrics(false);},[desktop,page]);
  useEffect(()=>{
    if(!desktopLyricsOpen)return;
    const escape=(event:KeyboardEvent)=>{if(event.key==='Escape'&&!event.defaultPrevented&&!document.querySelector(':popover-open,dialog[open]')){event.preventDefault();closeDesktopLyrics();}};
    window.addEventListener('keydown',escape);return()=>window.removeEventListener('keydown',escape);
  },[desktopLyricsOpen]);
  const [listImport,setListImport]=useState<ListImportRequest>();
  const [groupTrack,setGroupTrack]=useState<Track>();
  const importTracks=(items:Track[],title='当前列表',context:'video'|'part'='video',excluded=0)=>{if(!requireLibrary())return;const allowed=items.filter(t=>!sourceBlocked(t));if(!allowed.length)return;setListImport({title,source:{kind:'entries',items:allowed.map(track=>({ref:track.ref,context}))},labels:allowed.map(track=>track.title),excluded:excluded+items.length-allowed.length});};
  const [compactQueue,setCompactQueue]=useState(()=>window.matchMedia('(max-width:1050px)').matches);
  useEffect(()=>{const media=window.matchMedia('(max-width:1050px)'),update=()=>setCompactQueue(media.matches);media.addEventListener('change',update);return()=>media.removeEventListener('change',update);},[]);
  const queueVisible=queueOpen;
  const closeQueue=()=>setQueueOpen(false);
  const [artworks,setArtworks]=useState<Record<string,string>>({});
  const [scrub,setScrub]=useState<number|null>(null),scrubValue=useRef<number|null>(null);
  const [bilibiliAccount,setBilibiliAccount]=useState<BilibiliAccountState>();
  useEffect(()=>{if(desktop)playback.sourceChanged();},[desktop,bilibiliAccount?.state,bilibiliAccount?.account?.id]);
  const [followState,setFollowState]=useState<FollowState|null>(null),[trackAuthors,setTrackAuthors]=useState<Record<string,CreatorRef>>({});
  const [activeCreator,setActiveCreator]=useState<CreatorProfile>(),[authorBusy,setAuthorBusy]=useState(false),authorWork=useRef<AbortController|null>(null),[authorTarget,setAuthorTarget]=useState('');
  const [discoveryMessage,setDiscoveryMessage]=useState(''),[discoveryUpdatedAt,setDiscoveryUpdatedAt]=useState<number>();
  const [youtubeRefresh,setYoutubeRefresh]=useState(0);
  const [searchOpen,setSearchOpen]=useState(false),[searchSource,setSearchSource]=useState<keyof typeof names>('all');
  const [searchSong,setSearchSong]=useState<SongQuery>(),[showAllSearch,setShowAllSearch]=useState<boolean>();
  const searchTarget=useRef<{context?:ChartSongContext;songId?:string}>({});
  const searchReturn=useRef<(() => void) | undefined>(undefined);
  const searchSettingsEpoch=useRef(0),latestSearchSettings=useRef<SearchSettings|undefined>(undefined);
  const searchPreferencesChanged=(state:SearchSettings)=>{searchSettingsEpoch.current++;latestSearchSettings.current=state;setResults(old=>Object.fromEntries(Object.entries(old).map(([provider,result])=>[provider,{...result,config:state.config,preferred:preferredSong(state.preferred,searchSong??{title:searched}),preferredVersions:searchPreferredVersions(state.preferred,searchSong??{title:searched})}])));};
  const previousRecommendations=useRef(new Set<string>());
  const checkedArtwork=useRef(new Set<string>());
  const discovery=useRef<AbortController|null>(null),search=useRef<AbortController|null>(null),youtubeSearch=useRef<AbortController|null>(null),linkWork=useRef<AbortController|null>(null),writeWork=useRef<AbortController|null>(null),serial=useRef(0),noticeTimer=useRef<ReturnType<typeof setTimeout>|undefined>(undefined);
  const libraryReadSerial=useRef(0);
  const libraryState=useRef<LibraryData|null>(null),libraryReading=useRef(false);
  const [libraryError,setLibraryError]=useState('');
  const flash=(t:string,action?:{label:string;run:()=>void})=>{setNotice(t);setNoticeAction(action);clearTimeout(noticeTimer.current);noticeTimer.current=setTimeout(()=>{setNotice('');setNoticeAction(undefined);},action?7000:3500);};
  const requireLibrary=()=>{if(lib)return true;flash(libraryError?'歌单与收藏暂不可用，请在歌单页重试。':'正在读取歌单与收藏，请稍后重试。');return false;};
  useEffect(()=>{
    if(snapshot.state!=='idle'){restorationNotified.current=true;return;}
    if(desktop||page!=='playing'||!restoredQueue||restorationNotified.current||!snapshot.items.length)return;
    restorationNotified.current=true;flash('已恢复队列，点击播放从头听。');
  },[desktop,page,restoredQueue,snapshot.state,snapshot.items.length]);
  const cancelDiscovery=()=>{discovery.current?.abort();setDiscoverBusy(false);};
  const navigate=(next:string)=>{if(next==='search'){openSearch();return;}actionWork.current?.abort();setActionBusy(false);authorWork.current?.abort();setAuthorBusy(false);if(next==='follows')setActiveCreator(undefined);if(next!=='discover'&&next!=='settings')cancelDiscovery();setPage(next);setListFilter('');window.scrollTo(0,0);};
  const openCreator=async(track:Track)=>{authorWork.current?.abort();const controller=new AbortController();authorWork.current=controller;setAuthorBusy(true);setAuthorTarget(artworkKey(track));setError('');
    try{const profile=await request<CreatorProfile>('/api/creators/resolve',{ref:track.ref},controller.signal);if(controller.signal.aborted)return;setTrackAuthors(old=>({...old,[artworkKey(track)]:{provider:profile.provider,id:profile.id}}));setPopup(null);closeSearch();navigate('follows');setSource(previous=>previous==='all'||previous===profile.provider?previous:profile.provider);setActiveCreator(profile);}
    catch(e){if(!cancelled(e)&&!controller.signal.aborted)setError(errorText(e));}
    finally{if(authorWork.current===controller)setAuthorBusy(false);}
  };
  const creatorContent=(track:Track,className='')=><span className={'creator-details '+className}>{track.artists?.length?<span className="creator-artists">{track.artists.join(' / ')}</span>:null}<button className="creator-link" title={'查看 '+(track.uploader?.name??'UP / 博主')+' 的合集和投稿'} aria-label={'查看 UP / 博主 · '+track.title} aria-busy={desktop&&authorBusy&&authorTarget===artworkKey(track)||undefined} disabled={authorBusy||sourceBlocked(track)} onClick={()=>void openCreator(track)}>{desktop&&authorBusy&&authorTarget===artworkKey(track)?'正在读取作者…':track.uploader?.name??'查看 UP / 博主'}</button>{desktop&&authorBusy&&authorTarget===artworkKey(track)&&<button className="btn btn-ghost btn-sm" onClick={()=>{authorWork.current?.abort();setAuthorBusy(false);}}>取消</button>}</span>;
  const openSettings=()=>{if(page==='settings'){void reload();return;}setPreviousPage(page);navigate('settings');};
  const openDesktopSettings=useRef(()=>{});
  openDesktopSettings.current=()=>{setDesktopSettingsRequest(value=>value+1);setDesktopLyrics(false);setPopup(null);setSearchOpen(false);openSettings();};
  useEffect(()=>window.slowTuneDesktop?.onOpenLyricsSettings(()=>openDesktopSettings.current()),[]);
  const logout=async()=>{
    // Release sources while the session is valid; keep the engine usable if the
    // network request fails. Successful logout disposes it when Workspace unmounts.
    if(await playback.stop()===false)throw new Error('stop-failed');
    await request('/api/logout',{});onLogout();
  };
  // 设置页会卸载发现栏目；保存规则后准备新批次，返回时读取该批次。
  const refreshYoutubeCandidates=async()=>{if(!status?.providers.youtube.available)return;try{await request(youtubeMusicPath(readYoutubeRegion(),{refresh:true}));}catch{/* 候选池补取失败时，随后的预览／保存会把原因报给用户。 */}};
  const toggleListeningPanel=(panel:'queue'|'comments')=>{if(management)closeManagement();const switching=listeningPanel!==panel;setListeningPanel(panel);setQueueOpen(value=>switching||!value);};
  const toggleQueue=()=>{if(page==='playing'){toggleListeningPanel('queue');return;}setQueueOpen(value=>!value);};
  const open=(p:Popup|{type:'queue'}|{type:'playing'})=>{if(p.type==='queue'){toggleQueue();return;}if(p.type==='playing'){if(page!=='playing')setListeningReturnPage(page);setListeningPanel('queue');setPage('playing');window.scrollTo(0,0);return;}actionWork.current?.abort();setActionBusy(false);setError('');setField(p.type==='rename'?lib?.snapshot.playlists.find(x=>x.id===p.id)?.name??'':'');const cached=p.track?partsStore.peek(p.track.ref.id):undefined;setPopup({...p,session:++modalSession.current,...(p.track?{parts:p.parts??cached?.parts,entryContext:p.entryContext??(p.track.songId?'part':'video')}:{})});};
  useEffect(()=>()=>partsStore.dispose(),[partsStore]);
  useEffect(()=>{
    if(!popup?.track||!['track','parts'].includes(popup.type)||sourceBlocked(popup.track)){setMetadataBusy(false);return;}
    const controller=new AbortController(),session=popup.session;setMetadataBusy(true);
    void partsStore.read(popup.track.ref,controller.signal).then(entry=>{
      if(controller.signal.aborted)return;
      setCanonical(old=>({...old,[key(popup.track!.ref)]:entry.ref}));
      setPopup(old=>old&&old.session===session?{...old,track:{...old.track!,...entry},parts:entry.parts??[entry]}:old);
    }).catch(issue=>{if(!cancelled(issue)&&!controller.signal.aborted)setError(errorText(issue));}).finally(()=>{if(!controller.signal.aborted)setMetadataBusy(false);});
    return()=>controller.abort();
  },[popup?.session,popup?.track?.ref.provider,popup?.track?.ref.id,popup?.track?.ref.part,partsStore,metadataRetry,youtubeEnabled]);
  const updateLibrary=(data:LibraryData)=>{++libraryReadSerial.current;libraryState.current=data;setLib(old=>old?.revision===data.revision?old:data);setLibraryError('');};
  const readLibrary=async(signal?:AbortSignal,checkRevision=false)=>{
    if(writeWork.current||libraryReading.current)return;
    libraryReading.current=true;
    const sequence=++libraryReadSerial.current,readSignal=AbortSignal.any([AbortSignal.timeout(10000),...(signal?[signal]:[])]);
    const current=()=>!readSignal.aborted&&!writeWork.current&&sequence===libraryReadSerial.current;
    try{
      if(checkRevision&&libraryState.current){
        const state=await request<{revision:string|null}>('/api/song-library/events',undefined,readSignal);
        if(!current())return;
        if(state.revision===libraryState.current.revision){setLibraryError('');return;}
      }
      const data=await preload.take<LibraryData>('/api/song-library',readSignal);
      if(current())updateLibrary(data);
    }catch(issue){if(!signal?.aborted&&sequence===libraryReadSerial.current&&!cancelled(issue))setLibraryError(errorText(issue));}
    finally{libraryReading.current=false;}
  };
  const refreshDiagnostics=async()=>{const value=await preload.take<ServerStatus>('/api/status');setStatus(value);setStatusCheckedAt(Date.now());if(value.sourceSettings)sourcesChanged(value.sourceSettings);};
  const reload=async()=>{try{await Promise.all([readLibrary(),refreshDiagnostics()]);}catch(e){setError(errorText(e));}};
  useDesktopSongCatalog(desktop&&!!rawLibrary,()=>readLibrary(undefined,true),!!rawLibrary&&(rawLibrary.snapshot.songs.length>=1000||rawLibrary.snapshot.versions.length>=4000)&&(snapshot.playing||preparingPlayback));
  useEffect(()=>{
    const controller=new AbortController();
    const refresh=()=>{if(document.visibilityState==='visible')void readLibrary(controller.signal,true);};
    const timer=setInterval(()=>void refresh(),5000);const visible=()=>{if(document.visibilityState==='visible')void refresh();};
    document.addEventListener('visibilitychange',visible);
    return()=>{controller.abort();clearInterval(timer);document.removeEventListener('visibilitychange',visible);};
  },[client]);
  useEffect(()=>{
    const events=new EventSource('/api/settings/sources/events');
    const read=()=>{void request<SourceSettingsState>('/api/settings/sources').then(sourcesChanged).catch(()=>{});};
    events.addEventListener('sources',event=>{try{sourcesChanged(JSON.parse((event as MessageEvent).data));}catch{}});
    events.addEventListener('open',read);
    const visible=()=>{if(document.visibilityState==='visible')read();};
    document.addEventListener('visibilitychange',visible);
    return()=>{events.close();document.removeEventListener('visibilitychange',visible);};
  },[client]);
  useEffect(()=>{
    if(youtubeEnabled)return;
    setSource('all');setSearchSource('all');
    youtubeSearch.current?.abort();
    setResults(old=>Object.fromEntries(Object.entries(old).filter(([provider])=>provider!=='youtube')));
    if(linkRef?.provider==='youtube'){search.current?.abort();setLinkRef(undefined);}
    if(activeCreator?.provider==='youtube')setActiveCreator(undefined);
    if(popup?.track?.ref.provider==='youtube'){actionWork.current?.abort();authorWork.current?.abort();setActionBusy(false);setAuthorBusy(false);}
  },[youtubeEnabled]);
  const checkAccount=async(signal?:AbortSignal)=>{try{const data=await preload.take<BilibiliAccountState>('/api/bilibili/account',signal);if(!signal?.aborted)setBilibiliAccount(data);}catch(e){if(!cancelled(e))setBilibiliAccount({state:'unavailable',issue:errorText(e)});}};
  const discover=async(refresh=false)=>{
    discovery.current?.abort();const c=new AbortController();discovery.current=c;setDiscoverBusy(refresh||!shelves.length);setDiscoverError(undefined);
    try{
      const data=await preload.take<RecommendedShelf[]>(bilibiliDiscoveryPath(refresh,desktop),c.signal);
      if(!c.signal.aborted){
        setShelves(old=>data.filter(s=>s.kind==='recommendation').map(next=>next.error&&old.find(s=>s.id===next.id)?.page?old.find(s=>s.id===next.id)!:next));
        if(data.some(s=>s.error))setDiscoverError(data.find(s=>s.error)!.error);
        const recommended=data.find(s=>s.kind==='recommendation');
        if(recommended?.page&&!recommended.error){
          const items=recommended.page.items.slice(0,discoverySize),newCount=items.filter(t=>!previousRecommendations.current.has(t.ref.id)).length;
          setDiscoveryMessage(items.length?refresh&&previousRecommendations.current.size?newCount?`本次找到 ${newCount} 首新音乐`:'B站本次返回相同的音乐，可再换一批':'当前批次 '+items.length+' 首音乐':'本次没有找到音乐，可再换一批');
          previousRecommendations.current=new Set(items.map(t=>t.ref.id));setDiscoveryUpdatedAt(recommended.recommendation?.fetchedAt??Date.now());
          if(recommended.recommendation?.issue)setDiscoverError({code:recommended.recommendation.issue,retained:recommended.recommendation.retained});
        }
        if(refresh)void checkAccount(c.signal);
      }
    }catch(e){if(!cancelled(e)&&!c.signal.aborted){setDiscoverError((e as {code?:string}).code==='authentication'?{code:'bilibili-authentication'}:e);if((e as {code?:string}).code==='authentication'){setShelves([]);void checkAccount(c.signal);}}}
    finally{if(discovery.current===c)setDiscoverBusy(false);}
  };
  const accountChanged=(value:BilibiliAccountState)=>{setBilibiliAccount(value);setShelves([]);previousRecommendations.current.clear();setDiscoveryMessage('');setDiscoveryUpdatedAt(undefined);void discover();};
  const recommendationChanged=(column:string)=>{if(column==='youtube-music-selection'){void refreshYoutubeCandidates();setYoutubeRefresh(value=>value+1);return;}discovery.current?.abort();setShelves(old=>old.map(s=>s.id===column?{...s,page:undefined,error:undefined}:s));void discover(true);};
  useEffect(()=>{const c=new AbortController();void checkAccount(c.signal);return()=>c.abort();},[client]);
  useEffect(()=>{setListImport(undefined);},[bilibiliAccount?.state,bilibiliAccount?.account?.id]);
  useEffect(()=>{const c=new AbortController();void preload.take<FollowState>('/api/follows',c.signal).then(value=>{if(!c.signal.aborted)setFollowState(value);}).catch(()=>{});return()=>c.abort();},[client]);
  useEffect(()=>{void reload();void discover();const network=()=>setOnline(navigator.onLine);window.addEventListener('online',network);window.addEventListener('offline',network);return()=>{discovery.current?.abort();search.current?.abort();linkWork.current?.abort();writeWork.current?.abort();authorWork.current?.abort();actionWork.current?.abort();clearTimeout(noticeTimer.current);window.removeEventListener('online',network);window.removeEventListener('offline',network);};},[client]);
  const discoveryPreparing=shelves.some(s=>(s as RecommendedShelf).recommendation?.updating);
  useEffect(()=>{if(!discoveryPreparing||discoverBusy||page!=='discover')return;const timer=setTimeout(()=>void discover(),3000);return()=>clearTimeout(timer);},[discoveryPreparing,discoverBusy,shelves,page]);
  useEffect(()=>{if(lib&&selected!==favoritesId&&!lib.snapshot.playlists.some(p=>p.id===selected))setSelected(favoritesId);},[lib,selected]);
  useEffect(()=>{
    const handler=(e:KeyboardEvent)=>{
      const target=e.target as HTMLElement;
      if(e.defaultPrevented||e.altKey||e.ctrlKey||e.metaKey||popup||searchOpen||(compactQueue&&queueVisible)||document.querySelector(':popover-open,dialog[open]')||['INPUT','TEXTAREA','SELECT'].includes(target.tagName)||target.isContentEditable)return;
      if(e.code==='Space'){if(target.closest('button,a,summary'))return;e.preventDefault();if(desktop&&preparingPlayback)cancelPlayback();else if(snapshot.items.length)void startPlayback(()=>playback.toggle(),false);return;}
      if(page!=='playing'||!current||!snapshot.duration||snapshot.state==='idle'||snapshot.state==='stopped')return;
      if(e.key==='ArrowLeft'){e.preventDefault();void playback.skip(-5);return;}
      if(e.key==='ArrowRight'){e.preventDefault();void playback.skip(5);return;}
      if(e.code==='KeyJ'){void playback.skip(-10);return;}
      if(e.code==='KeyL')void playback.skip(10);
    };
    window.addEventListener('keydown',handler);return()=>window.removeEventListener('keydown',handler);
  },[popup,searchOpen,playback,page,compactQueue,queueVisible]);
  async function mutate(body:any,close=true,localFeedback=false) {
    if(saving||writeWork.current||!requireLibrary()||!lib)return;const revision=lib.revision;++libraryReadSerial.current;setSaving(true);if(!localFeedback){setError('');setPending(body);}const c=new AbortController();writeWork.current=c;
    try{const path=body.save?'/sources':body.context?'/chart-favorites':'/edits';const data=await request<LibraryData&{summary?:{changed:number;unchanged:number};playlistId?:string}>('/api/song-library'+path,{revision,...body},c.signal);updateLibrary(data);if(!localFeedback)setPending(undefined);if(data.playlistId)setSelected(data.playlistId);if(!localFeedback)flash(data.summary?`已处理 ${data.summary.changed} 项，${data.summary.unchanged} 项无需更改`:'资料已保存');if(close)setPopup(null);return data;}catch(e){if(!localFeedback)setError(errorText(e));if((e as {code?:string}).code==='conflict'){try{updateLibrary(await request<LibraryData>('/api/song-library',undefined,c.signal));}catch{}}if(localFeedback)throw e;}finally{setSaving(false);writeWork.current=null;}
  }
  async function showParts(t:Track){
    actionWork.current?.abort();setActionBusy(false);setError('');const cached=partsStore.peek(t.ref.id);
    setPopup(old=>old?.track?.ref.provider===t.ref.provider&&old.track.ref.id===t.ref.id
      ?{...old,track:t,parts:old.parts??cached?.parts,intent:'parts',entryContext:'part',step:(old.step??0)+1}
      :{type:'track',track:t,parts:cached?.parts,intent:'parts',entryContext:'part',session:++modalSession.current});
  }
  const rememberPartMode=(id:string,value:PartPlaybackMode)=>{
    const next={...preferenceRef.current};delete next[id];next[id]=value;
    const bounded=Object.fromEntries(Object.entries(next).slice(-500));preferenceRef.current=bounded;setPartPreferences(bounded);
    try{preferenceStorage().setItem(partPreferenceKey,JSON.stringify(bounded));}catch{flash('播放偏好已在本次会话记住');}
  };
  async function choosePartMode(mode:PartPlaybackMode){
    if(!popup?.track||!popup.anchorId||playback.currentTrackId()!==popup.anchorId)return false;
    if(mode==='all'&&!playback.expandParts(popup.anchorId,popup.parts??[]))return false;
    rememberPartMode(popup.track.ref.id,mode);setPopup(null);flash(mode==='all'?'已加入整组，按分 P 顺序播放':'已记住：这个视频播放本 P');return true;
  }
  async function trackAction(t:Track,action:'play'|'add',origin?:{tracks:Track[];index:number},entryContext:EntryContext='video'){
    if(action==='play')playback.cancelPending();
    actionWork.current?.abort();const controller=new AbortController();actionWork.current=controller;setActionBusy(true);setError('');
    const deadline=desktop&&action==='play'?Date.now()+60000:undefined,timer=deadline?setTimeout(()=>controller.abort(new DOMException('Playback operation timed out','TimeoutError')),60000):undefined;
    if(desktop&&action==='play'){playMetadataWork.current=controller;++playRequestSerial.current;preparationRetry.current=undefined;playback.dismiss();setPlayAction({controller,track:t,origin,entryContext,loading:true});}
    try{
      const entry=await partsStore.read(t.ref,controller.signal);controller.signal.throwIfAborted();
      const resolved={...t,...entry},parts=entry.parts??[entry],multiple=t.ref.provider==='bilibili'&&parts.length>1;
      setCanonical(old=>({...old,[key(t.ref)]:entry.ref}));
      if(action==='add'&&entryContext==='video'&&multiple){
        if(popup?.track?.ref.id===t.ref.id)setPopup(old=>old?{...old,track:resolved,parts,intent:'enqueue',step:(old.step??0)+1}:old);
        else open({type:'track',track:resolved,parts,origin,entryContext,intent:'enqueue'});
        return true;
      }
      const ok=await(action==='play'?startPlayback(()=>playback.play(resolved,origin,true,deadline),true,controller):playback.add(resolved,true));
      if(controller.signal.aborted||!ok)return false;
      if(action==='add'){flash('已加入队尾');return true;}
      const anchorId=playback.currentTrackId();
      if(entryContext==='video'&&multiple&&anchorId){
        const preference=preferenceRef.current[t.ref.id];
        if(preference==='all'&&playback.expandParts(anchorId,parts)){if(!desktop)flash('按分 P 顺序播放');return true;}
        if(preference!=='single'){
          const next={track:resolved,parts,origin,entryContext,intent:'play-choice' as const,anchorId};
          if(popup?.track?.ref.id===t.ref.id)setPopup(old=>old?{...old,...next}:old);else open({type:'track',...next});
        }
      }
      return true;
    }catch(issue){if(desktop&&action==='play'&&controller.signal.reason?.name==='TimeoutError'&&playMetadataWork.current===controller)setPlayAction({controller,track:t,origin,entryContext,loading:false,error:errorText({code:'timeout'})});else if(!cancelled(issue)&&!controller.signal.aborted){if(desktop&&action==='play')setPlayAction({controller,track:t,origin,entryContext,loading:false,error:errorText(issue)});else setError(errorText(issue));}return false;}
    finally{
      clearTimeout(timer);
      if(playMetadataWork.current===controller)playMetadataWork.current=undefined;
      if(desktop&&action==='play')setPlayAction(old=>old?.controller===controller&&old.loading?{...old,loading:false}:old);
      if(actionWork.current===controller){setActionBusy(false);actionWork.current=null;}
    }
  }
  const libraryIndex=useMemo(()=>{
    const favorites=new Map(lib?.snapshot.favorites.map(favorite=>[favorite.songId,favorite])??[]);
    const chartFavorites=new Map((lib?.snapshot.catalogLinks??[]).flatMap(link=>{const favorite=favorites.get(link.songId);return favorite?[[link.key,favorite] as const]:[];}));
    return {owners:new Map(lib?.snapshot.versions.map(version=>[songSourceKey(version.ref),version.songId])??[]),favorites:new Set(favorites.keys()),chartFavorites,chartFavoriteKeys:new Set(chartFavorites.keys())};
  },[lib]);
  const toggleChartFavorite=async(context:ChartSongContext)=>{
    if(saving||writeWork.current||!requireLibrary())return;
    const chartKey=catalogSongKey(context),favorite=libraryIndex.chartFavorites.get(chartKey);
    const body=favorite?{edits:[{type:'remove-favorite',favoriteId:favorite.favoriteId}]}:{context};
    setChartFavoriteAction({key:chartKey,body});
    const data=await mutate(body,false);
    if(data)flash(`${favorite?'已取消收藏':'已收藏'}「${context.title}」`);
  };
  const songForTrack=(track:Track)=>{if(track.songId)return track.songId;try{return libraryIndex.owners.get(songSourceKey((canonical[key(track.ref)]??track.ref) as any));}catch{return undefined;}};
  const favorite=(t:Track,toggle=true,entryContext:EntryContext=t.songId?'part':'video')=>{
    if(!lib||saving||writeWork.current)return;
    if(desktop&&favoriteWork.current?.key===key(t.ref)&&!favoriteWork.current.controller.signal.aborted)return;
    if(sourceBlocked(t)&&!isFavorite(t)){setError('YouTube 已关闭，请在设置中开启后再收藏。');return;}
    actionWork.current?.abort();const controller=new AbortController();actionWork.current=controller;setActionBusy(true);setError('');
    if(desktop){favoriteWork.current={key:key(t.ref),controller};setFavoriteTarget(key(t.ref));}
    void(async()=>{try{
      const songId=songForTrack(t),alreadySaved=!!lib.snapshot.favorites.find(favorite=>favorite.songId===songId);
      const entry=!alreadySaved&&t.ref.provider==='bilibili'&&(entryContext==='video'||!t.ref.part)?await partsStore.read(t.ref,controller.signal):t;
      controller.signal.throwIfAborted();const resolved={...t,...entry};setCanonical(old=>({...old,[key(t.ref)]:entry.ref}));
      if(entryContext==='video'&&entry.ref.provider==='bilibili'&&(entry.parts?.length??1)>1){
        if(popup?.track?.ref.id===t.ref.id)setPopup(old=>old?{...old,track:resolved,parts:entry.parts,intent:'favorite',step:(old.step??0)+1}:old);
        else open({type:'track',track:resolved,parts:entry.parts,entryContext,intent:'favorite'});
        return;
      }
      const owner=songForTrack(resolved),favorite=lib.snapshot.favorites.find(favorite=>favorite.songId===owner),exists=!!favorite;
      if(exists&&!toggle){flash('已在我的收藏');return;}
      const data=await mutate(favorite?{edits:[{type:'remove-favorite',favoriteId:favorite.favoriteId}]}:owner&&!resolved.chartContext?{edits:[{type:'favorite',songId:owner}]}:{save:{refs:[resolved.ref],target:'favorite',...(resolved.chartContext?{context:resolved.chartContext}:{})}},false);
      if(data)flash(exists?'已取消收藏本首':'已收藏本首',resolved.ref.provider==='bilibili'?{label:'管理整组',run:()=>void showParts(resolved)}:undefined);
    }catch(issue){if(!cancelled(issue)&&!controller.signal.aborted)setError(errorText(issue));}
    finally{if(favoriteWork.current?.controller===controller){favoriteWork.current=undefined;setFavoriteTarget(undefined);}if(actionWork.current===controller){setActionBusy(false);actionWork.current=null;}}})();
  };
  const favoritePending=(track:Track)=>desktop&&favoriteTarget===key(track.ref);
  const isFavorite=(t:Track)=>{const songId=songForTrack(t);return !!songId&&libraryIndex.favorites.has(songId);};
  const isVideoFavorite=(t:Track)=>{const parts=partsStore.peek(t.ref.id)?.parts;return parts&&parts.length>1?parts.every(isFavorite):isFavorite(t);};
  useEffect(()=>{const c=new AbortController();const native=lib?.snapshot.versions.map(version=>version.ref)??[];const tracks=Object.values(results).flatMap(r=>r.items).filter(t=>t.ref.provider==='bilibili'&&!t.ref.part&&!canonical[key(t.ref)]&&native.some(r=>r.id===t.ref.id));for(const t of tracks)void partsStore.read(t.ref,c.signal,false).then(e=>setCanonical(old=>({...old,[key(t.ref)]:e.ref}))).catch(()=>{});return()=>c.abort();},[lib,results,partsStore]);
  async function find(provider:'bilibili'|'youtube',text:string,c:AbortController,cursor?:string,ref?:EntryRef,song:SongQuery=searchSong??{title:text}) {
    const target=searchTarget.current;
    if(c.signal.aborted||provider==='youtube'&&!(sourceStateRef.current?.youtube.enabled??youtubeEnabled))return;
    const controller=provider==='youtube'?new AbortController():c,abort=()=>controller.abort(),settingsEpoch=searchSettingsEpoch.current;
    if(provider==='youtube'){youtubeSearch.current?.abort();youtubeSearch.current=controller;c.signal.addEventListener('abort',abort,{once:true});}
    const active=()=>!c.signal.aborted&&!controller.signal.aborted&&(provider!=='youtube'||(sourceStateRef.current?.youtube.enabled??youtubeEnabled));
    setResults(old=>active()?{...old,[provider]:{...(cursor?old[provider]??{items:[]}:{items:[]}),busy:true,error:undefined}}:old);
    try {const data=ref?await client.list({ref,limit:20,cursor},{signal:controller.signal}):await request<SearchPage>('/api/search',{provider,query:text,cursor,song},controller.signal);
      const changed=settingsEpoch!==searchSettingsEpoch.current?latestSearchSettings.current:undefined;
      const searchData=ref?undefined:{...data as SearchPage,...(changed?{config:changed.config,preferred:preferredSong(changed.preferred,song),preferredVersions:searchPreferredVersions(changed.preferred,song)}:{})};
      if(active())setResults(old=>{if(!active()||!old[provider])return old;const incoming=data.items.map(track=>({...track,...(target.context?{chartContext:target.context}:{}),...(target.songId?{targetSongId:target.songId}:{})}));const entries=cursor?[...(old[provider].items),...incoming]:incoming;return {...old,[provider]:{items:[...new Map(entries.map(t=>[t.resourceId,t])).values()],cursor:data.nextCursor,...(searchData?{config:searchData.config,preferred:searchData.preferred,preferredVersions:searchData.preferredVersions,classificationIssue:searchData.classificationIssue}:{})}};});
    }catch(e){if(active())setResults(old=>active()&&old[provider]?{...old,[provider]:{...old[provider],busy:false,error:e}}:old);}
    finally{if(provider==='youtube')c.signal.removeEventListener('abort',abort);}
  }
  function openSearch(){searchReturn.current?.();searchReturn.current=undefined;searchTarget.current={};authorWork.current?.abort();setAuthorBusy(false);search.current?.abort();setSearchSource('all');setQuery('');setSearched('');setSearchSong(undefined);setShowAllSearch(undefined);setLinkRef(undefined);setResults({});setSearchOpen(true);}
  function closeSearch(){search.current?.abort();actionWork.current?.abort();setActionBusy(false);setSearchOpen(false);setResults(old=>Object.fromEntries(Object.entries(old).map(([p,r])=>[p,{...r,busy:false}])));const back=searchReturn.current;searchReturn.current=undefined;back?.();}
  function groupSource(track:Track){if(!requireLibrary())return;closeSearch();setPopup(null);setGroupTrack(track);}
  async function searchFor(text=query,filter: keyof typeof names=searchSource,song?:SongQuery,preserveDisplay=false,context?:ChartSongContext,targetSong?:Song) {
    if(!preserveDisplay&&!(desktop&&searchReturn.current&&searchTarget.current.songId&&!targetSong))searchTarget.current={...(context?{context}:{}),...(targetSong?{songId:targetSong.id}:{})};
    if(!text.trim()){if(desktop&&searchReturn.current&&searchTarget.current.songId){search.current?.abort();setQuery('');setSearched('');setResults({});setError('');return;}openSearch();return;}authorWork.current?.abort();setAuthorBusy(false);search.current?.abort();const c=new AbortController();search.current=c;serial.current++;setSearchOpen(true);setSearchSource(filter);setSearched(text);setLinkRef(undefined);setResults({});
    const target=song??{title:text};setSearchSong(target);if(!preserveDisplay)setShowAllSearch(undefined);
    const providers=(filter==='all'?['bilibili','youtube']:[filter]).filter(p=>p!=='youtube'||youtubeAvailable);
    await Promise.all(providers.map(p=>find(p as 'bilibili'|'youtube',text,c,undefined,undefined,target)));
  }
  function searchForTitle(value:string|(SongQuery&{context?:ChartSongContext})){const song=typeof value==='string'?{title:value}:value,text=desktop?songSearchText(song):song.title;setQuery(desktop?text:'');void searchFor(text,'all',{title:song.title,...(song.artists?.length?{artists:song.artists}:{})},false,'context' in song?song.context:undefined);}
  function searchForLibrarySong(song?:Song,onReturn?:()=>void){
    if(!song){openSearch();return;}
    searchReturn.current=desktop?onReturn:undefined;
    const text=desktop?songSearchText(song):song.title;
    if(desktop)setQuery(text);
    void searchFor(text,'all',{title:song.title,artists:song.artists},false,undefined,song);
  }
  const loadMore=(p:'bilibili'|'youtube')=>{const c=search.current&&!search.current.signal.aborted?search.current:new AbortController();search.current=c;return find(p,searched,c,results[p]?.cursor,linkRef);};
  async function resolveLink(){
    linkWork.current?.abort();const controller=new AbortController();linkWork.current=controller;setError('');setLinkBusy(true);
    const input=field.trim();let entryContext:EntryContext='video';try{if(new URL(input).searchParams.has('p'))entryContext='part';}catch{}
    try{
      const data=await request<{entry?:Track;parts?:MusicEntry[];ref?:EntryRef}>('/api/identify',{input},controller.signal);controller.signal.throwIfAborted();
      if(data.ref){search.current?.abort();const searchController=new AbortController();search.current=searchController;setLinkRef(data.ref);setSearched('公开歌单');setQuery('');setSearchSource(data.ref.provider);setSearchOpen(true);setResults({});setPopup(null);await find(data.ref.provider,'',searchController,undefined,data.ref);}
      else if(data.entry){partsStore.seed(data.entry);open({type:'track',track:data.entry,parts:data.parts??[data.entry],entryContext,intent:(data.parts?.length??1)>1?'parts':'overview'});}
    }catch(issue){if(!cancelled(issue)&&!controller.signal.aborted)setError(errorText(issue));}
    finally{if(linkWork.current===controller){setLinkBusy(false);linkWork.current=null;}}
  }
  function reorder(ids:string[],id:string,delta:number){const from=ids.indexOf(id),to=from+delta;if(to<0||to>=ids.length)return;const next=[...ids];next.splice(from,1);next.splice(to,0,id);return next;}
  const playlist=lib?.snapshot.playlists.find(p=>p.id===selected);
  const attachingSong=lib?.snapshot.songs.find(song=>song.id===popup?.track?.targetSongId);
  const saveParts=async(action:PartBatchAction,parts:MusicEntry[],options:{playlistId?:string;duplicates?:DuplicatePolicy;name?:string}={})=>{
    if(parts.length>500){setError('一次最多处理 500 首，请选择部分分 P。');return false;}
    const ids=new Set(parts.map(songForTrack));
    const data=await mutate(action==='unfavorite'?{edits:lib?.snapshot.favorites.filter(favorite=>ids.has(favorite.songId)).map(favorite=>({type:'remove-favorite',favoriteId:favorite.favoriteId}))}:{save:{refs:parts.map(track=>track.ref),target:action==='favorite'?'favorite':'playlist',...options}},false);
    if(data?.summary){const target=options.playlistId?lib?.snapshot.playlists.find(p=>p.id===options.playlistId)?.name:options.name;flash(action==='unfavorite'?`已取消收藏 ${data.summary.changed} 首`:`${target?'已向「'+target+'」添加':'已收藏'} ${data.summary.changed} 首，跳过 ${data.summary.unchanged} 首`);}
    return !!data;
  };
  const filteredShelves=shelves.map(s=>({...s,page:s.page?{...s.page,items:s.page.items.filter(t=>source==='all'||t.ref.provider===source)}:undefined}));
  const current=snapshot.current;
  const lyricTrack=current&&!sourceBlocked(current)&&(current.ref.provider==='youtube'||current.ref.part)?current:null;
  const lyrics=useLyrics(lyricTrack,snapshot.duration,lib?.snapshot.versions.find(version=>version.id===current?.versionId),snapshot.state!=='idle'&&snapshot.state!=='stopped');
  const currentVersion=lib?.snapshot.versions.find(version=>current&&key(version.ref)===key(current.ref));
  const currentSong=lib?.snapshot.songs.find(song=>song.id===(current?.songId??currentVersion?.songId));
  const closeManagement=()=>{setManagement(undefined);lyrics.closeSettings();};
  const openManagement=(tab:PlaybackManagementTab,section?:'select'|'offset')=>{managementSection.current=section;setQueueOpen(false);setManagement(tab);lyrics.openSettings();if(section==='select')lyrics.setSelector(true);};
  const openLyricsManagement=()=>{if(desktop&&page==='playing')openManagement('lyrics');else lyrics.openSettings();};
  useEffect(()=>{if(!managementVisible){if(management){setManagement(undefined);lyrics.closeSettings();}return;}lyrics.openSettings();if(managementSection.current==='select')lyrics.setSelector(true);managementSection.current=undefined;},[managementVisible,lyrics.sourceKey]);
  const desktopSongMeta=()=>current?<><div className="playing-artist"><span>{current.artists?.join(' / ')||'歌手未提供'}</span></div><PlaybackSource key={key(current.ref)} track={current} version={currentVersion} store={partsStore} onVersions={()=>openManagement('versions')} versionsOpen={managementVisible&&management==='versions'}/></>:<p className="muted">从发现、搜索或歌单添加音乐</p>;
  const lyricPlayback:LyricPlayback={position:snapshot.position,duration:snapshot.duration,playing:snapshot.playing&&!snapshot.loading,readPosition:playback.readPosition,...(desktop?{subscribePosition:playback.clock.subscribe}:{})};
  const desktopHost=useDesktopHost(lyrics,lyricPlayback,snapshot.state!=='idle'&&snapshot.state!=='stopped',{toggle:()=>preparingPlayback?cancelPlayback():startPlayback(()=>playback.toggle(),false),previous:()=>startPlayback(()=>playback.previous(),false),next:()=>startPlayback(()=>playback.next(),false),release:playback.release},issue=>setError(errorText(issue)));
  const bottomLyricsVisible=!desktopHost.available&&!!lyricTrack&&lyrics.bottom&&snapshot.state!=='idle'&&snapshot.state!=='stopped';
  const collectArtworks=()=>{const known={...artworks};for(const t of [...shelves.flatMap(s=>s.page?.items??[]),...Object.values(results).flatMap(r=>r.items),...snapshot.items,...(current?[current]:[])])if(isTrack(t)&&t.artwork)known[artworkKey(t)]=t.artwork;return known;};
  const desktopArtworks=useMemo(()=>desktop?collectArtworks():undefined,[desktop,artworks,shelves,results,snapshot.items,current]);
  const knownArtworks=desktop?desktopArtworks!:collectArtworks();
  const currentArtwork=current&&!sourceBlocked(current)?artworkUrl(current.artwork??knownArtworks[artworkKey(current)]):undefined;
  useEffect(()=>{const c=new AbortController();const targets=[...(current?[current]:[])].filter(t=>!sourceBlocked(t)&&!t.artwork&&!checkedArtwork.current.has(artworkKey(t)));for(const t of targets)void partsStore.read(t.ref,c.signal,false).then(entry=>{if(!c.signal.aborted&&entry.artwork)setArtworks(old=>({...old,[artworkKey(t)]:entry.artwork!}));}).catch(()=>{});return()=>c.abort();},[client,current?.ref.id,current?.ref.part,youtubeEnabled]);
  const commitScrub=()=>{const value=scrubValue.current;if(value===null)return;scrubValue.current=null;setScrub(null);void playback.seek(value);};
  // Let the range's final native change finish before clearing its controlled preview.
  const releaseScrub=()=>requestAnimationFrame(commitScrub);
  const sleepRunning=playback.sleep.status==='running';
  const sleepBadge=!sleepRunning?null:playback.sleep.trigger?.type==='duration'?time(desktop?Math.ceil(playback.sleep.remainingMs/1000):playback.sleep.remainingMs/1000):`${playback.sleep.remainingItems??1} 首`;
  const rateControl=(labeled=false)=><RateControl value={snapshot.rate} onChange={playback.rate} labeled={labeled}/>;
  const sleepButton=(labeled=false)=><button type="button" className={'btn sleep-control player-setting '+(labeled?'labeled ':'')+(sleepRunning?'saved':'')} title={sleepRunning?'睡眠定时器 · 剩余 '+sleepBadge:'睡眠定时器'} aria-label="睡眠定时器" aria-pressed={sleepRunning} onClick={()=>open({type:'sleep'})}>
<span className="setting-icon"><MoonIcon size={19}/></span>{labeled&&<span className="setting-label">定时</span>}<span className="setting-value">{sleepRunning?sleepBadge:labeled?'未开启':'定时'}</span>
</button>;
  const transport=(large=false)=>
<div className={'transport '+(large?'large':'')}>
<button className="btn btn-icon" title="上一首" aria-label="上一首" onClick={()=>void startPlayback(()=>playback.previous(),false)} disabled={!snapshot.canPrevious}>
<SkipBackIcon size={23} weight="fill"/>
</button>
<button className="play-toggle" title={preparingPlayback?'取消播放准备':snapshot.playing?'暂停 · 空格':'播放 · 空格'} aria-label={preparingPlayback?'取消播放准备':snapshot.playing?'暂停':'播放'} aria-busy={preparingPlayback} onClick={()=>preparingPlayback?cancelPlayback():void startPlayback(()=>playback.toggle(),false)} disabled={!snapshot.items.length&&!preparingPlayback}>{preparingPlayback?<SpinnerGapIcon size={26}/>:snapshot.playing?<PauseIcon size={26} weight="fill"/>:<PlayIcon size={26} weight="fill"/>}</button>
<button className="btn btn-icon" title="下一首" aria-label="下一首" onClick={()=>void startPlayback(()=>playback.next(),false)} disabled={!snapshot.canNext}>
<SkipForwardIcon size={23} weight="fill"/>
</button>
</div>;
  const progress=()=>desktop?<DesktopPlaybackProgress key={snapshot.currentId} clock={playback.clock} enabled={!!current&&snapshot.state!=='idle'&&snapshot.state!=='stopped'} onSeek={playback.seek}/>:
<div className="progress">
<span>{time(scrub??snapshot.position)}</span>
<div className="progress-track">
{snapshot.buffered.map((range,index)=>snapshot.duration&&range.end>range.start?<span key={index} className="progress-buffer" style={{left:range.start/snapshot.duration*100+'%',width:(range.end-range.start)/snapshot.duration*100+'%'}}/>:null)}
<input aria-label="播放进度" aria-valuetext={time(scrub??snapshot.position)+' / '+time(snapshot.duration)} type="range" min="0" max={snapshot.duration??0} step=".1" value={snapshot.duration?Math.min(scrub??snapshot.position,snapshot.duration):snapshot.position} disabled={!snapshot.duration||!current||snapshot.state==='idle'||snapshot.state==='stopped'} style={{'--fill':(snapshot.duration?Math.min(100,Math.max(0,(scrub??snapshot.position)/snapshot.duration*100)):0)+'%'} as React.CSSProperties} onChange={e=>{const value=Number(e.target.value);scrubValue.current=value;setScrub(value);}} onPointerUp={releaseScrub} onPointerCancel={()=>{scrubValue.current=null;setScrub(null);}} onKeyUp={e=>{if(e.key.startsWith('Arrow')||['Home','End','PageUp','PageDown'].includes(e.key))commitScrub();}} onBlur={commitScrub}/>
</div>
<span>{time(snapshot.duration)}</span>
</div>;
  const mode=snapshot.order==='shuffle'?'shuffle':snapshot.repeat==='all'?'all':snapshot.repeat==='one'?'one':'sequential';
  const modeLabel={sequential:'顺序播放',shuffle:'随机播放',all:'列表循环',one:'单曲循环'}[mode];
  const nextModeLabel={sequential:'随机播放',shuffle:'列表循环',all:'单曲循环',one:'顺序播放'}[mode];
  const ModeIcon={sequential:ListBulletsIcon,shuffle:ShuffleIcon,all:RepeatIcon,one:RepeatOnceIcon}[mode];
  const modeButton=(size=22,showLabel=false)=><button type="button" className={'btn btn-icon mode-control '+(mode!=='sequential'?'saved ':'')+(showLabel?'mode-control-labeled':'')} aria-label="播放模式" aria-description={modeLabel+'；点击切换为'+nextModeLabel} title={modeLabel+' · 点击切换为'+nextModeLabel} data-mode={mode} onClick={playback.cycleMode}>
<ModeIcon size={size}/>{showLabel&&<span className="playback-mode-label" aria-live="polite">{current?.partsGroupId&&mode==='sequential'?'按分 P 顺序播放':modeLabel}</span>}
</button>;
  const seekButtons=(compact=false)=>[-10,10].map(delta=>{const Icon=delta<0?RewindIcon:FastForwardIcon,label=delta<0?'快退':'快进';return <button key={delta} type="button" className={'btn seek-button'+(compact?' seek-button-compact':'')} aria-label={label+' 10 秒'} title={label+' 10 秒 · '+(delta<0?'J':'L')} disabled={!current||!snapshot.duration||snapshot.state==='idle'||snapshot.state==='stopped'} onClick={()=>void playback.skip(delta)}><Icon size={compact?20:18}/>{compact?<span className="seek-value" aria-hidden="true">10</span>:<span>{label} <span className="seek-value">10 秒</span></span>}</button>;});
  const playerOptions=(dock=false)=><ControlPopover className="player-options" label="更多播放选项" icon={<DotsThreeIcon size={25}/>}>
    {dock&&<div className="popover-player-style" role="radiogroup" aria-label="底栏样式">
      <p className="popover-heading">底栏样式</p>
      <label className="player-style-option"><input type="radio" name="player-style" value="floating" checked={playerStyle==='floating'} onChange={()=>selectPlayerStyle('floating')}/><span>悬浮播放岛</span></label>
      <label className="player-style-option"><input type="radio" name="player-style" value="bar" checked={playerStyle==='bar'} onChange={()=>selectPlayerStyle('bar')}/><span>底部长条</span></label>
    </div>}
    <p className="popover-heading">播放选项</p>{preparingPlayback&&<button onClick={cancelPlayback}><XIcon size={19}/>取消播放准备</button>}{dock&&<><div className="popover-settings">{rateControl(true)}{sleepButton(true)}</div><div className="popover-seek">{seekButtons()}</div></>}
    {!desktopHost.available&&<label className="choice popover-lyrics-choice"><input type="checkbox" checked={lyrics.bottom} onChange={event=>lyrics.updateDisplay({bottom:event.target.checked})}/>底部歌词</label>}
    {desktopHost.available&&<label className="choice popover-lyrics-choice"><input type="checkbox" checked={desktopHost.visible} onChange={desktopHost.toggle}/>桌面悬浮歌词</label>}
    <button onClick={event=>{event.currentTarget.closest('.control-popover')?.querySelector<HTMLButtonElement>('button[popovertarget]')?.focus();openLyricsManagement();}}><MusicNotesIcon size={19}/>{desktop&&page==='playing'?'歌词管理':'歌词设置'}</button>
    {desktop&&page==='playing'&&<DesktopLyricFont/>}
    {desktopLyricsOpen&&<><label className="choice popover-lyrics-choice"><input type="checkbox" checked={lyrics.translations} onChange={event=>lyrics.updateDisplay({translations:event.target.checked})}/>显示翻译</label><a href="/legal/desktop-lyrics-source.tar.gz" download="slowtune-desktop-lyrics-source.tar.gz">下载当前构建对应源码</a><a href="/legal/THIRD-PARTY-NOTICES.txt" download>下载第三方许可全文</a></>}
    {!dock&&page==='playing'&&<div className="popover-listening-extras"><div className="popover-seek">{seekButtons()}</div><div className="popover-volume">{volume}</div></div>}
    {!dock&&page==='playing'&&<div className="popover-short-settings">{rateControl(true)}{sleepButton(true)}<button className="btn btn-ghost" aria-label="播放队列" aria-expanded={queueVisible} onClick={toggleQueue}><QueueIcon size={19}/>播放队列</button></div>}
    {current&&<button onClick={()=>open({type:'track',track:current,entryContext:'part'})}><MusicNotesIcon size={19}/>歌曲操作</button>}
    {current&&<button onClick={()=>groupSource(current)}><PlusIcon size={19}/>归入歌曲</button>}
    {current&&<a href={current.url||(current.ref.provider==='bilibili'?'https://www.bilibili.com/video/'+current.ref.id:'https://www.youtube.com/watch?v='+current.ref.id)} target="_blank" rel="noreferrer"><LinkIcon size={19}/>查看来源</a>}
    {!dock&&page==='playing'&&<div className="player-help">{snapshot.state==='idle'&&snapshot.items.length>0&&<p className="restore-hint">队列已恢复，播放将从头开始。</p>}<p className="player-shortcuts"><kbd>空格</kbd> 播放 / 暂停</p><p className="player-shortcuts"><kbd>←</kbd><kbd>→</kbd> 跳转 5 秒</p></div>}
    <button disabled={!current||snapshot.state==='idle'||snapshot.state==='stopped'} onClick={()=>void startPlayback(()=>playback.stop(),false)}><StopIcon size={19}/>停止播放</button>
    <button disabled={!current||snapshot.state==='idle'} onClick={()=>void startPlayback(()=>playback.reset(),false)}><ArrowCounterClockwiseIcon size={19}/>停止并归零</button>
  </ControlPopover>;
  const playbackLabel=preparingPlayback?'正在准备音轨':snapshot.playing?'正在播放':snapshot.state==='paused'?'已暂停':snapshot.state==='stopped'?'已停止':snapshot.state==='ended'?'播放已结束':current?'准备播放':'等待音乐';
  const playbackSlot=desktop?<span className="desktop-playback-slot" data-desktop-playback-slot=""/>:null;
  const playbackFeedback=()=>desktop?<PlaybackFeedback error={playAction?.error||playback.error} failures={playback.chartFailures} preparing={preparingPlayback}
    retryLabel={playback.chartSearchTitle?'去搜索':'重试播放'} onRetry={()=>{if(playAction?.error){void trackAction(playAction.track,'play',playAction.origin,playAction.entryContext);return;}if(playback.chartSearchTitle){searchForTitle(playback.chartSearchSong??playback.chartSearchTitle);return;}const retry=preparationRetry.current;void startPlayback(retry??(()=>playback.retry()));}}
    onStop={cancelPlayback} onDismiss={()=>{setPlayAction(undefined);preparationRetry.current=undefined;playback.dismiss();}} onDismissFailures={playback.dismissChartFailures}/>:null;
  const row=(t:Track,context:'normal'|'queue'|'playlist'|'favorite'|'part'='normal',index=0,list?:Track[],timestamps=false,searchContext?:SongQuery)=>
    (()=>{const entryContext:EntryContext=context==='normal'?'video':'part';const saved=entryContext==='video'?isVideoFavorite(t):isFavorite(t);const open_track=()=>context==='queue'?startPlayback(()=>playback.select(t.resourceId),false):trackAction(t,'play',list&&list.length?{tracks:list,index:list.indexOf(t)}:undefined,context==='part'?'video':entryContext);
    const filterReasons=searchContext&&results[t.ref.provider]?.config?searchFilterReasons(t,results[t.ref.provider].config!,searched):[];
    return <div className={'track-row '+(context==='favorite'?'playlist':context)+' '+(filterReasons.length?'search-filtered-row ':'')+(sourceBlocked(t)?'source-closed ':'')+(sourceBlocked(t)&&youtubeDisplay==='dim'?'source-disabled ':'')+(current&&key(current.ref)===key(t.ref)?'current':'')} key={t.resourceId}>
    {context!=='queue'&&context!=='part'&&<span className="row-number">{String((searchContext?results[t.ref.provider]?.items.findIndex(item=>item.resourceId===t.resourceId)??index:index)+1).padStart(2,'0')}</span>}
    <button className="row-cover" aria-label={'播放 '+t.title} disabled={sourceBlocked(t)} onClick={()=>void open_track()}>
<Cover track={t}/>
</button>
<div className="row-info">
<button className="track-name" title={t.title} disabled={sourceBlocked(t)} onClick={()=>void open_track()}>{displayTitle(t)}</button>{context!=='part'&&<PartBadge track={t} store={partsStore} active={!popup&&!sourceBlocked(t)} viewKey={page+':'+searchOpen} onOpen={()=>void showParts(t)}/>}
<div className="row-sub">
{creatorContent(t)}
<Badge provider={t.ref.provider}/></div>
{timestamps&&<time className="row-update" dateTime={t.publishedAt?new Date(t.publishedAt).toISOString():undefined}>{updateTime(t.publishedAt)}</time>}
    {t.unavailable&&<span className="row-status error-text">{availabilityText(t.unavailable)}</span>}
{sourceBlocked(t)&&<span className="row-status">YouTube 已关闭</span>}
</div>
    {context!=='queue'&&context!=='part'&&<>{creatorContent(t,'row-creator')}<span className="row-source"><Badge provider={t.ref.provider}/></span></>}
<span className="row-duration">{time(t.durationSeconds)}</span>
    {context==='queue'?<>
<button className="btn btn-icon" aria-label={'队列上移 '+t.title} disabled={index===0} onClick={()=>playback.move(t.resourceId,index-1)}>
<ArrowUpIcon size={18}/>
</button>
<button className="btn btn-icon" aria-label={'队列下移 '+t.title} disabled={index===snapshot.items.length-1} onClick={()=>playback.move(t.resourceId,index+1)}>
<ArrowDownIcon size={18}/>
</button>
<button className="btn btn-icon" aria-label={'移除队列 '+t.title} onClick={()=>void playback.remove(t.resourceId)}>
<TrashIcon size={20}/>
</button>
</>:<>
    {t.targetSongId?<button className="btn btn-icon" title="添加为这首歌曲的版本" aria-label={'添加版本 '+t.title} disabled={saving||!lib||sourceBlocked(t)} onClick={()=>void mutate({save:{refs:[t.ref],target:'version',songId:t.targetSongId}},false)}><PlusIcon size={21}/></button>:<button className={'btn btn-icon '+(saved?'saved':'')} title={saved&&entryContext==='part'?'取消收藏':'收藏'} aria-label={(saved&&entryContext==='part'?'取消收藏 ':'收藏 ')+t.title} aria-pressed={saved} aria-busy={favoritePending(t)||undefined} disabled={saving||!lib||favoritePending(t)} onClick={()=>favorite(t,true,entryContext)}>
{favoritePending(t)?<SpinnerGapIcon size={21} className="favorite-spinner"/>:<HeartIcon size={21} weight={saved?'fill':'regular'}/>}
</button>}
    <button className="btn btn-icon" title="更多操作" aria-label={'更多操作 '+t.title} onClick={()=>context==='part'?setPopup(old=>old?{...old,track:t,entryContext:'part',intent:'overview',step:(old.step??0)+1}:old):open({type:'track',track:t,entryContext,searchSong:searchContext,id:context==='favorite'?favoritesId:context==='playlist'?playlist?.id:undefined,origin:list&&list.length?{tracks:list,index:list.indexOf(t)}:undefined})}>
<DotsThreeIcon size={26}/>
</button>
</>}
    {!!filterReasons.length&&<span className="row-status search-filter-reason">筛选原因：{filterReasons.join('、')}</span>}
  </div>;})();
  const errorBox=(e:unknown,retry:()=>void)=>
<div className="feedback" data-tone="error" role="alert">
<p>{errorText(e)}{(e as {retained?:boolean})?.retained?' 已保留上次内容。':''}</p>
<RefreshButton label="重试" onClick={retry}/>
</div>;
  const tableHeading=<div className="track-table-heading"><span className="row-number">#</span><span aria-hidden="true"/><span>歌曲</span><span>作者</span><span>来源</span><span className="row-duration">时长</span><span aria-hidden="true"/><span aria-hidden="true"/></div>;
  const list=(items:Track[],timestamps=false,searchContext?:SongQuery,offset=0,all=items)=>items.length?<div className="track-list">{tableHeading}{items.map((t,i)=>row(t,'normal',offset+i,all,timestamps,searchContext))}</div>:<div className="empty">
<ListBulletsIcon size={38}/>
<h3>这里还没有音乐</h3>
<p>从搜索或链接添加喜欢的声音。</p>
</div>;
  const covers=(items:Track[],timestamps=false,slots=items.length,all=items)=><div className="cover-grid">{items.map((t,i)=><article className="music-card" key={t.resourceId}>
    <div className="art-wrap"><button className="cover-button" aria-label={'播放 '+t.title} onClick={()=>void trackAction(t,'play',{tracks:all,index:all.indexOf(t)},'video')}><Cover track={t}/></button><button className={'cover-favorite '+(isVideoFavorite(t)?'saved':'')} aria-label={'收藏 '+t.title} aria-pressed={isVideoFavorite(t)} aria-busy={favoritePending(t)||undefined} disabled={saving||!lib||favoritePending(t)} onClick={()=>favorite(t,true,'video')}>{favoritePending(t)?<SpinnerGapIcon size={18} className="favorite-spinner"/>:<HeartIcon size={18} weight={isVideoFavorite(t)?'fill':'regular'}/>}</button></div>
    <div className="card-heading"><button className="card-title" title={t.title} onClick={()=>void trackAction(t,'play',{tracks:all,index:all.indexOf(t)},'video')}>{displayTitle(t)}</button><PartBadge track={t} store={partsStore} active={!popup} viewKey={page+':'+searchOpen} onOpen={()=>void showParts(t)}/></div>
    <div className="card-foot">{creatorContent(t,'card-creator')}<Badge provider={t.ref.provider}/><button className="btn btn-icon card-menu" aria-label={'更多操作 '+t.title} onClick={()=>open({type:'track',track:t,entryContext:'video',origin:{tracks:all,index:all.indexOf(t)}})}><DotsThreeIcon size={22}/></button></div>
    {timestamps&&<time className="card-update" dateTime={t.publishedAt?new Date(t.publishedAt).toISOString():undefined}>{updateTime(t.publishedAt)}</time>}
  </article>)}{Array.from({length:Math.max(0,slots-items.length)},(_,i)=><article className="music-card catalog-empty-slot" key={'empty-'+i} aria-hidden="true"><div className="cover-button"><span className="unknown-cover"><MusicNotesIcon size={28}/></span></div><span className="card-title">暂无符合规则的歌曲</span></article>)}</div>;
  const retryWrite=()=>{void mutate(pending,false);};
  const sourceTabs=useMemo(()=>youtubeEnabled?<div className="segmented source-tabs" aria-label="音乐来源">{Object.entries(names).map(([id,name])=><button key={id} className={source===id?'selected':''} aria-pressed={source===id} onClick={()=>setSource(id as keyof typeof names)}>{name}</button>)}</div>:null,[youtubeEnabled,source]);
  const volume=<div className="volume-control"><button type="button" className={'btn btn-icon '+(snapshot.muted?'saved':'')} title={snapshot.muted?'取消静音':'静音'} aria-label={snapshot.muted?'取消静音':'静音'} aria-pressed={snapshot.muted} onClick={playback.mute}>{snapshot.muted||snapshot.volume===0?<SpeakerSlashIcon size={20}/>:<SpeakerHighIcon size={20}/>}</button><input aria-label="音量" aria-valuetext={Math.round(snapshot.volume*100)+'%'+(snapshot.muted?' · 已静音':'')} type="range" min="0" max="1" step=".01" value={snapshot.volume} style={{'--fill':(snapshot.muted?0:snapshot.volume*100)+'%'} as React.CSSProperties} onChange={e=>playback.volume(Number(e.target.value))}/></div>;
  const queuePanel=()=><PlaybackQueue items={snapshot.items} youtubeEnabled={youtubeEnabled} disabledDisplay={youtubeDisplay} currentId={snapshot.currentId} playing={snapshot.playing} order={snapshot.order} renderCover={track=><Cover track={track}/>} title={displayTitle} onClose={closeQueue} onPlayAll={()=>{const first=snapshot.items.find(t=>!sourceBlocked(t));if(first)void startPlayback(()=>playback.select(first.resourceId),false);}} onSelect={id=>void startPlayback(()=>playback.select(id),false)} onMove={playback.move} onRemove={id=>void playback.remove(id)} onClear={()=>void playback.clear()} onSearch={()=>navigate('search')} onCreator={track=>void openCreator(track)} authorBusy={authorBusy} onImport={()=>importTracks(snapshot.items.filter(isTrack).filter(t=>!sourceBlocked(t)),'当前播放队列','part',snapshot.items.filter(t=>!isTrack(t)||sourceBlocked(t)).length)}/>;
  const listeningSidePanel=()=><div className="listening-sidepanel"><div className="listening-panel-tabs segmented" aria-label="聆听面板"><button className={listeningPanel==='comments'?'selected':''} aria-pressed={listeningPanel==='comments'} onClick={()=>setListeningPanel('comments')}><ChatCircleTextIcon size={18}/>评论</button><button className={listeningPanel==='queue'?'selected':''} aria-pressed={listeningPanel==='queue'} onClick={()=>setListeningPanel('queue')}><QueueIcon size={18}/>队列</button></div>{listeningPanel==='comments'?<CommentsPanel key={current?artworkKey(current):'empty'} track={current&&!sourceBlocked(current)?current:null} onClose={closeQueue}/>:queuePanel()}</div>;
  const build=status?.build;
  // The large playlist sidebar has no clock-dependent state. Stable elements keep
  // its cover lookups and icon trees outside desktop media-clock commits.
  const desktopSidebarPlaylists=useMemo(()=>{
    if(!desktop||!lib)return;
    const songs=new Map(lib.snapshot.songs.map(song=>[song.id,song]));
    return lib.snapshot.playlists.map(p=><button className={'sidebar-playlist '+(page==='library'&&selected===p.id?'active':'')} key={p.id} onClick={()=>{setSelected(p.id);navigate('library');}}><PlaylistCover image={p.desktopCover} song={songs.get(p.entries.find(entry=>songs.get(entry.songId)?.artwork)?.songId??'')}/><span><strong className="playlist-label">{p.name}</strong><small>{p.entries.length} 首</small></span></button>);
  },[desktop,lib,page,selected]);
  const desktopFavoriteCover=useMemo(()=>{
    if(!desktop||!lib)return;
    const songs=new Map(lib.snapshot.songs.map(song=>[song.id,song]));
    const song=songs.get(lib.snapshot.favorites.find(favorite=>songs.get(favorite.songId)?.artwork)?.songId??'');
    return lib.snapshot.desktopFavoritesCover||song?<PlaylistCover image={lib.snapshot.desktopFavoritesCover} song={song}/>:undefined;
  },[desktop,lib]);
  if(build?.stale) return <div className="build-notice" role="alert">
<h1>服务端仍是旧构建</h1>
<p>磁盘上的{build.changed.map(artifact=>artifact==='server'?'服务端代码':'网页资源').join('、')}比运行中的服务更新。当前页面与运行中的服务不是同一次构建，B站栏目等接口会失败。</p>
<p>请先运行 stop.cmd，再运行 一键启动.cmd（或在仓库执行 npm start）重新启动服务，然后重新输入访问码并刷新本页。</p>
<p className="muted">服务启动 {new Date(build.startedAt).toLocaleString('zh-CN',{hour12:false})} · 磁盘构建 {new Date(Math.max(build.current.server,build.current.client)).toLocaleString('zh-CN',{hour12:false})}</p>
<button className="btn btn-primary" onClick={()=>void reload()}>重新检查</button>
</div>;
  const pinnedSearch=[...new Map(Object.values(results).flatMap(result=>result.preferredVersions??[]).filter(item=>searchSource==='all'||item.entry.ref.provider===searchSource).map(item=>[item.key,item])).values()];
  const globalTools=(className:string)=><div className={className} role="group" aria-label="工具" inert={desktopLyricsOpen}>
    <button className="btn btn-icon" aria-label="粘贴链接" title="粘贴视频或歌单链接" onClick={()=>open({type:'link'})}><LinkIcon size={22}/></button>
    <ThemeToggle/>
    <button className={'btn btn-icon'+(page==='settings'?' active':'')} aria-label="设置" title="设置" aria-current={page==='settings'?'page':undefined} onClick={openSettings}><GearIcon size={22}/></button>
  </div>;
  const currentFavoriteButton=()=>current&&<button className={'btn btn-icon '+(isFavorite(current)?'saved':'')} title={isFavorite(current)?'取消收藏当前歌曲':'收藏当前歌曲'} aria-label="收藏当前歌曲" aria-pressed={isFavorite(current)} aria-busy={favoritePending(current)||undefined} disabled={saving||!lib||favoritePending(current)} onClick={()=>favorite(current,true,'part')}>{favoritePending(current)?<SpinnerGapIcon size={22} className="favorite-spinner"/>:<HeartIcon size={24} weight={isFavorite(current)?'fill':'regular'}/>}</button>;
  return <YoutubeEnabledContext.Provider value={youtubeEnabled}><ArtworkContext.Provider value={knownArtworks}><div className={'app '+(page==='playing'?'immersive ':'')+(queueVisible?'has-queue ':'')+(managementVisible?'has-playback-management ':'')+(desktopLyricsOpen?'desktop-lyrics-open ':'')+(bottomLyricsVisible?'has-bottom-lyrics':'')} data-player-style={playerStyle}>
		    {page!=='playing'&&<aside className="sidebar"><button className="brand" aria-label="慢听" onClick={()=>navigate('discover')}><span className="brand-mark"><HeadphonesIcon size={22} weight="bold"/></span><span className="brand-wordmark">{brand.name}<small>{brand.english.toUpperCase()}</small></span></button><nav className="sidebar-nav" aria-label="主导航">{nav.map(n=><button key={n.id} className={'nav-item '+(page===n.id?'active':'')} aria-current={page===n.id?'page':undefined} onClick={()=>navigate(n.id)}><n.icon size={22} weight={page===n.id?'fill':'regular'}/><span>{n.label}</span></button>)}</nav><div className="sidebar-library"><div className="sidebar-heading"><span>我的歌单</span><button className="btn btn-icon" aria-label="新建歌单" title="新建歌单" disabled={!lib} onClick={()=>open({type:'new'})}><PlusIcon size={19}/></button></div><button className={'sidebar-playlist '+(page==='library'&&selected===favoritesId?'active':'')} onClick={()=>{setSelected(favoritesId);navigate('library');}}>{desktopFavoriteCover??<span className="sidebar-favorite-art" aria-hidden="true"><HeartIcon size={23} weight="fill"/></span>}<span><strong>我的收藏</strong><small>{lib?lib.snapshot.favorites.length+' 首':libraryError?'暂不可用':'读取中…'}</small></span></button>{desktop?desktopSidebarPlaylists:lib?.snapshot.playlists.map(p=><button className={'sidebar-playlist '+(page==='library'&&selected===p.id?'active':'')} key={p.id} onClick={()=>{setSelected(p.id);navigate('library');}}><SongCover song={lib.snapshot.songs.find(song=>song.id===p.entries[0]?.songId)}/><span><strong className="playlist-label">{p.name}</strong><small>{p.entries.length} 首</small></span></button>)}{lib&&!lib.snapshot.playlists.length&&<p className="sidebar-empty">把喜欢的音乐整理成歌单</p>}</div>
	{desktop&&globalTools('desktop-tools')}</aside>}
<header className={'topbar'+(page==='playing'?' listening-header':'')} inert={desktopLyricsOpen}>
{page==='playing'?<>
  <button className="btn btn-icon" aria-label="返回浏览音乐" title="返回浏览音乐" onClick={()=>navigate(listeningReturnPage)}><ArrowLeftIcon size={23}/></button>
  <div className="listening-header-title"><h1>正在播放</h1><span>{snapshot.items.length?`${snapshot.items.length} 首音乐 · 慢听`:'慢听 · 音乐空间'}</span></div>
</>:<>
<button className="brand" onClick={()=>navigate('discover')}>慢听</button>
<nav className="desktop-nav" aria-label="主导航">{nav.map(n=>
<button key={n.id} className={page===n.id?'active':''} onClick={()=>navigate(n.id)}>{n.label}</button>)}</nav>
<form className="search-field" onSubmit={e=>{e.preventDefault();void searchFor(query,'all');}}>
<MagnifyingGlassIcon size={21}/>
<input aria-label="搜索歌曲或视频" placeholder="搜索歌曲或视频" value={query} onChange={e=>setQuery(e.target.value)}/>
<button aria-label="开始搜索" title="开始搜索" type="submit">
<ArrowRightIcon size={19}/>
</button>
</form>
</>}
{!desktop&&globalTools('topbar-actions')}
</header>
    <main className="main-content" inert={desktopLyricsOpen}><DesktopRegion enabled={desktop} resetKey={page} label="当前页面">
{page!=='library'&&page!=='settings'&&page!=='playing'&&<div className="page-heading"><h1>{page==='discover'?'发现音乐':page==='charts'?'音乐榜单':activeCreator?'作者内容':'我的关注'}</h1>{page!=='charts'&&sourceTabs}</div>}
    {!desktop&&!online&&<div className="feedback" data-tone="info" role="alert">网络已断开。资料保留，联网后可重试。</div>}
    {!desktop&&authorBusy&&!popup&&<div className="feedback" role="status"><p>正在读取 UP / 博主信息…</p><button className="btn btn-ghost" onClick={()=>{authorWork.current?.abort();setAuthorBusy(false);}}>取消</button></div>}
    {!desktop&&error&&!popup&&!searchOpen&&<div className="feedback" data-tone="error" role="alert">
<p>{error}</p>
<div className="toolbar">
<button className="btn btn-ghost" onClick={()=>void reload()}>重读资料 / 检查服务</button>{pending&&<button className="btn btn-ghost" disabled={saving} onClick={retryWrite}>重试保留编辑</button>}<button className="btn btn-ghost" onClick={()=>setError('')}>关闭提示</button>{error.includes('会话')&&<button className="btn btn-ghost" onClick={async()=>{await playback.release();onLogout();}}>重新连接</button>}</div>
</div>}
    {!desktop&&!popup&&!searchOpen&&(playback.error||((playback.preparing||snapshot.loading)&&page!=='playing'))&&<div className="feedback" role="status">
<p>{playback.error||'正在取得真实音轨…'}</p>
<div className="toolbar">{playback.error&&(playback.chartSearchTitle?<button className="btn btn-ghost" onClick={()=>searchForTitle(playback.chartSearchSong??playback.chartSearchTitle)}>去搜索</button>:<button className="btn btn-ghost" onClick={()=>void playback.retry()}>重试播放</button>)}<button className="btn btn-ghost" onClick={playback.cancel}>取消并停止</button>{playback.error&&<button className="btn btn-ghost" onClick={playback.dismiss}>关闭提示</button>}</div>
</div>}
    {!desktop&&actionBusy&&!popup&&!playback.preparing&&!snapshot.loading&&<div className="feedback" role="status"><p>正在读取歌曲信息…</p><button className="btn btn-ghost" onClick={()=>{actionWork.current?.abort();setActionBusy(false);}}>取消读取</button></div>}
    {!desktop&&!!playback.chartFailures.length&&<div className="feedback chart-playback-failures" role="status"><details><summary>{playback.chartFailures.length} 首榜单歌曲未能播放</summary><ul>{playback.chartFailures.map((item,index)=><li key={item.id+':'+index}>{item.title} · {item.reason}</li>)}</ul></details><button className="btn btn-ghost" onClick={playback.dismissChartFailures}>关闭提示</button></div>}
    {page==='discover'&&<>
      {source!=='youtube'&&<>{bilibiliAccount?.state==='expired'&&<p className="feedback" role="status">B站登录已过期，可在设置中重新登录。</p>}{discoverBusy&&<div className="loading">正在获取 B站推荐… <button className="btn btn-ghost" onClick={cancelDiscovery}>取消</button></div>}{!!discoverError&&errorBox(discoverError,()=>void discover(true))}{filteredShelves.map(s=><DiscoveryShelf key={s.id} shelf={s} displayActive={!popup&&!searchOpen} loading={discoverBusy} renderCovers={covers} renderList={list} renderError={e=>errorBox(e,()=>void discover(true))} onRefresh={()=>void discover(true)} onPlayAll={items=>void startPlayback(()=>playback.playAll(items),false)} onImport={(items,title)=>importTracks(items,title)} info={<p>{s.id==='account-recommendation'?'从你的B站首页推荐中筛选音乐，每次换一批会重新获取。':'B站音乐分区内容，每次换一批会获取其他推荐。'}</p>} status={discoveryUpdatedAt?<span>{discoveryMessage} · 获取于 {new Date(discoveryUpdatedAt).toLocaleTimeString('zh-CN')}</span>:undefined}/>)}</>}
      {youtubeEnabled&&source!=='bilibili'&&<YoutubeDiscovery displayActive={!popup&&!searchOpen} available={youtubeAvailable} refreshToken={youtubeRefresh} renderCovers={covers} renderList={list} onPlayAll={items=>void startPlayback(()=>playback.playAll(items),false)} onImport={(items,title)=>importTracks(items,title)}/>}
      <FollowUpdatesShelf youtubeEnabled={youtubeEnabled} state={followState} source={source} renderCovers={covers} renderList={items=>list(items,true)} onPlayAll={items=>void startPlayback(()=>playback.playAll(items),false)} onImport={(items,title)=>importTracks(items,title)} onFollow={()=>navigate('follows')}/>
    </>}
    {page==='charts'&&<ChartsPage onSearch={(item,context)=>searchForTitle({...item,...(context?{context}:{})})} onPlay={(item,context)=>void startPlayback(()=>playback.playSelection(context?{kind:'chart',context}:{kind:'query',query:{title:item.title,artists:item.artists}},item))} onPlayAll={(items,contexts)=>void startPlayback(()=>playback.playSelections(items.map((item,index)=>({selection:contexts?.[index]?{kind:'chart' as const,context:contexts[index]}:{kind:'query' as const,query:{title:item.title,artists:item.artists}},song:item}))),false)} onFavorite={context=>desktop?void toggleChartFavorite(context):void mutate({context},false)} favoriteState={desktop?{saved:libraryIndex.chartFavoriteKeys,busy:saving&&pending===chartFavoriteAction?.body?chartFavoriteAction?.key:undefined,disabled:saving||!lib}:undefined}/>}
    {page==='follows'&&<FollowsPage youtubeEnabled={youtubeEnabled} onImportSource={setListImport} client={client} state={followState} onChange={setFollowState} source={source} renderList={(items,timestamps,offset,all)=>list(items,timestamps,undefined,offset,all)} renderCovers={(items,timestamps,offset,all)=>covers(items,timestamps,items.length,all)} onPlayAll={items=>void startPlayback(()=>playback.playAll(items),false)} onImport={(items,title)=>importTracks(items,title)} onSearch={()=>navigate('search')} initialCreator={activeCreator} onClearCreator={()=>setActiveCreator(undefined)}/>}
    {page==='library'&&<SongLibraryWorkspace desktop={desktop} sourceControls={sourceTabs} youtubeEnabled={youtubeEnabled} disabledDisplay={sources?.youtube.disabledDisplay ?? 'dim'} source={source} onChange={updateLibrary} state={lib} loadError={libraryError} onRetry={()=>void readLibrary()} selected={selected} onSelect={setSelected} busy={saving} commit={(edits,revision,localFeedback)=>mutate({edits,...(revision!==undefined?{revision}:{})},false,localFeedback)} onBackup={()=>open({type:'backup'})} onSearch={searchForLibrarySong} onPlay={(selection,song)=>void startPlayback(()=>playback.playSelection(selection,song))} onPlayAll={items=>void startPlayback(()=>playback.playSelections(items),false)}/>}
    {page==='playing'&&<section className="listening-stage">
{currentArtwork&&<img className="listening-backdrop" src={currentArtwork} alt="" referrerPolicy="no-referrer"/>}
<div className="listening-content">
<PlayingArtwork artwork={currentArtwork} playing={snapshot.playing&&!snapshot.loading&&!desktopLyricsOpen} muted={snapshot.muted||snapshot.volume===0} analysis={playback.audioAnalysis} allowLyrics={!desktop} desktop={desktop} suspended={desktopLyricsOpen} lyrics={<LyricsView lyrics={lyrics} playback={lyricPlayback} onSeek={seconds=>void playback.seek(seconds)}/>}/>
<div className="playing-detail">
<div className="playing-title">
<div className="playing-status"><span className={'playback-status '+(snapshot.playing?'is-playing':'')} role="status">{playbackLabel}</span>{!desktop&&current&&<Badge provider={current.ref.provider}/>} {!playback.preparing&&!snapshot.loading&&snapshot.format&&<span className="audio-quality" aria-label="当前音质" title="自动选择此来源当前可用、浏览器支持的最佳音轨">{audioQualityLabel(snapshot.format)}</span>}</div>
<PlayingTitle key={current?.resourceId} title={current?displayTitle(current):undefined} fullTitle={current?.title}/>{current&&<PartBadge track={current} store={partsStore} active={!popup} current viewKey={page+':'+searchOpen} onOpen={()=>void showParts(current)}/>}
<div className={'playing-meta'+(desktop?' desktop-playing-meta':'')}>{desktop?<div className="playing-song-copy">{desktopSongMeta()}</div>:<p>{current?creatorContent(current):'从发现、搜索或歌单添加音乐'}</p>}<div className="playing-song-actions">{!desktop&&currentFavoriteButton()}{desktop&&<LyricsToggle active={false} onClick={toggleDesktopLyrics}/>}{playerOptions()}</div></div>
</div>
<div className="listening-playback">{progress()}<div className="playbar-controls listening-transport">{modeButton(23,!desktop)}{transport(true)}{desktop?(currentFavoriteButton()||<span className="transport-balance" aria-hidden="true"/>):<span className="transport-balance" aria-hidden="true"/>}{playbackSlot}</div><div className="listening-seek">{seekButtons(true)}</div></div>
<div className="stage-volume">{volume}<span className="volume-value">{snapshot.muted?'静音':Math.round(snapshot.volume*100)+'%'}</span></div>
<div className="stage-controls">{rateControl(true)}{sleepButton(true)}<button className="btn btn-secondary stage-queue" aria-label="播放队列" aria-expanded={queueVisible&&listeningPanel==='queue'} onClick={toggleQueue}><QueueIcon size={21}/><span>队列</span><small>{snapshot.items.length}</small></button></div>
{!current&&<button className="btn btn-primary" onClick={()=>navigate('discover')}>去发现音乐</button>}
</div></div>{bottomLyricsVisible&&<BottomLyrics lyrics={lyrics} playback={lyricPlayback}/>}</section>}
    {page==='settings'&&<SettingsPage desktopLyricsRequest={desktopSettingsRequest} onLibraryChange={updateLibrary} onSearchPreferencesChanged={searchPreferencesChanged} status={status} statusCheckedAt={statusCheckedAt} onRefreshDiagnostics={refreshDiagnostics} sources={sources} onSourcesChanged={sourcesChanged} account={bilibiliAccount} library={lib} onAccountChange={accountChanged} onRecommendationChanged={recommendationChanged} onReload={()=>void reload()} onBack={()=>navigate(previousPage)} onOpenBackup={()=>open({type:'backup'})} onStopPlayback={()=>playback.stop()} onLogout={logout}/>}
    </DesktopRegion></main>
{page!=='playing'&&bottomLyricsVisible&&<BottomLyrics lyrics={lyrics} playback={lyricPlayback} compact/>}
{desktopLyricsOpen&&<DesktopLyricsView onManage={section=>openManagement('lyrics',section)} lyrics={lyrics} playback={lyricPlayback} artwork={currentArtwork} onClose={closeDesktopLyrics} onSeek={seconds=>void playback.seek(seconds)} visual={<PlayingArtwork artwork={currentArtwork} playing={snapshot.playing&&!snapshot.loading} muted={snapshot.muted||snapshot.volume===0} analysis={playback.audioAnalysis} allowLyrics={false} desktop/>} songInfo={<><PlayingTitle key={current?.resourceId} title={current?displayTitle(current):undefined} fullTitle={current?.title}/><div className="playing-song-copy">{desktopSongMeta()}</div></>} controls={<>
{progress()}{playbackSlot}<div className="desktop-lyrics-tools">{modeButton()}{volume}</div>{transport(true)}<div className="desktop-lyrics-tools"><button className="btn btn-icon" aria-label="播放队列" title="播放队列" aria-expanded={queueVisible} onClick={toggleQueue}><QueueIcon size={24}/></button>{current&&<button className={'btn btn-icon '+(isFavorite(current)?'saved':'')} title={isFavorite(current)?'取消收藏当前歌曲':'收藏当前歌曲'} aria-label="收藏当前歌曲" aria-pressed={isFavorite(current)} aria-busy={favoritePending(current)||undefined} disabled={saving||!lib||favoritePending(current)} onClick={()=>favorite(current,true,'part')}>{favoritePending(current)?<SpinnerGapIcon size={22} className="favorite-spinner"/>:<HeartIcon size={24} weight={isFavorite(current)?'fill':'regular'}/>}</button>}<LyricsToggle active onClick={toggleDesktopLyrics}/>{playerOptions(true)}</div>
</>}/>}
{!managementVisible&&<LyricsSettings lyrics={lyrics} desktopImmersive={desktop} nativeDesktop={desktopHost.available}/>}
{managementVisible&&<PlaybackManagement tab={management!} onTab={setManagement} onClose={closeManagement} current={current} song={currentSong} library={lib} youtubeEnabled={youtubeEnabled} nativeDesktop={desktopHost.available} lyrics={lyrics} preparing={preparingPlayback} saving={saving} playbackError={playback.error} onPlay={(selection,song)=>startPlayback(()=>playback.playSelection(selection,song,true))} onSave={(track,song)=>song?mutate({save:{refs:[track.ref],target:'version',songId:song.id}},false):groupSource(track)} onDefault={(song,version)=>mutate({edits:[{type:'set-default',songId:song.id,versionId:version.id}]},false)}/>}
{queueVisible&&(compactQueue||desktopLyricsOpen?<Modal title={page==='playing'&&listeningPanel==='comments'?'视频评论':'播放队列'} className="queue-drawer" showHeader={false} onClose={closeQueue}>{page==='playing'?listeningSidePanel():queuePanel()}</Modal>:page==='playing'?listeningSidePanel():queuePanel())}
{page!=='playing'&&<footer className="playbar" aria-label="播放器">
<div className="playbar-inner">
<div className="playbar-now">
<button className="now-playing" aria-label="打开正在播放" onClick={()=>open({type:'playing'})}>
<Cover track={current}/>
<span>
<strong title={current?.title}>{current?displayTitle(current):'选择一首音乐'}</strong>
<small>{current?creator(current):'好音乐，等你发现'}</small>
</span>
</button>{playbackSlot}{current&&<button className={'btn btn-icon playbar-heart '+(isFavorite(current)?'saved':'')} title={isFavorite(current)?'取消收藏当前歌曲':'收藏当前歌曲'} aria-label="收藏当前歌曲" aria-pressed={isFavorite(current)} aria-busy={favoritePending(current)||undefined} disabled={saving||!lib||favoritePending(current)} onClick={()=>favorite(current,true,'part')}>{favoritePending(current)?<SpinnerGapIcon size={22} className="favorite-spinner"/>:<HeartIcon size={22} weight={isFavorite(current)?'fill':'regular'}/>}</button>}</div><div className="playbar-center"><div className="playbar-controls">{modeButton()}{transport()}<span className="transport-balance" aria-hidden="true"/></div>{progress()}</div><div className="playbar-tools">{volume}{rateControl()}{sleepButton()}
<button className={'btn btn-icon '+(queueVisible?'saved':'')} title="播放队列" aria-label="打开播放队列" aria-expanded={queueVisible} onClick={()=>open({type:'queue'})}>
<QueueIcon size={25}/>
</button>
{playerOptions(true)}
</div>
</div>
</footer>}
{page!=='playing'&&<nav className="mobile-nav" aria-label="手机导航">{nav.map(n=>
<button key={n.id} className={page===n.id?'active':''} aria-current={page===n.id?'page':undefined} onClick={()=>navigate(n.id)}>
<n.icon size={23} weight={page===n.id?'fill':'regular'}/>
<span>{n.label}</span>
</button>)}<button className={queueVisible?'active':''} aria-expanded={queueVisible} onClick={()=>open({type:'queue'})}>
<QueueIcon size={23}/>
<span>队列</span>
</button>
</nav>}
    {searchOpen&&<Modal title={desktop&&searchReturn.current?'添加播放版本':'搜索音乐'} className="search-modal" onClose={closeSearch}>
      {desktop&&searchReturn.current&&<button className="btn btn-ghost btn-sm" onClick={closeSearch}><ArrowLeftIcon size={18}/>返回歌曲与版本</button>}
      <form className="search-field search-dialog-input" onSubmit={e=>{e.preventDefault();void searchFor();}}><MagnifyingGlassIcon size={21}/><input aria-label="弹窗搜索关键词" placeholder="搜索歌曲或视频" data-autofocus="true" value={query} onChange={e=>setQuery(e.target.value)}/><button aria-label="搜索" type="submit"><MagnifyingGlassIcon size={20}/></button></form>
      {youtubeEnabled&&<div className="segmented search-source-tabs" aria-label="搜索来源">{Object.entries(names).map(([id,name])=><button key={id} className={searchSource===id?'selected':''} aria-pressed={searchSource===id} disabled={id==='youtube'&&!status?.providers.youtube.available||!!linkRef&&id!==linkRef.provider} onClick={()=>{setSearchSource(id as keyof typeof names);if(searched&&!linkRef)void searchFor(searched,id as keyof typeof names,searchSong,true);}}>{name}</button>)}</div>}
      <div className="search-results"><p className="muted search-description">{searchTarget.current.songId?`为「${lib?.snapshot.songs.find(song=>song.id===searchTarget.current.songId)?.title??searched}」添加版本，点击结果右侧的 ＋ 即可。`:linkRef?'公开视频歌单':searched?`“${searched}” 的搜索结果`:'输入歌名，找到想听的版本。'}</p>
      {!linkRef&&!searchTarget.current.songId&&pinnedSearch.map(item=><section key={item.key} className="search-preferred" aria-label="自动匹配的优先结果"><div><strong>自动匹配「{item.song.title}{item.song.artists?.length?' · '+item.song.artists.join(' / '):''}」时优先选择</strong><p>{item.entry.title}</p>{sourceBlocked(item.entry)&&<p>YouTube 已关闭，可在设置的偏好中管理这个匹配结果。</p>}</div><div className="toolbar"><button className="btn btn-primary btn-sm" disabled={sourceBlocked(item.entry)} onClick={()=>void trackAction(item.entry,'play',undefined,'part')}>播放此结果</button><button className="btn btn-secondary btn-sm" onClick={()=>open({type:'track',track:item.entry,entryContext:'part',searchSong:item.song})}>管理匹配偏好</button></div></section>)}
      {Object.entries(results).filter(([p])=>searchSource==='all'||searchSource===p).map(([p,r])=>{
        const filtered=!linkRef&&r.config?r.items.filter(track=>!searchFilterReasons(track,r.config!,searched).length):r.items;
        const hidden=r.items.length-filtered.length,showAll=showAllSearch??!(r.config?.filterByDefault??true),visible=showAll?r.items:filtered;
        return <section className="catalog" key={p}>
          <div className="section-heading"><h2>{names[p as keyof typeof names]}</h2><div className="toolbar"><PlayAllButton compact count={visible.length} onClick={()=>void startPlayback(()=>playback.playAll(visible),false)}/><AddToPlaylistButton compact count={linkRef?1:visible.length} disabled={r.busy} onClick={()=>linkRef?setListImport({title:'公开歌单',source:{kind:'playlist',ref:linkRef}}):importTracks(visible,'搜索结果 · '+searched)}/>{r.busy&&<button className="btn btn-ghost" onClick={()=>{search.current?.abort();setResults(old=>Object.fromEntries(Object.entries(old).map(([k,v])=>[k,{...v,busy:false}])));}}>取消搜索</button>}</div></div>
          {!linkRef&&r.config&&<div className="search-filter-notice" role="status"><p>{showAll?`正在显示全部结果。${hidden?`其中 ${hidden} 条不符合当前偏好。`:''}`:`当前已加载 ${r.items.length} 条结果，${hidden} 条被偏好规则筛选。`}<span>保留{p==='bilibili'?' B站':'来源'}原始顺序；切换仅影响本次搜索展示。</span></p><button className="btn btn-secondary btn-sm" onClick={()=>setShowAllSearch(!showAll)}>{showAll?'恢复筛选':'显示全部'}</button></div>}
          {r.classificationIssue&&<p className="notice" role="status">部分结果的分区暂时无法确认，可点击“显示全部”手动选择。{errorText(r.classificationIssue)}</p>}
          {!!r.error&&errorBox(r.error,()=>{const c=search.current&&!search.current.signal.aborted?search.current:new AbortController();search.current=c;void find(p as 'youtube'|'bilibili',searched,c,r.items.length?r.cursor:undefined,linkRef);})}
          <PagedList id={'search:'+serial.current+':'+p+':'+showAllSearch} group="search" label={names[p as keyof typeof names]+'搜索结果'} items={visible} busy={r.busy} error={!!r.error} cursor={r.cursor} onLoadMore={()=>loadMore(p as 'youtube'|'bilibili')}>{(items,offset)=>items.length?list(items,false,linkRef?undefined:searchSong??{title:searched},offset,visible):r.busy?<div className="loading">正在搜索…</div>:!r.error&&<div className="empty"><h3>{hidden?'当前偏好筛选了所有已加载结果':'没有搜索结果'}</h3><p>{hidden?'点击“显示全部”查看可能被误筛的结果。':'换个关键词或来源试试。'}</p></div>}</PagedList>
        </section>;
      })}
      {error&&!popup&&<div className="feedback" role="alert"><p>{error}</p>{pending&&<button className="btn btn-secondary" onClick={retryWrite}>重试保留编辑</button>}<button className="btn btn-ghost" onClick={()=>setError('')}>关闭提示</button></div>}
      {desktop&&notice&&!popup&&!error&&<div className="action-notice" role="status">{notice}{noticeAction&&<button className="btn btn-ghost btn-sm" onClick={noticeAction.run}>{noticeAction.label}</button>}</div>}
      {!desktop&&playback.error&&!popup&&<p className="feedback" role="alert">{playback.error}</p>}</div>
      {(current||desktop&&(preparingPlayback||playAction?.error||playback.error||playback.chartFailures.length>0))&&<div className="search-playing"><span>{current?displayTitle(current):playAction?.track.title??'播放状态'} · {playbackLabel}</span>{playbackSlot}{transport()}</div>}
    </Modal>}
    {popup&&<Modal className={['track','parts'].includes(popup.type)?'music-action-modal':popup.type==='sleep'?'sleep-modal':popup.type==='backup'?'backup-modal':popup.type==='maintenance'?'maintenance-modal':'form-modal'} title={{new:'新建歌单',rename:'歌单改名',delete:'删除歌单',backup:'备份与恢复',maintenance:'失效歌曲管理',link:'粘贴链接',parts:'歌曲与分 P',track:'歌曲与分 P',sleep:'睡眠定时器'}[popup.type]} onClose={()=>{linkWork.current?.abort();actionWork.current?.abort();authorWork.current?.abort();setAuthorBusy(false);setActionBusy(false);setPopup(null);}}>
      {popup.type==='sleep'&&<SleepPanel timer={playback.sleepTimer} desktop={desktop}/>}
      {['new','rename'].includes(popup.type)&&<form onSubmit={e=>{e.preventDefault();void mutate({edits:[popup.type==='new'?{type:'create-playlist',name:field.trim()}:{type:'rename-playlist',playlistId:popup.id,name:field.trim()}]});}}>
<label className="field"><span className="field-label">歌单名称</span><input className="input" data-autofocus="true" value={field} onChange={e=>setField(e.target.value)} maxLength={200} required/>
</label>
<div className="modal-actions"><button type="button" className="btn btn-secondary" onClick={()=>setPopup(null)}>取消</button><button className="btn btn-primary" disabled={!field.trim()||saving}>{saving?'保存中…':'保存歌单'}</button></div>
</form>}
      {popup.type==='delete'&&<>
<p>删除歌单“{lib?.snapshot.playlists.find(p=>p.id===popup.id)?.name}”及其条目？当前播放队列保留。</p>
<div className="modal-actions">
<button className="btn btn-secondary" onClick={()=>setPopup(null)}>取消</button>
<button className="btn btn-danger" disabled={saving} onClick={()=>void mutate({edits:[{type:'delete-playlist',playlistId:popup.id}]})}>确认删除</button>
</div>
</>}
      {popup.type==='backup'&&lib&&<SongBackupPanel library={lib} onCommitted={updateLibrary}/>}
      {popup.type==='link'&&<form onSubmit={e=>{e.preventDefault();void resolveLink();}}>
<p className="muted">支持库可识别的 B站 BV、完整视频链接、YouTube 视频和公开歌单链接。短链及其它 URL 会明确拒绝。</p>
<label className="field"><span className="field-label">视频 / 歌单链接</span><input className="input" aria-label="视频或歌单链接" data-autofocus="true" value={field} onChange={e=>setField(e.target.value)} placeholder="https://… 或 BV…" required/>
</label>
<div className="modal-actions"><button className="btn btn-primary" disabled={linkBusy||!field}>{linkBusy?'解析中…':'读取真实元信息'}</button>{linkBusy&&<button type="button" className="btn btn-secondary" onClick={()=>{linkWork.current?.abort();setLinkBusy(false);}}>取消</button>}</div></form>}
      {['track','parts'].includes(popup.type)&&popup.track&&sourceBlocked(popup.track)&&<div className="disabled-track-actions">
        <h3>{popup.track.title}</h3><p className="muted">YouTube 已关闭。歌曲资料保留，可在设置中重新开启。</p>
        <div className="toolbar">
          {isFavorite(popup.track)&&<button className="btn btn-secondary" disabled={saving} onClick={()=>favorite(popup.track!,true,'part')}>取消收藏</button>}
        </div>
        {error&&<p role="alert">{error}</p>}
      </div>}
      {['track','parts'].includes(popup.type)&&popup.track&&!sourceBlocked(popup.track)&&<PartsPanel
        key={popup.session} track={popup.track} parts={popup.parts??[]} playlists={lib?.snapshot.playlists??[]}
        intent={popup.intent??(popup.type==='parts'?'parts':'overview')} targetId={popup.targetId} anchorId={popup.anchorId} step={popup.step}
        loading={metadataBusy||!popup.parts} busy={saving||actionBusy||playback.preparing||snapshot.loading}
        decisionStale={!!popup.anchorId&&snapshot.currentId!==popup.anchorId} preference={partPreferences[popup.track.ref.id]}
        isFavorite={isFavorite} renderRow={t=>row(t,'part')}
        intro={<div className="collection-intro track-intro"><Cover track={popup.track}/><div><h3 title={popup.track.title}>{displayTitle(popup.track)}</h3>{popup.track.unavailable&&<p className="error-text">{availabilityText(popup.track.unavailable)}</p>}<div className="track-intro-meta"><span className="track-intro-creator">{creatorContent(popup.track)}</span><span className="track-intro-duration">{time(popup.track.durationSeconds)}</span><Badge provider={popup.track.ref.provider}/></div></div></div>}
        more={<><button className="btn btn-secondary song-group-entry" onClick={()=>groupSource(popup.track!)}><PlusIcon size={19}/>归入歌曲 · 添加版本</button><div className="action-list"><button className="btn btn-secondary" disabled={authorBusy} onClick={()=>void openCreator(popup.track!)}><UsersIcon size={19}/>{authorBusy?'读取作者中…':'查看 UP / 博主'}</button><FollowTrackButton key={key(popup.track.ref)} client={client} track={popup.track} state={followState} onChange={setFollowState} author={trackAuthors[artworkKey(popup.track)]} onResolved={author=>setTrackAuthors(old=>({...old,[artworkKey(popup.track!)]:author}))}/><a className="btn btn-secondary" href={popup.track.url} target="_blank" rel="noreferrer"><LinkIcon size={18}/>查看来源</a></div>
          {popup.searchSong&&!attachingSong&&<PreferSongAction key={key(popup.track.ref)} song={popup.searchSong} track={popup.track} onChanged={searchPreferencesChanged}/>}
          {attachingSong&&<div className="settings-group"><h3>添加到「{attachingSong.title}」</h3><button className="btn btn-primary" disabled={saving} onClick={()=>void mutate({save:{refs:[popup.track!.ref],target:'version',songId:attachingSong.id}},false)}>将此来源添加为歌曲版本</button></div>}
        </>}
        feedback={<>
          {notice&&<div className="action-notice" role="status">{notice}{noticeAction&&<button className="btn btn-ghost btn-sm" onClick={noticeAction.run}>{noticeAction.label}</button>}</div>}
          {!desktop&&(playback.preparing||snapshot.loading)&&<div className="feedback" role="status"><p>正在准备音轨…</p><button className="btn btn-ghost" onClick={playback.cancel}>取消播放准备</button></div>}
          {(error||!desktop&&playback.error)&&<div className="feedback" data-tone="error" role="alert"><p>{error||playback.error}</p>{!popup.parts&&<button className="btn btn-ghost" disabled={metadataBusy} onClick={()=>{setError('');setMetadataRetry(value=>value+1);}}>重试读取歌曲</button>}<button className="btn btn-ghost" onClick={()=>void reload()}>重读资料 / 检查服务</button>{pending&&<button className="btn btn-ghost" disabled={saving} onClick={retryWrite}>重试保留编辑</button>}</div>}
          {playbackSlot}
        </>}
        playSingle={()=>trackAction(popup.track!,'play',popup.origin,popup.entryContext??'video')}
        addSingle={()=>trackAction(popup.track!,'add',undefined,popup.entryContext??'video')}
        favoriteSingle={()=>favorite(popup.track!,true,popup.entryContext??'video')}
        play={async parts=>{const ok=await startPlayback(()=>playback.playAll(parts),false);if(ok&&!desktop)flash(`已开始播放 ${parts.length} 首`);return !!ok;}}
        add={async parts=>{const ok=await playback.addAll(parts);if(ok)flash(`已加入队尾 ${parts.length} 首`);return ok;}}
        save={saveParts} choose={choosePartMode} changePreference={mode=>rememberPartMode(popup.track!.ref.id,mode)}
      />}
      {error&&!['track','parts'].includes(popup.type)&&<div className="feedback" data-tone="error" role="alert">
<p>{error}</p>
<button className="btn btn-ghost" onClick={()=>void reload()}>重读资料 / 检查服务</button>{pending&&<button className="btn btn-ghost" disabled={saving} onClick={retryWrite}>重试保留编辑</button>}</div>}
    </Modal>}{notice&&!popup&&(!desktop||!error&&!searchOpen)&&<div className="toast" role="status">{notice}{noticeAction&&<button className="btn btn-ghost btn-sm" onClick={noticeAction.run}>{noticeAction.label}</button>}</div>}
  {playbackFeedback()}
  {desktop&&<DesktopOperationFeedback error={!popup&&!searchOpen?error:''} offline={!online} onDismiss={()=>setError('')}><button className="btn btn-ghost" onClick={()=>void reload()}>重读资料 / 检查服务</button>{pending&&<button className="btn btn-ghost" disabled={saving} onClick={retryWrite}>重试保留编辑</button>}{error.includes('会话')&&<button className="btn btn-ghost" onClick={async()=>{await playback.release();onLogout();}}>重新连接</button>}</DesktopOperationFeedback>}
  {listImport&&lib&&<SongListImportPanel client={client} input={listImport} library={lib} onChange={updateLibrary} onClose={()=>setListImport(undefined)} onSaved={text=>flash(text)}/>}
  {groupTrack&&lib&&<SongVersionDialog track={groupTrack} library={lib} desktop={desktop} onChange={data=>{updateLibrary(data);flash('已保存到歌曲，当前播放继续。');}} onClose={()=>setGroupTrack(undefined)}/>}
  </div></ArtworkContext.Provider></YoutubeEnabledContext.Provider>;
}
