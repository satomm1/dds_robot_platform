const { app, BrowserWindow, dialog, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const http = require('http');
const ddsLocalRunner = require('./ddsLocalRunner');
const dockerComposeRunner = require('./dockerComposeRunner');

const ROBOT_LAUNCHER_TIMEOUT_MS = 20000;

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

ipcMain.handle('dds-local-get-defaults', () => ({
  platformDir: ddsLocalRunner.getDefaultPlatformDir(),
  wslDistro: process.platform === 'win32' ? ddsLocalRunner.defaultWslDistro() : '',
  platform: process.platform,
}));

ipcMain.handle('dds-local-validate', (_event, settings) =>
  ddsLocalRunner.validateSettings(settings || {}),
);

ipcMain.handle('dds-local-write-user-map', async (_event, args) => {
  const { platformDir, wslDistro, mapJsonText } = args || {};
  return ddsLocalRunner.writeUserMapJson(
    { platformDir, wslDistro },
    mapJsonText,
  );
});

ipcMain.handle('docker-compose-status', (_event, settings) =>
  dockerComposeRunner.getDockerStatus(settings || {}),
);

ipcMain.handle('docker-compose-up', (_event, settings) =>
  dockerComposeRunner.dockerComposeUp(settings || {}),
);

ipcMain.handle('docker-compose-down', (_event, settings) =>
  dockerComposeRunner.dockerComposeDown(settings || {}),
);

ipcMain.handle('robot-launcher-request', (_event, { host, port, path: route, timeoutMs }) => {
  const cleanHost = String(host || '').trim();
  const portNum = Number(port) > 0 ? Number(port) : 8080;
  const reqPath = route && String(route).startsWith('/') ? String(route) : '/start';
  const timeout =
    Number(timeoutMs) > 0 ? Number(timeoutMs) : ROBOT_LAUNCHER_TIMEOUT_MS;

  if (!cleanHost) {
    return { ok: false, status: 0, body: '', error: 'host is required' };
  }

  return new Promise((resolve) => {
    const fail = (error) => {
      resolve({ ok: false, status: 0, body: '', error });
    };

    const req = http.get(
      { host: cleanHost, port: portNum, path: reqPath, timeout },
      (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => {
          body += chunk;
        });
        res.on('end', () => {
          resolve({
            ok: res.statusCode >= 200 && res.statusCode < 300,
            status: res.statusCode,
            body: body.trim(),
          });
        });
      },
    );
    req.on('timeout', () => {
      req.destroy();
      fail('Request timed out');
    });
    req.on('error', (err) => {
      fail(err.message || 'Request failed');
    });
  });
});

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
