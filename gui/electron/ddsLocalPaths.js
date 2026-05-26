/**
 * Pure helpers for local stack launcher (Windows WSL paths, bash escaping).
 * Lives under electron/ so packaged builds include it (see package.json build.files).
 */

const path = require('path');

const DDS_SUBDIR = 'dds';

/**
 * Convert a Windows path to a WSL path (/mnt/c/...).
 * @param {string} winPath
 * @returns {string}
 */
function windowsPathToWsl(winPath) {
  if (!winPath || typeof winPath !== 'string') return '';
  let p = winPath.trim().replace(/\//g, '\\');
  if (!p) return '';

  const unc = /^\\\\([^\\]+)\\([^\\]+)(\\.*)?$/i.exec(p);
  if (unc) {
    const share = unc[2];
    const rest = (unc[3] || '').replace(/\\/g, '/');
    return `//${unc[1]}/${share}${rest}`;
  }

  const drive = /^([a-zA-Z]):\\(.*)$/.exec(p);
  if (drive) {
    const letter = drive[1].toLowerCase();
    const rest = drive[2].replace(/\\/g, '/');
    return `/mnt/${letter}/${rest}`;
  }

  return p.replace(/\\/g, '/');
}

/**
 * Escape a string for use inside bash single quotes.
 * @param {string} value
 * @returns {string}
 */
function escapeBashSingleQuoted(value) {
  if (value == null) return '';
  return String(value).replace(/'/g, `'\\''`);
}

/**
 * Resolve a user path segment for bash/WSL (platform root or legacy dds path).
 * @param {string} rawPath
 * @param {boolean} isWindows
 */
function resolvePathForShell(rawPath, isWindows) {
  const trimmed = (rawPath || '').trim();
  if (!trimmed) return '';

  if (!isWindows) {
    return trimmed.replace(/\/+$/, '');
  }

  if (trimmed.startsWith('/')) {
    return trimmed.replace(/\/+$/, '');
  }

  const normalized = trimmed.replace(/\//g, '\\');
  const wslUnc = /^\\\\wsl(?:\.localhost|\$)\\([^\\]+)\\(.+)$/i.exec(normalized);
  if (wslUnc) {
    return `/${wslUnc[2].replace(/\\/g, '/').replace(/\/+$/, '')}`;
  }

  return windowsPathToWsl(trimmed).replace(/\/+$/, '');
}

/**
 * Normalize settings from the renderer (platform root directory).
 * Accepts legacy `ddsDir` and migrates paths that pointed at .../dds.
 * @param {{ platformDir?: string, ddsDir?: string, wslDistro?: string }} settings
 */
function normalizeDdsSettings(settings = {}) {
  let platformDir =
    typeof settings.platformDir === 'string'
      ? settings.platformDir.trim()
      : typeof settings.ddsDir === 'string'
        ? settings.ddsDir.trim()
        : '';

  platformDir = migrateLegacyDdsPathToPlatform(platformDir);

  return {
    platformDir,
    wslDistro:
      typeof settings.wslDistro === 'string' ? settings.wslDistro.trim() : '',
  };
}

/**
 * If the user previously saved the dds/ subfolder, use its parent as platform root.
 * @param {string} platformDir
 */
function migrateLegacyDdsPathToPlatform(platformDir) {
  if (!platformDir) return '';
  const normalized = platformDir.replace(/\\/g, '/').replace(/\/+$/, '');
  if (normalized.endsWith('/dds')) {
    const parent = path.posix.dirname(normalized);
    return parent === '.' || parent === '/' ? normalized : parent;
  }
  return platformDir;
}

/**
 * Platform repo root in shell/WSL form.
 * @param {string} platformDir
 * @param {boolean} isWindows
 */
function shellPlatformRoot(platformDir, isWindows) {
  return resolvePathForShell(platformDir, isWindows);
}

/**
 * dds/ subdirectory under the platform root (for start_scripts.sh, dds_env.sh).
 * @param {string} platformDir
 * @param {boolean} isWindows
 */
function shellDdsDirFromPlatform(platformDir, isWindows) {
  const root = shellPlatformRoot(platformDir, isWindows);
  if (!root) return '';
  return path.posix.join(root, DDS_SUBDIR);
}

/** @deprecated use shellPlatformRoot */
function resolveDdsDirForShell(ddsDir, isWindows) {
  return resolvePathForShell(ddsDir, isWindows);
}

/** @deprecated use shellDdsDirFromPlatform */
function platformRootFromDdsDir(ddsDir, isWindows) {
  const shellDds = resolveDdsDirForShell(ddsDir, isWindows);
  if (!shellDds) return '';
  const parent = path.posix.dirname(shellDds.replace(/\/+$/, ''));
  return parent === '.' || parent === '/' ? '' : parent;
}

module.exports = {
  windowsPathToWsl,
  escapeBashSingleQuoted,
  normalizeDdsSettings,
  migrateLegacyDdsPathToPlatform,
  resolvePathForShell,
  shellPlatformRoot,
  shellDdsDirFromPlatform,
  resolveDdsDirForShell,
  platformRootFromDdsDir,
  DDS_SUBDIR,
};
