import { createPlayingArtworkFixture } from './playing-artwork-fixture.mjs';
import { seedSongs } from './song-fixture.mjs';

/** Long, synthetic browsing data with real in-memory library writes and controlled audio. */
export async function createMobileSecondaryFixture({withYoutube=false}={}) {
  const longTitle='晚风经过海岸线 · 一段很长的现场录音与完整歌曲标题 Live at the Evening Coast';
  const creators=Array.from({length:45},(_,i)=>({provider:'bilibili',id:String(101+i),name:i?'散步的音乐人 '+(i+1):'把晚风和沿途的故事唱给你听的音乐人',url:'https://space.bilibili.com/'+(101+i),followedAt:1}));
  const collections=Array.from({length:42},(_,i)=>({id:'season:101:'+i,kind:'season',title:(i?'散步歌单 '+(i+1):longTitle)+' · 合集',url:'https://space.bilibili.com/101',count:65}));
  let fixture,failWrite=false,failMetadata=false,failPrepare=false,metadataDelay=0;
  const reads=[],writes=[];
  const paginate=(items,url)=>{const page=Number(url.searchParams.get('page')??1),pageSize=Number(url.searchParams.get('pageSize')??30);return {items:items.slice((page-1)*pageSize,page*pageSize),page,pageSize,total:items.length};};
  fixture=await createPlayingArtworkFixture({preview:true,
    librarySeed:tracks=>{
      tracks[0].title=longTitle;tracks[0].artists=['晚风演示'];tracks[0].uploader={id:'101',name:creators[0].name};tracks[0].artwork=undefined;
      const seed=seedSongs({favorites:[{ref:tracks[0].ref,metadata:tracks[0]}]});
      const alternate=seedSongs({favorites:[{ref:tracks[1].ref,metadata:tracks[1]}]}).versions[0];
      seed.versions.push({...alternate,id:'version-live',songId:seed.songs[0].id,label:'海边现场特别收录 · '+longTitle});
      seed.versions[0].label='录音室原版';return seed;
    },
    beforeWrite:(path,body)=>{writes.push({path,body});return failWrite?{code:'storage',status:503}:undefined;},
    handleRequest:async({request,response,url,json})=>{
      if(url.pathname==='/api/follows') {json({revision:'authors-1',creators});return true;}
      if(url.pathname==='/api/follows/collections') {json({items:collections});return true;}
      if(url.pathname==='/api/creators/profile') {json(creators.find(c=>c.id===url.searchParams.get('id'))??creators[0]);return true;}
      if(url.pathname==='/api/creators/resolve') {for await(const _ of request){}json(creators[0]);return true;}
      if(['/api/follows/videos','/api/follows/collection','/api/follows/feed'].includes(url.pathname)) {
        reads.push(url.pathname+url.search);const items=Array.from({length:65},(_,i)=>({...fixture.tracks[i%2],resourceId:'secondary-'+i,title:i?'晚风里的第 '+(i+1)+' 首':longTitle,uploader:{id:'101',name:creators[0].name},publishedAt:1}));
        json({...paginate(items,url),warnings:[],snapshot:'feed-1'});return true;
      }
      if(url.pathname==='/api/charts') {const source=url.searchParams.get('source')??'netease',chart=url.searchParams.get('chart')??'hot';reads.push(url.pathname+url.search);json({source,chart,title:source==='qq'?'QQ 演示热歌榜':'晚风演示榜单',items:Array.from({length:65},(_,i)=>({id:String(i),rank:i+1,title:i?'海岸第 '+(i+1)+' 首':longTitle,artists:['晚风演示']})),sourceUrl:'https://example.com/charts',fetchedAt:1,refreshAfter:Date.now()+3600000});return true;}
      if(url.pathname==='/api/settings/sources') {json({revision:'fixture',youtube:{enabled:withYoutube,available:false,disabledDisplay:'dim'}});return true;}
      if(url.pathname==='/api/settings/sources/events') {response.writeHead(200,{'Content-Type':'text/event-stream'});response.write('event: sources\ndata: '+JSON.stringify({revision:'fixture',youtube:{enabled:withYoutube,available:false,disabledDisplay:'dim'}})+'\n\n');return true;}
      if(url.pathname==='/api/search/resolve') {for await(const _ of request){}json({entry:fixture.tracks[0]});return true;}
      if(url.pathname==='/api/search') {for await(const _ of request){}json({items:fixture.tracks});return true;}
      if(url.pathname==='/v1/call/metadata'&&metadataDelay) {await new Promise(resolve=>setTimeout(resolve,metadataDelay));if(response.destroyed)return true;}
      if(url.pathname==='/v1/call/metadata'&&failMetadata) {for await(const _ of request){}json({protocol:2,error:{code:'network',retryable:true}},503);return true;}
      if(url.pathname==='/v1/call/prepare'&&failPrepare) {for await(const _ of request){}json({protocol:2,error:{code:'network',retryable:true}},503);return true;}
      if(url.pathname==='/api/lyrics/state') {json({revision:'lyrics-1',offsetMs:0,document:{provider:'local',id:'demo',title:longTitle,instrumental:true,lines:[]}});return true;}
      return false;
    }
  });
  return {...fixture,longTitle,creators,collections,reads,writes,setFailWrite:value=>failWrite=value,setFailMetadata:value=>failMetadata=value,setFailPrepare:value=>failPrepare=value,setMetadataDelay:value=>metadataDelay=value};
}
