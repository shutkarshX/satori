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

async function pollGoogleAIOverview(tabId, before, requestId, mode, attempts = 60) {
  if (requestId !== activeRequestId) return;
  const reading = await readGoogleAIOverview(tabId);
  const text = reading.text || '';
  addDiagnostic('response-check', text ? `candidate found (${text.length} chars)` : 'no AI response candidate');
  if (text && text !== before) {
    chrome.storage.local.set({ latestGoogleResponse: text, latestGoogleAt: Date.now() });
    let quality = 'response captured and stored';
    let warning = '';
    if (mode === 'mcq' && !/\b(answer|correct answer|option)\s*[:\-]/i.test(text)) {
      warning = ' Response captured, but no explicit MCQ answer was found.';
      quality += '; MCQ answer marker missing';
    } else if (mode === 'coding' && !/(#include|public\s+class\s+Main|\bint\s+main\s*\(|\bdef\s+main\s*\()/i.test(text)) {
      warning = ' Response captured, but it does not look like a complete program.';
      quality += '; code completeness warning';
    }
    setStatus(`Google AI Overview captured.${warning}`, warning ? 'error' : 'ready');
    addDiagnostic('complete', quality);
    return;
  }
  if (attempts > 0) setTimeout(() => pollGoogleAIOverview(tabId, before, requestId, mode, attempts - 1), 1000);
  else setStatus('No Google AI Overview was detected. Check the search tab or try again.', 'error');
}

async function startGoogleSearch(query, requestId, mode) {
  const url = `https://www.google.com/search?q=${encodeURIComponent(query.slice(0, 30000))}`;
  chrome.storage.local.remove('latestGoogleResponse');
  addDiagnostic('tab', 'creating Google Search tab');
  setStatus('Opening Google Search for AI Overview in the background…', 'waiting');
  chrome.tabs.create({ url, active: false }, (tab) => {
    if (chrome.runtime.lastError || !tab?.id) {
      setStatus(`Could not open Google Search: ${chrome.runtime.lastError?.message || 'Chrome did not create the tab.'}`, 'error');
      return;
    }
    const listener = async (tabId, changeInfo) => {
      if (tabId !== tab.id || changeInfo.status !== 'complete') return;
      chrome.tabs.onUpdated.removeListener(listener);
      setStatus('Google Search loaded — checking for AI Overview…', 'waiting');
      addDiagnostic('page', 'Google Search page loaded');
      const before = (await readGoogleAIOverview(tab.id)).text || '';
      pollGoogleAIOverview(tab.id, before, requestId, mode);
    };
    chrome.tabs.onUpdated.addListener(listener);
  });
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type !== 'OPEN_GOOGLE_SEARCH') return;
  activeRequestId += 1;
  const requestId = activeRequestId;
  const provider = message.provider || 'google';
  chrome.storage.local.set({ satoriDiagnostics: [{ time: new Date().toLocaleTimeString(), step: 'request', detail: `provider=${provider}` }] });
  if (provider !== 'google') {
    setStatus(`${provider === 'gemini' ? 'Gemini' : 'ChatGPT'} adapter is not enabled yet. Select Google AI Mode for this version.`, 'error');
    addDiagnostic('provider', 'adapter not enabled');
    sendResponse({ ok: false });
    return;
  }
  const query = provider === 'google' ? (message.googleQuery || message.prompt || '') : (message.prompt || '');
  addDiagnostic('prompt', `Google raw-page query length=${query.length}`);
  if (provider === 'google') startGoogleSearch(query, requestId, message.mode || 'text');
  sendResponse({ ok: true });
});
