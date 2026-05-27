export const MAP_SHOW_PATHS_KEY = 'dds_gui_map_show_paths';
export const MAP_PATH_WIDTH_KEY = 'dds_gui_map_path_width';
export const MAP_SHOW_CURSOR_COORDS_KEY = 'dds_gui_map_show_cursor_coords';
export const MAP_SHOW_SELECTED_ROBOT_ONLY_KEY = 'dds_gui_map_show_selected_robot_only';
export const MAP_SHOW_AIR_QUALITY_HOVER_KEY = 'dds_gui_map_show_air_quality_hover';

export const MAP_PATH_WIDTH_DEFAULT = 2;
export const MAP_PATH_WIDTH_MIN = 1;
export const MAP_PATH_WIDTH_MAX = 8;

export function readStoredMapShowPaths() {
  try {
    const raw = localStorage.getItem(MAP_SHOW_PATHS_KEY);
    if (raw === '0') return false;
    if (raw === '1') return true;
  } catch {
    /* ignore */
  }
  return true;
}

export function readStoredMapPathWidth() {
  try {
    const raw = localStorage.getItem(MAP_PATH_WIDTH_KEY);
    const n = Number(raw);
    if (Number.isFinite(n)) {
      return Math.min(
        MAP_PATH_WIDTH_MAX,
        Math.max(MAP_PATH_WIDTH_MIN, Math.round(n)),
      );
    }
  } catch {
    /* ignore */
  }
  return MAP_PATH_WIDTH_DEFAULT;
}

export function readStoredMapShowCursorCoords() {
  try {
    const raw = localStorage.getItem(MAP_SHOW_CURSOR_COORDS_KEY);
    if (raw === '0') return false;
    if (raw === '1') return true;
  } catch {
    /* ignore */
  }
  return true;
}

export function readStoredMapShowSelectedRobotOnly() {
  try {
    const raw = localStorage.getItem(MAP_SHOW_SELECTED_ROBOT_ONLY_KEY);
    if (raw === '1') return true;
    if (raw === '0') return false;
  } catch {
    /* ignore */
  }
  return false;
}

export function readStoredMapShowAirQualityHover() {
  try {
    const raw = localStorage.getItem(MAP_SHOW_AIR_QUALITY_HOVER_KEY);
    if (raw === '1') return true;
    if (raw === '0') return false;
  } catch {
    /* ignore */
  }
  return false;
}
