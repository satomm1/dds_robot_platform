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
  defaultWslDistro,
  spawnShellCommand,
} = require('./shellRunner');
const dockerComposeRunner = require('./dockerComposeRunner');

const START_SCRIPT = 'start_scripts.sh';
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

async function writeAtomicUtf8(filePath, content) {
  const tmpPath = `${filePath}.tmp`;
  await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
  await fs.promises.writeFile(tmpPath, content, 'utf8');
  await fs.promises.rename(tmpPath, filePath);
}

/**
 * Persist raw map JSON to {platformDir}/dds/user_map.json (atomic write).
 * @param {{ platformDir?: string, wslDistro?: string }} settings
 * @param {string} mapJsonText
 */
async function writeUserMapJson(settings, mapJsonText) {
  const { platformDir } = normalizeDdsSettings(settings);
  if (!platformDir) {
    return { ok: false, error: 'Enter the platform folder in Local Stack settings.' };
  }
  if (typeof mapJsonText !== 'string' || !mapJsonText.trim()) {
    return { ok: false, error: 'Map JSON is empty.' };
  }

  const targetPath = path.join(nativeDdsDir(platformDir), 'user_map.json');

  try {
    await writeAtomicUtf8(targetPath, mapJsonText);
    return { ok: true, path: targetPath };
  } catch (err) {
    return {
      ok: false,
      error: err.message || `Failed to write ${targetPath}`,
    };
  }
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

module.exports = {
  getDefaultPlatformDir,
  getDefaultDdsDir,
  validateSettings,
  writeUserMapJson,
  defaultWslDistro,
};
