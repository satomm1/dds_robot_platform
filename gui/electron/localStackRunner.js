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
const { ddsStatusCommand } = require('./ddsHostShell');

const DDS_ENV_FILE = 'dds_env.sh';
const STATUS_TIMEOUT_MS = 12000;

/** One WSL/bash invocation for Docker + DDS reachability (avoids serial spawnSync storms). */
function combinedStackStatusCommand(shellRoot, shellDds) {
  const root = escapeBashSingleQuoted(shellRoot);
  const envPath = escapeBashSingleQuoted(`${shellDds}/${DDS_ENV_FILE}`);

  return (
    `set -a && . '${envPath}' && set +a && ` +
    `cd '${root}' && (docker compose ps --status running -q 2>/dev/null | grep -q . && echo docker:running || echo docker:stopped) && ` +
    ddsStatusCommand('dds:running', 'dds:stopped')
  );
}

function parseLineStatus(stdout, prefix) {
  const line = (stdout || '')
    .split(/\r?\n/)
    .map((l) => l.trim().toLowerCase())
    .find((l) => l.startsWith(`${prefix}:`));
  if (!line) return false;
  return line.includes('running');
}

/**
 * Poll Docker Compose + DDS process state in a single non-blocking shell call.
 * @param {{ platformDir?: string, wslDistro?: string }} settings
 */
async function getLocalStackStatus(settings) {
  const platform = getPlatform();
  const { platformDir } = normalizeDdsSettings(settings);

  if (!platformDir) {
    return {
      platform,
      docker: { running: false, configured: false },
      dds: { running: false, configured: false },
    };
  }

  const shellRoot = shellPlatformRoot(platformDir, isWindows());
  const shellDds = shellDdsDirFromPlatform(platformDir, isWindows());
  if (!shellRoot || !shellDds) {
    return {
      platform,
      docker: { running: false, configured: false },
      dds: { running: false, configured: false },
    };
  }

  const result = await spawnShellCommandAsync(
    combinedStackStatusCommand(shellRoot, shellDds),
    settings,
    { timeoutMs: STATUS_TIMEOUT_MS },
  );

  if (result.error || result.status !== 0) {
    const probeError =
      combineShellOutput(result) || 'Local stack status check failed.';
    return {
      platform,
      docker: { running: false, configured: true, probeError },
      dds: { running: false, configured: true, probeError },
    };
  }

  return {
    platform,
    docker: {
      running: parseLineStatus(result.stdout, 'docker'),
      configured: true,
    },
    dds: {
      running: parseLineStatus(result.stdout, 'dds'),
      configured: true,
    },
  };
}

module.exports = {
  getLocalStackStatus,
};
