/**
 * BytesProtector — Preload / Context Bridge
 * Exposes safe IPC methods to the renderer.
 */

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('bp', {
  // Window controls
  minimize: ()  => ipcRenderer.send('window-minimize'),
  maximize: ()  => ipcRenderer.send('window-maximize'),
  close:    ()  => ipcRenderer.send('window-close'),

  // Settings
  getSettings:  ()   => ipcRenderer.invoke('get-settings'),
  saveSettings: (s)  => ipcRenderer.invoke('save-settings', s),

  // Dialogs
  chooseDirectory: () => ipcRenderer.invoke('choose-directory'),
  chooseFiles:     () => ipcRenderer.invoke('choose-files'),
  chooseSavePath:  (n) => ipcRenderer.invoke('choose-save-path', n),

  // Scan
  startScan: (opts) => ipcRenderer.invoke('start-scan', opts),
  stopScan:  ()     => ipcRenderer.send('stop-scan'),
  onScanEvent: (cb) => ipcRenderer.on('scan-event', (_, data) => cb(data)),
  offScanEvents: () => ipcRenderer.removeAllListeners('scan-event'),

  // Quarantine
  getQuarantine:       () => ipcRenderer.invoke('get-quarantine'),
  quarantineDeleteAll: () => ipcRenderer.invoke('quarantine-delete-all'),
  quarantineRestore:   (id) => ipcRenderer.invoke('quarantine-restore', id),
  quarantineDeleteItem:(id) => ipcRenderer.invoke('quarantine-delete-item', id),

  // Reports
  getReport:    ()   => ipcRenderer.invoke('get-report'),
  exportReport: (p)  => ipcRenderer.invoke('export-report', p),

  // Auto-Update
  checkForUpdate:   () => ipcRenderer.invoke('check-for-update'),
  openDownloadUrl:  (url) => ipcRenderer.invoke('open-download-url', url),
});
