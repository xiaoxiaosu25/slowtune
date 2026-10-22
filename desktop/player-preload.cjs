const { contextBridge, ipcRenderer } = require('electron');
const subscribe = (channel, callback) => {
  const listener = (_event, value) => callback(value);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
};
contextBridge.exposeInMainWorld('slowTuneDesktop', {
  getState: () => ipcRenderer.invoke('desktop:state'),
  restoreLocalSession: () => ipcRenderer.invoke('desktop:restore-local-session'),
  setLyricsVisible: visible => ipcRenderer.invoke('desktop:preferences', { visible }),
  setWindowAppearance: value => ipcRenderer.send('desktop:appearance', value),
  updateLyricsPreferences: value => ipcRenderer.invoke('desktop:preferences', value),
  resetLyricsPosition: () => ipcRenderer.invoke('desktop:reset-lyrics-position'),
  readPreferences: () => ipcRenderer.invoke('desktop:read-preferences'),
  writePreference: (key, value) => ipcRenderer.invoke('desktop:write-preference', key, value),
  flushPreferences: () => ipcRenderer.invoke('desktop:flush-preferences'),
  getRuntimeInfo: () => ipcRenderer.invoke('desktop:runtime-info'),
  copyDiagnostics: text => ipcRenderer.invoke('desktop:copy-diagnostics', text),
  onPreferenceState: callback => subscribe('desktop:preference-state', callback),
  getDataDirectory: () => ipcRenderer.invoke('desktop:data-directory'),
  openDirectory: kind => ipcRenderer.invoke('desktop:open-directory', kind),
  saveWelcome: value => ipcRenderer.invoke('desktop:save-welcome', value),
  quit: () => ipcRenderer.send('desktop:quit'),
  onOpenLyricsSettings: callback => subscribe('desktop:open-lyrics-settings', callback),
  onWindowState: callback => subscribe('desktop:window-state', callback),
  publishDocument: value => ipcRenderer.send('desktop:document', value),
  publishClock: value => ipcRenderer.send('desktop:clock', value),
  playbackReleased: (ok = true) => ipcRenderer.send('desktop:released', ok),
  onState: callback => subscribe('desktop:state', callback),
  onCommand: callback => subscribe('desktop:command', callback),
});
contextBridge.exposeInMainWorld('slowTuneSetup', {
  getState: () => ipcRenderer.invoke('desktop:setup-state'),
  ready: () => ipcRenderer.send('desktop:setup-visible'),
  retry: () => ipcRenderer.invoke('desktop:setup-retry'),
  openLogs: () => ipcRenderer.invoke('desktop:open-directory', 'logs'),
  openData: () => ipcRenderer.invoke('desktop:open-directory', 'data'),
  quit: () => ipcRenderer.send('desktop:setup-quit'),
  onState: callback => subscribe('desktop:setup-state', callback),
});
