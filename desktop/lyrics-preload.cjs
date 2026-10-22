const { contextBridge, ipcRenderer } = require('electron');
const subscribe = (channel, callback) => {
  const listener = (_event, value) => callback(value);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
};
contextBridge.exposeInMainWorld('slowTuneLyrics', {
  getState: () => ipcRenderer.invoke('desktop:state'),
  updatePreferences: value => ipcRenderer.invoke('desktop:preferences', value),
  command: value => ipcRenderer.send('desktop:command', value),
  showPlayer: () => ipcRenderer.send('desktop:show-player'),
  openSettings: () => ipcRenderer.send('desktop:open-lyrics-settings'),
  resetPosition: () => ipcRenderer.invoke('desktop:reset-lyrics-position'),
  setOptionsOpen: value => ipcRenderer.invoke('desktop:lyrics-options', value),
  setUnlockTarget: value => ipcRenderer.send('desktop:lyrics-unlock-target', value),
  onPointerLeave: callback => subscribe('desktop:lyrics-pointer-left', callback),
  onState: callback => subscribe('desktop:state', callback),
  onDocument: callback => subscribe('desktop:document', callback),
  onClock: callback => subscribe('desktop:clock', callback),
});
