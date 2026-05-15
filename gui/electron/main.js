const { app, BrowserWindow, dialog } = require('electron');
const path = require('path');
const fs = require('fs');

// Windows taskbar uses the .exe icon; Shell also keys off AppUserModelId (match package.json build.appId).
if (process.platform === 'win32') {
  app.setAppUserModelId('com.ddsrobot.platform.gui');
}

function indexHtmlPath() {
  return path.join(__dirname, '..', 'build', 'index.html');
}

/** Icon for window / taskbar / dock (must exist under app root, including packaged asar). */
function appIconPath() {
  const root = app.getAppPath();
  if (process.platform === 'win32') {
    return path.join(root, 'public', 'favicon.ico');
  }
  return path.join(root, 'public', 'block-s-right.png');
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

  const iconPath = appIconPath();
  const winOptions = {
    width: 1280,
    height: 900,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  };
  if (fs.existsSync(iconPath)) {
    winOptions.icon = iconPath;
  }

  const win = new BrowserWindow(winOptions);

  win.loadFile(htmlPath);
}

app.whenReady().then(() => {
  if (process.platform === 'darwin') {
    const iconPath = appIconPath();
    if (fs.existsSync(iconPath) && app.dock) {
      app.dock.setIcon(iconPath);
    }
  }
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
