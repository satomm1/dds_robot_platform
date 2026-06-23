'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('robotLauncher', {
  request: (options) => ipcRenderer.invoke('robot-launcher-request', options),
});

contextBridge.exposeInMainWorld('ddsLocal', {
  getDefaults: () => ipcRenderer.invoke('dds-local-get-defaults'),
  validate: (settings) => ipcRenderer.invoke('dds-local-validate', settings),
  writeUserMap: (args) => ipcRenderer.invoke('dds-local-write-user-map', args),
});

contextBridge.exposeInMainWorld('dockerCompose', {
  status: (settings) => ipcRenderer.invoke('docker-compose-status', settings),
  up: (settings) => ipcRenderer.invoke('docker-compose-up', settings),
  down: (settings) => ipcRenderer.invoke('docker-compose-down', settings),
});
