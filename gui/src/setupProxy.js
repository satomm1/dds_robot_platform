const http = require('http');
const ddsLocalRunner = require('../electron/ddsLocalRunner');
const dockerComposeRunner = require('../electron/dockerComposeRunner');

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
    platformDir: (query.platformDir || query.ddsDir || '').trim(),
    wslDistro: (query.wslDistro || '').trim(),
  };
}

/**
 * Dev-only proxy so the React app can call robot launch servers on the LAN without CORS.
 * Packaged Electron uses IPC instead (see electron/main.js).
 */
function parseRawBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
    });
    req.on('end', () => resolve(raw));
    req.on('error', reject);
  });
}

function proxyRobotHostRequest(res, { host, port, path, method, body, timeoutMs }) {
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
  const timeout =
    Number(timeoutMs) > 0
      ? Number(timeoutMs)
      : pathname === '/status'
        ? 5000
        : pathname === '/map' && method === 'POST'
          ? 120000
          : REQUEST_TIMEOUT_MS;

  const headers = {};
  let bodyText = null;
  if (body != null && method !== 'GET' && method !== 'HEAD') {
    bodyText = typeof body === 'string' ? body : JSON.stringify(body);
    headers['Content-Type'] = 'application/json';
    headers['Content-Length'] = Buffer.byteLength(bodyText, 'utf8');
  }

  const proxyReq = http.request(
    { host, port, path, method, timeout, headers },
    (proxyRes) => {
      let responseBody = '';
      proxyRes.setEncoding('utf8');
      proxyRes.on('data', (chunk) => {
        responseBody += chunk;
      });
      proxyRes.on('end', () => {
        const ok = proxyRes.statusCode >= 200 && proxyRes.statusCode < 300;
        sendOnce(ok ? 200 : 502, {
          ok,
          status: proxyRes.statusCode,
          body: responseBody.trim(),
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

  if (bodyText != null) {
    proxyReq.write(bodyText);
  }
  proxyReq.end();
}

module.exports = function setupRobotLauncherProxy(app) {
  app.get('/api/dds-local/defaults', (_req, res) => {
    res.json({
      platformDir: ddsLocalRunner.getDefaultPlatformDir(),
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

  app.get('/api/docker-compose/status', async (req, res) => {
    try {
      const payload = await dockerComposeRunner.getDockerStatus(
        settingsFromQuery(req.query),
      );
      res.json(payload);
    } catch (err) {
      res.status(500).json({ error: err.message || 'Docker status check failed' });
    }
  });

  app.post('/api/docker-compose/up', async (req, res) => {
    try {
      const body = await parseJsonBody(req);
      const result = await dockerComposeRunner.dockerComposeUp(body);
      if (result.ok) {
        res.json(result);
      } else {
        res.status(400).json(result);
      }
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message || 'Docker up failed' });
    }
  });

  app.post('/api/docker-compose/down', async (req, res) => {
    try {
      const body = await parseJsonBody(req);
      const result = await dockerComposeRunner.dockerComposeDown(body);
      if (result.ok) {
        res.json(result);
      } else {
        res.status(400).json(result);
      }
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message || 'Docker down failed' });
    }
  });

  app.get('/api/docker-compose/capture/status', async (req, res) => {
    try {
      const payload = await dockerComposeRunner.getCaptureDockerStatus(
        settingsFromQuery(req.query),
      );
      res.json(payload);
    } catch (err) {
      res.status(500).json({ error: err.message || 'Capture Docker status check failed' });
    }
  });

  app.post('/api/docker-compose/capture/up', async (req, res) => {
    try {
      const body = await parseJsonBody(req);
      const result = await dockerComposeRunner.captureDockerComposeUp(body);
      if (result.ok) {
        res.json(result);
      } else {
        res.status(400).json(result);
      }
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message || 'Capture Docker up failed' });
    }
  });

  app.post('/api/docker-compose/capture/down', async (req, res) => {
    try {
      const body = await parseJsonBody(req);
      const result = await dockerComposeRunner.captureDockerComposeDown(body);
      if (result.ok) {
        res.json(result);
      } else {
        res.status(400).json(result);
      }
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message || 'Capture Docker down failed' });
    }
  });

  app.get('/api/robot-launcher', (req, res) => {
    const host = (req.query.host || '').trim();
    const port = Number(req.query.port) || 8080;
    const path = (req.query.path || '/start').startsWith('/')
      ? req.query.path
      : `/${req.query.path}`;

    proxyRobotHostRequest(res, {
      host,
      port,
      path,
      method: 'GET',
      body: null,
    });
  });

  app.post('/api/robot-launcher', async (req, res) => {
    const host = (req.query.host || '').trim();
    const port = Number(req.query.port) || 8080;
    const path = (req.query.path || '/start').startsWith('/')
      ? req.query.path
      : `/${req.query.path}`;

    try {
      const body = await parseRawBody(req);
      proxyRobotHostRequest(res, {
        host,
        port,
        path,
        method: 'POST',
        body,
      });
    } catch (err) {
      res.status(400).json({ ok: false, error: err.message || 'Invalid request body' });
    }
  });
};
