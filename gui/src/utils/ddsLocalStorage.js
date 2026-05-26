const STORAGE_KEY = 'dds_local_launcher_settings';

function migrateStoredPlatformDir(parsed) {
  if (typeof parsed?.platformDir === 'string' && parsed.platformDir.trim()) {
    return parsed.platformDir.trim();
  }
  if (typeof parsed?.ddsDir === 'string' && parsed.ddsDir.trim()) {
    const raw = parsed.ddsDir.trim();
    const normalized = raw.replace(/\\/g, '/').replace(/\/+$/, '');
    if (normalized.endsWith('/dds')) {
      const parent = normalized.slice(0, -4);
      return parent || raw;
    }
    return raw;
  }
  return '';
}

export function loadDdsLocalSettings() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return { platformDir: '', wslDistro: '' };
    }
    const parsed = JSON.parse(raw);
    return {
      platformDir: migrateStoredPlatformDir(parsed),
      wslDistro:
        typeof parsed?.wslDistro === 'string' ? parsed.wslDistro.trim() : '',
    };
  } catch {
    return { platformDir: '', wslDistro: '' };
  }
}

export function saveDdsLocalSettings(settings) {
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({
      platformDir: (settings?.platformDir || '').trim(),
      wslDistro: (settings?.wslDistro || '').trim(),
    }),
  );
}
