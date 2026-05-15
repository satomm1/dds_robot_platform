const { app, BrowserWindow, dialog } = require('electron');
const path = require('path');
const fs = require('fs');

function indexHtmlPath() {
  return path.join(__dirname, '..', 'build', 'index.html');
}

function createWindow() {
  const htmlPath = indexHtmlPath();
  if (!fs.existsSync(htmlPath)) {
    dialog.showErrorBox(
      'Build missing',
      'Production bundle not found. From the gui folder run: npm run build'
    );
    app.quit();
    return;
  }

  const win = new BrowserWindow({
    width: 1280,
    height: 900,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  win.loadFile(htmlPath);
}

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
