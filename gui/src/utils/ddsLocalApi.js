const REQUEST_TIMEOUT_MS = 20000;

function hasDdsBridge() {
  return Boolean(window.ddsLocal) || process.env.NODE_ENV === 'development';
}

async function devFetch(path, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(path, { ...options, signal: controller.signal });
    const data = await res.json().catch(() => ({}));
    if (!res.ok && data?.error) {
      throw new Error(data.error);
    }
    return data;
  } catch (err) {
    if (err.name === 'AbortError') {
      throw new Error('Request timed out.');
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * @returns {Promise<{ platformDir: string, wslDistro: string, platform: string }>}
 */
export async function fetchDdsLocalDefaults() {
  if (window.ddsLocal?.getDefaults) {
    return window.ddsLocal.getDefaults();
  }
  if (process.env.NODE_ENV === 'development') {
    return devFetch('/api/dds-local/defaults');
  }
  return { platformDir: '', wslDistro: '', platform: '' };
}

/**
 * @param {{ platformDir?: string, wslDistro?: string }} settings
 */
export async function validateDdsLocalSettings(settings) {
  if (window.ddsLocal?.validate) {
    return window.ddsLocal.validate(settings);
  }
  if (process.env.NODE_ENV === 'development') {
    return devFetch('/api/dds-local/validate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(settings),
    });
  }
  return { valid: false, error: 'Local stack control requires the Electron app or npm start.' };
}

/**
 * @param {{ platformDir?: string, wslDistro?: string, mapJsonText: string }} args
 */
export async function writeUserMap(args) {
  if (window.ddsLocal?.writeUserMap) {
    return window.ddsLocal.writeUserMap(args);
  }
  return { ok: false, error: 'Electron bridge not available' };
}

function platformArgs(settings) {
  return {
    platformDir: settings?.platformDir || '',
    wslDistro: settings?.wslDistro || '',
  };
}

export async function listSavedMaps(settings) {
  if (window.ddsLocal?.listSavedMaps) {
    return window.ddsLocal.listSavedMaps(platformArgs(settings));
  }
  return { ok: false, error: 'Electron bridge not available', maps: [] };
}

export async function saveNamedMap(args) {
  if (window.ddsLocal?.saveNamedMap) {
    return window.ddsLocal.saveNamedMap(args);
  }
  return { ok: false, error: 'Electron bridge not available' };
}

export async function readSavedMap(args) {
  if (window.ddsLocal?.readSavedMap) {
    return window.ddsLocal.readSavedMap(args);
  }
  return { ok: false, error: 'Electron bridge not available' };
}

export async function setActiveSavedMap(args) {
  if (window.ddsLocal?.setActiveSavedMap) {
    return window.ddsLocal.setActiveSavedMap(args);
  }
  return { ok: false, error: 'Electron bridge not available' };
}

export async function deleteSavedMap(args) {
  if (window.ddsLocal?.deleteSavedMap) {
    return window.ddsLocal.deleteSavedMap(args);
  }
  return { ok: false, error: 'Electron bridge not available' };
}

export function hasMapLibraryBridge() {
  return Boolean(window.ddsLocal?.listSavedMaps);
}

export { hasDdsBridge };
