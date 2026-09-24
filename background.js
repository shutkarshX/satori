const setStatus = (text, kind = 'waiting') => chrome.storage.local.set({ satoriStatus: { text, kind, at: Date.now() } });
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
        const selectors = ['[data-attrid="wa"]', '[data-attrid="AIOverview"]', '[data-mce-source]', 'div[jsname="N760b"]'];
        const candidates = selectors.flatMap((selector) => [...document.querySelectorAll(selector)])
          .map((node) => clean(node.innerText || node.textContent || ''))
          .filter((text) => text.length > 40);
        const overviewLabel = [...document.querySelectorAll('h1,h2,h3,div,span')]
          .find((node) => /^AI Overview$/i.test((node.innerText || '').trim()));
        if (overviewLabel?.parentElement) {
          const nearby = clean(overviewLabel.parentElement.parentElement?.innerText || overviewLabel.parentElement.innerText || '');
          if (nearby.length > 40) candidates.push(nearby);
        }
        const text = candidates.sort((a, b) => b.length - a.length)[0] || '';
        const loading = /generating|loading/i.test(document.body?.innerText || '') && !text;
        return { text, loading };
      }
    });
    return result?.[0]?.result || { text: '', loading: false };
  } catch (_error) { return { text: '', loading: false }; }
}

async function pollGoogleAIOverview(tabId, before, attempts = 60) {
  const reading = await readGoogleAIOverview(tabId);
  const text = reading.text || '';
  addDiagnostic('response-check', text ? `candidate found (${text.length} chars)` : 'no AI response candidate');
  if (text && text !== before) {
    chrome.storage.local.set({ latestGoogleResponse: text, latestGoogleAt: Date.now() });
    setStatus('Google AI Mode response ready — open Satori to review it.', 'ready');
    addDiagnostic('complete', 'response captured and stored');
    return;
  }
  if (attempts > 0) setTimeout(() => pollGoogleAIOverview(tabId, before, attempts - 1), 1000);
  else setStatus('No Google AI Mode response was detected. Check the search tab or try again.', 'error');
}

async function startGoogleSearch(prompt) {
  const url = `https://www.google.com/search?q=${encodeURIComponent(prompt)}&udm=50`;
  chrome.storage.local.remove('latestGoogleResponse');
  addDiagnostic('tab', 'creating Google AI Mode tab');
  setStatus('Opening Google AI Mode in the background…', 'waiting');
  chrome.tabs.create({ url, active: false }, (tab) => {
    if (chrome.runtime.lastError || !tab?.id) {
      setStatus(`Could not open Google Search: ${chrome.runtime.lastError?.message || 'Chrome did not create the tab.'}`, 'error');
      return;
    }
    const listener = async (tabId, changeInfo) => {
      if (tabId !== tab.id || changeInfo.status !== 'complete') return;
      chrome.tabs.onUpdated.removeListener(listener);
      setStatus('Google AI Mode loaded — checking for its response…', 'waiting');
      addDiagnostic('page', 'Google AI Mode page loaded');
      const before = (await readGoogleAIOverview(tab.id)).text || '';
      pollGoogleAIOverview(tab.id, before);
    };
    chrome.tabs.onUpdated.addListener(listener);
  });
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type !== 'OPEN_GOOGLE_SEARCH') return;
  const provider = message.provider || 'google';
  chrome.storage.local.set({ satoriDiagnostics: [{ time: new Date().toLocaleTimeString(), step: 'request', detail: `provider=${provider}` }] });
  if (provider !== 'google') {
    setStatus(`${provider === 'gemini' ? 'Gemini' : 'ChatGPT'} adapter is not enabled yet. Select Google AI Mode for this version.`, 'error');
    addDiagnostic('provider', 'adapter not enabled');
    sendResponse({ ok: false });
    return;
  }
  addDiagnostic('prompt', `query length=${(message.prompt || '').length}`);
  startGoogleSearch(message.prompt);
  sendResponse({ ok: true });
});
