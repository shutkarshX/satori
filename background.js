chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false }).catch(() => {});
});

const setStatus = (text, kind = 'waiting') => chrome.storage.local.set({ satoriStatus: { text, kind, at: Date.now() } });

async function ensureChatGPTScript(tabId) {
  try {
    await chrome.tabs.sendMessage(tabId, { type: 'PING_CHATGPT' });
    return true;
  } catch (_error) {
    try {
      await chrome.scripting.executeScript({ target: { tabId }, files: ['chatgpt.js'] });
      return true;
    } catch (_injectError) {
      return false;
    }
  }
}

async function readChatGPTResponse(tabId) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        const clean = (value) => {
          const fenced = [...value.matchAll(/```[^\n]*\n?([\s\S]*?)```/g)].map((m) => m[1].trim());
          return (fenced.sort((a, b) => b.length - a.length)[0] || value).trim();
        };
        // Keep selectors narrow: broad class/data-test selectors can match Gemini's
        // whole application shell and make an old page look like a new answer.
        const responseSelectors = ['[data-message-author-role="assistant"]', '[data-testid^="conversation-turn"] [data-message-author-role="assistant"]', '.markdown'];
        for (const selector of responseSelectors) {
          const nodes = [...document.querySelectorAll(selector)].filter((n) => (n.innerText || n.textContent || '').trim());
          if (!nodes.length) continue;
          const latest = nodes[nodes.length - 1];
          const parts = [latest, ...latest.querySelectorAll('.markdown, [class*="markdown" i], [class*="response" i], message-content')];
          return parts.map((n) => clean((n.innerText || n.textContent || '').trim()))
            .filter((text) => text.length > 20)
            .reduce((longest, text) => text.length > longest.length ? text : longest, '');
        }
        return '';
      }
    });
    return result?.[0]?.result || '';
  } catch (_error) { return ''; }
}

async function pollChatGPTResponse(tabId, before, attempts = 90, stable = 0, previous = '') {
  const text = await readChatGPTResponse(tabId);
  if (text && text !== before && text === previous) stable += 1; else stable = 0;
  if (text && text !== before && stable >= 2) {
    chrome.storage.local.set({ latestGeminiResponse: text, latestGeminiAt: Date.now() });
    setStatus('ChatGPT response ready — open Satori to review it.', 'ready');
    chrome.runtime.sendMessage({ type: 'GEMINI_RESPONSE', text }).catch(() => {});
    return;
  }
  if (attempts > 0) setTimeout(() => pollChatGPTResponse(tabId, before, attempts - 1, stable, text), 1000);
  else setStatus('ChatGPT did not return a response. Open ChatGPT and check it.', 'error');
}

async function waitForChatGPT(tabId, prompt, attempts = 20) {
  const ready = await ensureChatGPTScript(tabId);
  if (ready) {
    try {
      const before = await readChatGPTResponse(tabId);
      const result = await chrome.tabs.sendMessage(tabId, { type: 'FILL_AND_SEND_CHATGPT', prompt });
      if (result?.ok) {
        setStatus('Prompt sent — waiting for ChatGPT response…', 'waiting');
        pollChatGPTResponse(tabId, before);
        return;
      }
    } catch (_error) { /* retry while the page finishes loading */ }
  }
  if (attempts > 0) setTimeout(() => waitForChatGPT(tabId, prompt, attempts - 1), 500);
  else setStatus('ChatGPT input was not ready. Log in to ChatGPT and try again.', 'error');
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === 'GEMINI_RESPONSE') {
    chrome.storage.local.set({ latestGeminiResponse: message.text, latestGeminiAt: Date.now() });
    chrome.runtime.sendMessage({ type: 'CHATGPT_RESPONSE', text: message.text }).catch(() => {});
    return;
  }
  if (message.type !== 'OPEN_OR_REUSE_GEMINI') return;
  chrome.storage.local.remove('latestGeminiResponse');
  setStatus('Opening ChatGPT in the background…', 'waiting');
  chrome.tabs.query({ url: ['https://chatgpt.com/*', 'https://www.chatgpt.com/*', 'https://chat.openai.com/*'] }, (tabs) => {
    const existing = tabs[0];
    const activate = (tab) => {
      // Keep the assignment tab in front. Gemini is used as an inactive helper tab.
      chrome.tabs.update(tab.id, { active: false }, () => {
        waitForChatGPT(tab.id, message.prompt);
      });
    };
    if (existing) {
      activate(existing);
      sendResponse({ ok: true, reused: true });
      return;
    }
    chrome.tabs.create({ url: 'https://chatgpt.com/', active: false }, (tab) => {
      const listener = (tabId, changeInfo) => {
        if (tabId === tab.id && changeInfo.status === 'complete') {
          chrome.tabs.onUpdated.removeListener(listener);
          waitForChatGPT(tab.id, message.prompt);
        }
      };
      chrome.tabs.onUpdated.addListener(listener);
      sendResponse({ ok: true, reused: false });
    });
  });
  return true;
});
