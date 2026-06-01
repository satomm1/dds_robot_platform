/** Reachability of the Jetson host service (port 8081). */
export const HOST_REACHABILITY = {
  OFFLINE: 'offline',
  ONLINE: 'online',
  CHECKING: 'checking',
};

export const HOST_REACHABILITY_LABELS = {
  [HOST_REACHABILITY.OFFLINE]: 'Host service offline',
  [HOST_REACHABILITY.ONLINE]: 'Host service online',
  [HOST_REACHABILITY.CHECKING]: 'Checking host service…',
};

/** Docker container state reported by host service /status. */
export const DOCKER_STATUS = {
  RUNNING: 'running',
  STOPPED: 'stopped',
  UNKNOWN: 'unknown',
};

export const DOCKER_STATUS_LABELS = {
  [DOCKER_STATUS.RUNNING]: 'Docker running',
  [DOCKER_STATUS.STOPPED]: 'Docker stopped',
  [DOCKER_STATUS.UNKNOWN]: 'Docker status unknown',
};

/**
 * Parse GET /status JSON from host_service.py.
 * @returns {{ reachable: boolean, dockerRunning: boolean }}
 */
export function parseHostStatusBody(body) {
  if (!body) {
    return { reachable: false, dockerRunning: false };
  }
  try {
    const data = JSON.parse(body);
    if (data.host_service === true && typeof data.docker_running === 'boolean') {
      return {
        reachable: true,
        dockerRunning: data.docker_running,
      };
    }
  } catch {
    // ignore
  }
  return { reachable: false, dockerRunning: false };
}

export function dockerStatusFromHostBody(body) {
  const { reachable, dockerRunning } = parseHostStatusBody(body);
  if (!reachable) return DOCKER_STATUS.UNKNOWN;
  return dockerRunning ? DOCKER_STATUS.RUNNING : DOCKER_STATUS.STOPPED;
}

export function hostReachabilityFromFetch(ok, body) {
  if (!ok) return HOST_REACHABILITY.OFFLINE;
  const { reachable } = parseHostStatusBody(body);
  return reachable ? HOST_REACHABILITY.ONLINE : HOST_REACHABILITY.OFFLINE;
}
