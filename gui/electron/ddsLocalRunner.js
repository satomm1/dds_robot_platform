const { spawn, spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const {
  escapeBashSingleQuoted,
  normalizeDdsSettings,
  resolveDdsDirForShell,
} = require('../src/utils/ddsLocalPaths');

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

let startWrapperPid = null;

function getPlatform() {
  return process.platform;
}

function isWindows() {
  return process.platform === 'win32';
}

function shellDdsDir(ddsDir) {
  return resolveDdsDirForShell(ddsDir, isWindows());
}

function defaultWslDistro() {
  try {
    const result = spawnSync('wsl.exe', ['-l', '-q'], {
      encoding: 'utf8',
      timeout: 5000,
      windowsHide: true,
    });
    const line = (result.stdout || '')
      .split(/\r?\n/)
      .map((l) => l.replace(/\0/g, '').trim())
      .find((l) => l.length > 0);
    if (line) return line;
  } catch {
    /* ignore */
  }
  return 'Ubuntu';
}

function effectiveWslDistro(settings) {
  const distro = normalizeDdsSettings(settings).wslDistro;
  return distro || defaultWslDistro();
}

function spawnShellCommand(innerCommand, settings, options = {}) {
  const { detached = false, sync = false, timeoutMs } = options;

  if (isWindows()) {
    const distro = effectiveWslDistro(settings);
    const wslArgs = ['-d', distro, '--', 'bash', '-lc', innerCommand];
    if (sync) {
      return spawnSync('wsl.exe', wslArgs, {
        encoding: 'utf8',
        timeout: timeoutMs,
        windowsHide: true,
      });
    }
    return spawn('wsl.exe', wslArgs, {
      detached,
      stdio: detached ? 'ignore' : 'pipe',
      windowsHide: true,
    });
  }

  const bashArgs = ['-lc', innerCommand];
  if (sync) {
    return spawnSync('bash', bashArgs, {
      encoding: 'utf8',
      timeout: timeoutMs,
    });
  }
  return spawn('bash', bashArgs, {
    detached,
    stdio: detached ? 'ignore' : 'pipe',
  });
}

function scriptExists(ddsDir, settings) {
  const shellDir = shellDdsDir(ddsDir);
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

  const nativePath = path.resolve(ddsDir.trim());
  return fs.existsSync(path.join(nativePath, START_SCRIPT));
}

function ddsEnvExists(ddsDir, settings) {
  const shellDir = shellDdsDir(ddsDir);
  if (!shellDir) return false;

  if (isWindows()) {
    const check = `test -f '${escapeBashSingleQuoted(`${shellDir}/${DDS_ENV_FILE}`)}'`;
    const result = spawnShellCommand(check, settings, {
      sync: true,
      timeoutMs: STATUS_TIMEOUT_MS,
    });
    return result.status === 0;
  }

  const nativePath = path.resolve(ddsDir.trim());
  return fs.existsSync(path.join(nativePath, DDS_ENV_FILE));
}

function getDefaultDdsDir() {
  const candidate = path.resolve(__dirname, '..', '..', 'dds');
  if (fs.existsSync(path.join(candidate, START_SCRIPT))) {
    return candidate;
  }
  return '';
}

function validateSettings(settings) {
  const { ddsDir } = normalizeDdsSettings(settings);
  if (!ddsDir) {
    return { valid: false, error: 'Enter the path to the dds folder.' };
  }
  if (!scriptExists(ddsDir, settings)) {
    const hint = isWindows()
      ? 'Path not found in WSL (check WSL distro and /mnt/c/ path).'
      : 'start_scripts.sh not found at that path.';
    return { valid: false, error: hint };
  }
  if (!ddsEnvExists(ddsDir, settings)) {
    return {
      valid: false,
      error: `Missing dds/${DDS_ENV_FILE}. Copy dds_env.sh.example to dds_env.sh in that folder.`,
    };
  }
  return { valid: true, error: null };
}

function statusProbeCommand(shellDir) {
  const dir = escapeBashSingleQuoted(shellDir);
  // IMPORTANT: avoid `pgrep -f pattern` self-matching the probe command line.
  // Use the "[p]attern" trick so the regex matches the target process text,
  // but does not match the literal probe string in this bash command.
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
  const { ddsDir } = normalizeDdsSettings(settings);
  const configured = Boolean(ddsDir);
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

  const shellDir = shellDdsDir(ddsDir);
  const result = spawnShellCommand(statusProbeCommand(shellDir), settings, {
    sync: true,
    timeoutMs: STATUS_TIMEOUT_MS,
  });

  if (result.error || result.status !== 0) {
    const errText = [result.stderr, result.stdout, result.error?.message]
      .filter(Boolean)
      .join(' ')
      .trim();
    return {
      running: false,
      platform,
      configured: true,
      probeError: errText || 'Status check failed in WSL/bash',
    };
  }

  const stdout = (result.stdout || '').trim().toLowerCase();
  const running = stdout.includes('running');
  return { running, platform, configured: true };
}

/**
 * Non-interactive WSL/bash often skips .bashrc (and thus conda init).
 * Source common conda.sh locations before start_scripts.sh runs.
 */
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

/** Run start_scripts.sh (sources repo dds_env.sh internally). */
function nohupStartScriptsCommand(shellDir) {
  const dir = escapeBashSingleQuoted(shellDir);
  const inner = `${BASH_INIT_CONDA} && cd '${dir}' && ./${START_SCRIPT}`;
  return `nohup bash -c ${quoteForBashC(inner)}`;
}

function startCommand(shellDir) {
  const dir = escapeBashSingleQuoted(shellDir);
  const inner = `${BASH_INIT_CONDA} && cd '${dir}' && ./${START_SCRIPT}`;
  return `bash -c ${quoteForBashC(inner)}`;
}

function stopCommand(shellDir) {
  return `cd '${escapeBashSingleQuoted(shellDir)}' && ./stop_scripts.sh`;
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

  const shellDir = shellDdsDir(normalizeDdsSettings(settings).ddsDir);

  // Start via `nohup` so background jobs survive after the shell exits.
  // Then verify the expected DDS python processes actually came up.
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

  const stdout = (result.stdout || '').trim();
  const stderr = (result.stderr || '').trim();
  const combined = [stdout, stderr].filter(Boolean).join(' ').trim();

  if (stdout.toLowerCase().includes('running')) {
    startWrapperPid = null;
    return { ok: true, body: 'DDS started.' };
  }

  return {
    ok: false,
    error:
      combined || 'DDS failed to start (no matching processes found).',
  };
}

async function stopDds(settings) {
  const validation = validateSettings(settings);
  if (!validation.valid) {
    return { ok: false, error: validation.error };
  }

  const shellDir = shellDdsDir(normalizeDdsSettings(settings).ddsDir);
  const result = spawnShellCommand(stopCommand(shellDir), settings, {
    sync: true,
    timeoutMs: STOP_TIMEOUT_MS,
  });

  startWrapperPid = null;
  const stderr = (result.stderr || '').trim();
  const stdout = (result.stdout || '').trim();
  const combined = [stdout, stderr].filter(Boolean).join(' ');

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
  getDefaultDdsDir,
  validateSettings,
  getDdsStatus,
  startDds,
  stopDds,
  defaultWslDistro,
};
