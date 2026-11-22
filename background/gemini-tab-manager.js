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
    },
    async toggleSideBySide(callerTab) {
      const tabs = await chrome.tabs.query({ url: '*://gemini.google.com/*' });
      let geminiTab = tabs.find((t) => t.id === pinnedTabId) || tabs[0];
      
      // If no tab exists, create one
      if (!geminiTab) {
        geminiTab = await chrome.tabs.create({ url: GEMINI_URL, active: false });
        pinnedTabId = geminiTab.id;
      }

      // Check if Gemini is in a separate popup window already
      const geminiWindow = await chrome.tabs.get(geminiTab.id).then((t) => chrome.windows.get(t.windowId)).catch(() => null);
      const callerWindow = callerTab?.windowId ? await chrome.windows.get(callerTab.windowId).catch(() => null) : null;

      if (geminiWindow && geminiWindow.id !== callerWindow?.id && geminiWindow.type === 'popup') {
        // Toggle: close it if it's already open as side panel popup
        await chrome.windows.remove(geminiWindow.id).catch(() => {});
        return { open: false };
      }

      // Position side-by-side: right half of the screen
      const screenWidth = callerWindow?.width || 1920;
      const screenHeight = callerWindow?.height || 1080;
      const halfWidth = Math.floor(screenWidth * 0.45);
      const left = (callerWindow?.left || 0) + (screenWidth - halfWidth);

      // Detach Gemini tab into its own companion side window
      const win = await chrome.windows.create({
        tabId: geminiTab.id,
        type: 'popup',
        left: left,
        top: callerWindow?.top || 0,
        width: halfWidth,
        height: screenHeight,
        focused: true
      });

      pinnedTabId = geminiTab.id;
      return { open: true, windowId: win.id };
    }
  };
})();
