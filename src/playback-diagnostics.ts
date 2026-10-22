import { desktopSurface } from './song-search';

interface PlaybackDiagnostic {operation:string;code:string;at:number;elapsedMs?:number;serverOperation?:string}
const events:PlaybackDiagnostic[]=[];
/** Session-only, bounded diagnostics. Never retain media URLs or track identities. */
export function recordPlaybackDiagnostic(event:PlaybackDiagnostic){
  if(!desktopSurface())return;
  events.push(event);if(events.length>120)events.shift();
}
export function playbackDiagnostics(){return events.map(event=>({...event}));}
export function observeSourceRequest(path:string,response:Response,start:number){
  recordPlaybackDiagnostic({operation:path.split('?')[0],code:response.ok?'complete':'failure',at:Date.now(),elapsedMs:performance.now()-start,...(response.headers.get('X-SlowTune-Operation')?{serverOperation:response.headers.get('X-SlowTune-Operation')!}:{})});
}
