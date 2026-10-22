import { useState, type CSSProperties } from 'react';
import type { WelcomeSettings } from '../server/startup-types';
import { useDesktopWindowMode } from './desktop-chrome';
import { welcomeImage } from './WelcomeScreen';
import mark from '../desktop/mark.svg';
import '../desktop/setup.css';

export function DesktopStartup({ settings, message, error, onRetry }: { settings: WelcomeSettings; message: string; error: boolean; onRetry(): void }) {
  const [failed, setFailed] = useState<string[]>([]);
  const source = welcomeImage(settings);
  const picture = source && !failed.includes(source) ? source : settings.background === 'plain' || failed.includes('/assets/coast.png') ? undefined : '/assets/coast.png';
  useDesktopWindowMode(picture ? 'welcome-artwork' : 'welcome');
  return <div className="desktop-startup" data-phase={error ? 'error' : 'starting'} data-position={settings.position} data-artwork={!!picture}>
    {picture && <img className="startup-background" src={picture} alt="" fetchPriority="high" style={{ objectPosition: `${settings.desktopFocus.x}% ${settings.desktopFocus.y}%` }} onError={() => setFailed(value => [...value, picture])} />}
    <div className="startup-shade" style={{ opacity: picture ? settings.shade / 100 : 0 } as CSSProperties}/><div className="startup-vignette"/>
    <header className="startup-header">SLOWTUNE<span>音乐，慢慢听。</span></header>
    <main className="startup-main">
      <section className="startup-brand" aria-label="慢听启动页">
        <img className="startup-mark" src={mark} alt=""/>
        <h1>慢听</h1><p className="startup-wordmark">SLOWTUNE</p>
        <p className="startup-tagline">留一点时间，听见喜欢。</p>
      </section>
    </main>
    <footer className="startup-footer">
      <div className="startup-loader" aria-hidden="true"><span/></div>
      <div className="startup-status" role={error ? 'alert' : 'status'} aria-live="polite">{message}</div>
      {error && <div className="startup-actions"><button onClick={onRetry}>重试</button><button className="secondary" onClick={() => void window.slowTuneDesktop?.openDirectory('logs')}>打开日志文件夹</button><button className="quiet" onClick={() => window.slowTuneDesktop?.quit()}>退出</button></div>}
      <p className="startup-caption">你的个人音乐空间</p>
    </footer>
  </div>;
}
