import {test} from 'node:test';
import assert from 'node:assert/strict';
import {setTimeout as delay} from 'node:timers/promises';
import {loadSongModule} from './helpers/song-services.mjs';
const {PlaybackDelivery}=await loadSongModule('playback-delivery');
const ref={provider:'bilibili',kind:'video',id:'BV0000000001',part:'1'},playback={entry:{ref,title:'fixture',url:'https://www.bilibili.com/video/'+ref.id},resourceId:'fixture',format:{id:'aac',codec:'aac',container:'mp4',mimeType:'audio/mp4'},delivery:{url:'https://x.bilivideo.com/audio',requiresHost:true}};
test('only desktop-issued leases use progress-based read policy; both paths release every resource',async t=>{
  let cancelled=0,desktop=true;
  const delivery=new PlaybackDelivery({now:Date.now,fetch:async()=>{let count=0;return new Response(new ReadableStream({async pull(c){await delay(15);if(count++<6)c.enqueue(new Uint8Array([1]));else c.close();},cancel(){cancelled++;}}),{status:206,headers:{'Content-Range':'bytes 0-5/6','Content-Length':'6'}});}},{readTimeoutMs:45});
  delivery.desktopContext=()=>desktop;delivery.desktopReadTimeouts={connectMs:80,firstByteMs:80,idleMs:80};t.after(()=>delivery.dispose());
  const first=await delivery.publish(playback,'http://localhost');desktop=false;const mobile=await delivery.publish(playback,'http://localhost');
  const read=async lease=>(await delivery.read(lease.leaseId,new Request(lease.delivery.url,{headers:{Range:'bytes=0-5'}}))).arrayBuffer();
  assert.equal((await read(first)).byteLength,6);await assert.rejects(read(mobile),{code:'timeout'});
  await delivery.release(first.leaseId);await delivery.release(mobile.leaseId);assert.equal(delivery.diagnostics().leases,0);assert.equal(delivery.diagnostics().activeReads,0);assert.equal(cancelled,1);
});
