const fs = require('fs');
const path = require('path');
const {
  escapeBashSingleQuoted,
  normalizeDdsSettings,
  shellDdsDirFromPlatform,
  shellPlatformRoot,
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
const {
  DDS_CONTAINER,
  START_SCRIPT,
  STOP_SCRIPT,
  isDdsContainerRunningCheck,
  ddsStatusCommand,
  ddsScriptsRunningCheckViaExec,
  startDdsScriptsCommand,
  stopDdsScriptsCommand,
  withPlatformCwd,
} = require('./ddsContainerShell');

const STOP_TIMEOUT_MS = 15000;
const STATUS_TIMEOUT_MS = 8000;
const DDS_ENV_FILE = 'dds_env.sh';

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
    const check = `test -f '${escapeBashSingleQuoted(`${shellDir}/${START_SCRIPT}`)}'`;
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

  const shellRoot = shellPlatformRoot(platformDir, isWindows());
  const result = spawnShellCommand(withPlatformCwd(shellRoot, ddsStatusCommand()), settings, {
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

async function startDds(settings) {
  const validation = validateSettings(settings);
  if (!validation.valid) {
    return { ok: false, error: validation.error };
  }

  const status = await getDdsStatus(settings);
  if (status.running) {
    return { ok: true, body: 'DDS is already running.' };
  }

  const shellRoot = shellPlatformRoot(normalizeDdsSettings(settings).platformDir, isWindows());

  const startAttempt = withPlatformCwd(
    shellRoot,
    `if ! ${isDdsContainerRunningCheck()}; then echo container_stopped; exit 0; fi && ` +
      `${startDdsScriptsCommand()} && sleep 5 && ` +
      `(if ${ddsScriptsRunningCheckViaExec()}; then echo running; ` +
      `else echo failed; docker logs ${DDS_CONTAINER} --tail 120 2>&1 || true; fi)`,
  );

  const result = spawnShellCommand(startAttempt, settings, {
    sync: true,
    timeoutMs: 30000,
  });

  const combined = combineShellOutput(result);
  const stdout = (result.stdout || '').toLowerCase();

  if (stdout.includes('container_stopped')) {
    return {
      ok: false,
      error: 'DDS container is not running. Start Docker Compose first.',
    };
  }

  if (stdout.includes('running')) {
    return { ok: true, body: 'DDS started.' };
  }

  return {
    ok: false,
    error: combined || 'DDS failed to start (no matching processes found in container).',
  };
}

async function stopDds(settings) {
  const validation = validateSettings(settings);
  if (!validation.valid) {
    return { ok: false, error: validation.error };
  }

  const shellRoot = shellPlatformRoot(normalizeDdsSettings(settings).platformDir, isWindows());
  const result = spawnShellCommand(
    withPlatformCwd(
      shellRoot,
      `if ! ${isDdsContainerRunningCheck()}; then echo 'DDS container is not running.'; exit 0; fi && ${stopDdsScriptsCommand()}`,
    ),
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
