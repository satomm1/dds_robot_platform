const REQUEST_TIMEOUT_MS = 20000;

function hasLocalStackBridge() {
  return Boolean(window.localStack) || process.env.NODE_ENV === 'development';
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
 * @param {{ platformDir?: string, wslDistro?: string }} settings
 * @returns {Promise<{ platform: string, docker: object, dds: object }>}
 */
export async function fetchLocalStackStatus(settings) {
  if (!hasLocalStackBridge()) {
    return {
      platform: '',
      docker: { running: false, configured: false },
      dds: { running: false, configured: false },
    };
  }
  if (window.localStack?.status) {
    return window.localStack.status(settings);
  }
  if (process.env.NODE_ENV === 'development') {
    const params = new URLSearchParams({
      platformDir: settings.platformDir || '',
      wslDistro: settings.wslDistro || '',
    });
    return devFetch(`/api/local-stack/status?${params}`);
  }
  return {
    platform: '',
    docker: { running: false, configured: false },
    dds: { running: false, configured: false },
  };
}

export { hasLocalStackBridge };
