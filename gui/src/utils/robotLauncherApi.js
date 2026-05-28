import { DEFAULT_PORT, normalizeHostInput } from './robotLauncherStorage';

const REQUEST_TIMEOUT_MS = 20000;
const SOFTWARE_UPDATE_TIMEOUT_MS = 660000;
const STATUS_REQUEST_TIMEOUT_MS = 5000;

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

async function requestRobotLauncherRaw(host, path, timeoutMs) {
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

function buildLauncherPath(path, options = {}) {
  const route = path.startsWith('/') ? path : `/${path}`;
  const pathname = route.split('?')[0];
  if (pathname !== '/start') {
    return route;
  }
  const params = new URLSearchParams();
  params.set('social', Boolean(options.social) ? 'true' : 'false');
  params.set('multi', Boolean(options.multi) ? 'true' : 'false');
  return `/start?${params.toString()}`;
}

/**
 * GET the robot launch server (/start or /stop). Uses Electron IPC when available,
 * dev proxy in development, otherwise direct fetch (may fail on browser CORS).
 * @param {string} host
 * @param {string} path
 * @param {{ social?: boolean, multi?: boolean }} [options] — for /start, planner launch args
 */
export async function requestRobotLauncher(host, path, options = {}) {
  const route = buildLauncherPath(path, options);
  return requestRobotLauncherRaw(host, route, REQUEST_TIMEOUT_MS);
}

/**
 * Build path for GET /host-poweroff (optional token query).
 * @param {string} [token]
 */
export function buildHostPowerOffPath(token = '') {
  const trimmed = (token || '').trim();
  if (!trimmed) {
    return '/host-poweroff';
  }
  const params = new URLSearchParams();
  params.set('token', trimmed);
  return `/host-poweroff?${params.toString()}`;
}

/**
 * Stop ROS, stop the robot container, and power off the host (launch_server /host-poweroff).
 * @param {string} host
 * @param {string} [token]
 */
export async function requestRobotHostPowerOff(host, token = '') {
  return requestRobotLauncherRaw(host, buildHostPowerOffPath(token), REQUEST_TIMEOUT_MS);
}

/**
 * Build path for GET /software-update (optional stop/build query).
 * @param {{ stopRos?: boolean, build?: boolean }} [options]
 */
export function buildSoftwareUpdatePath(options = {}) {
  const params = new URLSearchParams();
  if (Boolean(options.stopRos)) {
    params.set('stop', 'true');
  }
  if (Boolean(options.build)) {
    params.set('build', 'true');
  }
  const qs = params.toString();
  return qs ? `/software-update?${qs}` : '/software-update';
}

/**
 * Run git pull on configured repos via launch_server GET /software-update.
 * @param {string} host
 * @param {{ stopRos?: boolean, build?: boolean }} [options]
 */
export async function requestRobotSoftwareUpdate(host, options = {}) {
  return requestRobotLauncherRaw(
    host,
    buildSoftwareUpdatePath(options),
    SOFTWARE_UPDATE_TIMEOUT_MS,
  );
}

/** Parse /software-update JSON body into a short user-facing summary. */
export function summarizeSoftwareUpdateBody(body) {
  if (!body) return 'Software update finished.';
  try {
    const data = JSON.parse(body);
    const repos = Array.isArray(data.repos) ? data.repos : [];
    const succeeded = repos.filter((r) => r.ok).length;
    const total = repos.length;
    if (total === 0) {
      return data.message || 'No repositories configured on the robot.';
    }
    const base = data.ok
      ? `Software update succeeded (${succeeded}/${total} repos).`
      : `Software update finished with errors (${succeeded}/${total} repos succeeded).`;
    const catkin = data.catkin_make;
    let catkinNote = '';
    if (catkin && typeof catkin === 'object') {
      catkinNote = catkin.ok
        ? ' catkin_make OK.'
        : ' catkin_make failed.';
    }
    const failed = repos.filter((r) => !r.ok).map((r) => r.path);
    if (failed.length > 0 && failed.length <= 3) {
      return `${base}${catkinNote} Failed: ${failed.join(', ')}`;
    }
    return `${base}${catkinNote}`;
  } catch {
    return body.trim() || 'Software update finished.';
  }
}

/** GET /status — short timeout, no throw on unreachable host (returns { ok: false }). */
export async function fetchRobotLauncherStatus(host) {
  const cleanHost = normalizeHostInput(host);
  if (!cleanHost) {
    return { ok: false, body: '' };
  }
  try {
    const result = await requestRobotLauncherRaw(
      cleanHost,
      '/status',
      STATUS_REQUEST_TIMEOUT_MS,
    );
    return { ok: Boolean(result.ok), body: result.body || '' };
  } catch {
    return { ok: false, body: '' };
  }
}
