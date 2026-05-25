import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

const STORAGE_KEY = 'dds_gui_map_controls_position';
const LEGACY_CORNER_KEY = 'dds_gui_map_controls_corner';

const LEGACY_CORNERS = ['top-left', 'top-right', 'bottom-left', 'bottom-right'];

const INSET_X = 16;
const INSET_TOP = 16;
const INSET_BOTTOM = 32;

function clampPosition(left, top, containerEl, panelEl) {
  const maxLeft = Math.max(0, containerEl.clientWidth - panelEl.offsetWidth);
  const maxTop = Math.max(0, containerEl.clientHeight - panelEl.offsetHeight);
  return {
    left: Math.min(Math.max(0, left), maxLeft),
    top: Math.min(Math.max(0, top), maxTop),
  };
}

function maxPosition(containerEl, panelEl) {
  return {
    maxLeft: Math.max(0, containerEl.clientWidth - panelEl.offsetWidth),
    maxTop: Math.max(0, containerEl.clientHeight - panelEl.offsetHeight),
  };
}

function ratiosFromPosition(left, top, containerEl, panelEl) {
  const { maxLeft, maxTop } = maxPosition(containerEl, panelEl);
  if (maxLeft <= 0 || maxTop <= 0) {
    return { leftRatio: 0, topRatio: 0 };
  }
  return {
    leftRatio: Math.min(1, Math.max(0, left / maxLeft)),
    topRatio: Math.min(1, Math.max(0, top / maxTop)),
  };
}

function positionFromRatios(leftRatio, topRatio, containerEl, panelEl) {
  const { maxLeft, maxTop } = maxPosition(containerEl, panelEl);
  return clampPosition(leftRatio * maxLeft, topRatio * maxTop, containerEl, panelEl);
}

function saveRatios(ratios) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(ratios));
  } catch {
    /* ignore */
  }
}

function loadSavedRatios() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
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

function defaultBottomRight(containerEl, panelEl) {
  return clampPosition(
    containerEl.clientWidth - panelEl.offsetWidth - INSET_X,
    containerEl.clientHeight - panelEl.offsetHeight - INSET_BOTTOM,
    containerEl,
    panelEl,
  );
}

function positionFromLegacyCorner(corner, containerEl, panelEl) {
  const pw = panelEl.offsetWidth;
  const ph = panelEl.offsetHeight;
  const cw = containerEl.clientWidth;
  const ch = containerEl.clientHeight;

  switch (corner) {
    case 'top-left':
      return clampPosition(INSET_X, INSET_TOP, containerEl, panelEl);
    case 'top-right':
      return clampPosition(cw - pw - INSET_X, INSET_TOP, containerEl, panelEl);
    case 'bottom-left':
      return clampPosition(INSET_X, ch - ph - INSET_BOTTOM, containerEl, panelEl);
    default:
      return defaultBottomRight(containerEl, panelEl);
  }
}

function resolveInitialRatios(containerEl, panelEl) {
  const saved = loadSavedRatios();
  if (saved?.leftRatio != null) {
    return { leftRatio: saved.leftRatio, topRatio: saved.topRatio };
  }

  let pixelPos;
  if (saved?.legacyLeft != null) {
    pixelPos = clampPosition(saved.legacyLeft, saved.legacyTop, containerEl, panelEl);
  } else {
    try {
      const legacy = localStorage.getItem(LEGACY_CORNER_KEY);
      if (LEGACY_CORNERS.includes(legacy)) {
        pixelPos = positionFromLegacyCorner(legacy, containerEl, panelEl);
        localStorage.removeItem(LEGACY_CORNER_KEY);
      }
    } catch {
      /* ignore */
    }
  }

  pixelPos = pixelPos || defaultBottomRight(containerEl, panelEl);
  const ratios = ratiosFromPosition(pixelPos.left, pixelPos.top, containerEl, panelEl);
  saveRatios(ratios);
  return ratios;
}

const MapControlsPanel = ({ containerRef, onDraggingChange, children }) => {
  const [position, setPosition] = useState(null);
  const [dragging, setDragging] = useState(false);
  const panelRef = useRef(null);
  const handleRef = useRef(null);
  const dragOffsetRef = useRef({ x: 0, y: 0 });
  const activePointerIdRef = useRef(null);
  const ratiosRef = useRef(null);

  const applyStoredRatios = useCallback(() => {
    const container = containerRef?.current;
    const panel = panelRef.current;
    if (!container || !panel) return;
    if (container.clientWidth <= 0 || container.clientHeight <= 0) return;

    if (!ratiosRef.current) {
      ratiosRef.current = resolveInitialRatios(container, panel);
    }

    const next = positionFromRatios(
      ratiosRef.current.leftRatio,
      ratiosRef.current.topRatio,
      container,
      panel,
    );
    setPosition(next);
  }, [containerRef]);

  const persistPosition = useCallback(
    (left, top) => {
      const container = containerRef?.current;
      const panel = panelRef.current;
      if (!container || !panel) return null;
      const clamped = clampPosition(left, top, container, panel);
      const ratios = ratiosFromPosition(clamped.left, clamped.top, container, panel);
      ratiosRef.current = ratios;
      saveRatios(ratios);
      return clamped;
    },
    [containerRef],
  );

  useLayoutEffect(() => {
    applyStoredRatios();
  }, [applyStoredRatios]);

  useEffect(() => {
    const container = containerRef?.current;
    if (!container) return undefined;

    const ro = new ResizeObserver(() => {
      applyStoredRatios();
    });
    ro.observe(container);
    return () => ro.disconnect();
  }, [containerRef, applyStoredRatios]);

  const endDrag = useCallback(() => {
    const handle = handleRef.current;
    const pointerId = activePointerIdRef.current;
    if (handle && pointerId != null) {
      try {
        if (handle.hasPointerCapture(pointerId)) {
          handle.releasePointerCapture(pointerId);
        }
      } catch {
        /* ignore */
      }
    }
    activePointerIdRef.current = null;
    setDragging(false);
    onDraggingChange?.(false);
    document.body.style.userSelect = '';
    document.body.style.cursor = '';
    setPosition((pos) => {
      if (!pos) return pos;
      return persistPosition(pos.left, pos.top) ?? pos;
    });
  }, [onDraggingChange, persistPosition]);

  useEffect(() => {
    if (!dragging) return undefined;

    const onMove = (e) => {
      if (activePointerIdRef.current != null && e.pointerId !== activePointerIdRef.current) {
        return;
      }
      const container = containerRef?.current;
      const panel = panelRef.current;
      if (!container || !panel) return;
      const cr = container.getBoundingClientRect();
      const left = e.clientX - cr.left - dragOffsetRef.current.x;
      const top = e.clientY - cr.top - dragOffsetRef.current.y;
      setPosition(clampPosition(left, top, container, panel));
    };

    const onUp = (e) => {
      if (activePointerIdRef.current != null && e.pointerId !== activePointerIdRef.current) {
        return;
      }
      endDrag();
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp, true);
    window.addEventListener('pointercancel', onUp, true);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp, true);
      window.removeEventListener('pointercancel', onUp, true);
    };
  }, [dragging, containerRef, endDrag]);

  const onHandlePointerDown = (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();

    const container = containerRef?.current;
    const panel = panelRef.current;
    const handle = handleRef.current;
    if (!container || !panel || !handle) return;

    try {
      handle.setPointerCapture(e.pointerId);
      activePointerIdRef.current = e.pointerId;
    } catch {
      activePointerIdRef.current = e.pointerId;
    }

    const cr = container.getBoundingClientRect();
    const pr = panel.getBoundingClientRect();
    dragOffsetRef.current = {
      x: e.clientX - pr.left,
      y: e.clientY - pr.top,
    };
    setPosition(persistPosition(pr.left - cr.left, pr.top - cr.top));
    setDragging(true);
    onDraggingChange?.(true);
    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'grabbing';
  };

  const panelStyle = position
    ? { left: position.left, top: position.top, right: 'auto', bottom: 'auto' }
    : { right: INSET_X, bottom: INSET_BOTTOM, left: 'auto', top: 'auto' };

  return (
    <div
      ref={panelRef}
      className={`map-controls${dragging ? ' map-controls--dragging' : ''}`}
      style={panelStyle}
    >
      <div
        ref={handleRef}
        className="map-controls__handle"
        onPointerDown={onHandlePointerDown}
        title="Drag to move"
        aria-label="Drag map controls"
      >
        <span className="map-controls__grip" aria-hidden />
        Move
      </div>
      {children}
    </div>
  );
};

export default MapControlsPanel;
