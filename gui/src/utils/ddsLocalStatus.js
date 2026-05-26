/** Local DDS process state on the operator machine. */
export const DDS_STATUS = {
  CHECKING: 'checking',
  UNCONFIGURED: 'unconfigured',
  STOPPED: 'stopped',
  RUNNING: 'running',
  UNSUPPORTED: 'unsupported',
};

export const DDS_STATUS_LABELS = {
  [DDS_STATUS.CHECKING]: 'Checking…',
  [DDS_STATUS.UNCONFIGURED]: 'Path not configured',
  [DDS_STATUS.STOPPED]: 'Stopped',
  [DDS_STATUS.RUNNING]: 'Running',
  [DDS_STATUS.UNSUPPORTED]: 'Use Electron or npm start',
};

/** Background poll while path is verified (WSL/docker checks are expensive). */
export const DDS_POLL_INTERVAL_MS = 8000;

/**
 * @param {{ running?: boolean, configured?: boolean, error?: string }} payload
 * @param {{ hasBridge: boolean, platformDir: string }} context
 */
export function parseDdsStatusPayload(payload, context) {
  if (!context.hasBridge) {
    return DDS_STATUS.UNSUPPORTED;
  }
  if (!context.platformDir) {
    return DDS_STATUS.UNCONFIGURED;
  }
  if (payload?.configured === false) {
    return DDS_STATUS.UNCONFIGURED;
  }
  if (payload?.running) {
    return DDS_STATUS.RUNNING;
  }
  return DDS_STATUS.STOPPED;
}
