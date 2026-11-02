/**
 * Minimal external store for the map pointer so mouse moves only re-render
 * subscribers (via useSyncExternalStore) instead of the whole map.
 */
export function createPointerStore(initialValue) {
  let value = initialValue;
  const listeners = new Set();
  return {
    get: () => value,
    set: (next) => {
      value = next;
      listeners.forEach((listener) => listener());
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
