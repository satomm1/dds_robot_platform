const fs = require('fs');
const path = require('path');
const {
  escapeBashSingleQuoted,
  normalizeDdsSettings,
  shellPlatformRoot,
  shellDdsDirFromPlatform,
} = require('./ddsLocalPaths');
const {
  isWindows,
  getPlatform,
  spawnShellCommandAsync,
  combineShellOutput,
} = require('./shellRunner');

const COMPOSE_FILE = 'compose.yaml';
const CAPTURE_SUBDIR = 'capture';
const DDS_ENV_FILE = 'dds_env.sh';
const STATUS_TIMEOUT_MS = 15000;
const UP_TIMEOUT_MS = 180000;
const DOWN_TIMEOUT_MS = 90000;
const RUNNING_PROBE =
  "ps --status running -q 2>/dev/null | grep -q . && echo running || echo stopped";
const MISSING_MARKER = 'missing';

async function shellFileExists(filePath, settings, timeoutMs = STATUS_TIMEOUT_MS) {
  if (!filePath) return false;
  if (isWindows()) {
    const check = `test -f '${escapeBashSingleQuoted(filePath)}'`;
    const result = await spawnShellCommandAsync(check, settings, { timeoutMs });
    return result.status === 0;
  }
  try {
    await fs.promises.access(filePath);
    return true;
  } catch {
    return false;
  }
}

/** Prefix that prints MISSING_MARKER and exits 0 when the file is absent. */
function requireFileCommand(filePath) {
  return `[ -f '${escapeBashSingleQuoted(filePath)}' ] || { echo ${MISSING_MARKER}; exit 0; }; `;
}

async function composeFileExists(platformDir, settings) {
  const root = shellPlatformRoot(platformDir, isWindows());
  if (!root) return false;
  return shellFileExists(`${root}/${COMPOSE_FILE}`, settings);
}

function shellCaptureDir(platformDir) {
  const root = shellPlatformRoot(platformDir, isWindows());
  if (!root) return '';
  return path.posix.join(root, CAPTURE_SUBDIR);
}

async function captureComposeFileExists(platformDir, settings) {
  const captureDir = shellCaptureDir(platformDir);
  if (!captureDir) return false;
  return shellFileExists(`${captureDir}/${COMPOSE_FILE}`, settings);
}

function sourceDdsEnvPrefix(shellDdsDir) {
  const envPath = escapeBashSingleQuoted(`${shellDdsDir}/${DDS_ENV_FILE}`);
  return `set -a && . '${envPath}' && set +a && `;
}

function dockerComposeCommand(shellPlatformRootPath, shellDdsDirPath, composeArgs) {
  const root = escapeBashSingleQuoted(shellPlatformRootPath);
  const dds = escapeBashSingleQuoted(shellDdsDirPath);
  return `${sourceDdsEnvPrefix(dds)}cd '${root}' && docker compose ${composeArgs}`;
}

/** Capture stack: cwd is capture/; Compose loads capture/.env (no dds_env.sh). */
function captureDockerComposeCommand(shellCaptureDirPath, composeArgs) {
  const capture = escapeBashSingleQuoted(shellCaptureDirPath);
  return `cd '${capture}' && docker compose ${composeArgs}`;
}

async function composeYamlExistsForSettings(settings) {
  const { platformDir } = normalizeDdsSettings(settings);
  if (!platformDir) return false;
  return composeFileExists(platformDir, settings);
}

/**
 * Check the compose file and probe running services in a single shell call.
 * @returns {Promise<{ running: boolean, platform: string, configured: boolean, error?: string, probeError?: string }>}
 */
async function probeComposeStatus(settings, { composeFilePath, probeCommand, missingError, probeFailedError }) {
  const platform = getPlatform();
  const missing = { running: false, platform, configured: false, error: missingError };
  if (!composeFilePath) {
    return missing;
  }

  const result = await spawnShellCommandAsync(
    `${requireFileCommand(composeFilePath)}${probeCommand}`,
    settings,
    { timeoutMs: STATUS_TIMEOUT_MS },
  );

  if (result.error || result.status !== 0) {
    return {
      running: false,
      platform,
      configured: true,
      probeError: combineShellOutput(result) || probeFailedError,
    };
  }

  const stdout = (result.stdout || '').trim().toLowerCase();
  const lastLine = stdout.split(/\r?\n/).pop().trim();
  if (lastLine === MISSING_MARKER) {
    return missing;
  }
  return {
    running: stdout.includes('running'),
    platform,
    configured: true,
  };
}

async function getDockerStatus(settings) {
  const { platformDir } = normalizeDdsSettings(settings);
  if (!platformDir) {
    return { running: false, platform: getPlatform(), configured: false };
  }

  const root = shellPlatformRoot(platformDir, isWindows());
  const dds = shellDdsDirFromPlatform(platformDir, isWindows());
  return probeComposeStatus(settings, {
    composeFilePath: root ? `${root}/${COMPOSE_FILE}` : '',
    probeCommand: dockerComposeCommand(root, dds, RUNNING_PROBE),
    missingError: `Missing ${COMPOSE_FILE} at platform root.`,
    probeFailedError: 'Docker status check failed.',
  });
}

async function dockerComposeUp(settings) {
  const { platformDir } = normalizeDdsSettings(settings);
  if (!platformDir) {
    return { ok: false, error: 'Enter the path to the dds_robot_platform folder.' };
  }
  if (!(await composeFileExists(platformDir, settings))) {
    return {
      ok: false,
      error: `Missing ${COMPOSE_FILE} at platform root.`,
    };
  }

  const status = await getDockerStatus(settings);
  if (status.running) {
    return { ok: true, body: 'Docker Compose is already running.' };
  }

  const root = shellPlatformRoot(platformDir, isWindows());
  const dds = shellDdsDirFromPlatform(platformDir, isWindows());
  const cmd = dockerComposeCommand(root, dds, 'up -d');
  const result = await spawnShellCommandAsync(cmd, settings, {
    timeoutMs: UP_TIMEOUT_MS,
  });

  const combined = combineShellOutput(result);
  if (result.error) {
    return { ok: false, error: result.error.message || 'docker compose up failed.' };
  }
  if (result.status !== 0) {
    return {
      ok: false,
      error: combined || `docker compose up exited with code ${result.status}`,
    };
  }

  const after = await getDockerStatus(settings);
  if (!after.running) {
    const tail = combined.slice(-2000);
    return {
      ok: false,
      error: tail || 'docker compose up finished but no running services detected.',
    };
  }

  return { ok: true, body: 'Docker Compose started.' };
}

async function dockerComposeDown(settings) {
  const { platformDir } = normalizeDdsSettings(settings);
  if (!platformDir) {
    return { ok: false, error: 'Enter the path to the dds_robot_platform folder.' };
  }
  if (!(await composeFileExists(platformDir, settings))) {
    return {
      ok: false,
      error: `Missing ${COMPOSE_FILE} at platform root.`,
    };
  }

  const root = shellPlatformRoot(platformDir, isWindows());
  const dds = shellDdsDirFromPlatform(platformDir, isWindows());
  const cmd = dockerComposeCommand(root, dds, 'down');
  const result = await spawnShellCommandAsync(cmd, settings, {
    timeoutMs: DOWN_TIMEOUT_MS,
  });

  const combined = combineShellOutput(result);
  if (result.error) {
    return { ok: false, error: result.error.message || 'docker compose down failed.' };
  }
  if (result.status !== 0) {
    return {
      ok: false,
      error: combined || `docker compose down exited with code ${result.status}`,
    };
  }

  return { ok: true, body: combined || 'Docker Compose stopped.' };
}

async function getCaptureDockerStatus(settings) {
  const { platformDir } = normalizeDdsSettings(settings);
  if (!platformDir) {
    return { running: false, platform: getPlatform(), configured: false };
  }

  const captureDir = shellCaptureDir(platformDir);
  return probeComposeStatus(settings, {
    composeFilePath: captureDir ? `${captureDir}/${COMPOSE_FILE}` : '',
    probeCommand: captureDockerComposeCommand(captureDir, RUNNING_PROBE),
    missingError: `Missing ${COMPOSE_FILE} in ${CAPTURE_SUBDIR}/.`,
    probeFailedError: 'Capture Docker status check failed.',
  });
}

async function captureDockerComposeUp(settings) {
  const { platformDir } = normalizeDdsSettings(settings);
  if (!platformDir) {
    return { ok: false, error: 'Enter the path to the dds_robot_platform folder.' };
  }
  if (!(await captureComposeFileExists(platformDir, settings))) {
    return {
      ok: false,
      error: `Missing ${COMPOSE_FILE} in ${CAPTURE_SUBDIR}/.`,
    };
  }

  const status = await getCaptureDockerStatus(settings);
  if (status.running) {
    return { ok: true, body: 'Capture Docker Compose is already running.' };
  }

  const captureDir = shellCaptureDir(platformDir);
  const cmd = captureDockerComposeCommand(captureDir, 'up -d');
  const result = await spawnShellCommandAsync(cmd, settings, {
    timeoutMs: UP_TIMEOUT_MS,
  });

  const combined = combineShellOutput(result);
  if (result.error) {
    return { ok: false, error: result.error.message || 'capture docker compose up failed.' };
  }
  if (result.status !== 0) {
    return {
      ok: false,
      error: combined || `capture docker compose up exited with code ${result.status}`,
    };
  }

  const after = await getCaptureDockerStatus(settings);
  if (!after.running) {
    const tail = combined.slice(-2000);
    return {
      ok: false,
      error: tail || 'capture docker compose up finished but no running services detected.',
    };
  }

  return { ok: true, body: 'Capture Docker Compose started.' };
}

async function captureDockerComposeDown(settings) {
  const { platformDir } = normalizeDdsSettings(settings);
  if (!platformDir) {
    return { ok: false, error: 'Enter the path to the dds_robot_platform folder.' };
  }
  if (!(await captureComposeFileExists(platformDir, settings))) {
    return {
      ok: false,
      error: `Missing ${COMPOSE_FILE} in ${CAPTURE_SUBDIR}/.`,
    };
  }

  const captureDir = shellCaptureDir(platformDir);
  const cmd = captureDockerComposeCommand(captureDir, 'down');
  const result = await spawnShellCommandAsync(cmd, settings, {
    timeoutMs: DOWN_TIMEOUT_MS,
  });

  const combined = combineShellOutput(result);
  if (result.error) {
    return { ok: false, error: result.error.message || 'capture docker compose down failed.' };
  }
  if (result.status !== 0) {
    return {
      ok: false,
      error: combined || `capture docker compose down exited with code ${result.status}`,
    };
  }

  return { ok: true, body: combined || 'Capture Docker Compose stopped.' };
}

module.exports = {
  composeYamlExistsForSettings,
  getDockerStatus,
  dockerComposeUp,
  dockerComposeDown,
  getCaptureDockerStatus,
  captureDockerComposeUp,
  captureDockerComposeDown,
};
