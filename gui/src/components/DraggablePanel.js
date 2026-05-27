import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  clampPanelPosition,
  defaultPanelBottomRight,
  positionFromPanelRatios,
  ratiosFromPanelPosition,
  resolveInitialPanelRatios,
  savePanelRatios,
} from '../utils/draggablePanelPosition';

const INSET_X = 16;
const INSET_BOTTOM = 32;

/**
 * Draggable floating panel positioned within containerRef bounds.
 * Position is persisted in localStorage via storageKey.
 */
const DraggablePanel = ({
  containerRef,
  storageKey,
  className,
  handleLabel = 'Move',
  handleAriaLabel = 'Drag panel',
  defaultPosition = defaultPanelBottomRight,
  onDraggingChange,
  children,
}) => {
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
      ratiosRef.current = resolveInitialPanelRatios(
        storageKey,
        container,
        panel,
        defaultPosition,
      );
    }

    const next = positionFromPanelRatios(
      ratiosRef.current.leftRatio,
      ratiosRef.current.topRatio,
      container,
      panel,
    );
    setPosition(next);
  }, [containerRef, storageKey, defaultPosition]);

  const persistPosition = useCallback(
    (left, top) => {
      const container = containerRef?.current;
      const panel = panelRef.current;
      if (!container || !panel) return null;
      const clamped = clampPanelPosition(left, top, container, panel);
      const ratios = ratiosFromPanelPosition(clamped.left, clamped.top, container, panel);
      ratiosRef.current = ratios;
      savePanelRatios(storageKey, ratios);
      return clamped;
    },
    [containerRef, storageKey],
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
      setPosition(clampPanelPosition(left, top, container, panel));
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

  const draggingClass = dragging ? ` ${className}--dragging` : '';

  return (
    <div
      ref={panelRef}
      className={`${className}${draggingClass}`}
      style={panelStyle}
    >
      <div
        ref={handleRef}
        className={`${className}__handle`}
        onPointerDown={onHandlePointerDown}
        title="Drag to move"
        aria-label={handleAriaLabel}
      >
        <span className={`${className}__grip`} aria-hidden />
        {handleLabel}
      </div>
      {children}
    </div>
  );
};

export default DraggablePanel;
