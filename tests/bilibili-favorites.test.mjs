import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bv, loadSongModule } from './helpers/song-services.mjs';
const { BilibiliFavorites } = await loadSongModule('bilibili-favorites');
test('B站 transport checks ownership, bounded complete pagination, cookie/CSRF and account generations', async () => {
  let revision='rev',mode='normal',expired=false;const calls=[];
  const credentials={ref:'bilibili:test',get revision(){return revision;},read:async()=>({revision,cookie:'SESSDATA=secret; bili_jct=csrf-secret'})};
  const accounts={status:async()=>({state:'authenticated',account:{id:'123'}}),expire:async()=>{expired=true;}};
  const source=new BilibiliFavorites({fetch:async(input,options)=>{
    const url=new URL(input);calls.push({url,options});
    if(mode==='auth')return Response.json({code:-101});
    if(url.pathname.endsWith('list-all'))return Response.json({code:0,data:{count:1,list:[{id:10,mid:123,title:'私密歌单',attr:1,media_count:21}]}});
    if(url.pathname.endsWith('resource/list')) {
      const page=Number(url.searchParams.get('pn'));return Response.json({code:0,data:{info:{id:10,upper:{mid:mode==='owner'?456:123},media_count:mode==='incomplete'?22:21},has_more:page===1,medias:Array.from({length:page===1?20:1},(_,i)=>({type:2,bvid:bv(page===1?i+1:mode==='duplicate'?1:21),id:page===1?i+1:21}))}});
    }
    if(url.pathname.endsWith('resource/deal'))return Response.json({code:0,data:{prompt:true}});
    if(url.pathname.endsWith('folder/add')){const body=new URLSearchParams(options.body);return Response.json({code:0,data:{id:20,mid:123,title:body.get('title'),media_count:0,attr:body.get('privacy')==='1'?7:6}});}
    throw new Error('Unexpected URL');
  }},accounts,credentials);
  const c=await source.context(new AbortController().signal);assert.equal((await source.folders(c))[0].private,true);assert.equal((await source.videos('10',c)).length,21);
  await source.change('10','1',true,c);const write=calls.at(-1);assert.equal(write.options.method,'POST');assert.equal(write.options.redirect,'error');assert.equal(new URLSearchParams(write.options.body).get('csrf'),'csrf-secret');assert.equal(new URLSearchParams(write.options.body).get('add_media_ids'),'10');assert.equal(write.options.headers.Cookie,'SESSDATA=secret; bili_jct=csrf-secret');
  const created=await source.createFolder('新收藏夹',true,c);assert(created.private);assert.equal(new URLSearchParams(calls.at(-1).options.body).get('privacy'),'1');
  mode='owner';await assert.rejects(source.videos('10',c),{code:'upstream'});mode='incomplete';await assert.rejects(source.videos('10',c),{code:'upstream'});mode='duplicate';await assert.rejects(source.videos('10',c),{code:'upstream'});
  mode='auth';await assert.rejects(source.folders(c),{code:'authentication'});assert(expired);revision='replacement';await assert.rejects(source.folders(c),{code:'cancelled'});
});
