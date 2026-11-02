import { useEffect, useState } from 'react';
import {
  readStoredRobotMarkerRadius,
  ROBOT_MARKER_RADIUS_KEY,
} from '../components/RobotMarkerSizeSlider';
import {
  MAP_PATH_WIDTH_KEY,
  MAP_SHOW_CURSOR_COORDS_KEY,
  MAP_SHOW_PATHS_KEY,
  MAP_SHOW_AIR_QUALITY_HOVER_KEY,
  MAP_SHOW_MAP_CONTROLS_KEY,
  MAP_SHOW_SELECTED_ROBOT_ONLY_KEY,
  readStoredMapPathWidth,
  readStoredMapShowAirQualityHover,
  readStoredMapShowCursorCoords,
  readStoredMapShowMapControls,
  readStoredMapShowPaths,
  readStoredMapShowSelectedRobotOnly,
} from '../utils/mapDisplaySettings';

const serializeBool = (value) => (value ? '1' : '0');

/** useState backed by localStorage: read once on mount, written on every change. */
function usePersistedSetting(storageKey, readStored, serialize = String) {
  const [value, setValue] = useState(readStored);
  useEffect(() => {
    localStorage.setItem(storageKey, serialize(value));
  }, [storageKey, serialize, value]);
  return [value, setValue];
}

/** Map display preferences edited in the Map Settings modal. */
export function useMapDisplaySettings() {
  const [robotMarkerRadius, setRobotMarkerRadius] = usePersistedSetting(
    ROBOT_MARKER_RADIUS_KEY,
    readStoredRobotMarkerRadius,
  );
  const [mapShowPaths, setMapShowPaths] = usePersistedSetting(
    MAP_SHOW_PATHS_KEY,
    readStoredMapShowPaths,
    serializeBool,
  );
  const [mapPathWidth, setMapPathWidth] = usePersistedSetting(
    MAP_PATH_WIDTH_KEY,
    readStoredMapPathWidth,
  );
  const [mapShowCursorCoords, setMapShowCursorCoords] = usePersistedSetting(
    MAP_SHOW_CURSOR_COORDS_KEY,
    readStoredMapShowCursorCoords,
    serializeBool,
  );
  const [mapShowSelectedRobotOnly, setMapShowSelectedRobotOnly] = usePersistedSetting(
    MAP_SHOW_SELECTED_ROBOT_ONLY_KEY,
    readStoredMapShowSelectedRobotOnly,
    serializeBool,
  );
  const [mapShowAirQualityOnHover, setMapShowAirQualityOnHover] = usePersistedSetting(
    MAP_SHOW_AIR_QUALITY_HOVER_KEY,
    readStoredMapShowAirQualityHover,
    serializeBool,
  );
  const [mapShowMapControls, setMapShowMapControls] = usePersistedSetting(
    MAP_SHOW_MAP_CONTROLS_KEY,
    readStoredMapShowMapControls,
    serializeBool,
  );

  return {
    robotMarkerRadius,
    setRobotMarkerRadius,
    mapShowPaths,
    setMapShowPaths,
    mapPathWidth,
    setMapPathWidth,
    mapShowCursorCoords,
    setMapShowCursorCoords,
    mapShowSelectedRobotOnly,
    setMapShowSelectedRobotOnly,
    mapShowAirQualityOnHover,
    setMapShowAirQualityOnHover,
    mapShowMapControls,
    setMapShowMapControls,
  };
}
