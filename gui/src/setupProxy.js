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

    const proxyReq = http.get(
      { host, port, path, timeout: REQUEST_TIMEOUT_MS },
      (proxyRes) => {
        let body = '';
        proxyRes.setEncoding('utf8');
        proxyRes.on('data', (chunk) => {
          body += chunk;
        });
        proxyRes.on('end', () => {
          const ok = proxyRes.statusCode >= 200 && proxyRes.statusCode < 300;
          res.status(ok ? 200 : 502).json({
            ok,
            status: proxyRes.statusCode,
            body: body.trim(),
          });
        });
      },
    );

    proxyReq.on('timeout', () => {
      proxyReq.destroy();
      res.status(504).json({ ok: false, error: 'Request timed out' });
    });

    proxyReq.on('error', (err) => {
      res.status(502).json({
        ok: false,
        error: err.message || 'Could not reach robot launcher',
      });
    });
  });
};
