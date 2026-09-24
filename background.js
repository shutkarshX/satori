chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false }).catch(() => {});
});

async function ensureGeminiScript(tabId) {
  try {
    await chrome.tabs.sendMessage(tabId, { type: 'PING_GEMINI' });
    return true;
  } catch (_error) {
    try {
      await chrome.scripting.executeScript({ target: { tabId }, files: ['gemini.js'] });
      return true;
    } catch (_injectError) {
      return false;
    }
  }
}

async function readGeminiResponse(tabId) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => [...document.querySelectorAll('model-response, message-content, [data-message-author-role="model"], [data-test-id*="model" i]')]
        .map((n) => (n.innerText || n.textContent || '').trim()).filter(Boolean).pop() || ''
    });
    return result?.[0]?.result || '';
  } catch (_error) { return ''; }
}

async function pollGeminiResponse(tabId, before, attempts = 30, stable = 0, previous = '') {
  const text = await readGeminiResponse(tabId);
  if (text && text !== before && text === previous) stable += 1; else stable = 0;
  if (text && text !== before && stable >= 2) {
    chrome.storage.local.set({ latestGeminiResponse: text, latestGeminiAt: Date.now() });
    chrome.runtime.sendMessage({ type: 'GEMINI_RESPONSE', text }).catch(() => {});
    return;
  }
  if (attempts > 0) setTimeout(() => pollGeminiResponse(tabId, before, attempts - 1, stable, text), 1000);
}

async function waitForGemini(tabId, prompt, attempts = 20) {
  const ready = await ensureGeminiScript(tabId);
  if (ready) {
    try {
      const before = await readGeminiResponse(tabId);
      const result = await chrome.tabs.sendMessage(tabId, { type: 'FILL_AND_SEND_GEMINI', prompt });
      if (result?.ok) { pollGeminiResponse(tabId, before); return; }
    } catch (_error) { /* retry while the page finishes loading */ }
  }
  if (attempts > 0) setTimeout(() => waitForGemini(tabId, prompt, attempts - 1), 500);
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === 'GEMINI_RESPONSE') {
    chrome.storage.local.set({ latestGeminiResponse: message.text, latestGeminiAt: Date.now() });
    chrome.runtime.sendMessage({ type: 'GEMINI_RESPONSE', text: message.text }).catch(() => {});
    return;
  }
  if (message.type !== 'OPEN_OR_REUSE_GEMINI') return;
  chrome.tabs.query({ url: 'https://gemini.google.com/*' }, (tabs) => {
    const existing = tabs[0];
    const activate = (tab) => {
      chrome.tabs.update(tab.id, { active: true }, () => {
        chrome.windows.update(tab.windowId, { focused: true });
        chrome.sidePanel.open({ windowId: tab.windowId }).catch(() => {});
        waitForGemini(tab.id, message.prompt);
      });
    };
    if (existing) {
      activate(existing);
      sendResponse({ ok: true, reused: true });
      return;
    }
    chrome.tabs.create({ url: 'https://gemini.google.com/app', active: true }, (tab) => {
      const listener = (tabId, changeInfo) => {
        if (tabId === tab.id && changeInfo.status === 'complete') {
          chrome.tabs.onUpdated.removeListener(listener);
          chrome.sidePanel.open({ windowId: tab.windowId }).catch(() => {});
          waitForGemini(tab.id, message.prompt);
        }
      };
      chrome.tabs.onUpdated.addListener(listener);
      sendResponse({ ok: true, reused: false });
    });
  });
  return true;
});
