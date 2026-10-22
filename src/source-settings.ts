import { MusicClient } from '@studio/music-sources/client';
import type { SourceSettingsState } from '../server/source-settings-types';
export type { SourceSettingsState, DisabledDisplay } from '../server/source-settings-types';

const refreshers = new WeakMap<MusicClient,()=>Promise<void>>();
/** Stable identity keeps the live B站 player intact when handshake capabilities change. */
export function refreshableClient(initial:MusicClient,connect:()=>Promise<MusicClient>):MusicClient {
  let current=initial,pending:Promise<void>|undefined;
  const clients=new Set([initial]);
  const refresh=()=>pending??(pending=connect().then(next=>{clients.add(next);current=next;}).finally(()=>{pending=undefined;}));
  const proxy=new Proxy(initial,{get(_target,key){
    if(key==='dispose')return ()=>{for(const client of clients)client.dispose();};
    if(key==='formats'||key==='prepare')return async(...args:unknown[])=>{if(pending)await pending;return (Reflect.get(current,key) as Function).apply(current,args);};
    if(key==='metadata')return async(...args:unknown[])=>{if((args[0] as {provider?:string})?.provider==='youtube'&&pending)await pending;return (Reflect.get(current,key) as Function).apply(current,args);};
    const value=Reflect.get(current,key);return typeof value==='function'?value.bind(current):value;
  }});
  refreshers.set(proxy,refresh);return proxy;
}
export async function refreshSourceCapabilities(client:MusicClient){await refreshers.get(client)?.();}
export const initialSourceSettings:SourceSettingsState={revision:'initial',youtube:{enabled:false,disabledDisplay:'dim',available:false,checking:false}};
