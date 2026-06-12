const { escapeBashSingleQuoted } = require('./ddsLocalPaths');

const START_SCRIPT = 'start_scripts.sh';
const STOP_SCRIPT = 'stop_scripts.sh';
const START_LOG = 'dds_scripts.log';

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

function ddsScriptsRunningCheck() {
  return ddsProcessChecksFragment();
}

function ddsStatusCommand(runningLabel = 'running', stoppedLabel = 'stopped') {
  const checks = ddsProcessChecksFragment();
  return `if ${checks}; then echo ${runningLabel}; else echo ${stoppedLabel}; fi`;
}

function startDdsScriptsCommand() {
  // Subshell so callers can chain with `&&` after backgrounding start_scripts.sh.
  return `(nohup ./${START_SCRIPT} >> ${START_LOG} 2>&1 &)`;
}

function stopDdsScriptsCommand() {
  return `./${STOP_SCRIPT}`;
}

function withDdsCwd(shellDdsDir, inner) {
  return `cd '${escapeBashSingleQuoted(shellDdsDir)}' && ${inner}`;
}

module.exports = {
  START_SCRIPT,
  STOP_SCRIPT,
  START_LOG,
  DDS_SCRIPT_NAMES,
  ddsProcessChecksFragment,
  ddsScriptsRunningCheck,
  ddsStatusCommand,
  startDdsScriptsCommand,
  stopDdsScriptsCommand,
  withDdsCwd,
};
