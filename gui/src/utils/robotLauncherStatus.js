import { DOCKER_STATUS, HOST_REACHABILITY } from './robotHostStatus';

/** Combined robot indicator + launch server (port 8080) reachability. */
export const HOST_STATUS = {
  CHECKING: 'checking',
  OFFLINE: 'offline',
  HOST_ONLINE: 'host_online',
  AVAILABLE: 'available',
  RUNNING: 'running',
};

export const POLL_INTERVAL_MS = 15000;
export const SELECTED_POLL_INTERVAL_MS = 3000;

export const STATUS_LABELS = {
  [HOST_STATUS.CHECKING]: 'Checking…',
  [HOST_STATUS.OFFLINE]: 'Unreachable',
  [HOST_STATUS.HOST_ONLINE]: 'Host on — start Docker',
  [HOST_STATUS.AVAILABLE]: 'Ready to start ROS',
  [HOST_STATUS.RUNNING]: 'ROS running',
};

/**
 * Merge launcher (8080), host service (8081), and Docker state for the status dot.
 * Green = ROS running; amber = launcher ready; grey = host up, Docker stopped; red = unreachable.
 */
export function combineRobotReach(launcherStatus, hostReachability, dockerStatus) {
  const launcher = launcherStatus || HOST_STATUS.OFFLINE;
  const hostReach = hostReachability || HOST_REACHABILITY.OFFLINE;
  const docker = dockerStatus || DOCKER_STATUS.UNKNOWN;
  const dockerUp =
    docker === DOCKER_STATUS.RUNNING ||
    launcher === HOST_STATUS.AVAILABLE ||
    launcher === HOST_STATUS.RUNNING;

  // During polls, keep amber when Docker is up even if /status is momentarily unreachable.
  if (
    dockerUp &&
    hostReach === HOST_REACHABILITY.ONLINE &&
    (launcher === HOST_STATUS.CHECKING || launcher === HOST_STATUS.OFFLINE)
  ) {
    if (launcher === HOST_STATUS.OFFLINE) {
      return HOST_STATUS.AVAILABLE;
    }
  }
  // Launcher poll uses CHECKING while 8080 is down; keep grey only when Docker is not up yet.
  if (launcher === HOST_STATUS.CHECKING && hostReach === HOST_REACHABILITY.ONLINE) {
    return dockerUp ? HOST_STATUS.AVAILABLE : HOST_STATUS.HOST_ONLINE;
  }
  if (hostReach === HOST_REACHABILITY.CHECKING) {
    return HOST_STATUS.CHECKING;
  }
  if (launcher === HOST_STATUS.CHECKING) {
    return HOST_STATUS.CHECKING;
  }
  if (launcher === HOST_STATUS.RUNNING) {
    return HOST_STATUS.RUNNING;
  }
  if (launcher === HOST_STATUS.AVAILABLE) {
    return HOST_STATUS.AVAILABLE;
  }
  if (hostReach === HOST_REACHABILITY.ONLINE) {
    return HOST_STATUS.HOST_ONLINE;
  }
  return HOST_STATUS.OFFLINE;
}

export function parseLauncherStatusBody(body) {
  if (!body || typeof body !== 'string') {
    return HOST_STATUS.OFFLINE;
  }
  try {
    const data = JSON.parse(body);
    if (data.available === true) {
      return HOST_STATUS.AVAILABLE;
    }
    if (data.ros_running === true) {
      return HOST_STATUS.RUNNING;
    }
    if (data.launcher === true) {
      return HOST_STATUS.AVAILABLE;
    }
  } catch {
    /* old servers without JSON /status */
  }
  return HOST_STATUS.OFFLINE;
}
