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
  return { valid: false, error: 'Local DDS control requires the Electron app or npm start.' };
}

/**
 * @param {{ platformDir?: string, wslDistro?: string }} settings
 */
export async function fetchDdsLocalStatus(settings) {
  if (!hasDdsBridge()) {
    return { running: false, configured: false, platform: '' };
  }
  if (window.ddsLocal?.status) {
    return window.ddsLocal.status(settings);
  }
  if (process.env.NODE_ENV === 'development') {
    const params = new URLSearchParams({
      platformDir: settings.platformDir || '',
      wslDistro: settings.wslDistro || '',
    });
    return devFetch(`/api/dds-local/status?${params}`);
  }
  return { running: false, configured: false, platform: '' };
}

/**
 * @param {{ platformDir?: string, wslDistro?: string }} settings
 */
export async function startDdsLocal(settings) {
  if (window.ddsLocal?.start) {
    return window.ddsLocal.start(settings);
  }
  if (process.env.NODE_ENV === 'development') {
    return devFetch('/api/dds-local/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(settings),
    });
  }
  throw new Error('Local DDS control requires the Electron app or npm start.');
}

/**
 * @param {{ platformDir?: string, wslDistro?: string }} settings
 */
export async function stopDdsLocal(settings) {
  if (window.ddsLocal?.stop) {
    return window.ddsLocal.stop(settings);
  }
  if (process.env.NODE_ENV === 'development') {
    return devFetch('/api/dds-local/stop', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(settings),
    });
  }
  throw new Error('Local DDS control requires the Electron app or npm start.');
}

export { hasDdsBridge };
