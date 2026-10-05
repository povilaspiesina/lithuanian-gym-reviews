const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('gymApp', {
  dashboardUrl: () => ipcRenderer.invoke('dashboard-url'),
  start: mode => ipcRenderer.invoke('collector-start', mode),
  finishLogin: () => ipcRenderer.invoke('collector-finish-login'),
  stop: () => ipcRenderer.invoke('collector-stop'),
  importCsv: () => ipcRenderer.invoke('import-csv'),
  openDataFolder: () => ipcRenderer.invoke('open-data-folder'),
  on: (channel, callback) => {
    if (!['dashboard-ready', 'collector-status', 'app-log', 'app-error', 'reload-dashboard'].includes(channel)) return;
    ipcRenderer.on(channel, (_event, value) => callback(value));
  },
});
