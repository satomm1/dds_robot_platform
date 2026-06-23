const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  escapeBashSingleQuoted,
  normalizeDdsSettings,
  shellDdsDirFromPlatform,
  windowsPathToWsl,
  DDS_SUBDIR,
} = require('./ddsLocalPaths');
const {
  isWindows,
  defaultWslDistro,
  spawnShellCommand,
  spawnShellCommandAsync,
  combineShellOutput,
} = require('./shellRunner');
const dockerComposeRunner = require('./dockerComposeRunner');

const START_SCRIPT = 'start_scripts.sh';
const STATUS_TIMEOUT_MS = 8000;
const DDS_ENV_FILE = 'dds_env.sh';
const SAVED_MAPS_SUBDIR = 'saved_maps';
const SAVED_MAPS_MANIFEST = 'manifest.json';
const USER_MAP_FILE = 'user_map.json';
const MAP_IO_TIMEOUT_MS = 120000;

function shellDdsDir(platformDir) {
  return shellDdsDirFromPlatform(platformDir, isWindows());
}

function nativeDdsDir(platformDir) {
  return path.join(path.resolve(platformDir.trim()), DDS_SUBDIR);
}

function requireShellDdsDir(settings) {
  const { platformDir } = normalizeDdsSettings(settings);
  if (!platformDir) {
    return { ok: false, error: 'Enter the platform folder in Local Stack settings.' };
  }
  const shellDir = shellDdsDir(platformDir);
  if (!shellDir) {
    return { ok: false, error: 'Invalid platform folder path.' };
  }
  return { ok: true, platformDir, shellDir };
}

function shellFilePath(shellDir, relativePath) {
  const rel = String(relativePath || '').replace(/\\/g, '/').replace(/^\/+/, '');
  return `${shellDir}/${rel}`;
}

function nativeFilePath(platformDir, relativePath) {
  return path.join(nativeDdsDir(platformDir), relativePath);
}

async function writeAtomicUtf8(filePath, content) {
  const tmpPath = `${filePath}.tmp`;
  await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
  await fs.promises.writeFile(tmpPath, content, 'utf8');
  await fs.promises.rename(tmpPath, filePath);
}

/**
 * Write a file under the platform dds/ folder using the same path resolution as
 * Local Stack validation (WSL paths on Windows).
 */
async function writeDdsFileUtf8(settings, relativePath, content) {
  const resolved = requireShellDdsDir(settings);
  if (!resolved.ok) {
    throw new Error(resolved.error);
  }

  const targetShellPath = shellFilePath(resolved.shellDir, relativePath);

  if (!isWindows()) {
    const nativePath = nativeFilePath(resolved.platformDir, relativePath);
    await writeAtomicUtf8(nativePath, content);
    return { path: nativePath, shellPath: targetShellPath };
  }

  const tmpWin = path.join(
    os.tmpdir(),
    `dds-write-${Date.now()}-${Math.random().toString(36).slice(2)}.json`,
  );
  await fs.promises.writeFile(tmpWin, content, 'utf8');
  const wslTmp = windowsPathToWsl(tmpWin);
  const targetTmpShellPath = `${targetShellPath}.tmp`;
  const parentDir = path.posix.dirname(targetShellPath);
  const cmd = [
    `mkdir -p '${escapeBashSingleQuoted(parentDir)}'`,
    `cp '${escapeBashSingleQuoted(wslTmp)}' '${escapeBashSingleQuoted(targetTmpShellPath)}'`,
    `mv '${escapeBashSingleQuoted(targetTmpShellPath)}' '${escapeBashSingleQuoted(targetShellPath)}'`,
    `rm -f '${escapeBashSingleQuoted(wslTmp)}'`,
  ].join(' && ');

  const result = await spawnShellCommandAsync(cmd, settings, {
    timeoutMs: MAP_IO_TIMEOUT_MS,
  });
  try {
    await fs.promises.unlink(tmpWin);
  } catch {
    /* ignore */
  }
  if (result.status !== 0) {
    throw new Error(
      combineShellOutput(result) || `Failed to write ${targetShellPath} via WSL.`,
    );
  }
  return { path: targetShellPath, shellPath: targetShellPath };
}

async function readDdsFileUtf8(settings, relativePath) {
  const resolved = requireShellDdsDir(settings);
  if (!resolved.ok) {
    throw new Error(resolved.error);
  }

  const targetShellPath = shellFilePath(resolved.shellDir, relativePath);

  if (!isWindows()) {
    return fs.promises.readFile(
      nativeFilePath(resolved.platformDir, relativePath),
      'utf8',
    );
  }

  const tmpWin = path.join(
    os.tmpdir(),
    `dds-read-${Date.now()}-${Math.random().toString(36).slice(2)}.json`,
  );
  const wslTmp = windowsPathToWsl(tmpWin);
  const cmd = `cat '${escapeBashSingleQuoted(targetShellPath)}' > '${escapeBashSingleQuoted(wslTmp)}'`;
  const result = await spawnShellCommandAsync(cmd, settings, {
    timeoutMs: MAP_IO_TIMEOUT_MS,
  });
  if (result.status !== 0) {
    throw new Error(
      combineShellOutput(result) || `Failed to read ${targetShellPath} via WSL.`,
    );
  }
  try {
    return await fs.promises.readFile(tmpWin, 'utf8');
  } finally {
    try {
      await fs.promises.unlink(tmpWin);
    } catch {
      /* ignore */
    }
  }
}

/** Delete a file under the platform dds/ folder (WSL on Windows). */
async function deleteDdsFile(settings, relativePath) {
  const resolved = requireShellDdsDir(settings);
  if (!resolved.ok) {
    throw new Error(resolved.error);
  }

  const targetShellPath = shellFilePath(resolved.shellDir, relativePath);

  if (!isWindows()) {
    await fs.promises.unlink(nativeFilePath(resolved.platformDir, relativePath));
    return targetShellPath;
  }

  const cmd = `rm -f '${escapeBashSingleQuoted(targetShellPath)}'`;
  const result = await spawnShellCommandAsync(cmd, settings, {
    timeoutMs: STATUS_TIMEOUT_MS,
  });
  if (result.status !== 0) {
    throw new Error(
      combineShellOutput(result) || `Failed to delete ${targetShellPath} via WSL.`,
    );
  }
  return targetShellPath;
}

const MANIFEST_REL_PATH = `${SAVED_MAPS_SUBDIR}/${SAVED_MAPS_MANIFEST}`;

function emptyManifest() {
  return { version: 1, maps: [], activeMapId: null };
}

function generateMapId() {
  return `map_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function extractMapMeta(mapJsonText) {
  try {
    const parsed = JSON.parse(mapJsonText);
    const map = parsed?.data?.map;
    if (!map) return null;
    return {
      width: map.width,
      height: map.height,
      resolution: map.resolution,
    };
  } catch {
    return null;
  }
}

async function readManifest(settings) {
  try {
    const raw = await readDdsFileUtf8(settings, MANIFEST_REL_PATH);
    const data = JSON.parse(raw);
    if (!Array.isArray(data.maps)) {
      return emptyManifest();
    }
    return {
      version: data.version || 1,
      maps: data.maps,
      activeMapId: data.activeMapId || null,
    };
  } catch {
    return emptyManifest();
  }
}

async function writeManifest(settings, manifest) {
  await writeDdsFileUtf8(
    settings,
    MANIFEST_REL_PATH,
    JSON.stringify(manifest, null, 2),
  );
}

function scriptExists(platformDir, settings) {
  const shellDir = shellDdsDir(platformDir);
  if (!shellDir) return false;

  if (isWindows()) {
    const check = `test -f '${escapeBashSingleQuoted(`${shellDir}/${START_SCRIPT}`)}'`;
    const result = spawnShellCommand(check, settings, {
      sync: true,
      timeoutMs: STATUS_TIMEOUT_MS,
    });
    return result.status === 0;
  }

  return fs.existsSync(path.join(nativeDdsDir(platformDir), START_SCRIPT));
}

function ddsEnvExists(platformDir, settings) {
  const shellDir = shellDdsDir(platformDir);
  if (!shellDir) return false;

  if (isWindows()) {
    const check = `test -f '${escapeBashSingleQuoted(`${shellDir}/${DDS_ENV_FILE}`)}'`;
    const result = spawnShellCommand(check, settings, {
      sync: true,
      timeoutMs: STATUS_TIMEOUT_MS,
    });
    return result.status === 0;
  }

  return fs.existsSync(path.join(nativeDdsDir(platformDir), DDS_ENV_FILE));
}

/**
 * Persist raw map JSON to {platformDir}/dds/user_map.json (atomic write).
 * @param {{ platformDir?: string, wslDistro?: string }} settings
 * @param {string} mapJsonText
 */
async function writeUserMapJson(settings, mapJsonText) {
  const resolved = requireShellDdsDir(settings);
  if (!resolved.ok) {
    return resolved;
  }
  if (typeof mapJsonText !== 'string' || !mapJsonText.trim()) {
    return { ok: false, error: 'Map JSON is empty.' };
  }

  try {
    const written = await writeDdsFileUtf8(settings, USER_MAP_FILE, mapJsonText);
    return {
      ok: true,
      path: written.path,
      shellPath: written.shellPath,
    };
  } catch (err) {
    return {
      ok: false,
      error: err.message || `Failed to write ${USER_MAP_FILE}.`,
    };
  }
}

/**
 * List maps in dds/saved_maps/manifest.json.
 * @param {{ platformDir?: string, wslDistro?: string }} settings
 */
async function listSavedMaps(settings) {
  const resolved = requireShellDdsDir(settings);
  if (!resolved.ok) {
    return { ok: false, error: resolved.error, maps: [] };
  }
  try {
    const manifest = await readManifest(settings);
    return {
      ok: true,
      maps: manifest.maps,
      activeMapId: manifest.activeMapId,
      ddsDir: resolved.shellDir,
    };
  } catch (err) {
    return {
      ok: false,
      error: err.message || 'Failed to read saved maps.',
      maps: [],
    };
  }
}

/**
 * Save map JSON under dds/saved_maps/, update manifest, and copy to user_map.json.
 * Reuses an existing entry when the name matches (case-insensitive).
 */
async function saveNamedMap(settings, { name, mapJsonText, sourceHost = '' }) {
  const resolved = requireShellDdsDir(settings);
  if (!resolved.ok) {
    return resolved;
  }
  const trimmedName = (name || '').trim();
  if (!trimmedName) {
    return { ok: false, error: 'Enter a map name.' };
  }
  if (typeof mapJsonText !== 'string' || !mapJsonText.trim()) {
    return { ok: false, error: 'Map JSON is empty.' };
  }

  const meta = extractMapMeta(mapJsonText);
  if (!meta) {
    return { ok: false, error: 'Invalid map JSON (expected data.map).' };
  }

  const manifest = await readManifest(settings);
  const nameKey = trimmedName.toLowerCase();
  let entry = manifest.maps.find((m) => String(m.name || '').toLowerCase() === nameKey);
  const now = new Date().toISOString();

  if (!entry) {
    const id = generateMapId();
    entry = {
      id,
      name: trimmedName,
      file: `${id}.json`,
      savedAt: now,
    };
    manifest.maps.push(entry);
  } else {
    entry.name = trimmedName;
    entry.savedAt = now;
  }

  entry.width = meta.width;
  entry.height = meta.height;
  entry.resolution = meta.resolution;
  if (sourceHost) {
    entry.sourceHost = sourceHost;
  }

  try {
    const mapRelPath = `${SAVED_MAPS_SUBDIR}/${entry.file}`;
    const mapWritten = await writeDdsFileUtf8(settings, mapRelPath, mapJsonText);
    const userWritten = await writeDdsFileUtf8(settings, USER_MAP_FILE, mapJsonText);

    manifest.activeMapId = entry.id;
    manifest.maps.sort((a, b) => String(a.name).localeCompare(String(b.name)));
    await writeManifest(settings, manifest);

    return {
      ok: true,
      mapId: entry.id,
      name: entry.name,
      path: mapWritten.shellPath || mapWritten.path,
      userMapPath: userWritten.shellPath || userWritten.path,
    };
  } catch (err) {
    return {
      ok: false,
      error: err.message || 'Failed to save named map.',
    };
  }
}

/**
 * Read a saved map JSON file by manifest id.
 */
async function readSavedMapJson(settings, mapId) {
  const resolved = requireShellDdsDir(settings);
  if (!resolved.ok) {
    return resolved;
  }
  if (!mapId) {
    return { ok: false, error: 'Map id is required.' };
  }

  const manifest = await readManifest(settings);
  const entry = manifest.maps.find((m) => m.id === mapId);
  if (!entry) {
    return { ok: false, error: 'Saved map not found.' };
  }

  try {
    const mapJsonText = await readDdsFileUtf8(
      settings,
      `${SAVED_MAPS_SUBDIR}/${entry.file}`,
    );
    return { ok: true, mapJsonText, entry };
  } catch (err) {
    return {
      ok: false,
      error: err.message || `Failed to read saved map ${entry.file}.`,
    };
  }
}

/**
 * Copy a saved map to user_map.json and mark it active in the manifest.
 */
async function setActiveSavedMap(settings, mapId, mapJsonText) {
  const resolved = requireShellDdsDir(settings);
  if (!resolved.ok) {
    return resolved;
  }

  const manifest = await readManifest(settings);
  const entry = manifest.maps.find((m) => m.id === mapId);
  if (!entry) {
    return { ok: false, error: 'Saved map not found.' };
  }

  try {
    const written = await writeDdsFileUtf8(settings, USER_MAP_FILE, mapJsonText);
    manifest.activeMapId = mapId;
    await writeManifest(settings, manifest);
    return {
      ok: true,
      entry,
      path: written.shellPath || written.path,
    };
  } catch (err) {
    return {
      ok: false,
      error: err.message || 'Failed to activate saved map.',
    };
  }
}

/**
 * Remove a saved map file and its manifest entry.
 */
async function deleteSavedMap(settings, mapId) {
  const resolved = requireShellDdsDir(settings);
  if (!resolved.ok) {
    return resolved;
  }
  if (!mapId) {
    return { ok: false, error: 'Map id is required.' };
  }

  const manifest = await readManifest(settings);
  const entryIndex = manifest.maps.findIndex((m) => m.id === mapId);
  if (entryIndex === -1) {
    return { ok: false, error: 'Saved map not found.' };
  }

  const entry = manifest.maps[entryIndex];

  try {
    await deleteDdsFile(settings, `${SAVED_MAPS_SUBDIR}/${entry.file}`);
    manifest.maps.splice(entryIndex, 1);
    if (manifest.activeMapId === mapId) {
      manifest.activeMapId = null;
    }
    await writeManifest(settings, manifest);
    return { ok: true, name: entry.name, mapId };
  } catch (err) {
    return {
      ok: false,
      error: err.message || 'Failed to delete saved map.',
    };
  }
}

function getDefaultPlatformDir() {
  const candidate = path.resolve(__dirname, '..', '..');
  if (
    fs.existsSync(path.join(candidate, 'compose.yaml')) &&
    fs.existsSync(path.join(candidate, DDS_SUBDIR, START_SCRIPT))
  ) {
    return candidate;
  }
  return '';
}

/** @deprecated use getDefaultPlatformDir */
function getDefaultDdsDir() {
  return getDefaultPlatformDir();
}

function validateSettings(settings) {
  const { platformDir } = normalizeDdsSettings(settings);
  if (!platformDir) {
    return { valid: false, error: 'Enter the path to the dds_robot_platform folder.' };
  }
  if (!scriptExists(platformDir, settings)) {
    const hint = isWindows()
      ? 'dds/start_scripts.sh not found in WSL (check path and WSL distro).'
      : 'dds/start_scripts.sh not found under that folder.';
    return { valid: false, error: hint };
  }
  if (!ddsEnvExists(platformDir, settings)) {
    return {
      valid: false,
      error: `Missing dds/${DDS_ENV_FILE}. Copy dds_env.sh.example to dds_env.sh.`,
    };
  }
  if (!dockerComposeRunner.composeYamlExistsForSettings(settings)) {
    return {
      valid: false,
      error: 'Missing compose.yaml at platform root.',
    };
  }
  return { valid: true, error: null };
}

module.exports = {
  getDefaultPlatformDir,
  getDefaultDdsDir,
  validateSettings,
  writeUserMapJson,
  listSavedMaps,
  saveNamedMap,
  readSavedMapJson,
  setActiveSavedMap,
  deleteSavedMap,
  defaultWslDistro,
};
