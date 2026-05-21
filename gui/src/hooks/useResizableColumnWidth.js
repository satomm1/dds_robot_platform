import { useCallback, useRef, useState } from 'react';

function readStoredWidth(storageKey, defaultWidth, minWidth, maxWidth) {
  try {
    const raw = localStorage.getItem(storageKey);
    const n = Number(raw);
    if (Number.isFinite(n)) {
      return Math.min(maxWidth, Math.max(minWidth, n));
    }
  } catch {
    /* ignore */
  }
  return defaultWidth;
}

/**
 * @param {'left' | 'right'} side — left sidebar grows when handle moves right;
 *   right sidebar grows when handle moves left.
 */
export function useResizableColumnWidth({
  storageKey,
  defaultWidth,
  minWidth,
  maxWidth,
  side,
}) {
  const [width, setWidth] = useState(() =>
    readStoredWidth(storageKey, defaultWidth, minWidth, maxWidth),
  );
  const widthRef = useRef(width);
  widthRef.current = width;

  const beginResize = useCallback(
    (e) => {
      e.preventDefault();
      const startX = e.clientX;
      const startW = widthRef.current;
      const sign = side === 'left' ? 1 : -1;

      const onMove = (moveEvent) => {
        const delta = (moveEvent.clientX - startX) * sign;
        const next = Math.min(maxWidth, Math.max(minWidth, startW + delta));
        widthRef.current = next;
        setWidth(next);
      };

      const onUp = () => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        try {
          localStorage.setItem(storageKey, String(widthRef.current));
        } catch {
          /* ignore */
        }
      };

      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    },
    [storageKey, minWidth, maxWidth, side],
  );

  return { width, beginResize };
}
