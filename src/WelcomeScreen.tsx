import { useState, type CSSProperties, type ReactNode } from 'react';
import { HeadphonesIcon } from '@phosphor-icons/react';
import { brand } from '../server/brand';
import type { WelcomeSettings } from '../server/startup-types';
import { ThemeToggle } from './ThemeControls';
import { useDesktopWindowMode } from './desktop-chrome';

export function welcomeImage(settings:WelcomeSettings) { return settings.background==='plain'?undefined:settings.background==='custom'&&settings.imageId?'/api/welcome/image/'+encodeURIComponent(settings.imageId):'/assets/coast.png'; }
export function WelcomeScreen({settings,image,children,preview=false}:{settings:WelcomeSettings;image?:string;children:ReactNode;preview?:boolean}) {
  const source=image??welcomeImage(settings),[failed,setFailed]=useState<string[]>([]);
  const picture=source&&!failed.includes(source)?source:settings.background==='plain'||failed.includes('/assets/coast.png')?undefined:'/assets/coast.png';
  useDesktopWindowMode(picture?'welcome-artwork':'welcome', !preview);
  const style={'--welcome-x':settings.desktopFocus.x+'%','--welcome-y':settings.desktopFocus.y+'%','--welcome-mobile-x':settings.mobileFocus.x+'%','--welcome-mobile-y':settings.mobileFocus.y+'%','--welcome-shade':settings.shade/100} as CSSProperties;
  return <div className={'welcome-screen'+(preview?' welcome-screen-preview':'')} style={style} data-position={settings.position} data-background={picture?settings.background:'plain'}>
    {picture&&<img className="welcome-background" src={picture} alt="" onError={()=>setFailed(value=>[...value,picture])} fetchPriority="high"/>}
    <div className="welcome-shade"/>
    <div className="welcome-layout">
      <header className="welcome-header"><span className="welcome-signature"><HeadphonesIcon size={23} weight="bold"/><span>{brand.english}</span></span>{!preview&&<ThemeToggle/>}</header>
      <main className="welcome-content">
        <section className="welcome-card" aria-label="欢迎来到慢听">
          <span className="welcome-eyebrow">YOUR PERSONAL MUSIC SPACE</span>
          <h1>{brand.name}</h1><p className="welcome-tagline">{brand.tagline}</p>
          <div className="welcome-action">{children}</div>
          <span className="welcome-card-footnote">跟随自己的节奏。</span>
        </section>
      </main>
      <footer className="welcome-footer"><span>留一点时间，听见喜欢。</span><span>{brand.english} · 个人音乐空间</span></footer>
    </div>
  </div>;
}
