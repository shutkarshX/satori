const setStatus = (text, kind = 'waiting') => chrome.storage.local.set({ satoriStatus: { text, kind, at: Date.now() } });
let activeRequestId = 0;
const addDiagnostic = (step, detail) => chrome.storage.local.get('satoriDiagnostics', (result) => {
  const entries = Array.isArray(result.satoriDiagnostics) ? result.satoriDiagnostics : [];
  entries.push({ time: new Date().toLocaleTimeString(), step, detail });
  chrome.storage.local.set({ satoriDiagnostics: entries.slice(-30) });
});

async function readGoogleAIOverview(tabId) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        const clean = (value) => value.replace(/\u00a0/g, ' ').replace(/\r\n?/g, '\n').replace(/[ \t]+\n/g, '\n').trim();
        const codeScore = (text, node) => {
          let score = 0;
          if (node?.matches?.('pre, pre code')) score += 100;
          if (node?.closest?.('pre')) score += 80;
          if (node?.parentElement?.querySelector?.('button[aria-label*="copy" i], button[title*="copy" i]')) score += 80;
          if (/#include|\bint\s+main\s*\(|public\s+class\s+Main|\bdef\s+main\s*\(|if\s+__name__/.test(text)) score += 35;
          if (/[{}();]|\bfor\s*\(|\bwhile\s*\(|\breturn\b/.test(text)) score += 20;
          if (/^(Here|This|The|Explanation|Algorithm|Complexity|Note|Would you)/im.test(text)) score -= 60;
          if (text.split('\n').length > 2) score += 10;
          return score;
        };
        const selectors = ['[data-attrid="wa"]', '[data-attrid="AIOverview"]', '[data-mce-source]', 'div[jsname="N760b"]'];
        const nodes = selectors.flatMap((selector) => [...document.querySelectorAll(selector)]);
        const candidates = nodes
          .map((node) => clean(node.innerText || node.textContent || ''))
          .filter((text) => text.length > 40);
        nodes.forEach((node) => {
          let parent = node;
          for (let depth = 0; depth < 7 && parent; depth += 1) {
            const text = clean(parent.innerText || '');
            if (text.length > 40 && text.length < 40000) candidates.push(text);
            parent = parent.parentElement;
          }
        });
        const overviewLabel = [...document.querySelectorAll('h1,h2,h3,div,span')]
          .find((node) => /^AI Overview$/i.test((node.innerText || '').trim()));
        if (overviewLabel?.parentElement) {
          const nearby = clean(overviewLabel.parentElement.parentElement?.innerText || overviewLabel.parentElement.innerText || '');
          if (nearby.length > 40) candidates.push(nearby);
        }
        const text = candidates.sort((a, b) => b.length - a.length)[0] || '';
        const codeCandidates = [...document.querySelectorAll('pre code, pre, [role="textbox"][aria-label*="code" i]')]
          .map((node) => ({ text: clean(node.innerText || node.textContent || ''), score: 0, node }))
          .filter((candidate) => candidate.text.length > 20)
          .map((candidate) => ({ ...candidate, score: codeScore(candidate.text, candidate.node) }));
        const fenced = [...document.body.innerText.matchAll(/```[^\n]*\n?([\s\S]*?)```/g)]
          .map((match) => ({ text: clean(match[1]), score: 70, node: null }))
          .filter((candidate) => candidate.text.length > 20);
        const code = [...codeCandidates, ...fenced].sort((a, b) => b.score - a.score || b.text.length - a.text.length)[0]?.text || '';
        const loading = /generating|loading/i.test(document.body?.innerText || '') && !text;
        return { text, code, loading };
      }
    });
    return result?.[0]?.result || { text: '', loading: false };
  } catch (_error) { return { text: '', loading: false }; }
}

async function pollGoogleAIOverview(tabId, before, requestId, mode, attempts = 60) {
  if (requestId !== activeRequestId) return;
  const reading = await readGoogleAIOverview(tabId);
  const text = reading.text || '';
  const selected = mode === 'coding' ? (reading.code || '') : text;
  addDiagnostic('response-check', text ? `response found (${text.length} chars), code candidate=${reading.code ? 'yes' : 'no'}` : 'no AI response candidate');
  if (selected && selected !== before) {
    chrome.storage.local.set({ latestGoogleResponse: selected, latestGoogleRawResponse: text, latestGoogleAt: Date.now() });
    let quality = 'response captured and stored';
    let warning = '';
    if (mode === 'mcq' && !/\b(answer|correct answer|option)\s*[:\-]/i.test(text)) {
      warning = ' Response captured, but no explicit MCQ answer was found.';
      quality += '; MCQ answer marker missing';
    } else if (mode === 'coding' && !/(#include|public\s+class\s+Main|\bint\s+main\s*\(|\bdef\s+main\s*\()/i.test(selected)) {
      warning = ' Response captured, but it does not look like a complete program.';
      quality += '; code completeness warning';
    }
    setStatus(`Google AI Overview captured.${warning}`, warning ? 'error' : 'ready');
    addDiagnostic('complete', quality);
    return;
  }
  if (mode === 'coding' && text && !reading.code) addDiagnostic('parser', 'response found but no reliable code block detected');
  if (attempts > 0) setTimeout(() => pollGoogleAIOverview(tabId, before, requestId, mode, attempts - 1), 1000);
  else setStatus('No Google AI Overview was detected. Check the search tab or try again.', 'error');
}

async function getReusableGoogleTab(windowId) {
  const stored = await chrome.storage.local.get(['satoriGoogleTabId', 'satoriGoogleWindowId']);
  if (stored.satoriGoogleTabId && stored.satoriGoogleWindowId === windowId) {
    try {
      const tab = await chrome.tabs.get(stored.satoriGoogleTabId);
      if (tab?.windowId === windowId && /^https:\/\/(www\.)?google\./i.test(tab.url || '')) return tab;
    } catch (_error) {
      addDiagnostic('tab', 'saved Google tab no longer exists');
    }
  }
  const tabs = await chrome.tabs.query({ windowId });
  const inactiveGoogleTab = tabs.find((tab) => !tab.active && /^https:\/\/(www\.)?google\./i.test(tab.url || ''));
  if (inactiveGoogleTab?.id) {
    await chrome.storage.local.set({ satoriGoogleTabId: inactiveGoogleTab.id, satoriGoogleWindowId: windowId });
    addDiagnostic('tab', `adopted existing inactive Google tab ${inactiveGoogleTab.id}`);
    return inactiveGoogleTab;
  }
  return null;
}

async function startGoogleSearch(query, requestId, mode, assignmentTab) {
  const url = `https://www.google.com/search?q=${encodeURIComponent(query.slice(0, 30000))}`;
  await chrome.storage.local.remove(['latestGoogleResponse', 'latestGoogleRawResponse']);
  const windowId = assignmentTab?.windowId;
  let tab = windowId ? await getReusableGoogleTab(windowId) : null;
  const reused = Boolean(tab?.id);
  addDiagnostic('tab', tab ? `reusing Google Search tab ${tab.id}` : 'creating reusable Google Search tab');
  setStatus('Opening Google Search for AI Overview in the background…', 'waiting');
  let targetTabId = tab?.id || null;
  let handled = false;
  const handleLoaded = async () => {
    if (handled || requestId !== activeRequestId || !targetTabId) return;
    handled = true;
    chrome.tabs.onUpdated.removeListener(listener);
    setStatus('Google Search loaded — checking for AI Overview…', 'waiting');
    addDiagnostic('page', `Google Search tab ${targetTabId} loaded`);
    const reading = await readGoogleAIOverview(targetTabId);
    const before = mode === 'coding' ? (reading.code || '') : (reading.text || '');
    pollGoogleAIOverview(targetTabId, before, requestId, mode);
  };
  const listener = (updatedTabId, changeInfo) => {
    if (updatedTabId === targetTabId && changeInfo.status === 'complete') handleLoaded();
  };
  chrome.tabs.onUpdated.addListener(listener);
  try {
    if (tab?.id) {
      await chrome.tabs.update(tab.id, { url, active: false });
    } else {
      tab = await chrome.tabs.create({ url, active: false, windowId });
      if (!tab?.id) throw new Error('Chrome did not create the tab.');
      targetTabId = tab.id;
      await chrome.storage.local.set({ satoriGoogleTabId: tab.id, satoriGoogleWindowId: tab.windowId });
    }
    if (!reused && tab.status === 'complete') handleLoaded();
  } catch (error) {
    chrome.tabs.onUpdated.removeListener(listener);
    setStatus(`Could not open Google Search: ${error.message}`, 'error');
    addDiagnostic('tab-error', error.message);
  }
}

let activeGeminiRequest = null;

async function getReusableGeminiTab(windowId) {
  const stored = await chrome.storage.local.get(['satoriGeminiTabId', 'satoriGeminiWindowId']);
  if (stored.satoriGeminiTabId && stored.satoriGeminiWindowId === windowId) {
    try {
      const tab = await chrome.tabs.get(stored.satoriGeminiTabId);
      if (tab?.windowId === windowId && /^https:\/\/gemini\.google\.com\//i.test(tab.url || '')) return tab;
    } catch (_error) {
      addDiagnostic('gemini-tab', 'saved Gemini tab no longer exists');
    }
  }
  const tabs = await chrome.tabs.query({ windowId });
  const inactive = tabs.find((tab) => !tab.active && /^https:\/\/gemini\.google\.com\//i.test(tab.url || ''));
  if (inactive?.id) {
    await chrome.storage.local.set({ satoriGeminiTabId: inactive.id, satoriGeminiWindowId: windowId });
    addDiagnostic('gemini-tab', `adopted existing inactive Gemini tab ${inactive.id}`);
    return inactive;
  }
  return null;
}

async function sendGeminiPrompt(tabId, requestId, prompt, mode, retries = 15) {
  if (requestId !== activeRequestId) return;
  try {
    const result = await chrome.tabs.sendMessage(tabId, { type: 'FILL_AND_SEND_GEMINI', requestId, prompt, mode });
    if (result?.ok) {
      addDiagnostic('gemini-input', `prompt dispatched; baseline responses=${result.baselineCount ?? 'unknown'}`);
      setStatus('Gemini prompt sent — waiting for a new response…', 'waiting');
      return;
    }
    addDiagnostic('gemini-input', result?.error || 'Gemini adapter rejected the prompt');
  } catch (error) {
    addDiagnostic('gemini-input', `adapter not ready (${error.message})`);
  }
  if (retries > 0) setTimeout(() => sendGeminiPrompt(tabId, requestId, prompt, mode, retries - 1), 1000);
  else {
    setStatus('Gemini input was not ready. Open Gemini once, then try again.', 'error');
    addDiagnostic('gemini-error', 'input not found after retries');
  }
}

async function startGeminiSearch(prompt, requestId, mode, assignmentTab) {
  await chrome.storage.local.remove(['latestGeminiResponse', 'latestGeminiRawResponse']);
  const windowId = assignmentTab?.windowId;
  let tab = windowId ? await getReusableGeminiTab(windowId) : null;
  activeGeminiRequest = { requestId, mode, tabId: null };
  addDiagnostic('gemini-tab', tab ? `reusing Gemini tab ${tab.id}` : 'creating reusable Gemini tab');
  setStatus('Opening Gemini in the background…', 'waiting');
  try {
    const url = 'https://gemini.google.com/app';
    if (tab?.id) {
      activeGeminiRequest.tabId = tab.id;
      await chrome.tabs.update(tab.id, { url, active: false });
      setTimeout(() => sendGeminiPrompt(tab.id, requestId, prompt, mode), 1200);
    } else {
      tab = await chrome.tabs.create({ url, active: false, windowId });
      if (!tab?.id) throw new Error('Chrome did not create the Gemini tab.');
      activeGeminiRequest.tabId = tab.id;
      await chrome.storage.local.set({ satoriGeminiTabId: tab.id, satoriGeminiWindowId: tab.windowId });
      setTimeout(() => sendGeminiPrompt(tab.id, requestId, prompt, mode), 1800);
    }
  } catch (error) {
    setStatus(`Could not open Gemini: ${error.message}`, 'error');
    addDiagnostic('gemini-error', error.message);
  }
}

function handleGeminiResponse(message) {
  if (!activeGeminiRequest || message.requestId !== activeGeminiRequest.requestId) {
    addDiagnostic('gemini-stale', 'ignored response from an older Gemini request');
    return;
  }
  const payload = typeof message.text === 'string' ? { text: message.text, code: '' } : (message.text || {});
  const raw = String(payload.text || '').trim();
  const selected = activeGeminiRequest.mode === 'coding' ? String(payload.code || '').trim() : raw;
  if (!selected) {
    setStatus(activeGeminiRequest.mode === 'coding' ? 'Gemini responded, but no reliable code block was found.' : 'Gemini returned an empty response.', 'error');
    addDiagnostic('gemini-parser', activeGeminiRequest.mode === 'coding' ? 'response found but code block missing' : 'empty response');
    return;
  }
  chrome.storage.local.set({ latestGeminiResponse: selected, latestGeminiRawResponse: raw, latestGeminiAt: Date.now(), latestProvider: 'gemini' });
  const warning = activeGeminiRequest.mode === 'coding' && !/(#include|public\s+class\s+Main|\bint\s+main\s*\(|\bdef\s+main\s*\()/i.test(selected);
  setStatus(`Gemini response captured.${warning ? ' It may be incomplete.' : ''}`, warning ? 'error' : 'ready');
  addDiagnostic('gemini-complete', `${selected.length} chars captured${activeGeminiRequest.mode === 'coding' ? ' as code' : ''}`);
}

chrome.runtime.onMessage.addListener(async (message, sender, sendResponse) => {
  if (message.type === 'GEMINI_RESPONSE') {
    handleGeminiResponse(message);
    return;
  }
  if (message.type === 'GEMINI_DIAGNOSTIC') {
    addDiagnostic('gemini', message.detail || 'Gemini adapter diagnostic');
    return;
  }
  if (message.type === 'GEMINI_SUBMITTED') {
    addDiagnostic('gemini-submit', message.detail || 'Gemini prompt submitted');
    return;
  }
  if (!['OPEN_GOOGLE_SEARCH', 'OPEN_GEMINI_REQUEST', 'OPEN_CHATGPT_REQUEST'].includes(message.type)) return;
  activeRequestId += 1;
  const requestId = activeRequestId;
  const provider = message.type === 'OPEN_GEMINI_REQUEST' ? 'gemini' : message.type === 'OPEN_CHATGPT_REQUEST' ? 'chatgpt' : 'google';
  chrome.storage.local.set({ satoriDiagnostics: [{ time: new Date().toLocaleTimeString(), step: 'request', detail: `provider=${provider}` }] });
  const query = provider === 'google' ? (message.googleQuery || message.prompt || '') : (message.prompt || '');
  addDiagnostic('prompt', `${provider} query length=${query.length}`);
  let assignmentTab = sender.tab;
  if (!assignmentTab?.windowId) {
    const activeTabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    assignmentTab = activeTabs.find((tab) => tab.id && !/^https:\/\/(www\.)?google\./i.test(tab.url || '') && !/^https:\/\/gemini\.google\.com\//i.test(tab.url || '')) || activeTabs[0];
  }
  addDiagnostic('tab', assignmentTab?.windowId ? `assignment window=${assignmentTab.windowId}` : 'assignment window unavailable');
  if (provider === 'google') {
    startGoogleSearch(query, requestId, message.mode || 'text', assignmentTab);
  } else if (provider === 'gemini') {
    startGeminiSearch(query, requestId, message.mode || 'text', assignmentTab);
  } else {
    setStatus('ChatGPT adapter is not enabled yet. Select Google or Gemini for this version.', 'error');
    addDiagnostic('provider', 'ChatGPT adapter not enabled');
    sendResponse({ ok: false });
    return;
  }
  sendResponse({ ok: true });
});
