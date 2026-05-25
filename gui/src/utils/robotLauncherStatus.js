/** Reachability of the robot launch server (port 8080). */
export const HOST_STATUS = {
  CHECKING: 'checking',
  OFFLINE: 'offline',
  AVAILABLE: 'available',
  RUNNING: 'running',
};

export const POLL_INTERVAL_MS = 15000;
export const SELECTED_POLL_INTERVAL_MS = 3000;

export const STATUS_LABELS = {
  [HOST_STATUS.CHECKING]: 'Checking…',
  [HOST_STATUS.OFFLINE]: 'Offline',
  [HOST_STATUS.AVAILABLE]: 'Ready to start',
  [HOST_STATUS.RUNNING]: 'ROS running',
};

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
