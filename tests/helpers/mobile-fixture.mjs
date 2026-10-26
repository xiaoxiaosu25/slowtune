import { createPlayingArtworkFixture } from './playing-artwork-fixture.mjs';

/** An isolated real-player fixture; no user data, accounts or remote media. */
export async function createMobileFixture({ preview = false, title = '风从远方来', artists = ['SlowTune 演示'], discovery = false } = {}) {
  let fixture;
  let sources={revision:'fixture',sequence:0,youtube:{enabled:false,available:false,disabledDisplay:'dim'}};
  const sourceWrites=[];
  const lyricDocument = { provider:'local', id:'mobile-demo', title:'风从远方来', artist:'SlowTune 演示', synced:true, instrumental:false, lines:[
    {startMs:0,text:'把窗打开，让晚风进来'}, {startMs:3000,text:'城市的声音慢慢走远'}, {startMs:6000,text:'风从远方来，停在你身旁'}, {startMs:12000,text:'留一段旋律，陪今天收藏'}, {startMs:18000,text:'不必赶路，也不必寻找答案'},
  ] };
  fixture = await createPlayingArtworkFixture({ preview,
    librarySeed:tracks => {
      tracks[0].title = title; tracks[0].artists = artists;
      const saved = track => ({ref:track.ref,metadata:{title:track.title,artists:track.artists,artwork:track.artwork},availability:{state:'unknown'},addedAt:1});
      return {favorites:tracks.map(saved),playlists:[{id:'evening',name:'晚风与散步',entries:tracks.map(saved)}]};
    },
    handleRequest:async ({request,response,url,json}) => {
      if(discovery&&url.pathname==='/api/discovery/bilibili') {
        const titles=['风从远方来','沿着海岸散步','留一盏灯','城市慢下来','午后的一张唱片','把今天收藏','在路上听见你','山间的回声','雨停之后','晚安与晨光','窗外的四季','下一段旋律'];
        json([{id:'account-recommendation',title:'为你推荐 · B站账号',kind:'recommendation',page:{items:titles.map((title,index)=>({...fixture.tracks[0],title,resourceId:'discovery-'+index,ref:index?{provider:'bilibili',kind:'video',id:'BV'+String(index).padStart(10,'0')}:fixture.tracks[0].ref}))}}]);return true;
      }
      if(url.pathname==='/api/settings/sources') {
        if(request.method==='POST') {
          const chunks=[];for await(const chunk of request)chunks.push(chunk);
          const body=JSON.parse(Buffer.concat(chunks));sourceWrites.push(body);
          if(body.revision!==sources.revision){json({error:{code:'conflict'}},409);return true;}
          sources={revision:'fixture-'+(sources.sequence+1),sequence:sources.sequence+1,youtube:{...sources.youtube,...body.youtube}};
        }
        json(sources);return true;
      }
      if (url.pathname === '/api/lyrics/state') { json({ref:fixture.tracks[0].ref,revision:'demo',offsetMs:0,document:lyricDocument}); return true; }
      if (url.pathname === '/api/follows/feed') { json({items:[],total:0,warnings:[]}); return true; }
      if (url.pathname === '/api/charts') { json({source:'netease',chart:'hot',title:'演示榜单',items:[],fetchedAt:Date.now()}); return true; }
      if (url.pathname === '/api/search') { for await (const _ of request) {} json({items:fixture.tracks}); return true; }
      if (url.pathname === '/api/settings/sources/events') {
        response.writeHead(200,{'Content-Type':'text/event-stream'});
        response.write('event: sources\ndata: '+JSON.stringify(sources)+'\n\n');
        return true;
      }
      return false;
    },
  });
  return {...fixture,sourceWrites};
}
