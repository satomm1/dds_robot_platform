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

export { hasDdsBridge };
