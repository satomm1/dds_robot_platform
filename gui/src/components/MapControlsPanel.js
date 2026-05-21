import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

const STORAGE_KEY = 'dds_gui_map_controls_position';
const LEGACY_CORNER_KEY = 'dds_gui_map_controls_corner';

const LEGACY_CORNERS = ['top-left', 'top-right', 'bottom-left', 'bottom-right'];

function clampPosition(left, top, containerEl, panelEl) {
  const maxLeft = Math.max(0, containerEl.clientWidth - panelEl.offsetWidth);
  const maxTop = Math.max(0, containerEl.clientHeight - panelEl.offsetHeight);
  return {
    left: Math.min(Math.max(0, left), maxLeft),
    top: Math.min(Math.max(0, top), maxTop),
  };
}

function loadSavedPosition() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw);
    if (Number.isFinite(p.left) && Number.isFinite(p.top)) {
      return { left: p.left, top: p.top };
    }
  } catch {
    /* ignore */
  }
  return null;
}

function savePosition(pos) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(pos));
  } catch {
    /* ignore */
  }
}

function defaultBottomRight(containerEl, panelEl) {
  return clampPosition(
    containerEl.clientWidth - panelEl.offsetWidth - 16,
    containerEl.clientHeight - panelEl.offsetHeight - 32,
    containerEl,
    panelEl,
  );
}

function positionFromLegacyCorner(corner, containerEl, panelEl) {
  const insetX = 16;
  const insetTop = 16;
  const insetBottom = 32;
  const pw = panelEl.offsetWidth;
  const ph = panelEl.offsetHeight;
  const cw = containerEl.clientWidth;
  const ch = containerEl.clientHeight;

  switch (corner) {
    case 'top-left':
      return clampPosition(insetX, insetTop, containerEl, panelEl);
    case 'top-right':
      return clampPosition(cw - pw - insetX, insetTop, containerEl, panelEl);
    case 'bottom-left':
      return clampPosition(insetX, ch - ph - insetBottom, containerEl, panelEl);
    default:
      return defaultBottomRight(containerEl, panelEl);
  }
}

function resolveInitialPosition(containerEl, panelEl) {
  const saved = loadSavedPosition();
  if (saved) {
    return clampPosition(saved.left, saved.top, containerEl, panelEl);
  }

  try {
    const legacy = localStorage.getItem(LEGACY_CORNER_KEY);
    if (LEGACY_CORNERS.includes(legacy)) {
      const pos = positionFromLegacyCorner(legacy, containerEl, panelEl);
      savePosition(pos);
      localStorage.removeItem(LEGACY_CORNER_KEY);
      return pos;
    }
  } catch {
    /* ignore */
  }

  return defaultBottomRight(containerEl, panelEl);
}

const MapControlsPanel = ({ containerRef, onDraggingChange, children }) => {
  const [position, setPosition] = useState(null);
  const [dragging, setDragging] = useState(false);
  const panelRef = useRef(null);
  const handleRef = useRef(null);
  const dragOffsetRef = useRef({ x: 0, y: 0 });
  const activePointerIdRef = useRef(null);

  const measureAndSetPosition = useCallback(
    (nextLeft, nextTop) => {
      const container = containerRef?.current;
      const panel = panelRef.current;
      if (!container || !panel) return;
      setPosition(clampPosition(nextLeft, nextTop, container, panel));
    },
    [containerRef],
  );

  useLayoutEffect(() => {
    const container = containerRef?.current;
    const panel = panelRef.current;
    if (!container || !panel) return;

    setPosition((prev) => {
      if (prev) {
        return clampPosition(prev.left, prev.top, container, panel);
      }
      return resolveInitialPosition(container, panel);
    });
  }, [containerRef]);

  useEffect(() => {
    const container = containerRef?.current;
    if (!container) return undefined;

    const ro = new ResizeObserver(() => {
      const panel = panelRef.current;
      if (!panel) return;
      setPosition((prev) => {
        if (!prev) return prev;
        return clampPosition(prev.left, prev.top, container, panel);
      });
    });
    ro.observe(container);
    return () => ro.disconnect();
  }, [containerRef]);

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
      if (pos) savePosition(pos);
      return pos;
    });
  }, [onDraggingChange]);

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
    measureAndSetPosition(pr.left - cr.left, pr.top - cr.top);
    setDragging(true);
    onDraggingChange?.(true);
    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'grabbing';
  };

  if (!position) {
    return (
      <div ref={panelRef} className="map-controls map-controls--measuring" aria-hidden>
        <div className="map-controls__handle">
          <span className="map-controls__grip" aria-hidden />
          Move
        </div>
        {children}
      </div>
    );
  }

  return (
    <div
      ref={panelRef}
      className={`map-controls${dragging ? ' map-controls--dragging' : ''}`}
      style={{ left: position.left, top: position.top, right: 'auto', bottom: 'auto' }}
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
