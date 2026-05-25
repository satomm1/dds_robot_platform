const STORAGE_KEY = 'dds_robot_colors';

export function loadRobotColorOverrides() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return {};
    const overrides = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value)) {
        overrides[String(key)] = value.toLowerCase();
      }
    }
    return overrides;
  } catch {
    return {};
  }
}

export function saveRobotColorOverrides(overrides) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(overrides));
}
