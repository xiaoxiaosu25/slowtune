import {MusicSourceError,type AudioFormat} from '@studio/music-sources';
import {bestAudioFormat,type AudioFormatSelector} from '@studio/music-sources/audio';

export type AudioPreference='auto'|'compatible'|'economy';
export interface AudioSelection {readonly preference:AudioPreference;readonly formatId?:string}
export const audioPreferences={auto:'自动（无损优先）',compatible:'兼容优先',economy:'省流量'} as const;
export const defaultAudioSelection:AudioSelection=Object.freeze({preference:'auto'});
export function audioSelection(value:unknown=defaultAudioSelection):AudioSelection{
  if(!value||typeof value!=='object'||Array.isArray(value))throw new MusicSourceError({code:'invalid-input',retryable:false});
  const row=value as Record<string,unknown>;
  if(Object.keys(row).some(key=>!['preference','formatId'].includes(key))||typeof row.preference!=='string'||!Object.hasOwn(audioPreferences,row.preference)||row.formatId!==undefined&&(typeof row.formatId!=='string'||!row.formatId||row.formatId.length>200))throw new MusicSourceError({code:'invalid-input',retryable:false});
  return Object.freeze({preference:row.preference as AudioPreference,...(typeof row.formatId==='string'?{formatId:row.formatId}:{})});
}
export const sameAudioSelection=(left:AudioSelection|undefined,right:AudioSelection|undefined)=>(left?.preference??'auto')===(right?.preference??'auto')&&left?.formatId===right?.formatId;
const family=(format:AudioFormat)=>/^mp4a/i.test(format.codec)?'aac':format.codec.toLowerCase().split('.')[0];
/** Rank codec families first; compare economy bitrate only inside one family. */
export function audioSelector(selection:AudioSelection):AudioFormatSelector|undefined{
  if(selection.preference==='auto'&&!selection.formatId)return undefined;
  return formats=>{
    if(selection.formatId)return formats.find(format=>format.id===selection.formatId)?.id;
    const priority=['aac','opus','mp3','vorbis','pcm','flac','alac','ec-3','ac-3'];
    const available=[...new Set(formats.map(family))].sort((a,b)=>(priority.includes(a)?priority.indexOf(a):100)-(priority.includes(b)?priority.indexOf(b):100)||a.localeCompare(b));
    const candidates=formats.filter(format=>family(format)===available[0]);
    if(selection.preference==='economy')return [...candidates].sort((a,b)=>(a.bitrate??Infinity)-(b.bitrate??Infinity)||a.id.localeCompare(b.id))[0]?.id;
    return bestAudioFormat(candidates,()=>true)?.id;
  };
}
