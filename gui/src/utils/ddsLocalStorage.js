const STORAGE_KEY = 'dds_local_launcher_settings';

export function loadDdsLocalSettings() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return { ddsDir: '', wslDistro: '' };
    }
    const parsed = JSON.parse(raw);
    return {
      ddsDir: typeof parsed?.ddsDir === 'string' ? parsed.ddsDir.trim() : '',
      wslDistro:
        typeof parsed?.wslDistro === 'string' ? parsed.wslDistro.trim() : '',
    };
  } catch {
    return { ddsDir: '', wslDistro: '' };
  }
}

export function saveDdsLocalSettings(settings) {
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({
      ddsDir: (settings?.ddsDir || '').trim(),
      wslDistro: (settings?.wslDistro || '').trim(),
    }),
  );
}
