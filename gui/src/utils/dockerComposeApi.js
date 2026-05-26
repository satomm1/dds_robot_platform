const REQUEST_TIMEOUT_MS = 20000;
const UP_TIMEOUT_MS = 200000;

function hasDockerBridge() {
  return Boolean(window.dockerCompose) || process.env.NODE_ENV === 'development';
}

async function devFetch(path, options = {}, timeoutMs = REQUEST_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(path, { ...options, signal: controller.signal });
    const data = await res.json().catch(() => ({}));
    if (!res.ok && data?.error) {
      throw new Error(data.error);
    }
    return data;
  } catch (err) {
    if (err.name === 'AbortError') {
      throw new Error('Request timed out.');
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * @param {{ platformDir?: string, wslDistro?: string }} settings
 */
export async function fetchDockerComposeStatus(settings) {
  if (!hasDockerBridge()) {
    return { running: false, configured: false, platform: '' };
  }
  if (window.dockerCompose?.status) {
    return window.dockerCompose.status(settings);
  }
  if (process.env.NODE_ENV === 'development') {
    const params = new URLSearchParams({
      platformDir: settings.platformDir || '',
      wslDistro: settings.wslDistro || '',
    });
    return devFetch(`/api/docker-compose/status?${params}`);
  }
  return { running: false, configured: false, platform: '' };
}

/**
 * @param {{ platformDir?: string, wslDistro?: string }} settings
 */
export async function dockerComposeUp(settings) {
  if (window.dockerCompose?.up) {
    return window.dockerCompose.up(settings);
  }
  if (process.env.NODE_ENV === 'development') {
    return devFetch(
      '/api/docker-compose/up',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings),
      },
      UP_TIMEOUT_MS,
    );
  }
  throw new Error('Docker Compose control requires the Electron app or npm start.');
}

/**
 * @param {{ platformDir?: string, wslDistro?: string }} settings
 */
export async function dockerComposeDown(settings) {
  if (window.dockerCompose?.down) {
    return window.dockerCompose.down(settings);
  }
  if (process.env.NODE_ENV === 'development') {
    return devFetch(
      '/api/docker-compose/down',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings),
      },
      REQUEST_TIMEOUT_MS,
    );
  }
  throw new Error('Docker Compose control requires the Electron app or npm start.');
}

export { hasDockerBridge };
