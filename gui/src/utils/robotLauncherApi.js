import { DEFAULT_PORT, normalizeHostInput } from './robotLauncherStorage';

const REQUEST_TIMEOUT_MS = 20000;

function launchUrl(host, port, path) {
  const h = normalizeHostInput(host);
  const p = Number(port) > 0 ? Number(port) : DEFAULT_PORT;
  const route = path.startsWith('/') ? path : `/${path}`;
  return `http://${h}:${p}${route}`;
}

async function parseResponse(res) {
  let body = '';
  try {
    body = await res.text();
  } catch {
    body = '';
  }
  return {
    ok: res.ok,
    status: res.status,
    body: body.trim(),
  };
}

/**
 * GET the robot launch server (/start or /stop). Uses Electron IPC when available,
 * dev proxy in development, otherwise direct fetch (may fail on browser CORS).
 */
export async function requestRobotLauncher(host, path) {
  const cleanHost = normalizeHostInput(host);
  if (!cleanHost) {
    throw new Error('Enter a robot IP address or hostname.');
  }
  const portNum = DEFAULT_PORT;
  const route = path.startsWith('/') ? path : `/${path}`;

  if (window.robotLauncher?.request) {
    return window.robotLauncher.request({
      host: cleanHost,
      port: portNum,
      path: route,
    });
  }

  if (process.env.NODE_ENV === 'development') {
    const params = new URLSearchParams({
      host: cleanHost,
      port: String(portNum),
      path: route,
    });
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const res = await fetch(`/api/robot-launcher?${params}`, {
        signal: controller.signal,
      });
      const data = await res.json();
      if (!res.ok && data?.error) {
        throw new Error(data.error);
      }
      return data;
    } finally {
      clearTimeout(timer);
    }
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(launchUrl(cleanHost, portNum, route), {
      method: 'GET',
      signal: controller.signal,
    });
    return parseResponse(res);
  } catch (err) {
    if (err.name === 'AbortError') {
      throw new Error('Request timed out. Check the robot IP and that port 8080 is reachable.');
    }
    throw new Error(
      'Could not reach the robot launcher. Use the Electron app or check network/CORS.',
    );
  } finally {
    clearTimeout(timer);
  }
}
