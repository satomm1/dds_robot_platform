import { HOST_SERVICE_PORT, normalizeHostInput } from './robotLauncherStorage';

const REQUEST_TIMEOUT_MS = 20000;
const STATUS_REQUEST_TIMEOUT_MS = 5000;
const DOCKER_ACTION_TIMEOUT_MS = 120000;
export const MAP_SYNC_TIMEOUT_MS = 120000;

function hostUrl(host, port, path) {
  const h = normalizeHostInput(host);
  const p = Number(port) > 0 ? Number(port) : HOST_SERVICE_PORT;
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

async function requestRobotHostRaw(host, path, timeoutMs) {
  const cleanHost = normalizeHostInput(host);
  if (!cleanHost) {
    throw new Error('Enter a robot IP address or hostname.');
  }
  const portNum = HOST_SERVICE_PORT;
  const route = path.startsWith('/') ? path : `/${path}`;

  if (window.robotLauncher?.request) {
    return window.robotLauncher.request({
      host: cleanHost,
      port: portNum,
      path: route,
      timeoutMs,
    });
  }

  if (process.env.NODE_ENV === 'development') {
    const params = new URLSearchParams({
      host: cleanHost,
      port: String(portNum),
      path: route,
    });
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
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
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(hostUrl(cleanHost, portNum, route), {
      method: 'GET',
      signal: controller.signal,
    });
    return parseResponse(res);
  } catch (err) {
    if (err.name === 'AbortError') {
      throw new Error(
        'Request timed out. Check the robot IP and that port 8081 is reachable.',
      );
    }
    throw new Error(
      'Could not reach the robot host service. Use the Electron app or check network/CORS.',
    );
  } finally {
    clearTimeout(timer);
  }
}

export function buildHostPowerOffPath(token = '') {
  const trimmed = (token || '').trim();
  if (!trimmed) {
    return '/poweroff';
  }
  const params = new URLSearchParams();
  params.set('token', trimmed);
  return `/poweroff?${params.toString()}`;
}

/** GET /status on the Jetson host service (port 8081). */
export async function fetchRobotHostStatus(host) {
  const cleanHost = normalizeHostInput(host);
  if (!cleanHost) {
    return { ok: false, body: '' };
  }
  try {
    const result = await requestRobotHostRaw(cleanHost, '/status', STATUS_REQUEST_TIMEOUT_MS);
    return { ok: Boolean(result.ok), body: result.body || '' };
  } catch {
    return { ok: false, body: '' };
  }
}

/** GET /docker-start on the Jetson host service. */
export async function requestRobotDockerStart(host) {
  return requestRobotHostRaw(host, '/docker-start', DOCKER_ACTION_TIMEOUT_MS);
}

/** GET /docker-stop on the Jetson host service. */
export async function requestRobotDockerStop(host) {
  return requestRobotHostRaw(host, '/docker-stop', DOCKER_ACTION_TIMEOUT_MS);
}

/** GET /map on the Jetson host service (current_map.json). */
export async function fetchRobotMapJson(host) {
  try {
    return await requestRobotHostRaw(host, '/map', MAP_SYNC_TIMEOUT_MS);
  } catch (err) {
    const base =
      err.message ||
      'Could not reach the robot host service.';
    throw new Error(
      `${base} Ensure the robot is powered on, host service is installed ` +
        '(jetson-host-install.sh), port 8081 is reachable, and the map was finalized (finalize_map.py).',
    );
  }
}

/**
 * Stop all Docker containers and power off the Jetson host (host service /poweroff).
 * @param {string} host
 * @param {string} [token]
 */
export async function requestRobotHostPowerOff(host, token = '') {
  return requestRobotHostRaw(host, buildHostPowerOffPath(token), REQUEST_TIMEOUT_MS);
}

/** Parse /poweroff JSON body into a short user-facing summary. */
export function summarizeHostPowerOffBody(body) {
  if (!body) return 'Power off scheduled. The robot PC should halt shortly.';
  try {
    const data = JSON.parse(body);
    if (data.message) return data.message;
  } catch {
    // fall through
  }
  return body.trim() || 'Power off scheduled. The robot PC should halt shortly.';
}
