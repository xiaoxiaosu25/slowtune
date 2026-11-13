import { createRoot } from 'react-dom/client';
// 样式在打包结果中的先后决定同等优先级规则谁生效，这里统一声明顺序：组件样式在前，全局样式在后。
// 组件文件仍各自导入样式；在此先导入，顺序就不随组件的拆分和导入顺序变化。
import './song-library.css';
import './action-menu.css';
import './search-discovery.css';
import './desktop-chrome.css';
import '../desktop/setup.css';
import './desktop-feedback.css';
import './audio-quality.css';
import './discovery-feedback.css';
import './lyric-offset.css';
import './lyric-picker.css';
import './desktop-lyrics.css';
import { App } from './App';
import { initializeTheme } from './theme';
import { initializeDesktopChrome } from './desktop-chrome';
import { initializePreferenceStorage } from './preference-storage';
import { DesktopPersistenceNotice } from './DesktopPersistenceNotice';
import './styles.css';
import './lyrics.css';
import './playback-management.css';
import './mobile.css';
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
