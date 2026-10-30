import { Hono, type Context, type MiddlewareHandler } from 'hono';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import { randomBytes, randomUUID, createHash, timingSafeEqual } from 'node:crypto';
import { mkdirSync, writeFileSync, readFileSync, unlinkSync, accessSync, constants } from 'node:fs';
import { dirname, join } from 'node:path';
import { MusicSources, identify, normalizeMusicInput, MusicSourceError, type MusicApi, type MusicEntry, type Shelf } from '@studio/music-sources';
import { createNodeHost } from '@studio/music-sources/node';
import { createMusicService } from '@studio/music-sources/service';
import { PlaybackDelivery, playbackContext } from './playback-delivery.js';
import { SongLibraryError as LibraryError } from './song-library-errors.js';
import { readConfig, root } from './config.js';
import { captureBuild, buildState } from './build-state.js';
import { BilibiliCredentials } from './bilibili-credentials.js';
import { BilibiliAccounts } from './bilibili-accounts.js';
import { AccountBilibiliProvider, desktopBilibiliRecommendationRevision } from './bilibili-recommendations.js';
import { YoutubeMusicDiscovery, createYoutubeCatalogueLoader } from './youtube-discovery.js';
import { defaultYoutubeRegion, isYoutubeRegion } from './youtube-regions.js';
import { MusicRecommendations, RecommendationStore } from './recommendation.js';
import { RecommendationError } from '@studio/recommendation';
import { FollowStore } from './follow-store.js';
import { CreatorSources } from './creator-sources.js';
import { Follows } from './follows.js';
import { VideoComments } from './comments.js';
import { MusicCharts } from './charts.js';
import { BrowseCache } from './browse-cache.js';
import { DiscoveryBatches, desktopBilibiliBatchKey, isBilibiliBatch } from './discovery-batches.js';
import { streamSSE } from 'hono/streaming';
import { SourceSettingsStore } from './source-settings.js';
import { YoutubeRuntime } from './youtube-runtime.js';
import type { SourceSettingsState } from './source-settings-types.js';
import { StartupSettingsStore, StartupError } from './startup-settings.js';
import { brand } from './brand.js';
import { BilibiliCatalogue } from '@studio/music-sources/discovery';
import { SearchSettingsStore, validateSong } from './search-settings.js';
import { MusicSearch, MusicSearchError } from './music-search.js';
import { verifySearchPlayback } from './search-playback.js';
import { SongLibraryStore } from './song-library-store.js';
import { SongLibraryService } from './song-library-service.js';
import { SongCatalogService } from './song-catalog.js';
import { createSongLibraryRouter } from './song-library-http.js';
import { SongLibrarySources, type SongSourceAccess } from './song-library-sources.js';
import { SongLibraryMaintenance } from './song-library-maintenance.js';
import { SongLibrarySync } from './song-library-sync.js';
import { BilibiliFavorites } from './bilibili-favorites.js';
import { LyricsStore } from './lyrics-store.js';
import { LyricProviders } from './lyrics-providers.js';
import { createLyricsRouter } from './lyrics-http.js';
import { DesktopPlayback, desktopAudioCapability, desktopSourcePath } from './desktop-playback.js';
import { validateAudioSupport } from './search-settings.js';

const config = readConfig();
const version: string = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version;
const build = captureBuild(root);
if (Number(process.versions.node.split('.')[0]) < 24) throw new Error('请使用 Node 24.15 或更新的兼容版本。');
accessSync(join(root, 'dist/client/index.html'), constants.R_OK);
mkdirSync(dirname(config.database), {recursive:true}); mkdirSync(config.runtimeDirectory, {recursive:true});
const songLibraryStore = new SongLibraryStore(config.database+'.song-library.sqlite',config.userSpace);
const songLibrary = new SongLibraryService(songLibraryStore);
const songCatalog = new SongCatalogService(songLibrary);
const lyricsStore = new LyricsStore(config.database+'.lyrics.sqlite',config.userSpace);
const lyricProviders = new LyricProviders(lyricsStore);
const sourceSettingsStore = new SourceSettingsStore(config.database+'.settings.sqlite',config.userSpace);
const startupSettings = new StartupSettingsStore(config.database+'.settings.sqlite',config.userSpace,config.accessKey);
let sourceSettings = sourceSettingsStore.read();
let youtube: YoutubeRuntime;
const sourceListeners = new Set<()=>void>();
const sourceStreams = new Map<string,Set<()=>void>>();
const closeSourceStreams = (owner?:string) => { for (const [key,streams] of sourceStreams) if (!owner || key===owner) { for (const close of streams) close(); sourceStreams.delete(key); } };
let sourceSequence=0;
const sourceState = ():SourceSettingsState => ({...sourceSettings,sequence:sourceSequence,youtube:{...sourceSettings.youtube,...youtube.status()}});
const sourceChanged = () => { sourceSequence++;for (const listener of sourceListeners) listener(); };
const metrics = {metadata:0, prepare:0, mediaRequests:0, mediaFailures:0};
const credentials = await new BilibiliCredentials(join(config.runtimeDirectory,'bilibili-account.dpapi.json'), 'bilibili:'+config.userSpace).open();
const desktopPlayback = new DesktopPlayback(()=>JSON.stringify([credentials.revision,youtube?.currentGeneration]));
desktopPlayback.setFetch(async (u, o) => {
  const upstream = new URL(typeof u==='string'||u instanceof URL?u:u.url);
  if (/(^|\.)(youtube\.com|googlevideo\.com|ytimg\.com|youtubei\.googleapis\.com)$/.test(upstream.hostname)) {
    youtube.assertEnabled(); o = {...o,signal:AbortSignal.any([youtube.signal,...(o?.signal?[o.signal]:[])])};
  }
  const accountHost = ['api.bilibili.com','passport.bilibili.com'].includes(upstream.hostname);
  if(new Headers(o?.headers).has('Cookie')&&(!accountHost||upstream.protocol!=='https:'))throw new MusicSourceError({code:'restricted',provider:'bilibili',retryable:false});
  const media = /\.(bilivideo\.(com|cn|net)|googlevideo\.com)([:/]|$)/.test(String(u));
  if (media) metrics.mediaRequests++;
  try { const r = await fetch(u,{...o,...(accountHost?{redirect:'error' as const}:{})}); if (media && ![200,206,301,302,303,307,308,416].includes(r.status)) metrics.mediaFailures++; return r; }
  catch(e) { if(media && !o?.signal?.aborted) metrics.mediaFailures++; throw e; }
});
const host = createNodeHost({credentials,fetch:desktopPlayback.fetch,onDiagnostic:event=>desktopPlayback.observe(event)});
const bilibiliProvider = new AccountBilibiliProvider();
const api = new MusicSources(host, {bilibili:bilibiliProvider}, 60000);
youtube = new YoutubeRuntime(config.ytDlp,host,sourceChanged,()=>!!desktopPlayback.current);
const preparedGenerations=new WeakMap<object,number>();
const counted = new Proxy(api, {get(target, key) {
  const value = Reflect.get(target,key); if(typeof value !== 'function') return value;
  return (...args:unknown[]) => {
    const first=args[0] as any;
    const provider=typeof first==='string'?first:first?.provider??first?.ref?.provider;
    const invoke=()=>{
    if(key==='metadata')metrics.metadata++; if(key==='prepare')metrics.prepare++;
    if (provider==='youtube') {
      youtube.assertAvailable();
      const optionsIndex=['search','shelf','library','pollLogin','cancelLogin'].includes(String(key))?2:1;
      if(key!=='capabilities') { const options=(args[optionsIndex]??{}) as any; args[optionsIndex]={...options,signal:AbortSignal.any([youtube.signal,...(options.signal?[options.signal]:[])])}; }
      const generation=youtube.currentGeneration,result=(Reflect.get(youtube.api!,key) as Function).apply(youtube.api,args);
      return key==='prepare'?Promise.resolve(result).then(value=>{preparedGenerations.set(value,generation);return value;}):result;
    }
    const revision=credentials.revision,result=value.apply(target,args);
    const accountRead=key==='discover'&&args[0]==='bilibili'||key==='formats'&&(args[0] as {provider?:string})?.provider==='bilibili'||key==='prepare'&&(args[0] as {ref?:{provider?:string}})?.ref?.provider==='bilibili';
    return accountRead?Promise.resolve(result).catch(async e=>{if(e instanceof MusicSourceError&&e.code==='authentication')await accounts.expire(revision);throw e;}):result;
    };
    if(desktopPlayback.current&&['bilibili','youtube'].includes(provider)&&!['capabilities','diagnostics','dispose'].includes(String(key))){
      const optionsIndex=['search','shelf','library','pollLogin','cancelLogin'].includes(String(key))?2:1,options=(args[optionsIndex]??{}) as import('@studio/music-sources').CallOptions;
      const execute=(signal:AbortSignal)=>desktopPlayback.call(provider,{...options,signal},async signal=>{args[optionsIndex]={...options,signal};return invoke();});
      return ['search','metadata','formats','prepare'].includes(String(key))
        ?desktopPlayback.share(['source',key,args.slice(0,optionsIndex),{...options,signal:undefined}],options.signal??desktopPlayback.current.signal,execute)
        :execute(options.signal??desktopPlayback.current.signal);
    }
    return invoke();
  };
}}) as MusicApi;
const youtubeDiscovery = new YoutubeMusicDiscovery({catalogue:createYoutubeCatalogueLoader(host),list:counted.list.bind(counted),now:host.now});
const youtubeCandidates = new YoutubeMusicDiscovery({catalogue:createYoutubeCatalogueLoader(host),list:counted.list.bind(counted),now:host.now},true);
const recommendationStore = new RecommendationStore(config.database+'.recommendation.sqlite',config.userSpace);
const recommendations = new MusicRecommendations(recommendationStore,()=>String(credentials.revision));
const delivery = new PlaybackDelivery(host, {ttlMs:config.mediaLeaseTtlMs, maxReads:8, maxLeases:64});
delivery.desktopContext=()=>!!desktopPlayback.current;
delivery.enabled=provider=>provider!=='youtube'||youtube.status().available;
delivery.canPublish=playback=>playback.entry.ref.provider!=='youtube'||preparedGenerations.get(playback)===youtube.currentGeneration;
const accounts = new BilibiliAccounts(api,credentials,ref=>delivery.revoke(ref));
const searchSettings=new SearchSettingsStore(config.database+'.settings.sqlite',config.userSpace);
const searchCatalogue=new BilibiliCatalogue(),searchStop=new AbortController();
const musicSearch=new MusicSearch(searchSettings,{
  search:(provider,input,options)=>counted.search(provider,input,options),
  metadata:(ref,options)=>counted.metadata(ref,options),
},async(ref,requestSignal)=>{
  const signal=AbortSignal.any([requestSignal,searchStop.signal,AbortSignal.timeout(20000)]);
  return searchCatalogue.json('/x/web-interface/view',{bvid:ref.id},{host,signal,scope:'public-search'});
},()=>youtube.status().available,()=>JSON.stringify([credentials.revision,youtube.currentGeneration]),Date.now,
  (entry,signal,audioSupport,accept)=>verifySearchPlayback(counted,host,entry.ref,{...(entry.ref.provider==='bilibili'?accounts.options():{}),signal},audioSupport,playback=>desktopPlayback.verified(playback),accept),
  (identity,signal,task)=>desktopPlayback.share(identity,signal,task));
const songSourceAccess: SongSourceAccess = {
  metadata: (ref, signal) => counted.metadata(ref, { signal }),
  resolve: (query, signal) => musicSearch.resolve(query, signal),
  enabled: provider => provider !== 'youtube' || youtube.status().enabled,
  generation: () => JSON.stringify([credentials.revision, youtube.currentGeneration]),
};
const songLibrarySources = new SongLibrarySources(songLibrary, songSourceAccess);
const songMaintenance = new SongLibraryMaintenance(songLibrary, songSourceAccess);
const songSync = new SongLibrarySync(songLibrary, new BilibiliFavorites(host, accounts, credentials), (ref, c) => counted.metadata(ref, { signal: c.signal, credentialRef: c.credentialRef }));
const follows = new Follows(new FollowStore(config.database+'.follows.sqlite',config.userSpace),new CreatorSources(host,async signal=>{
  const ref=accounts.options().credentialRef;return ref?(await credentials.read(ref,signal))?.cookie:undefined;
}),counted.metadata.bind(counted),Date.now,()=>sourceSettings.youtube.enabled);
const sessionLifetime = 7*86400000;
const sessions = new Map<string,{expiresAt:number;controller:AbortController;timer:ReturnType<typeof setTimeout>}>(), attempts = new Map<string,{count:number,until:number}>();
const comments = new VideoComments(host);
const browseCache=new BrowseCache(config.database+'.browse-cache.sqlite',config.userSpace);
const charts = new MusicCharts(host,browseCache);
const batchColumn=(key:string)=>isBilibiliBatch(key)?credentials.revision?'account-recommendation':'music-recommendation':'youtube-music-selection';
const batches=new DiscoveryBatches({
  cache:browseCache,recommendations,
  column:batchColumn,
  signature:key=>JSON.stringify([key,String(credentials.revision),recommendationStore.read(batchColumn(key)).epoch,...(key===desktopBilibiliBatchKey?[desktopBilibiliRecommendationRevision]:isBilibiliBatch(key)?[]:[sourceSettings.youtube.enabled,youtube.currentGeneration])]),
  context:key=>isBilibiliBatch(key)?'bilibili:'+String(credentials.revision)+(key===desktopBilibiliBatchKey?':'+desktopBilibiliRecommendationRevision:''):key,
  load:async(key,options)=>{
    if(!isBilibiliBatch(key)){
      youtube.assertAvailable(); options={...options,signal:AbortSignal.any([options.signal,youtube.signal])};
      const region=key.slice('youtube:'.length);
      if(options.parentScope&&isYoutubeRegion(region))youtubeCandidates.inheritFeed(region,options.parentScope,options.scope);
      const result=await youtubeCandidates.read(region,options.scope,options.signal,true,options.enough);
      const {shelf,...extra}=result;return {shelf,extra};
    }
    const auth=String(credentials.revision),accountOptions=accounts.options(),credential=accountOptions.credentialRef?await credentials.read(accountOptions.credentialRef,options.signal):undefined;
    const providerScope=(logical:string)=>JSON.stringify([accountOptions.credentialRef??'anonymous',auth,'shared',logical,recommendationStore.read(batchColumn(key)).epoch]),scope=providerScope(options.scope);
    if(options.parentScope)bilibiliProvider.inheritCandidates(providerScope(options.parentScope),scope);
    try {
      const shelves=await bilibiliProvider.discoverCandidates({host,signal:options.signal,credential,credentialRef:accountOptions.credentialRef,scope},options.seen,options.enough,key===desktopBilibiliBatchKey);
      const shelf=shelves.find(shelf=>shelf.kind==='recommendation');
      if(!shelf)throw new MusicSourceError({code:'upstream',provider:'bilibili',retryable:true});
      if(key===desktopBilibiliBatchKey&&shelf.page&&!shelf.error&&!options.filled(shelf.page.items)){
        const current=new Set(shelf.page.items.map(item=>item.ref.id)),retained=new Map<string,MusicEntry>();
        for(const [cacheKey,snapshot]of browseCache.entries<{signature:string;shelf:Shelf}>('recommendation').reverse()){
          try{
            const [savedKey,signature]=JSON.parse(cacheKey),[source,account]=JSON.parse(signature);
            if(!isBilibiliBatch(savedKey)||source!==savedKey||account!==auth||snapshot.signature!==signature||snapshot.shelf?.id!==shelf.id||!Array.isArray(snapshot.shelf.page?.items))continue;
            for(const item of snapshot.shelf.page.items)if(item?.ref?.provider==='bilibili'&&!current.has(item.ref.id)&&!retained.has(item.ref.id))retained.set(item.ref.id,item);
          }catch{/* Ignore malformed disposable snapshots. */}
        }
        const restored=await bilibiliProvider.restoreDesktopRecommendations({host,signal:options.signal,credential,credentialRef:accountOptions.credentialRef,scope},[...retained.values()],items=>options.filled([...shelf.page!.items,...items]));
        return {shelf:{...shelf,page:{...shelf.page,items:[...shelf.page.items,...restored]}}};
      }
      return {shelf};
    }catch(error){if(error instanceof MusicSourceError&&error.code==='authentication')await accounts.expire(credential?.revision);throw error;}
  }
});
const adminKey = randomBytes(32).toString('base64url');
const desktopOwned = /^[a-f0-9]{64}$/.test(process.env.MUSIC_APP_DESKTOP_OWNER ?? '');
let stopping = false;
const app = new Hono();
let lastRecommendationResponse={requestMs:0,coreMs:0,retainedBytes:0};
function completeResponse(value:unknown,raw:unknown,started:number,requestMs:number,coreStart:number,scope:string){
 const encoded=JSON.stringify(value),bytes=Buffer.byteLength(encoded)+Buffer.byteLength(JSON.stringify(raw));
 lastRecommendationResponse={requestMs:performance.now()-started,coreMs:performance.now()-coreStart,retainedBytes:bytes};
 if(bytes>32*1024*1024||lastRecommendationResponse.coreMs>5000||lastRecommendationResponse.requestMs>requestMs){recommendations.invalidate(scope);throw new RecommendationError('budget','complete response budget exceeded');}return encoded;
}
function same(a:string,b:string) {return timingSafeEqual(createHash('sha256').update(a).digest(), createHash('sha256').update(b).digest());}
async function json(request:Request, max=2*1024*1024):Promise<any> {
  const reader=request.body?.getReader(); if(!reader) throw new LibraryError('invalid-input');
  const parts:Uint8Array[]=[]; let length=0;
  try {while(true) {request.signal.throwIfAborted();const {done,value}=await reader.read();request.signal.throwIfAborted(); if(done) break; length+=value.length; if(length>max) {await reader.cancel(); throw new LibraryError('invalid-input');} parts.push(value);} return JSON.parse(Buffer.concat(parts).toString('utf8'));}
  catch(e) {if(request.signal.aborted)throw new LibraryError('cancelled');if(e instanceof LibraryError) throw e; throw new LibraryError('invalid-input');}
  finally {reader.releaseLock();}
}
app.use('*', async(c,next) => {
  const hostName=new URL(c.req.url).hostname;
  if(!config.allowedHosts.includes(hostName)) return c.json({error:{code:'host-denied'}},403);
  const origin=c.req.header('Origin');
  if(origin && origin!==new URL(c.req.url).origin) return c.json({error:{code:'origin-denied'}},403);
  if(stopping) return c.json({error:{code:'stopping'}},503);
  if(!['GET','HEAD','OPTIONS'].includes(c.req.method) && !c.req.path.startsWith('/internal/') && c.req.header('X-Music-App')!=='1') return c.json({error:{code:'origin-denied'}},403);
  c.header('X-Content-Type-Options','nosniff'); c.header('Referrer-Policy','no-referrer');
  c.header('Content-Security-Policy', "default-src 'self'; img-src 'self' https: data:; media-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self'; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'");
  if(c.req.path.startsWith('/api') || c.req.path.startsWith('/v1')) c.header('Cache-Control','no-store');
  await next();
});
const validSession=(c:Context)=>(sessions.get(getCookie(c,'music_session')??'')?.expiresAt??0)>Date.now();
const expireSession=async(session:string)=>{const current=sessions.get(session);sessions.delete(session);if(current)clearTimeout(current.timer);current?.controller.abort();desktopPlayback.cancelOwner(session);songLibrary.cancelOwner(session);songSync.cancelOwner(session);closeSourceStreams(session);batches.cancelOwner(session);recommendations.invalidate(session);bilibiliProvider.cancelCandidates(session);youtubeCandidates.cancelOwner(session);youtubeDiscovery.cancelOwner(session);follows.cancelOwner(session);comments.cancelOwner(session);await accounts.cancelOwner(session);};
const expireSessions=()=>Promise.allSettled([...sessions.keys()].map(expireSession));
const checkAccessAttempt=(c:Context,code:unknown)=>{
  const key=c.req.header('Host')??'local',a=attempts.get(key);
  if(a&&a.until>Date.now()&&a.count>=8)return 'rate-limited';
  if(!startupSettings.verify(code)){attempts.set(key,{count:a&&a.until>Date.now()?a.count+1:1,until:Date.now()+60000});return 'access-code-invalid';}
  attempts.delete(key);return undefined;
};
const issueSession=async(c:Context)=>{
  for(const [s,value]of sessions)if(value.expiresAt<=Date.now())await expireSession(s);
  if(sessions.size>=64)return c.json({error:{code:'busy'}},429);
  const session=randomBytes(32).toString('base64url');
  const timer=setTimeout(()=>{void expireSession(session).catch(()=>{});},sessionLifetime);timer.unref();
  sessions.set(session,{expiresAt:Date.now()+sessionLifetime,controller:new AbortController(),timer});
  setCookie(c,'music_session',session,{httpOnly:true,sameSite:'Strict',path:'/',maxAge:7*86400,secure:new URL(c.req.url).protocol==='https:'}); return c.json({ok:true});
};
app.get('/api/bootstrap',c=>c.json({...startupSettings.welcome(),authenticationRequired:startupSettings.access().authenticationRequired,authenticated:validSession(c)}));
app.get('/api/welcome/image/:id',c=>{
  const image=startupSettings.image(c.req.param('id'));if(!image)return c.body(null,404);
  c.header('Content-Type',image.mime);c.header('Cache-Control','private, max-age=86400');return c.body(image.bytes);
});
app.post('/api/session',async c=>{
  await json(c.req.raw,4096);
  if(startupSettings.access().authenticationRequired)return c.json({error:{code:'authentication'}},401);
  return validSession(c)?c.json({ok:true}):issueSession(c);
});
app.post('/api/login', async c => {
  const input=await json(c.req.raw,4096),failure=checkAccessAttempt(c,input?.accessKey);
  if(failure)return c.json({error:{code:failure==='access-code-invalid'?'authentication':failure}},failure==='rate-limited'?429:401);
  if(validSession(c))await expireSession(getCookie(c,'music_session')!);
  return issueSession(c);
});
const protectSession:MiddlewareHandler=async(c,next)=>{
  const owner=getCookie(c,'music_session')??'',session=sessions.get(owner);
  if(!session||session.expiresAt<=Date.now()){
    if(session)await expireSession(owner);
    c.header('X-SlowTune-Session','expired');
    return c.json(c.req.path.startsWith('/v1/')?{protocol:2,error:{code:'authentication',retryable:false}}:{error:{code:'authentication'}},401);
  }
  // Reuse one lifetime for body reads, source work, media streams and the library's
  // pre-commit signal checks. Revocation must also wake a stalled request body.
  const raw=c.req.raw,signal=AbortSignal.any([raw.signal,session.controller.signal]);
  const proceed=async(signal:AbortSignal)=>{
    const body=raw.body?.pipeThrough(new TransformStream(),{signal});
    c.req.raw=new Request(raw,{signal,...(body?{body}:{})});
    const operationId=desktopPlayback.current?.id;
    await next();
    if(operationId)c.header('X-SlowTune-Operation',operationId);
    desktopPlayback.response(c.res.status);
  };
  if(c.req.header('X-SlowTune-Surface')==='desktop'&&desktopSourcePath(c.req.path)){
    const priority=c.req.path==='/api/playback/prefetch'?0:c.req.path.includes('playback')||c.req.path.endsWith('/resolve')||c.req.path.endsWith('/prepare')||c.req.path.endsWith('/formats')?2:c.req.path.includes('search')?1:0;
    await desktopPlayback.run(owner,c.req.path,signal,proceed,priority);
  }else await proceed(signal);
};
app.use('/api/*',protectSession);
app.use('/v1/*',protectSession);
app.route('/api/song-library',createSongLibraryRouter(songLibrary,c=>getCookie(c,'music_session')??'',songLibrarySources,songMaintenance,songSync,songCatalog));
app.route('/api/lyrics',createLyricsRouter(lyricsStore,lyricProviders,c=>getCookie(c,'music_session')??''));
app.post('/api/logout', async c=>{await expireSession(getCookie(c,'music_session')??'');deleteCookie(c,'music_session',{path:'/'});return c.json({ok:true});});
// Logout should expire only this browser's identity; shared deliveries are released by its player.
app.get('/api/status', c=>c.json({version,brand,authenticationRequired:startupSettings.access().authenticationRequired,node:process.version,providers:{bilibili:{available:true},youtube:youtube.status()},sourceSettings:sourceState(),library:'sqlite',...diagnostics()}));
app.get('/api/settings/access',c=>c.json(startupSettings.access()));
app.post('/api/settings/access',async c=>{
  const input=await json(c.req.raw,4096);c.req.raw.signal.throwIfAborted();const failure=checkAccessAttempt(c,input?.currentAccessKey);
  if(failure)return c.json({error:{code:failure}},failure==='rate-limited'?429:400);
  const next=startupSettings.changeAccess(input),current=getCookie(c,'music_session')!;
  await Promise.allSettled([...sessions.keys()].filter(session=>session!==current).map(expireSession));
  return c.json(next);
});
app.get('/api/settings/welcome',c=>c.json(startupSettings.welcome()));
app.post('/api/settings/welcome',async c=>{const input=await json(c.req.raw,4*1024*1024+16384);c.req.raw.signal.throwIfAborted();return c.json(startupSettings.saveWelcome(input));});
app.get('/api/settings/welcome/export',c=>{c.header('Content-Disposition','attachment; filename="slowtune-welcome.json"');return c.json(startupSettings.exportWelcome());});
app.get('/api/settings/sources',c=>c.json(sourceState()));
app.get('/api/settings/search',c=>c.json(searchSettings.read()));
app.post('/api/settings/search',async c=>{
  const input=await json(c.req.raw,32768),signal=c.req.raw.signal;signal.throwIfAborted();
  if(!input||typeof input!=='object'||Array.isArray(input))throw new LibraryError('invalid-input');
  if(input.action==='config')return c.json(searchSettings.saveConfig(input.revision,input.config));
  if(input.action==='remove')return c.json(searchSettings.remove(input.revision,input.key));
  if(input.action!=='prefer')throw new LibraryError('invalid-input');
  const song=validateSong(input.song),state=searchSettings.read();
  if(input.revision!==state.revision)throw new LibraryError('conflict',state.revision);
  const entry=await counted.metadata(input.ref,{signal,...(input.ref?.provider==='bilibili'?accounts.options():{})});
  signal.throwIfAborted();return c.json(searchSettings.prefer(input.revision,song,entry));
});
app.post('/api/search',async c=>c.json(await musicSearch.search(await json(c.req.raw,8192),AbortSignal.any([c.req.raw.signal,searchStop.signal,AbortSignal.timeout(60000)]))));
app.post('/api/search/resolve',async c=>c.json({entry:await musicSearch.resolve(await json(c.req.raw,4096),AbortSignal.any([c.req.raw.signal,searchStop.signal,AbortSignal.timeout(60000)]))}));
app.post('/api/settings/sources',async c=>{
  const input=await json(c.req.raw,4096),previous=sourceSettings.youtube.enabled;
  c.req.raw.signal.throwIfAborted();
  sourceSettings=sourceSettingsStore.save(input);
  if(previous!==sourceSettings.youtube.enabled){
    youtube.setEnabled(sourceSettings.youtube.enabled);
    if(!sourceSettings.youtube.enabled){youtubeCandidates.cancelOwner();youtubeDiscovery.cancelOwner();batches.cancelProvider('youtube:');comments.cancelProvider('youtube');recommendations.invalidate(undefined,'youtube-music-selection');await delivery.releaseProvider('youtube');}
  }
  sourceChanged();return c.json(sourceState());
});
app.post('/api/settings/sources/youtube/check',async c=>{await json(c.req.raw,4096);c.req.raw.signal.throwIfAborted();youtube.assertEnabled();if(!youtube.status().checking)youtube.setEnabled(true,true);return c.json(sourceState());});
app.get('/api/settings/sources/events',c=>{
  const owner=getCookie(c,'music_session')!,streams=sourceStreams.get(owner)??new Set<()=>void>();
  if(streams.size>=8)return c.json({error:{code:'busy'}},429);
  return streamSSE(c,async stream=>{
    let finish!:()=>void;const done=new Promise<void>(resolve=>finish=resolve);
    const close=()=>{finish();};streams.add(close);sourceStreams.set(owner,streams);
    const send=()=>{void stream.writeSSE({event:'sources',data:JSON.stringify(sourceState())}).catch(close);};
    sourceListeners.add(send);stream.onAbort(close);
    const timer=setInterval(()=>{if((sessions.get(owner)?.expiresAt??0)<=Date.now())close();else void stream.writeSSE({event:'heartbeat',data:'{}'}).catch(close);},25000);
    try{send();await done;}finally{clearInterval(timer);sourceListeners.delete(send);streams.delete(close);if(!streams.size)sourceStreams.delete(owner);}
  });
});
app.get('/api/bilibili/account',async c=>c.json(await accounts.status(c.req.raw.signal)));
app.get('/api/comments',async c=>{if(c.req.query('provider')==='youtube'&&/^[\w-]{11}$/.test(c.req.query('id')??''))youtube.assertEnabled();return c.json(await comments.read({provider:c.req.query('provider'),id:c.req.query('id'),order:c.req.query('order'),parent:c.req.query('parent'),cursor:c.req.query('cursor')},getCookie(c,'music_session')!,c.req.raw.signal));});
app.all('/api/comments',c=>c.json({error:{code:'unsupported'}},405));
app.get('/api/follows',async c=>{
  const profiles=c.req.query('profiles'),refresh=c.req.query('refresh');
  if(profiles!==undefined&&!['0','1'].includes(profiles)||refresh!==undefined&&!['0','1'].includes(refresh))throw new LibraryError('invalid-input');
  return c.json(profiles==='1'?await follows.run(getCookie(c,'music_session')!,c.req.raw.signal,signal=>follows.readProfiles(signal,refresh==='1')):follows.store.read());
});
app.post('/api/creators/resolve',async c=>{const input=await json(c.req.raw,4096);return c.json(await follows.run(getCookie(c,'music_session')!,c.req.raw.signal,signal=>follows.resolve(input,signal)));});
app.post('/api/creators/search',async c=>{const input=await json(c.req.raw,4096);return c.json(await follows.run(getCookie(c,'music_session')!,c.req.raw.signal,signal=>follows.search(input,signal)));});
app.get('/api/creators/profile',async c=>{
  const refresh=c.req.query('refresh');if(refresh!==undefined&&!['0','1'].includes(refresh))throw new LibraryError('invalid-input');
  return c.json(await follows.run(getCookie(c,'music_session')!,c.req.raw.signal,signal=>follows.creator({provider:c.req.query('provider'),id:c.req.query('id')},signal,refresh==='1')));
});
app.post('/api/follows',async c=>{const input=await json(c.req.raw,4096);return c.json(await follows.run(getCookie(c,'music_session')!,c.req.raw.signal,signal=>follows.change(input,signal)));});
app.post('/api/follows/cancel',c=>{follows.cancelOwner(getCookie(c,'music_session')!);return c.json({ok:true});});
app.get('/api/follows/feed',async c=>{
  const refresh=c.req.query('refresh');if(refresh!==undefined&&!['0','1'].includes(refresh))throw new LibraryError('invalid-input');
  const paginated=['page','pageSize','snapshot'].some(key=>c.req.query(key)!==undefined);
  const pagination=paginated?{page:Number(c.req.query('page')??1),pageSize:Number(c.req.query('pageSize')??30),snapshot:c.req.query('snapshot')}:undefined;
  return c.json(await follows.run(getCookie(c,'music_session')!,c.req.raw.signal,signal=>follows.feed(getCookie(c,'music_session')!,signal,refresh==='1',c.req.query('cursor'),c.req.query('provider'),pagination)));
});
app.get('/api/follows/collections',async c=>c.json(await follows.run(getCookie(c,'music_session')!,c.req.raw.signal,signal=>follows.collections({provider:c.req.query('provider'),id:c.req.query('id')},getCookie(c,'music_session')!,signal,c.req.query('cursor')))));
app.get('/api/follows/videos',async c=>c.json(await follows.run(getCookie(c,'music_session')!,c.req.raw.signal,signal=>c.req.query('pageSize')!==undefined?follows.videoPage({provider:c.req.query('provider'),id:c.req.query('id')},undefined,signal,Number(c.req.query('page')??1),Number(c.req.query('pageSize'))):follows.videos({provider:c.req.query('provider'),id:c.req.query('id')},signal,c.req.query('cursor')))));
app.get('/api/follows/collection',async c=>c.json(await follows.run(getCookie(c,'music_session')!,c.req.raw.signal,signal=>c.req.query('pageSize')!==undefined?follows.videoPage({provider:c.req.query('provider'),id:c.req.query('id')},c.req.query('collection')??'',signal,Number(c.req.query('page')??1),Number(c.req.query('pageSize'))):follows.collectionVideos({provider:c.req.query('provider'),id:c.req.query('id')},c.req.query('collection')??'',signal,c.req.query('cursor')))));
app.get('/api/recommendation/settings',c=>c.json(recommendationStore.read(c.req.query('column')??'')));
app.post('/api/recommendation/settings',async c=>{const input=await json(c.req.raw,65536);const state=recommendations.save(getCookie(c,'music_session')!,input.column,input.expected,input.patch,c.req.raw.signal);recommendations.invalidate(undefined,input.column);if(input.column==='youtube-music-selection')youtubeCandidates.cancelOwner();else bilibiliProvider.cancelCandidates();return c.json(state);});
app.post('/api/recommendation/invalidate',c=>{const scope=getCookie(c,'music_session')!;batches.cancelOwner(scope,false);recommendations.invalidate(scope);bilibiliProvider.cancelCandidates(scope);youtubeCandidates.cancelOwner(scope);return c.json({ok:true});});
app.post('/api/recommendation/confirm',async c=>{const input=await json(c.req.raw,65536);return c.json(recommendations.confirm(getCookie(c,'music_session')!,input.column,input.token,input.ids));});
app.post('/api/recommendation/preview',async c=>{const input=await json(c.req.raw,65536);return c.json(recommendations.preview(getCookie(c,'music_session')!,input.column,input.overrides,c.req.raw.signal,input.absorbLegacy));});
app.get('/api/discovery/bilibili',async c=>{
 const refresh=c.req.query('refresh')??'0',surface=c.req.query('surface');if(!['0','1'].includes(refresh)||surface!==undefined&&surface!=='desktop')throw new LibraryError('invalid-input');
 const started=performance.now(),scope=getCookie(c,'music_session')!,result=await batches.read(surface==='desktop'?desktopBilibiliBatchKey:'bilibili',scope,c.req.raw.signal,refresh==='1'),coreStart=performance.now();
 return c.body(completeResponse([result.shelf],result.shelf,started,65000,coreStart,scope),200,{'Content-Type':'application/json'});
});
app.get('/api/youtube/music',async c=>{
  const region=c.req.query('region')??defaultYoutubeRegion, refresh=c.req.query('refresh')??'0';
  if(!isYoutubeRegion(region)||!['0','1'].includes(refresh))throw new MusicSourceError({code:'invalid-input',provider:'youtube',retryable:false});
  youtube.assertAvailable();
  const scope=getCookie(c,'music_session')!,shared=c.req.query('shared')==='1',started=performance.now();
  const signal=AbortSignal.any([c.req.raw.signal,youtube.signal]);
  if(!shared)return c.json(await youtubeDiscovery.read(region,scope,signal,refresh==='1'));
  browseCache.write('preferences','youtube-region',region,1);
  const result=await batches.read('youtube:'+region,scope,signal,refresh==='1'),selected={...result.extra,shelf:result.shelf};
  return c.body(completeResponse(selected,result.shelf,started,50000,performance.now(),scope),200,{'Content-Type':'application/json'});
});
app.get('/api/charts',async c=>c.json(await charts.read({source:c.req.query('source'),chart:c.req.query('chart'),period:c.req.query('period')},AbortSignal.any([c.req.raw.signal,AbortSignal.timeout(20000)]))));
app.all('/api/charts',c=>c.json({error:{code:'unsupported'}},405));
app.post('/api/bilibili/login',async c=>c.json(await accounts.begin(getCookie(c,'music_session')!,c.req.raw.signal)));
app.post('/api/bilibili/poll',async c=>{const input=await json(c.req.raw,4096);return c.json(await accounts.poll(getCookie(c,'music_session')!,input.id,c.req.raw.signal));});
app.post('/api/bilibili/cancel',async c=>{const input=await json(c.req.raw,4096);if(input.id===undefined)await accounts.cancelOwner(getCookie(c,'music_session')!);else await accounts.cancel(getCookie(c,'music_session')!,input.id,c.req.raw.signal);return c.json({ok:true});});
app.post('/api/bilibili/disconnect',async c=>c.json(await accounts.disconnect(c.req.raw.signal)));
let buildReported = false;
function reportBuild() {const state=buildState(build);if(state.stale&&!buildReported){buildReported=true;console.error(`磁盘上的构建比运行中的服务新（${state.changed.join('、')}）；重启服务后才会生效。`);}return state;}
function diagnostics(){return {sources:{disposed:api.diagnostics().disposed,pending:api.diagnostics().pending+(youtube.api?.diagnostics().pending??0)},delivery:delivery.diagnostics(),tool:youtube.diagnostics(),youtubeDiscovery:youtubeDiscovery.diagnostics(),recommendations:recommendations.diagnostics(),discoveryBatches:batches.diagnostics(),recommendationResponse:lastRecommendationResponse,youtubeCandidates:youtubeCandidates.diagnostics(),bilibiliCandidates:bilibiliProvider.candidateDiagnostics(),desktopPlayback:desktopPlayback.diagnostics(),build:reportBuild(),process:{rss:process.memoryUsage().rss,peakRSS:process.resourceUsage().maxRSS*1024},metrics};}
app.post('/api/identify',async c=>{const input=await json(c.req.raw,4096);const ref=identify(input.input);if(ref.provider==='youtube')youtube.assertAvailable();if(ref.kind==='playlist')return c.json({ref});const canonical=await normalizeMusicInput(counted,input.input,{signal:c.req.raw.signal});const entry=await counted.metadata(canonical,{signal:c.req.raw.signal});return c.json({entry,parts:entry.parts});});
app.post('/api/playback/prefetch',async c=>{
  if(!desktopPlayback.current)throw new MusicSourceError({code:'unsupported',retryable:false});
  const input=await json(c.req.raw,4096);
  if(typeof input.discard==='string'){desktopPlayback.discard(input.discard);return c.json({ok:true});}
  const support=validateAudioSupport(input.audioSupport);if(!support)throw new LibraryError('invalid-input');
  const playback=await desktopPlayback.prepare(counted,{ref:input.ref,media:'audio'},{...(input.ref?.provider==='bilibili'?accounts.options():{}),signal:c.req.raw.signal},support);
  const preparationToken=(playback.delivery.expiresAt??Infinity)>Date.now()+12000?desktopPlayback.verified(playback):undefined;
  return c.json({entry:{...playback.entry,...(preparationToken?{verifiedAudio:{ref:playback.entry.ref,format:playback.format,preparationToken}}:{})}});
});
app.all('/v1/*',c=> {
  if(c.req.path.startsWith('/v1/call/') && !['metadata','discover','search','list','prepare','formats','shelf'].includes(c.req.path.split('/').at(-1)!)) return c.json({protocol:2,error:{code:'unsupported',retryable:false}},400);
  const sourceApi=desktopPlayback.current?new Proxy(counted,{get(target,property){
    if(property==='capabilities')return (provider:import('@studio/music-sources').ProviderId)=>{const capabilities=target.capabilities(provider);return {...capabilities,operations:[...capabilities.operations,desktopAudioCapability]};};
    if(property==='prepare'&&c.req.header('X-SlowTune-Audio-Support')!==undefined)return (input:Parameters<MusicApi['prepare']>[0],options:import('@studio/music-sources').CallOptions)=>{
      let support;try{support=validateAudioSupport(JSON.parse(c.req.header('X-SlowTune-Audio-Support')!));}catch{throw new MusicSourceError({code:'invalid-input',retryable:false});}
      const token=c.req.header('X-SlowTune-Preparation');
      if(!support||token!==undefined&&!/^[\w-]{32}$/.test(token))throw new MusicSourceError({code:'invalid-input',retryable:false});
      return desktopPlayback.prepare(target,input,options,support,token);
    };
    const value=Reflect.get(target,property);return typeof value==='function'?value.bind(target):value;
  }}):counted;
  return createMusicService(sourceApi,delivery,{baseUrl:new URL(c.req.url).origin,providers:youtube.status().available?['bilibili','youtube']:['bilibili'],context:async(request,provider)=>{if(provider==='youtube'&&request.method!=='DELETE')youtube.assertAvailable();return playbackContext(request,provider,accounts,delivery);}}).fetch(c.req.raw);
});
app.post('/internal/desktop-session',c=>{
  if(!desktopOwned||!['127.0.0.1','::1'].includes(config.host)||!same(c.req.header('X-Control-Key')??'',adminKey))return c.body(null,403);
  return issueSession(c);
});
app.post('/internal/stop',c=>{if(!same(c.req.header('X-Control-Key')??'',adminKey))return c.body(null,403);setTimeout(()=>void shutdown(),100);return c.json({stopping:true});});
app.get('/internal/diagnose',c=>{if(!same(c.req.header('X-Control-Key')??'',adminKey))return c.body(null,403);return c.json(diagnostics());});
app.onError((e,c)=>{
  const code=c.req.raw.signal.aborted&&c.req.raw.signal.reason?.name==='TimeoutError'?'timeout':e instanceof MusicSearchError?e.code:e instanceof StartupError?e.code:e instanceof MusicSourceError&&e.upstreamCode==='folder-create-uncertain'?'bilibili-folder-create-uncertain':e instanceof RecommendationError?e.code==='invalid-config'?'invalid-input':e.code==='stale'?'conflict':e.code:e instanceof LibraryError||e instanceof MusicSourceError?e.code:c.req.raw.signal.aborted?'cancelled':'storage';
  return c.json({error:{code,provider:e instanceof MusicSourceError?e.provider:undefined,upstreamCode:e instanceof MusicSourceError?e.upstreamCode:undefined,currentRevision:e instanceof LibraryError?e.currentRevision:undefined}},code==='conflict'?409:code==='authentication'?401:code==='expired'?410:['busy','rate-limited'].includes(code)?429:code==='restricted'?403:e instanceof StartupError||e instanceof MusicSearchError||['invalid-input','unknown-version','duplicate','not-found'].includes(code)?400:code==='cancelled'?408:503);
});
app.all('/api/*',c=>c.json({error:{code:'not-found'}},404));
app.use('/*',serveStatic({root:join(root,'dist/client')}));
app.get('*',serveStatic({root:join(root,'dist/client'),path:'index.html'}));
const stateFile=join(config.runtimeDirectory,'service.json');
youtube.setEnabled(sourceSettings.youtube.enabled);
const server=serve({fetch:app.fetch,hostname:config.host,port:config.port}, info=>{writeFileSync(stateFile,JSON.stringify({pid:process.pid,port:config.port,key:adminKey}),{mode:0o600});console.log(`慢听已启动 http://localhost:${info.port} · 正式构建 · ${sourceSettings.youtube.enabled?'YouTube 已开启':'YouTube 已关闭'}`);});
const recentRegion=browseCache.read<string>('preferences','youtube-region');
songSync.start();
const warmRegions=[...new Set([defaultYoutubeRegion,...(isYoutubeRegion(recentRegion)?[recentRegion]:[])])];
const chartInputs=[{source:'netease',chart:'hot'},{source:'netease',chart:'new'},{source:'netease',chart:'rising'},{source:'qq',chart:'hot'},{source:'bilibili',chart:'hot',period:'latest'},{source:'apple',chart:'most-played'}];
batches.start([()=>batches.warm('bilibili'),...chartInputs.map(input=>()=>charts.read(input,AbortSignal.any([batches.signal,AbortSignal.timeout(20000)])))]);
let warmedYoutube=false;
sourceListeners.add(()=>{if(!youtube.status().available){warmedYoutube=false;return;}if(warmedYoutube)return;warmedYoutube=true;for(const region of warmRegions)void batches.warm('youtube:'+region).catch(()=>{});});
server.on('error',async e=>{console.error('服务监听失败', (e as NodeJS.ErrnoException).code);await expireSessions();await songSync.dispose();await lyricProviders.dispose();await songCatalog.dispose();searchStop.abort();desktopPlayback.dispose();musicSearch.dispose();await searchCatalogue.dispose();await batches.dispose();await charts.dispose();await comments.dispose();await follows.dispose();await youtubeCandidates.dispose();await youtubeDiscovery.dispose();await delivery.dispose();await api.dispose();browseCache.close();recommendationStore.close();startupSettings.close();sourceSettingsStore.close();searchSettings.close();lyricsStore.close();await songLibraryStore.close();process.exitCode=1;});
async function shutdown(reason = 'control') {
  if(stopping)return;stopping=true;
  if(desktopOwned)console.log(`${new Date().toISOString()} 正在停止桌面服务：${reason}`);
  await expireSessions();await songSync.dispose();await lyricProviders.dispose();await songCatalog.dispose();searchStop.abort();desktopPlayback.dispose();musicSearch.dispose();await searchCatalogue.dispose();
  closeSourceStreams();await youtube.dispose();
  const closing=new Promise<void>(resolve=>server.close(()=>resolve()));
  (server as import('node:http').Server).closeIdleConnections();
 await batches.dispose();recommendations.invalidate(); await charts.dispose(); await comments.dispose(); await follows.dispose(); await youtubeCandidates.dispose(); await youtubeDiscovery.dispose(); await delivery.dispose(); await api.dispose();
  // No work can commit or publish now. Node's idle-only close leaves unfinished
  // HTTP requests (and abandoned keep-alive sockets) holding desktop quit open.
  if(desktopOwned)(server as import('node:http').Server).closeAllConnections();
  await closing; browseCache.close();recommendationStore.close();startupSettings.close();sourceSettingsStore.close();searchSettings.close();lyricsStore.close();await songLibraryStore.close();
  writeFileSync(join(config.runtimeDirectory,'last-shutdown.json'),JSON.stringify({date:new Date().toISOString(),...diagnostics()}));
  // A successor may already be serving and have written its own state file during this shutdown.
  try{if(JSON.parse(readFileSync(stateFile,'utf8')).pid===process.pid)unlinkSync(stateFile);}catch{}
  console.log('停止完成：租约、读取、工具与数据库已释放。');
}
process.on('SIGINT',()=>void shutdown('SIGINT'));process.on('SIGTERM',()=>void shutdown('SIGTERM'));
