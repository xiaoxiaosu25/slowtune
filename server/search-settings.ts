import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { SongLibraryError as LibraryError } from './song-library-errors.js';
import { validateRef, type MusicEntry } from '@studio/music-sources';
import { defaultSearchConfig, searchDefaultsVersion, partitionLabels, versionTerms, songKey, type SearchConfig, type SearchSettings, type SongQuery, type SongSearchMode } from './search-policy.js';

const object=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value);
export function validateSongSearchMode(value:unknown):SongSearchMode {
  if(value===undefined)return 'title';
  if(value!=='title'&&value!=='title-artists')throw new LibraryError('invalid-input');
  return value;
}
export function validateAudioSupport(value:unknown):string[]|undefined {
  if(value===undefined)return undefined;
  if(!Array.isArray(value)||value.length>32||value.some(type=>typeof type!=='string'||type.length>128||!/^audio\/[a-z0-9.+-]+; codecs="[a-z0-9.+-]+"$/i.test(type)))throw new LibraryError('invalid-input');
  return [...new Set(value as string[])].sort();
}
export function validateSongSearch(value:unknown):{song:SongQuery;searchMode:SongSearchMode;audioSupport?:string[]} {
  if(!object(value))throw new LibraryError('invalid-input');
  const {searchMode,audioSupport,...song}=value;
  return {song:validateSong(song),searchMode:validateSongSearchMode(searchMode),audioSupport:validateAudioSupport(audioSupport)};
}
export function validateSong(value:unknown):SongQuery {
  if(!object(value)||Object.keys(value).some(key=>!['title','artists','durationSeconds'].includes(key))||typeof value.title!=='string'||!value.title.trim()||value.title.length>512)throw new LibraryError('invalid-input');
  if(value.durationSeconds!==undefined&&(typeof value.durationSeconds!=='number'||!Number.isFinite(value.durationSeconds)||value.durationSeconds<=0||value.durationSeconds>86400))throw new LibraryError('invalid-input');
  if(value.artists!==undefined&&(!Array.isArray(value.artists)||value.artists.length>20||value.artists.some(v=>typeof v!=='string'||!v.trim()||v.length>200)))throw new LibraryError('invalid-input');
  const song={title:value.title.trim(),...(Array.isArray(value.artists)&&value.artists.length?{artists:value.artists.map(v=>(v as string).trim())}:{}),...(typeof value.durationSeconds==='number'?{durationSeconds:value.durationSeconds}:{})};
  if(!JSON.parse(songKey(song))[0])throw new LibraryError('invalid-input');
  return song;
}
export function validateSearchConfig(value:unknown):SearchConfig {
  if(!object(value)||Object.keys(value).sort().join(',')!=='excludeTerms,filterByDefault,partitions,strictMatch,versions'||typeof value.filterByDefault!=='boolean'||typeof value.strictMatch!=='boolean')throw new LibraryError('invalid-input');
  for(const [field,labels] of [['partitions',partitionLabels],['versions',versionTerms]] as const){
    const rules=value[field];
    if(!object(rules)||Object.keys(rules).sort().join(',')!==Object.keys(labels).sort().join(',')||Object.values(rules).some(rule=>!['allow','requested','manual'].includes(String(rule))))throw new LibraryError('invalid-input');
  }
  if(!Array.isArray(value.excludeTerms)||value.excludeTerms.length>50||value.excludeTerms.some(v=>typeof v!=='string'||!v.trim()||v.length>100))throw new LibraryError('invalid-input');
  return structuredClone(value) as unknown as SearchConfig;
}
export class SearchSettingsStore {
  private db:DatabaseSync;
  constructor(path:string,private user:string){
    this.db=new DatabaseSync(path);
    this.db.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=1000; CREATE TABLE IF NOT EXISTS search_settings(user TEXT PRIMARY KEY,revision TEXT,value TEXT);');
  }
  read():SearchSettings {
    const row=this.db.prepare('SELECT revision,value FROM search_settings WHERE user=?').get(this.user);
    const saved=row?JSON.parse(String(row.value)):{defaultsVersion:searchDefaultsVersion,config:defaultSearchConfig(),preferred:[]};
    return {...saved,revision:row?String(row.revision):'initial',defaults:{version:searchDefaultsVersion,config:defaultSearchConfig()}};
  }
  private update(revision:unknown,edit:(state:SearchSettings)=>void):SearchSettings {
    if(typeof revision!=='string')throw new LibraryError('invalid-input');
    this.db.exec('BEGIN IMMEDIATE');
    try{
      const state=this.read();if(state.revision!==revision)throw new LibraryError('conflict',state.revision);
      edit(state);
      this.db.prepare('INSERT OR REPLACE INTO search_settings VALUES(?,?,?)').run(this.user,randomUUID(),JSON.stringify({defaultsVersion:state.defaultsVersion,config:state.config,preferred:state.preferred}));
      this.db.exec('COMMIT');return this.read();
    }catch(error){this.db.exec('ROLLBACK');throw error;}
  }
  saveConfig(revision:unknown,value:unknown){
    const config=validateSearchConfig(value);
    return this.update(revision,state=>{state.config=config;state.defaultsVersion=searchDefaultsVersion;});
  }
  prefer(revision:unknown,input:unknown,entry:MusicEntry){
    const song=validateSong(input);validateRef(entry.ref);if(entry.ref.kind!=='video')throw new LibraryError('invalid-input');
    // Persist neutral catalogue facts and exact stable references, never leases or media URLs.
    const saved:MusicEntry={ref:{...entry.ref},resourceId:entry.resourceId,title:entry.title,url:entry.url,...(entry.uploader?{uploader:entry.uploader}:{}),...(entry.artists?{artists:entry.artists}:{}),...(entry.artwork?{artwork:entry.artwork}:{}),...(entry.durationSeconds!==undefined?{durationSeconds:entry.durationSeconds}:{})};
    return this.update(revision,state=>{
      const key=songKey(song),previous=state.preferred.findIndex(item=>item.key===key);
      if(previous<0&&state.preferred.length>=500)throw new LibraryError('invalid-input');
      const preferred={key,song,entry:saved,updatedAt:Date.now()};
      if(previous<0)state.preferred.push(preferred);else state.preferred[previous]=preferred;
    });
  }
  remove(revision:unknown,key:unknown){
    if(typeof key!=='string'||key.length>8192)throw new LibraryError('invalid-input');
    return this.update(revision,state=>{state.preferred=state.preferred.filter(item=>item.key!==key);});
  }
  close(){this.db.close();}
}
