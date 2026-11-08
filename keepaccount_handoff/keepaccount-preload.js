const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('keepAccountDesktop', {
  getState: () => ipcRenderer.invoke('keepaccount-data:get'),
  saveState: (nextState) => ipcRenderer.invoke('keepaccount-data:save', nextState),
  setWidgetMode: (mode) => ipcRenderer.invoke('keepaccount:widget-mode', mode),
  restoreMain: () => ipcRenderer.invoke('keepaccount:restore-main')
});
