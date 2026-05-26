const fs = require('fs');
const path = require('path');
const {
  escapeBashSingleQuoted,
  normalizeDdsSettings,
  shellDdsDirFromPlatform,
  DDS_SUBDIR,
} = require('./ddsLocalPaths');
const {
  isWindows,
  getPlatform,
  defaultWslDistro,
  spawnShellCommand,
  combineShellOutput,
} = require('./shellRunner');
const dockerComposeRunner = require('./dockerComposeRunner');

const STOP_TIMEOUT_MS = 15000;
const STATUS_TIMEOUT_MS = 8000;
const START_SCRIPT = 'start_scripts.sh';
const STOP_SCRIPT = 'stop_scripts.sh';
const DDS_ENV_FILE = 'dds_env.sh';

const DDS_SCRIPT_NAMES = [
  'entry_exit.py',
  'heartbeat_publisher.py',
  'goal_publisher.py',
  'location_subscriber.py',
  'data_subscriber.py',
  'image_subscriber.py',
];

function shellDdsDir(platformDir) {
  return shellDdsDirFromPlatform(platformDir, isWindows());
}

function nativeDdsDir(platformDir) {
  return path.join(path.resolve(platformDir.trim()), DDS_SUBDIR);
}

function scriptExists(platformDir, settings) {
  const shellDir = shellDdsDir(platformDir);
  if (!shellDir) return false;

  if (isWindows()) {
    const check = `test -f '${escapeBashSingleQuoted(
      `${shellDir}/${START_SCRIPT}`,
    )}'`;
    const result = spawnShellCommand(check, settings, {
      sync: true,
      timeoutMs: STATUS_TIMEOUT_MS,
    });
    return result.status === 0;
  }

  return fs.existsSync(path.join(nativeDdsDir(platformDir), START_SCRIPT));
}

function ddsEnvExists(platformDir, settings) {
  const shellDir = shellDdsDir(platformDir);
  if (!shellDir) return false;

  if (isWindows()) {
    const check = `test -f '${escapeBashSingleQuoted(`${shellDir}/${DDS_ENV_FILE}`)}'`;
    const result = spawnShellCommand(check, settings, {
      sync: true,
      timeoutMs: STATUS_TIMEOUT_MS,
    });
    return result.status === 0;
  }

  return fs.existsSync(path.join(nativeDdsDir(platformDir), DDS_ENV_FILE));
}

function getDefaultPlatformDir() {
  const candidate = path.resolve(__dirname, '..', '..');
  if (
    fs.existsSync(path.join(candidate, 'compose.yaml')) &&
    fs.existsSync(path.join(candidate, DDS_SUBDIR, START_SCRIPT))
  ) {
    return candidate;
  }
  return '';
}

/** @deprecated use getDefaultPlatformDir */
function getDefaultDdsDir() {
  return getDefaultPlatformDir();
}

function validateSettings(settings) {
  const { platformDir } = normalizeDdsSettings(settings);
  if (!platformDir) {
    return { valid: false, error: 'Enter the path to the dds_robot_platform folder.' };
  }
  if (!scriptExists(platformDir, settings)) {
    const hint = isWindows()
      ? 'dds/start_scripts.sh not found in WSL (check path and WSL distro).'
      : 'dds/start_scripts.sh not found under that folder.';
    return { valid: false, error: hint };
  }
  if (!ddsEnvExists(platformDir, settings)) {
    return {
      valid: false,
      error: `Missing dds/${DDS_ENV_FILE}. Copy dds_env.sh.example to dds_env.sh.`,
    };
  }
  if (!dockerComposeRunner.composeYamlExistsForSettings(settings)) {
    return {
      valid: false,
      error: 'Missing compose.yaml at platform root.',
    };
  }
  return { valid: true, error: null };
}

function statusProbeCommand(shellDir) {
  const dir = escapeBashSingleQuoted(shellDir);
  const checks = DDS_SCRIPT_NAMES.map((name) => {
    const safe = String(name || '').replace(/'/g, '');
    const first = safe[0];
    const rest = safe.slice(1);
    const pattern = `[${first}]${rest}`;
    return `pgrep -f '${pattern}' >/dev/null 2>&1`;
  }).join(' || ');

  return `cd '${dir}' && if ${checks}; then echo running; else echo stopped; fi`;
}

async function getDdsStatus(settings) {
  const platform = getPlatform();
  const { platformDir } = normalizeDdsSettings(settings);
  const configured = Boolean(platformDir);
  if (!configured) {
    return { running: false, platform, configured: false };
  }

  const validation = validateSettings(settings);
  if (!validation.valid) {
    return {
      running: false,
      platform,
      configured: false,
      error: validation.error,
    };
  }

  const shellDir = shellDdsDir(platformDir);
  const result = spawnShellCommand(statusProbeCommand(shellDir), settings, {
    sync: true,
    timeoutMs: STATUS_TIMEOUT_MS,
  });

  if (result.error || result.status !== 0) {
    return {
      running: false,
      platform,
      configured: true,
      probeError: combineShellOutput(result) || 'Status check failed in WSL/bash',
    };
  }

  const stdout = (result.stdout || '').trim().toLowerCase();
  const running = stdout.includes('running');
  return { running, platform, configured: true };
}

const BASH_INIT_CONDA =
  'export PATH="$HOME/miniconda3/bin:${PATH:-}"; ' +
  'if ! command -v conda >/dev/null 2>&1; then ' +
  'for _conda_sh in "$HOME/miniconda3/etc/profile.d/conda.sh" ' +
  '"$HOME/anaconda3/etc/profile.d/conda.sh" ' +
  '"$HOME/mambaforge/etc/profile.d/conda.sh" ' +
  '"$HOME/miniforge3/etc/profile.d/conda.sh" ' +
  '"/opt/conda/etc/profile.d/conda.sh"; do ' +
  'if [ -f "$_conda_sh" ]; then . "$_conda_sh"; break; fi; ' +
  'done; fi';

function quoteForBashC(command) {
  return `'${String(command).replace(/'/g, `'\\''`)}'`;
}

function nohupStartScriptsCommand(shellDir) {
  const dir = escapeBashSingleQuoted(shellDir);
  const inner = `${BASH_INIT_CONDA} && cd '${dir}' && ./${START_SCRIPT}`;
  return `nohup bash -c ${quoteForBashC(inner)}`;
}

async function startDds(settings) {
  const validation = validateSettings(settings);
  if (!validation.valid) {
    return { ok: false, error: validation.error };
  }

  const status = await getDdsStatus(settings);
  if (status.running) {
    return { ok: true, body: 'DDS is already running.' };
  }

  const shellDir = shellDdsDir(normalizeDdsSettings(settings).platformDir);

  const checks = DDS_SCRIPT_NAMES.map((name) => {
    const safe = String(name || '').replace(/'/g, '');
    const first = safe[0];
    const rest = safe.slice(1);
    const pattern = `[${first}]${rest}`;
    return `pgrep -f '${pattern}' >/dev/null 2>&1`;
  }).join(' || ');

  const logPath = '/tmp/dds_local_start.log';

  const attemptCommand =
    `rm -f '${logPath}' && ` +
    `(${nohupStartScriptsCommand(shellDir)} >> '${logPath}' 2>&1 &) && sleep 5 && ` +
    `if ${checks}; then echo running; else echo failed; tail -n 120 '${logPath}' 2>/dev/null || true; fi`;

  const result = spawnShellCommand(attemptCommand, settings, {
    sync: true,
    timeoutMs: 30000,
  });

  const combined = combineShellOutput(result);

  if ((result.stdout || '').toLowerCase().includes('running')) {
    return { ok: true, body: 'DDS started.' };
  }

  return {
    ok: false,
    error: combined || 'DDS failed to start (no matching processes found).',
  };
}

async function stopDds(settings) {
  const validation = validateSettings(settings);
  if (!validation.valid) {
    return { ok: false, error: validation.error };
  }

  const shellDir = shellDdsDir(normalizeDdsSettings(settings).platformDir);
  const result = spawnShellCommand(
    `cd '${escapeBashSingleQuoted(shellDir)}' && ./${STOP_SCRIPT}`,
    settings,
    {
      sync: true,
      timeoutMs: STOP_TIMEOUT_MS,
    },
  );

  const combined = combineShellOutput(result);

  if (result.error) {
    return { ok: false, error: result.error.message || 'Stop failed.' };
  }
  if (result.status !== 0 && !combined) {
    return { ok: false, error: `stop_scripts.sh exited with code ${result.status}` };
  }

  return {
    ok: true,
    body: combined || 'DDS processes stopped.',
  };
}

module.exports = {
  getDefaultPlatformDir,
  getDefaultDdsDir,
  validateSettings,
  getDdsStatus,
  startDds,
  stopDds,
  defaultWslDistro,
};
