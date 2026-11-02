/** True while the window is minimized or the tab is in the background; pollers skip work then. */
export function isPageHidden() {
  return typeof document !== 'undefined' && document.visibilityState === 'hidden';
}
