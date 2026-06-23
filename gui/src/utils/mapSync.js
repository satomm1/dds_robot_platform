import { SET_MAP, SET_MAP_METADATA } from '../mutations';
import { GET_OCCUPANCY_GRID } from '../queries';
import { writeUserMap } from './ddsLocalApi';
import { fetchRobotMapJson } from './robotHostApi';

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
 * @param {{ host: string, apolloClient: import('@apollo/client').ApolloClient, platformSettings?: { platformDir?: string, wslDistro?: string } }} args
 */
export async function syncMapFromRobot({ host, apolloClient, platformSettings = {} }) {
  const result = await fetchRobotMapJson(host);
  if (!result.ok) {
    throw new Error(formatFetchError(result));
  }

  const mapJsonText = result.body || '';
  if (!mapJsonText) {
    throw new Error(`Empty map response from robot. ${MAP_SYNC_HINT}`);
  }

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

  let bytesWritten = 0;
  let persistNote = '';

  if (window.ddsLocal?.writeUserMap) {
    const writeResult = await writeUserMap({
      platformDir: platformSettings.platformDir || '',
      wslDistro: platformSettings.wslDistro || '',
      mapJsonText,
    });
    if (writeResult?.ok) {
      bytesWritten = mapJsonText.length;
    } else {
      persistNote =
        writeResult?.error ||
        'Map updated in GUI but failed to save dds/user_map.json. Set the platform folder in Local Stack settings.';
    }
  } else {
    console.warn(
      'Map sync: Electron bridge unavailable; skipping dds/user_map.json write. ' +
        'GraphQL map updated for this session only.',
    );
    persistNote =
      'Map updated in GUI; restart DDS after installing the Electron build to persist for next session.';
  }

  return {
    width: mapData.width,
    height: mapData.height,
    resolution: mapData.resolution,
    bytesWritten,
    persistNote,
  };
}
