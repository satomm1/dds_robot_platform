/**
 * Pure helpers for local DDS launcher (Windows WSL paths, bash escaping).
 */

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
 * Normalize settings from the renderer.
 * @param {{ ddsDir?: string, wslDistro?: string }} settings
 */
function normalizeDdsSettings(settings = {}) {
  return {
    ddsDir: typeof settings.ddsDir === 'string' ? settings.ddsDir.trim() : '',
    wslDistro:
      typeof settings.wslDistro === 'string' ? settings.wslDistro.trim() : '',
  };
}

/**
 * Path for bash/WSL commands on the operator machine.
 * @param {string} ddsDir
 * @param {boolean} isWindows
 */
function resolveDdsDirForShell(ddsDir, isWindows) {
  const trimmed = (ddsDir || '').trim();
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

module.exports = {
  windowsPathToWsl,
  escapeBashSingleQuoted,
  normalizeDdsSettings,
  resolveDdsDirForShell,
};
