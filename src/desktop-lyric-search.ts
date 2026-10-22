import { ApiError } from './api';
import type { LyricSearch } from '../server/lyrics-types';

/** Desktop manual lookup: each frame is a complete snapshot, never an automatic choice. */
export async function desktopLyricSearch(input:unknown,signal:AbortSignal,progress:(value:LyricSearch)=>void):Promise<void>{
  const budget=AbortSignal.any([signal,AbortSignal.timeout(22000)]);
  const response=await fetch('/api/lyrics/search-progress',{method:'POST',headers:{'Content-Type':'application/json','X-Music-App':'1','X-SlowTune-Surface':'desktop'},body:JSON.stringify(input),signal:budget}).catch(error=>{if(budget.aborted&&!signal.aborted)throw new ApiError('timeout');if(signal.aborted)throw error;throw new ApiError('network');});
  if(!response.ok){const value=await response.json();if(response.status===401)window.dispatchEvent(new Event('slowtune:session-expired'));throw new ApiError(value.error?.code??'network');}
  if(!response.headers.get('Content-Type')?.includes('application/x-ndjson')||!response.body)throw new ApiError('version-mismatch');
  const reader=response.body.getReader(),decoder=new TextDecoder();let pending='',bytes=0,complete=false;
  try{
    for(;;){
      const chunk=await reader.read();budget.throwIfAborted();if(chunk.done)break;
      bytes+=chunk.value.length;if(bytes>1024*1024)throw new ApiError('upstream');
      pending+=decoder.decode(chunk.value,{stream:true});
      let end:number;
      while((end=pending.indexOf('\n'))>=0){
        const row=JSON.parse(pending.slice(0,end));pending=pending.slice(end+1);
        if(row.error)throw new ApiError(row.error.code);
        if(!Array.isArray(row.candidates)||!Array.isArray(row.issues))throw new ApiError('upstream');
        complete=row.complete===true;progress(row);
      }
    }
    if(!complete||pending.trim())throw new ApiError('upstream');
  }catch(error){if(budget.aborted&&!signal.aborted)throw new ApiError('timeout');if(signal.aborted||error instanceof ApiError)throw error;throw new ApiError(error instanceof SyntaxError?'upstream':'network');}
  finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
}
