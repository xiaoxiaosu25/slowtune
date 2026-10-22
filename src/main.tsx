import { createRoot } from 'react-dom/client';
import { App } from './App';
import { initializeTheme } from './theme';
import { initializeDesktopChrome } from './desktop-chrome';
import { initializePreferenceStorage } from './preference-storage';
import { DesktopPersistenceNotice } from './DesktopPersistenceNotice';
import './styles.css';
import './lyrics.css';
import './playback-management.css';
void initializePreferenceStorage().then(() => {
  initializeTheme();
  initializeDesktopChrome();
  createRoot(document.getElementById('root')!).render(<><DesktopPersistenceNotice/><App /></>);
}).catch(error => {
  const root = document.getElementById('root')!;
  const message = document.createElement('p'); message.textContent = '无法读取本地偏好：' + String(error);
  const retry = document.createElement('button'); retry.textContent = '重试'; retry.onclick = () => location.reload();
  const logs = document.createElement('button'); logs.textContent = '打开日志文件夹'; logs.onclick = () => { void window.slowTuneDesktop?.openDirectory('logs'); };
  root.replaceChildren(message, retry, logs);
});
