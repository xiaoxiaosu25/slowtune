import { createPlayingArtworkFixture } from './playing-artwork-fixture.mjs';

/** An isolated real-player fixture; no user data, accounts or remote media. */
export async function createMobileFixture({ preview = false } = {}) {
  let fixture;
  const lyricDocument = { provider:'local', id:'mobile-demo', title:'风从远方来', artist:'SlowTune 演示', synced:true, instrumental:false, lines:[
    {startMs:0,text:'把窗打开，让晚风进来'}, {startMs:3000,text:'城市的声音慢慢走远'}, {startMs:6000,text:'风从远方来，停在你身旁'}, {startMs:12000,text:'留一段旋律，陪今天收藏'}, {startMs:18000,text:'不必赶路，也不必寻找答案'},
  ] };
  fixture = await createPlayingArtworkFixture({ preview,
    librarySeed:tracks => {
      tracks[0].title = '风从远方来'; tracks[0].artists = ['SlowTune 演示'];
      const saved = track => ({ref:track.ref,metadata:{title:track.title,artists:track.artists},availability:{state:'unknown'},addedAt:1});
      return {favorites:tracks.map(saved),playlists:[{id:'evening',name:'晚风与散步',entries:tracks.map(saved)}]};
    },
    handleRequest:async ({request,response,url,json}) => {
      if (url.pathname === '/api/lyrics/state') { json({ref:fixture.tracks[0].ref,revision:'demo',offsetMs:0,document:lyricDocument}); return true; }
      if (url.pathname === '/api/follows/feed') { json({items:[],total:0,warnings:[]}); return true; }
      if (url.pathname === '/api/charts') { json({source:'netease',chart:'hot',title:'演示榜单',items:[],fetchedAt:Date.now()}); return true; }
      if (url.pathname === '/api/search') { for await (const _ of request) {} json({items:fixture.tracks}); return true; }
      if (url.pathname === '/api/settings/sources/events') {
        response.writeHead(200,{'Content-Type':'text/event-stream'});
        response.write('event: sources\ndata: '+JSON.stringify({revision:'fixture',youtube:{enabled:false,available:false,disabledDisplay:'dim'}})+'\n\n');
        return true;
      }
      return false;
    },
  });
  return fixture;
}
