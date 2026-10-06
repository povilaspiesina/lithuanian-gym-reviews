const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('gymApp', {
  dashboardUrl: () => ipcRenderer.invoke('dashboard-url'),
  start: mode => ipcRenderer.invoke('collector-start', mode),
  finishLogin: () => ipcRenderer.invoke('collector-finish-login'),
  stop: () => ipcRenderer.invoke('collector-stop'),
  importCsv: () => ipcRenderer.invoke('import-csv'),
  openDataFolder: () => ipcRenderer.invoke('open-data-folder'),
  setup: () => ipcRenderer.invoke('setup-status'),
  setToken: token => ipcRenderer.invoke('hf-set-token', token),
  setCollectorSize: size => ipcRenderer.invoke('collector-size', size),
  on: (channel, callback) => {
    if (!['dashboard-ready', 'collector-status', 'collector-progress', 'app-log', 'app-error', 'reload-dashboard', 'data-summary'].includes(channel)) return;
    ipcRenderer.on(channel, (_event, value) => callback(value));
  },
});
