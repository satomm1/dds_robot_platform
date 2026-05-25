const http = require('http');

const REQUEST_TIMEOUT_MS = 20000;

/**
 * Dev-only proxy so the React app can call robot launch servers on the LAN without CORS.
 * Packaged Electron uses IPC instead (see electron/main.js).
 */
module.exports = function setupRobotLauncherProxy(app) {
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
