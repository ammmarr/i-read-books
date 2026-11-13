// I read — reading on command: turn counting on (or off) for the page in front of you, whatever site it is.
// Used by the popup and the Alt+Shift+R shortcut (background.js). The page remembers it for this tab only (sites.js).
// Re-injecting the scripts is safe: a copy already in the page stands down for the new one.

/** What this tab's page is: { known: a site I read already counts, on: reading is on by command, host }. */
export async function pageState(tabId) {
  try {
    const [r] = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => ({
        known: !!globalThis.__irbSites?.current(),
        on: !!globalThis.__irbSites?.manualOn(),
        host: location.hostname,
        ok: location.protocol === 'https:',
      }),
    })
    return r?.result ?? null
  } catch {
    return null // chrome:// pages, the Web Store, a tab that is still loading
  }
}

/** Turns reading on or off for the tab. Returns the new state, or null if the page can't be reached. */
export async function setReading(tabId, on) {
  try {
    await chrome.scripting.executeScript({ target: { tabId }, files: ['sites.js'] })
    await chrome.scripting.executeScript({ target: { tabId }, func: (v) => globalThis.__irbSites?.setManual(v), args: [on] })
    if (on) await chrome.scripting.executeScript({ target: { tabId }, files: ['sites.js', 'content.js', 'annotate.js'] })
    return pageState(tabId)
  } catch {
    return null
  }
}
