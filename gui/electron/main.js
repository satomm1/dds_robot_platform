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

ipcMain.handle('dds-local-list-saved-maps', async (_event, settings) =>
  ddsLocalRunner.listSavedMaps(settings || {}),
);

ipcMain.handle('dds-local-save-named-map', async (_event, args) => {
  const { platformDir, wslDistro, name, mapJsonText, sourceHost } = args || {};
  return ddsLocalRunner.saveNamedMap(
    { platformDir, wslDistro },
    { name, mapJsonText, sourceHost },
  );
});

ipcMain.handle('dds-local-read-saved-map', async (_event, args) => {
  const { platformDir, wslDistro, mapId } = args || {};
  return ddsLocalRunner.readSavedMapJson({ platformDir, wslDistro }, mapId);
});

ipcMain.handle('dds-local-set-active-saved-map', async (_event, args) => {
  const { platformDir, wslDistro, mapId, mapJsonText } = args || {};
  return ddsLocalRunner.setActiveSavedMap(
    { platformDir, wslDistro },
    mapId,
    mapJsonText,
  );
});

ipcMain.handle('dds-local-delete-saved-map', async (_event, args) => {
  const { platformDir, wslDistro, mapId } = args || {};
  return ddsLocalRunner.deleteSavedMap({ platformDir, wslDistro }, mapId);
});

ipcMain.handle('dds-local-read-user-map', async (_event, settings) =>
  ddsLocalRunner.readUserMapJson(settings || {}),
);

ipcMain.handle('docker-compose-status', (_event, settings) =>
  dockerComposeRunner.getDockerStatus(settings || {}),
);

ipcMain.handle('docker-compose-up', (_event, settings) =>
  dockerComposeRunner.dockerComposeUp(settings || {}),
);

ipcMain.handle('docker-compose-down', (_event, settings) =>
  dockerComposeRunner.dockerComposeDown(settings || {}),
);

ipcMain.handle('docker-compose-capture-status', (_event, settings) =>
  dockerComposeRunner.getCaptureDockerStatus(settings || {}),
);

ipcMain.handle('docker-compose-capture-up', (_event, settings) =>
  dockerComposeRunner.captureDockerComposeUp(settings || {}),
);

ipcMain.handle('docker-compose-capture-down', (_event, settings) =>
  dockerComposeRunner.captureDockerComposeDown(settings || {}),
);

ipcMain.handle('robot-launcher-request', (_event, options = {}) => {
  const {
    host,
    port,
    path: route,
    timeoutMs,
    method: rawMethod,
    body,
  } = options;
  const cleanHost = String(host || '').trim();
  const portNum = Number(port) > 0 ? Number(port) : 8080;
  const reqPath = route && String(route).startsWith('/') ? String(route) : '/start';
  const timeout =
    Number(timeoutMs) > 0 ? Number(timeoutMs) : ROBOT_LAUNCHER_TIMEOUT_MS;
  const method = String(rawMethod || 'GET').toUpperCase();

  if (!cleanHost) {
    return { ok: false, status: 0, body: '', error: 'host is required' };
  }

  return new Promise((resolve) => {
    const fail = (error) => {
      resolve({ ok: false, status: 0, body: '', error });
    };

    const headers = {};
    let bodyText = null;
    if (body != null && method !== 'GET' && method !== 'HEAD') {
      bodyText = typeof body === 'string' ? body : JSON.stringify(body);
      headers['Content-Type'] = 'application/json';
      headers['Content-Length'] = Buffer.byteLength(bodyText, 'utf8');
    }

    const req = http.request(
      {
        host: cleanHost,
        port: portNum,
        path: reqPath,
        method,
        timeout,
        headers,
      },
      (res) => {
        let responseBody = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => {
          responseBody += chunk;
        });
        res.on('end', () => {
          resolve({
            ok: res.statusCode >= 200 && res.statusCode < 300,
            status: res.statusCode,
            body: responseBody.trim(),
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
    if (bodyText != null) {
      req.write(bodyText);
    }
    req.end();
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
