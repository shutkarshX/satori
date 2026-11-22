// Per-tab snippet storage, persisted across MV3 service-worker restarts.
(() => {
  const STORAGE_KEY = 'satoSnippetsByTab';
  const snippetsByTab = new Map();
  const ready = chrome.storage.session.get(STORAGE_KEY).then((data) => {
    const saved = data[STORAGE_KEY] || {};
    for (const [tabId, list] of Object.entries(saved)) snippetsByTab.set(tabId, Array.isArray(list) ? list : []);
  }).catch(() => {});

  function tabKey(sender) {
    return String(sender?.tab?.id ?? 'global');
  }

  function persist() {
    chrome.storage.session.set({ [STORAGE_KEY]: Object.fromEntries(snippetsByTab) }).catch(() => {});
  }

  self.satoSnippetStore = {
    async handleMessage(request, sender, sendResponse) {
      await ready;
      const key = tabKey(sender);
      const list = snippetsByTab.get(key) || [];
      if (request.type === 'SATO_SNIPPET_ADD') {
        if (list[list.length - 1] !== request.text) list.push(request.text);
        snippetsByTab.set(key, list);
        persist();
        sendResponse({ count: list.length, list: [...list] });
        return;
      }
      if (request.type === 'SATO_SNIPPET_CLEAR') {
        snippetsByTab.delete(key);
        persist();
        sendResponse({ count: 0, cleared: list.length, list: [] });
        return;
      }
      if (request.type === 'SATO_SNIPPET_CONSUME') {
        list.splice(0, request.count || list.length);
        if (list.length) snippetsByTab.set(key, list);
        else snippetsByTab.delete(key);
        persist();
        sendResponse({ count: list.length, list: [...list] });
        return;
      }
      sendResponse({ count: list.length, list: [...list] });
    }
  };
})();
