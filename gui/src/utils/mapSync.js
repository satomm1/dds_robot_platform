import { SET_MAP, SET_MAP_METADATA } from '../mutations';
import { GET_OCCUPANCY_GRID } from '../queries';
import { saveNamedMap, readSavedMap, setActiveSavedMap, writeUserMap, readUserMap } from './ddsLocalApi';
import { fetchRobotMapJson, postRobotMapJson, summarizeRobotMapUploadBody } from './robotHostApi';

const MAP_SYNC_HINT =
  'Ensure the robot is powered on, host service is installed (jetson-host-install.sh), ' +
  'port 8081 is reachable, and the map was finalized (finalize_map.py).';

const MAP_METADATA_FIELDS = [
  'resolution',
  'width',
  'height',
  'origin_x',
  'origin_y',
  'origin_z',
  'origin_orientation_x',
  'origin_orientation_y',
  'origin_orientation_z',
  'origin_orientation_w',
];

/**
 * @param {string} jsonText
 * @returns {object} data.map object
 */
export function parseMapPayload(jsonText) {
  let parsed;
  try {
    parsed = JSON.parse(jsonText);
  } catch (err) {
    throw new Error(`Invalid map JSON from robot: ${err.message}`);
  }

  const map = parsed?.data?.map;
  if (!map || typeof map !== 'object') {
    throw new Error('Invalid map JSON: missing data.map object.');
  }

  for (const field of MAP_METADATA_FIELDS) {
    if (map[field] === undefined || map[field] === null) {
      throw new Error(`Invalid map JSON: missing data.map.${field}`);
    }
  }

  if (!Array.isArray(map.occupancy) || map.occupancy.length === 0) {
    throw new Error('Invalid map JSON: data.map.occupancy must be a non-empty array.');
  }

  const expectedCells = Number(map.width) * Number(map.height);
  if (map.occupancy.length !== expectedCells) {
    throw new Error(
      `Invalid map JSON: occupancy length ${map.occupancy.length} does not match ` +
        `width×height (${expectedCells}).`,
    );
  }

  return map;
}

/**
 * Mirror dds/entry_exit.py: np.array(occupancy).tobytes() → base64 (int64 on 64-bit).
 * @param {number[]} occupancyArray
 */
export function occupancyToBase64(occupancyArray) {
  const byteLength = occupancyArray.length * 8;
  const buf = new ArrayBuffer(byteLength);
  const view = new DataView(buf);
  for (let i = 0; i < occupancyArray.length; i++) {
    const value = occupancyArray[i] | 0;
    const offset = i * 8;
    view.setInt32(offset, value, true);
    view.setInt32(offset + 4, value < 0 ? -1 : 0, true);
  }
  const bytes = new Uint8Array(buf);
  const chunkSize = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

/**
 * @param {object} mapData validated data.map
 */
export function buildSetMapVariables(mapData) {
  return {
    data: occupancyToBase64(mapData.occupancy),
    metadata: {
      resolution: mapData.resolution,
      width: mapData.width,
      height: mapData.height,
      origin_pos_x: mapData.origin_x,
      origin_pos_y: mapData.origin_y,
      origin_pos_z: mapData.origin_z,
      origin_ori_x: mapData.origin_orientation_x,
      origin_ori_y: mapData.origin_orientation_y,
      origin_ori_z: mapData.origin_orientation_z,
      origin_ori_w: mapData.origin_orientation_w,
    },
  };
}

function formatFetchError(result) {
  const snippet = (result.body || '').trim().slice(0, 300);
  if (result.status === 404) {
    let detail = snippet;
    try {
      const err = JSON.parse(result.body);
      if (err.error) detail = err.error;
      if (err.path) detail += ` (${err.path})`;
    } catch {
      // use raw snippet
    }
    return `Map not found on robot (HTTP 404): ${detail || 'file missing'}. ` +
      'Run finalize_map.py on the robot first.';
  }
  return `Failed to fetch map from robot (HTTP ${result.status || 'unknown'})` +
    (snippet ? `: ${snippet}` : '.') +
    ` ${MAP_SYNC_HINT}`;
}

/**
 * @param {import('@apollo/client').ApolloClient} apolloClient
 * @param {string} mapJsonText
 */
export async function applyMapJsonToGraphQL(apolloClient, mapJsonText) {
  const mapData = parseMapPayload(mapJsonText);
  const { data, metadata } = buildSetMapVariables(mapData);

  const mapResult = await apolloClient.mutate({
    mutation: SET_MAP,
    variables: { data },
  });
  if (mapResult.data?.setMap !== true) {
    throw new Error('setMap mutation did not succeed.');
  }

  const mdResult = await apolloClient.mutate({
    mutation: SET_MAP_METADATA,
    variables: metadata,
  });
  if (mdResult.data?.setMapMetadata !== true) {
    throw new Error('setMapMetadata mutation did not succeed.');
  }

  await apolloClient.refetchQueries({ include: [GET_OCCUPANCY_GRID] });

  return {
    width: mapData.width,
    height: mapData.height,
    resolution: mapData.resolution,
  };
}

async function persistSyncedMap(platformSettings, { mapJsonText, mapName, sourceHost }) {
  const trimmedName = (mapName || '').trim();
  let persistNote = '';
  let savedPath = '';
  let savedName = trimmedName;
  let mapId = null;
  let bytesWritten = 0;

  if (window.ddsLocal?.saveNamedMap && trimmedName) {
    const writeResult = await saveNamedMap({
      platformDir: platformSettings.platformDir || '',
      wslDistro: platformSettings.wslDistro || '',
      name: trimmedName,
      mapJsonText,
      sourceHost: sourceHost || '',
    });
    if (writeResult?.ok) {
      bytesWritten = mapJsonText.length;
      savedName = writeResult.name || trimmedName;
      mapId = writeResult.mapId || null;
      savedPath = writeResult.userMapPath || writeResult.path || '';
    } else {
      persistNote =
        writeResult?.error ||
        'Map updated in GUI but failed to save to the map library.';
    }
  } else if (window.ddsLocal?.writeUserMap) {
    const writeResult = await writeUserMap({
      platformDir: platformSettings.platformDir || '',
      wslDistro: platformSettings.wslDistro || '',
      mapJsonText,
    });
    if (writeResult?.ok) {
      bytesWritten = mapJsonText.length;
      savedPath = writeResult.shellPath || writeResult.path || '';
    } else {
      persistNote =
        writeResult?.error ||
        'Map updated in GUI but failed to save dds/user_map.json. Set the platform folder in Local Stack settings.';
    }
    if (trimmedName && !window.ddsLocal?.saveNamedMap) {
      persistNote =
        'Named map library requires the Electron app. Saved user_map.json only for this session path.';
    }
  } else {
    console.warn(
      'Map sync: Electron bridge unavailable; skipping file persistence. ' +
        'GraphQL map updated for this session only.',
    );
    persistNote =
      'Map updated in GUI; use the Electron app and Local Stack settings to persist maps.';
  }

  return { bytesWritten, persistNote, savedPath, savedName, mapId };
}

/**
 * @param {{ host: string, apolloClient: import('@apollo/client').ApolloClient, platformSettings?: { platformDir?: string, wslDistro?: string }, mapName?: string }} args
 */
export async function syncMapFromRobot({ host, apolloClient, platformSettings = {}, mapName = '' }) {
  const result = await fetchRobotMapJson(host);
  if (!result.ok) {
    throw new Error(formatFetchError(result));
  }

  const mapJsonText = result.body || '';
  if (!mapJsonText) {
    throw new Error(`Empty map response from robot. ${MAP_SYNC_HINT}`);
  }

  const summary = await applyMapJsonToGraphQL(apolloClient, mapJsonText);
  const persist = await persistSyncedMap(platformSettings, {
    mapJsonText,
    mapName,
    sourceHost: host,
  });

  return {
    ...summary,
    ...persist,
  };
}

/**
 * @param {{ mapId: string, apolloClient: import('@apollo/client').ApolloClient, platformSettings?: { platformDir?: string, wslDistro?: string } }} args
 */
export async function loadSavedMapToCentral({ mapId, apolloClient, platformSettings = {} }) {
  if (!mapId) {
    throw new Error('Select a saved map.');
  }

  const readResult = await readSavedMap({
    platformDir: platformSettings.platformDir || '',
    wslDistro: platformSettings.wslDistro || '',
    mapId,
  });
  if (!readResult?.ok) {
    throw new Error(readResult?.error || 'Failed to read saved map.');
  }

  const mapJsonText = readResult.mapJsonText || '';
  const summary = await applyMapJsonToGraphQL(apolloClient, mapJsonText);

  let persistNote = '';
  let savedPath = '';
  let bytesWritten = 0;

  if (window.ddsLocal?.setActiveSavedMap) {
    const activateResult = await setActiveSavedMap({
      platformDir: platformSettings.platformDir || '',
      wslDistro: platformSettings.wslDistro || '',
      mapId,
      mapJsonText,
    });
    if (activateResult?.ok) {
      bytesWritten = mapJsonText.length;
      savedPath = activateResult.path || '';
    } else {
      persistNote =
        activateResult?.error ||
        'Map updated in GUI but failed to save dds/user_map.json.';
    }
  } else {
    persistNote =
      'Map updated in GUI; use the Electron app to persist user_map.json for the next DDS start.';
  }

  return {
    ...summary,
    name: readResult.entry?.name || '',
    mapId,
    bytesWritten,
    savedPath,
    persistNote,
  };
}

const ROBOT_MAP_NAME_INVALID = /[/\\]/;

/**
 * Validate map name for robot POST /map (archive filename, no path separators).
 * @param {string} name
 */
export function validateRobotMapName(name) {
  const trimmed = (name || '').trim();
  if (!trimmed) {
    throw new Error('Enter a map name.');
  }
  if (ROBOT_MAP_NAME_INVALID.test(trimmed)) {
    throw new Error('Map name cannot contain / or \\.');
  }
  if (trimmed === '.' || trimmed === '..') {
    throw new Error('Invalid map name.');
  }
  return trimmed;
}

/**
 * Add top-level name to map JSON for robot host POST /map.
 * @param {string} mapJsonText
 * @param {string} name
 */
export function buildRobotUploadPayload(mapJsonText, name) {
  const trimmedName = validateRobotMapName(name);
  let parsed;
  try {
    parsed = JSON.parse(mapJsonText);
  } catch (err) {
    throw new Error(`Invalid map JSON: ${err.message}`);
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Invalid map JSON: expected a JSON object.');
  }
  return JSON.stringify({ ...parsed, name: trimmedName });
}

function formatPostMapError(result) {
  const snippet = (result.body || '').trim().slice(0, 300);
  let detail = snippet;
  try {
    const err = JSON.parse(result.body);
    if (err.error) detail = err.error;
  } catch {
    // use raw snippet
  }
  return `Failed to send map to robot (HTTP ${result.status || 'unknown'})` +
    (detail ? `: ${detail}` : '.');
}

/**
 * Resolve central map JSON for upload: selected saved map, else user_map.json.
 */
export async function resolveCentralMapJsonForUpload(platformSettings, mapId = '') {
  const settings = {
    platformDir: platformSettings.platformDir || '',
    wslDistro: platformSettings.wslDistro || '',
  };
  const id = mapId || '';
  if (id) {
    const readResult = await readSavedMap({ ...settings, mapId: id });
    if (!readResult?.ok) {
      throw new Error(readResult?.error || 'Failed to read saved map.');
    }
    return readResult.mapJsonText || '';
  }
  const userResult = await readUserMap(settings);
  if (!userResult?.ok) {
    throw new Error(
      userResult?.error ||
        'No map to send. Load a saved map or sync a map to the central stack first.',
    );
  }
  return userResult.mapJsonText || '';
}

/**
 * POST the central map to a robot host service (port 8081).
 * @param {{ host: string, mapName: string, platformSettings?: object, mapId?: string, mapJsonText?: string }} args
 */
export async function sendMapToRobot({
  host,
  mapName,
  platformSettings = {},
  mapId = '',
  mapJsonText = '',
}) {
  const cleanHost = (host || '').trim();
  if (!cleanHost) {
    throw new Error('Enter a robot IP.');
  }

  const sourceJson =
    mapJsonText || (await resolveCentralMapJsonForUpload(platformSettings, mapId));
  if (!sourceJson.trim()) {
    throw new Error('Map JSON is empty.');
  }

  parseMapPayload(sourceJson);

  const uploadBody = buildRobotUploadPayload(sourceJson, mapName);
  const result = await postRobotMapJson(cleanHost, uploadBody);
  if (!result.ok) {
    throw new Error(formatPostMapError(result));
  }

  const robotName = validateRobotMapName(mapName);
  let namedPath = '';
  try {
    const data = JSON.parse(result.body || '{}');
    namedPath = data.named_path || data.current_path || '';
  } catch {
    // ignore
  }

  return {
    name: robotName,
    message: summarizeRobotMapUploadBody(result.body),
    namedPath,
  };
}
