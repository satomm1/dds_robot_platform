const { escapeBashSingleQuoted } = require('./ddsLocalPaths');

/** Must match compose.yaml `container_name` for the dds service. */
const DDS_CONTAINER = 'dds';
const START_SCRIPT = 'start_scripts.sh';
const STOP_SCRIPT = 'stop_scripts.sh';

const DDS_SCRIPT_NAMES = [
  'entry_exit.py',
  'heartbeat_publisher.py',
  'goal_publisher.py',
  'location_subscriber.py',
  'data_subscriber.py',
  'image_subscriber.py',
];

function ddsProcessChecksFragment() {
  return DDS_SCRIPT_NAMES.map((name) => {
    const safe = String(name || '').replace(/'/g, '');
    const first = safe[0];
    const rest = safe.slice(1);
    const pattern = `[${first}]${rest}`;
    return `pgrep -f '${pattern}' >/dev/null 2>&1`;
  }).join(' || ');
}

function isDdsContainerRunningCheck() {
  return `docker inspect -f '{{.State.Running}}' ${DDS_CONTAINER} 2>/dev/null | grep -q true`;
}

function ddsScriptsRunningCheckViaExec() {
  const checks = ddsProcessChecksFragment();
  return `docker exec ${DDS_CONTAINER} bash -lc "${checks}"`;
}

function ddsStatusCommand(runningLabel = 'running', stoppedLabel = 'stopped') {
  const checks = ddsProcessChecksFragment();
  return (
    `if ${isDdsContainerRunningCheck()}; then ` +
    `docker exec ${DDS_CONTAINER} bash -lc "if ${checks}; then echo ${runningLabel}; else echo ${stoppedLabel}; fi"; ` +
    `else echo ${stoppedLabel}; fi`
  );
}

function startDdsScriptsCommand() {
  return `docker exec -d ${DDS_CONTAINER} ./${START_SCRIPT}`;
}

function stopDdsScriptsCommand() {
  return `docker exec ${DDS_CONTAINER} ./${STOP_SCRIPT}`;
}

function withPlatformCwd(shellRoot, inner) {
  return `cd '${escapeBashSingleQuoted(shellRoot)}' && ${inner}`;
}

module.exports = {
  DDS_CONTAINER,
  DDS_SCRIPT_NAMES,
  START_SCRIPT,
  STOP_SCRIPT,
  ddsProcessChecksFragment,
  isDdsContainerRunningCheck,
  ddsScriptsRunningCheckViaExec,
  ddsStatusCommand,
  startDdsScriptsCommand,
  stopDdsScriptsCommand,
  withPlatformCwd,
};
