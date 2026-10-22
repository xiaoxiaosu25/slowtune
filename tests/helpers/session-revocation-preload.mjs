import { MusicSources } from '@studio/music-sources';
import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const original=MusicSources.prototype.metadata;
MusicSources.prototype.metadata=function(ref,options){
  const directory=process.env.MUSIC_APP_REVOCATION_FIXTURE;
  if(!directory||ref.id!=='BV1tX4y1W7Xm')return original.call(this,ref,options);
  writeFileSync(join(directory,'metadata-started'),'started');
  // Deliberately ignore cancellation until the fixture releases the source:
  // a late upstream result must still be rejected before the library commit.
  return new Promise(resolve=>{const timer=setInterval(()=>{
    if(!existsSync(join(directory,'metadata-release')))return;
    clearInterval(timer);writeFileSync(join(directory,'metadata-aborted'),String(options.signal.aborted));
    resolve({ref:{...ref,part:'900'},resourceId:'late-metadata',title:'Late metadata',url:'https://www.bilibili.com/video/'+ref.id});
  },5);});
};
