'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('robotLauncher', {
  request: (options) => ipcRenderer.invoke('robot-launcher-request', options),
});
