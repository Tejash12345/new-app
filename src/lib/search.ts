// Window-event channel used to open the universal search palette from anywhere
// (the on-screen search button in the top bar). This is the only entry point
// that works inside the Android WebView, where ⌘K / Ctrl-K is unavailable.
export const SEARCH_EVENT = 'focuslion:open-search'

/** Open the FocusLion search palette. */
export function openSearch() {
  window.dispatchEvent(new Event(SEARCH_EVENT))
}
