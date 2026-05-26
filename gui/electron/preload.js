'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('robotLauncher', {
  request: (options) => ipcRenderer.invoke('robot-launcher-request', options),
});

contextBridge.exposeInMainWorld('ddsLocal', {
  getDefaults: () => ipcRenderer.invoke('dds-local-get-defaults'),
  validate: (settings) => ipcRenderer.invoke('dds-local-validate', settings),
  status: (settings) => ipcRenderer.invoke('dds-local-status', settings),
  start: (settings) => ipcRenderer.invoke('dds-local-start', settings),
  stop: (settings) => ipcRenderer.invoke('dds-local-stop', settings),
});

contextBridge.exposeInMainWorld('dockerCompose', {
  status: (settings) => ipcRenderer.invoke('docker-compose-status', settings),
  up: (settings) => ipcRenderer.invoke('docker-compose-up', settings),
  down: (settings) => ipcRenderer.invoke('docker-compose-down', settings),
});

contextBridge.exposeInMainWorld('localStack', {
  status: (settings) => ipcRenderer.invoke('local-stack-status', settings),
});
