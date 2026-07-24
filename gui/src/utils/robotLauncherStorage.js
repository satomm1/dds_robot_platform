const STORAGE_KEY = 'dds_robot_launcher_hosts';
const LAUNCH_OPTIONS_KEY = 'dds_robot_launcher_options';

const DEFAULT_PORT = 8080;
const HOST_SERVICE_PORT = 8081;

const DEFAULT_LAUNCH_OPTIONS = {
  useKaist: false,
  useAudio: false,
  useCapture: false,
  usePatrol: false,
  useSocialPlanner: false,
  useMultiRobotPlanner: false,
  plannerSettingsOpen: false,
};

export function normalizeHostInput(raw) {
  if (!raw || typeof raw !== 'string') return '';
  let s = raw.trim();
  s = s.replace(/^https?:\/\//i, '');
  const slash = s.indexOf('/');
  if (slash >= 0) s = s.slice(0, slash);
  const colon = s.lastIndexOf(':');
  if (colon > 0 && /^\d+$/.test(s.slice(colon + 1))) {
    s = s.slice(0, colon);
  }
  return s.trim();
}

export function parseHostPort(raw, defaultPort = DEFAULT_PORT) {
  const trimmed = (raw || '').trim();
  let host = normalizeHostInput(trimmed);
  let port = defaultPort;
  const withoutScheme = trimmed.replace(/^https?:\/\//i, '');
  const hostPort = withoutScheme.split('/')[0];
  const colon = hostPort.lastIndexOf(':');
  if (colon > 0) {
    const maybePort = hostPort.slice(colon + 1);
    if (/^\d+$/.test(maybePort)) {
      port = Number(maybePort);
      host = hostPort.slice(0, colon);
    }
  }
  return { host: normalizeHostInput(host), port };
}

export function loadSavedHosts() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { hosts: [], lastSelectedId: null };
    const parsed = JSON.parse(raw);
    const hosts = Array.isArray(parsed?.hosts) ? parsed.hosts : [];
    return {
      hosts: hosts
        .filter((h) => h && typeof h.host === 'string' && h.host.trim())
        .map((h) => ({
          id: String(h.id || h.host),
          label: String(h.label || h.host).trim() || h.host,
          host: normalizeHostInput(h.host),
        })),
      lastSelectedId: parsed?.lastSelectedId ?? null,
    };
  } catch {
    return { hosts: [], lastSelectedId: null };
  }
}

export function saveSavedHosts({ hosts, lastSelectedId }) {
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({
      hosts,
      lastSelectedId: lastSelectedId ?? null,
    }),
  );
}

export function loadLaunchOptions() {
  try {
    const raw = localStorage.getItem(LAUNCH_OPTIONS_KEY);
    if (!raw) return { ...DEFAULT_LAUNCH_OPTIONS };
    const parsed = JSON.parse(raw);
    const useKaist = Boolean(parsed?.useKaist);
    // KAIST is mutually exclusive with the beta planner options.
    const useSocialPlanner = useKaist ? false : Boolean(parsed?.useSocialPlanner);
    const useMultiRobotPlanner = useKaist
      ? false
      : Boolean(parsed?.useMultiRobotPlanner);
    return {
      useKaist,
      useAudio: Boolean(parsed?.useAudio),
      useCapture: Boolean(parsed?.useCapture),
      usePatrol: Boolean(parsed?.usePatrol),
      useSocialPlanner,
      useMultiRobotPlanner,
      plannerSettingsOpen: Boolean(parsed?.plannerSettingsOpen),
    };
  } catch {
    return { ...DEFAULT_LAUNCH_OPTIONS };
  }
}

export function saveLaunchOptions(options) {
  const useKaist = Boolean(options?.useKaist);
  localStorage.setItem(
    LAUNCH_OPTIONS_KEY,
    JSON.stringify({
      useKaist,
      useAudio: Boolean(options?.useAudio),
      useCapture: Boolean(options?.useCapture),
      usePatrol: Boolean(options?.usePatrol),
      useSocialPlanner: useKaist ? false : Boolean(options?.useSocialPlanner),
      useMultiRobotPlanner: useKaist
        ? false
        : Boolean(options?.useMultiRobotPlanner),
      plannerSettingsOpen: Boolean(options?.plannerSettingsOpen),
    }),
  );
}

export function createHostId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `host-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export { DEFAULT_PORT, HOST_SERVICE_PORT, DEFAULT_LAUNCH_OPTIONS };
