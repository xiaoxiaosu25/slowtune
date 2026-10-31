import React,{useState} from 'react';
import {createRoot} from 'react-dom/client';
import {connectSourceClient} from '../../src/source-client';
import {usePlayback} from '../../src/playback';
import {initializePreferenceStorage} from '../../src/preference-storage';
import {AudioPreferenceSelect,AudioQualityDialog} from '../../src/AudioQualityOptions';
import '../../src/styles.css';
const client=await connectSourceClient(location.origin,new AbortController().signal);
function Probe(){const playback=usePlayback(client),[open,setOpen]=useState(false);(window as any).qualityProbe=playback;return <main className="app" style={{padding:16}}><AudioPreferenceSelect playback={playback}/><button className="btn" onClick={()=>setOpen(true)}>音质与音轨</button><p role="status">{playback.error}</p>{open&&<AudioQualityDialog playback={playback} generation="one" onClose={()=>setOpen(false)}/>}</main>;}
await initializePreferenceStorage();createRoot(document.getElementById('root')!).render(<Probe/>);
