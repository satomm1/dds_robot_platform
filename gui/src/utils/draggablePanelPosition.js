const INSET_X = 16;
const INSET_TOP = 16;
const INSET_BOTTOM = 32;

export function clampPanelPosition(left, top, containerEl, panelEl) {
  const maxLeft = Math.max(0, containerEl.clientWidth - panelEl.offsetWidth);
  const maxTop = Math.max(0, containerEl.clientHeight - panelEl.offsetHeight);
  return {
    left: Math.min(Math.max(0, left), maxLeft),
    top: Math.min(Math.max(0, top), maxTop),
  };
}

function maxPanelPosition(containerEl, panelEl) {
  return {
    maxLeft: Math.max(0, containerEl.clientWidth - panelEl.offsetWidth),
    maxTop: Math.max(0, containerEl.clientHeight - panelEl.offsetHeight),
  };
}

export function ratiosFromPanelPosition(left, top, containerEl, panelEl) {
  const { maxLeft, maxTop } = maxPanelPosition(containerEl, panelEl);
  if (maxLeft <= 0 || maxTop <= 0) {
    return { leftRatio: 0, topRatio: 0 };
  }
  return {
    leftRatio: Math.min(1, Math.max(0, left / maxLeft)),
    topRatio: Math.min(1, Math.max(0, top / maxTop)),
  };
}

export function positionFromPanelRatios(leftRatio, topRatio, containerEl, panelEl) {
  const { maxLeft, maxTop } = maxPanelPosition(containerEl, panelEl);
  return clampPanelPosition(leftRatio * maxLeft, topRatio * maxTop, containerEl, panelEl);
}

export function savePanelRatios(storageKey, ratios) {
  try {
    localStorage.setItem(storageKey, JSON.stringify(ratios));
  } catch {
    /* ignore */
  }
}

export function loadSavedPanelRatios(storageKey) {
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return null;
    const p = JSON.parse(raw);
    if (Number.isFinite(p.leftRatio) && Number.isFinite(p.topRatio)) {
      return {
        leftRatio: Math.min(1, Math.max(0, p.leftRatio)),
        topRatio: Math.min(1, Math.max(0, p.topRatio)),
      };
    }
    if (Number.isFinite(p.left) && Number.isFinite(p.top)) {
      return { legacyLeft: p.left, legacyTop: p.top };
    }
  } catch {
    /* ignore */
  }
  return null;
}

export function defaultPanelBottomRight(containerEl, panelEl) {
  return clampPanelPosition(
    containerEl.clientWidth - panelEl.offsetWidth - INSET_X,
    containerEl.clientHeight - panelEl.offsetHeight - INSET_BOTTOM,
    containerEl,
    panelEl,
  );
}

export function defaultPanelTopLeft(containerEl, panelEl) {
  return clampPanelPosition(INSET_X, INSET_TOP, containerEl, panelEl);
}

export function resolveInitialPanelRatios(storageKey, containerEl, panelEl, defaultPosition) {
  const saved = loadSavedPanelRatios(storageKey);
  if (saved?.leftRatio != null) {
    return { leftRatio: saved.leftRatio, topRatio: saved.topRatio };
  }

  let pixelPos;
  if (saved?.legacyLeft != null) {
    pixelPos = clampPanelPosition(saved.legacyLeft, saved.legacyTop, containerEl, panelEl);
  }

  pixelPos =
    pixelPos ||
    (typeof defaultPosition === 'function'
      ? defaultPosition(containerEl, panelEl)
      : defaultPanelBottomRight(containerEl, panelEl));

  const ratios = ratiosFromPanelPosition(pixelPos.left, pixelPos.top, containerEl, panelEl);
  savePanelRatios(storageKey, ratios);
  return ratios;
}
