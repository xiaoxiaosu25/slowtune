import React from 'react';
import {createRoot} from 'react-dom/client';
import {connectSourceClient} from '../../src/source-client';
import {usePlayback} from '../../src/playback';
import {initializePreferenceStorage} from '../../src/preference-storage';
const client=await connectSourceClient(location.origin,new AbortController().signal);
function Probe(){
  const playback=usePlayback(client);
  (window as any).sourceBaseline={...playback,position:()=>playback.clock.getSnapshot()};
  return <button onClick={()=>void playback.playChartItem({title:'基线测试歌曲',artists:['基线歌手']})}>点播基线歌曲</button>;
}
await initializePreferenceStorage();
createRoot(document.getElementById('root')!).render(<Probe/>);
