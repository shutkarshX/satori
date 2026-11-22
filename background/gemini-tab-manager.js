// Manages reusable background Gemini tab lifecycle and navigation
(() => {
  const GEMINI_URL = 'https://gemini.google.com/app';
  let pinnedTabId = null;
  let isOpening = false;

  async function getOrCreateTab(windowId) {
    if (pinnedTabId) {
      try {
        const tab = await chrome.tabs.get(pinnedTabId);
        if (tab && (tab.url || tab.pendingUrl)?.includes('gemini.google.com') && (!windowId || tab.windowId === windowId)) return tab;
      } catch (_e) {
        pinnedTabId = null;
      }
    }

    const tabs = await chrome.tabs.query({ url: '*://gemini.google.com/*' });
    const matchingWindow = windowId ? tabs.filter((tab) => tab.windowId === windowId) : tabs;
    if (matchingWindow.length > 0) {
      const selected = matchingWindow.find((tab) => tab.active) || matchingWindow[0];
      pinnedTabId = selected.id;
      chrome.tabs.update(selected.id, { autoDiscardable: false }).catch(() => {});
      return selected;
    }

    if (isOpening) {
      await new Promise((r) => setTimeout(r, 600));
      return getOrCreateTab(windowId);
    }

    isOpening = true;
    try {
      const createOptions = { url: GEMINI_URL, active: false };
      if (windowId) createOptions.windowId = windowId;
      const newTab = await chrome.tabs.create(createOptions);
      pinnedTabId = newTab.id;
      chrome.tabs.update(newTab.id, { autoDiscardable: false }).catch(() => {});
      return newTab;
    } finally {
      isOpening = false;
    }
  }

  function waitForComplete(tabId, timeout = 12000) {
    return new Promise((resolve) => {
      let timer = null;
      const listener = (id, info) => {
        if (id === tabId && info.status === 'complete') {
          chrome.tabs.onUpdated.removeListener(listener);
          clearTimeout(timer);
          resolve();
        }
      };
      timer = setTimeout(() => {
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }, timeout);
      chrome.tabs.onUpdated.addListener(listener);
    });
  }

  self.satoTabManager = {
    getOrCreateTab,
    waitForComplete,
    async resetToFreshChat(tab) {
      const loaded = waitForComplete(tab.id);
      await chrome.tabs.update(tab.id, { url: GEMINI_URL });
      await loaded;
    }
  };
})();
