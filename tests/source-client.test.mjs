import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { resolve } from 'node:path';

const output=await build({stdin:{contents:"export {connectSourceClient} from './src/source-client.ts';",resolveDir:resolve('.')},bundle:true,platform:'node',format:'esm',write:false});
const {connectSourceClient}=await import('data:text/javascript;base64,'+Buffer.from(output.outputFiles[0].text).toString('base64'));
const handshake=()=>Response.json({protocol:2,capabilities:[{provider:'bilibili',operations:['metadata','search','prepare'],anonymous:true,limitations:[]}]});
const track={ref:{provider:'bilibili',kind:'video',id:'BV1tX4y1W7Xm'},resourceId:'slow-source',title:'Slow source',url:'https://www.bilibili.com/video/BV1tX4y1W7Xm'};
const prepared={entry:track,resourceId:track.resourceId,format:{codec:'aac',mimeType:'audio/mp4',container:'m4a'},delivery:{url:'http://fixture/media',requiresHost:false}};

function controlledNetwork() {
  const originalFetch=globalThis.fetch,originalTimeout=AbortSignal.timeout,deadlines=[],calls=[];
  AbortSignal.timeout=ms=>{const controller=new AbortController();deadlines.push({ms,controller});return controller.signal;};
  globalThis.fetch=(url,options)=>{
    assert.equal(new Headers(options.headers).get('X-Music-App'),'1');
    if(new URL(url).pathname==='/v1/handshake')return Promise.resolve(handshake());
    return new Promise((resolve,reject)=>{
      const abort=()=>reject(options.signal.reason);
      options.signal.addEventListener('abort',abort,{once:true});
      calls.push({signal:options.signal,finish:result=>{options.signal.removeEventListener('abort',abort);resolve(Response.json({protocol:2,result}));}});
    });
  };
  return {deadlines,calls,restore:()=>{globalThis.fetch=originalFetch;AbortSignal.timeout=originalTimeout;}};
}

test('the handshake deadline does not truncate a later preparation or search',async()=>{
  const network=controlledNetwork(),lifetime=new AbortController();
  try {
    const client=await connectSourceClient('http://fixture',lifetime.signal);
    const preparation=client.prepare({ref:track.ref}),search=client.search('bilibili',{query:'music',mode:'video',limit:20});
    assert.deepEqual(network.deadlines.map(value=>value.ms),[10000],'only the handshake creates a short deadline');
    // Advance beyond the handshake budget while business requests are still pending.
    for(const {controller}of network.deadlines)controller.abort(new DOMException('Timed out','TimeoutError'));
    assert(network.calls.every(call=>!call.signal.aborted));
    network.calls[0].finish(prepared);network.calls[1].finish({items:[track]});
    assert.deepEqual(await preparation,prepared);assert.deepEqual((await search).items,[track]);
    client.dispose();
  }finally{lifetime.abort();network.restore();}
});

test('source requests still stop on per-call cancellation and on leaving the workspace',async()=>{
  const network=controlledNetwork(),lifetime=new AbortController();
  try {
    const client=await connectSourceClient('http://fixture',lifetime.signal),operation=new AbortController();
    const metadata=client.metadata(track.ref,{signal:operation.signal});operation.abort();
    await assert.rejects(metadata,{code:'cancelled'});assert(!lifetime.signal.aborted);
    const preparation=client.prepare({ref:track.ref});lifetime.abort();client.dispose();
    await assert.rejects(preparation,{code:'cancelled'});assert(network.calls.every(call=>call.signal.aborted));
  }finally{lifetime.abort();network.restore();}
});

test('a stalled handshake still times out',async()=>{
  const network=controlledNetwork(),lifetime=new AbortController();
  try {
    globalThis.fetch=(_url,options)=>new Promise((_resolve,reject)=>options.signal.addEventListener('abort',()=>reject(options.signal.reason),{once:true}));
    const connecting=connectSourceClient('http://fixture',lifetime.signal);
    network.deadlines[0].controller.abort(new DOMException('Timed out','TimeoutError'));
    await assert.rejects(connecting,{name:'TimeoutError'});
  }finally{lifetime.abort();network.restore();}
});
