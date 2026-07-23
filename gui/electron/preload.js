'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('robotLauncher', {
  request: (options) => ipcRenderer.invoke('robot-launcher-request', options),
});

contextBridge.exposeInMainWorld('ddsLocal', {
  getDefaults: () => ipcRenderer.invoke('dds-local-get-defaults'),
  validate: (settings) => ipcRenderer.invoke('dds-local-validate', settings),
  writeUserMap: (args) => ipcRenderer.invoke('dds-local-write-user-map', args),
  listSavedMaps: (settings) => ipcRenderer.invoke('dds-local-list-saved-maps', settings),
  saveNamedMap: (args) => ipcRenderer.invoke('dds-local-save-named-map', args),
  readSavedMap: (args) => ipcRenderer.invoke('dds-local-read-saved-map', args),
  setActiveSavedMap: (args) => ipcRenderer.invoke('dds-local-set-active-saved-map', args),
  deleteSavedMap: (args) => ipcRenderer.invoke('dds-local-delete-saved-map', args),
  readUserMap: (settings) => ipcRenderer.invoke('dds-local-read-user-map', settings),
});

contextBridge.exposeInMainWorld('dockerCompose', {
  status: (settings) => ipcRenderer.invoke('docker-compose-status', settings),
  up: (settings) => ipcRenderer.invoke('docker-compose-up', settings),
  down: (settings) => ipcRenderer.invoke('docker-compose-down', settings),
  captureStatus: (settings) =>
    ipcRenderer.invoke('docker-compose-capture-status', settings),
  captureUp: (settings) => ipcRenderer.invoke('docker-compose-capture-up', settings),
  captureDown: (settings) =>
    ipcRenderer.invoke('docker-compose-capture-down', settings),
});
