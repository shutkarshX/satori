// Manages reusable background Gemini tab lifecycle and navigation
(() => {
  const GEMINI_URL = 'https://gemini.google.com/app';
  let pinnedTabId = null;
  let isOpening = false;

  async function getOrCreateTab() {
    if (pinnedTabId) {
      try {
        const tab = await chrome.tabs.get(pinnedTabId);
        if (tab && (tab.url || tab.pendingUrl)?.includes('gemini.google.com')) return tab;
      } catch (_e) {
        pinnedTabId = null;
      }
    }

    const tabs = await chrome.tabs.query({ url: '*://gemini.google.com/*' });
    if (tabs && tabs.length > 0) {
      const activeOne = tabs.find((t) => t.active) || tabs[0];
      pinnedTabId = activeOne.id;
      chrome.tabs.update(activeOne.id, { autoDiscardable: false }).catch(() => {});
      return activeOne;
    }

    if (isOpening) {
      await new Promise((r) => setTimeout(r, 600));
      return getOrCreateTab();
    }

    isOpening = true;
    try {
      const newTab = await chrome.tabs.create({ url: GEMINI_URL, active: false });
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
