const http = require('http');
const ddsLocalRunner = require('../electron/ddsLocalRunner');

const REQUEST_TIMEOUT_MS = 20000;

function parseJsonBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
    });
    req.on('end', () => {
      if (!raw.trim()) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(raw));
      } catch (err) {
        reject(err);
      }
    });
    req.on('error', reject);
  });
}

function settingsFromQuery(query) {
  return {
    ddsDir: (query.ddsDir || '').trim(),
    wslDistro: (query.wslDistro || '').trim(),
  };
}

/**
 * Dev-only proxy so the React app can call robot launch servers on the LAN without CORS.
 * Packaged Electron uses IPC instead (see electron/main.js).
 */
module.exports = function setupRobotLauncherProxy(app) {
  app.get('/api/dds-local/status', async (req, res) => {
    try {
      const payload = await ddsLocalRunner.getDdsStatus(settingsFromQuery(req.query));
      res.json(payload);
    } catch (err) {
      res.status(500).json({ error: err.message || 'Status check failed' });
    }
  });

  app.get('/api/dds-local/defaults', (_req, res) => {
    res.json({
      ddsDir: ddsLocalRunner.getDefaultDdsDir(),
      wslDistro: process.platform === 'win32' ? ddsLocalRunner.defaultWslDistro() : '',
      platform: process.platform,
    });
  });

  app.post('/api/dds-local/validate', async (req, res) => {
    try {
      const body = await parseJsonBody(req);
      res.json(ddsLocalRunner.validateSettings(body));
    } catch (err) {
      res.status(400).json({ valid: false, error: err.message || 'Invalid JSON' });
    }
  });

  app.post('/api/dds-local/start', async (req, res) => {
    try {
      const body = await parseJsonBody(req);
      const result = await ddsLocalRunner.startDds(body);
      if (result.ok) {
        res.json(result);
      } else {
        res.status(400).json(result);
      }
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message || 'Start failed' });
    }
  });

  app.post('/api/dds-local/stop', async (req, res) => {
    try {
      const body = await parseJsonBody(req);
      const result = await ddsLocalRunner.stopDds(body);
      if (result.ok) {
        res.json(result);
      } else {
        res.status(400).json(result);
      }
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message || 'Stop failed' });
    }
  });

  app.get('/api/robot-launcher', (req, res) => {
    const host = (req.query.host || '').trim();
    const port = Number(req.query.port) || 8080;
    const path = (req.query.path || '/start').startsWith('/')
      ? req.query.path
      : `/${req.query.path}`;

    if (!host) {
      res.status(400).json({ ok: false, error: 'host query parameter is required' });
      return;
    }

    let responded = false;
    const sendOnce = (status, payload) => {
      if (responded) return;
      responded = true;
      res.status(status).json(payload);
    };

    const pathname = path.split('?')[0];
    const timeout = pathname === '/status' ? 5000 : REQUEST_TIMEOUT_MS;
    const proxyReq = http.get(
      { host, port, path, timeout },
      (proxyRes) => {
        let body = '';
        proxyRes.setEncoding('utf8');
        proxyRes.on('data', (chunk) => {
          body += chunk;
        });
        proxyRes.on('end', () => {
          const ok = proxyRes.statusCode >= 200 && proxyRes.statusCode < 300;
          sendOnce(ok ? 200 : 502, {
            ok,
            status: proxyRes.statusCode,
            body: body.trim(),
          });
        });
        proxyRes.on('error', (err) => {
          sendOnce(502, {
            ok: false,
            error: err.message || 'Error reading launcher response',
          });
        });
      },
    );

    proxyReq.on('timeout', () => {
      proxyReq.destroy();
      sendOnce(504, { ok: false, error: 'Request timed out' });
    });

    proxyReq.on('error', (err) => {
      sendOnce(502, {
        ok: false,
        error: err.message || 'Could not reach robot launcher',
      });
    });
  });
};
