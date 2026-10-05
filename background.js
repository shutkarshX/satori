// -------------------------------------------------------------
// Satori - Background Service Worker (Unified Request Lifecycle)
// -------------------------------------------------------------

let activeRequestId = 0;
let activeRequestMeta = null;
let activeChatGPTRequest = null;
let activeGeminiRequest = null;

const PROVIDER_NAMES = {
  google: 'Google AI Mode',
  gemini: 'Gemini',
  chatgpt: 'ChatGPT'
};

const setStatus = (text, kind = 'waiting', extra = {}) => {
  return chrome.storage.local.set({
    satoriStatus: {
      text,
      kind,
      at: Date.now(),
      ...(kind === 'waiting' && activeRequestMeta ? activeRequestMeta : {}),
      ...extra
    }
  });
};

const addDiagnostic = (step, detail) => chrome.storage.local.get('satoriDiagnostics', (result) => {
  const entries = Array.isArray(result.satoriDiagnostics) ? result.satoriDiagnostics : [];
  entries.push({ time: new Date().toLocaleTimeString(), step, detail });
  chrome.storage.local.set({ satoriDiagnostics: entries.slice(-30) });
});

// -------------------------------------------------------------
// Unified Prompt Construction (No Question Synthesis Layer)
// -------------------------------------------------------------
function buildDirectPrompt(provider, mode, pageContent) {
  if (mode === 'mcq') {
    return `Solve the practice multiple-choice question contained in this page text.
Identify the actual question and its options yourself from the text. Ignore navigation, buttons, timers, and unrelated page elements.
Output ONLY the correct option in this exact format:
ANSWER: <Option Letter> - <Exact Option Text>

Example format:
ANSWER: B - Inserting a new element into the queue

PAGE CONTENT:
${pageContent}`;
  }

  return `Solve the practice coding problem contained in this page text.
Identify the actual problem, required programming language, input/output format, constraints, and examples yourself. Ignore navigation, buttons, timers, and unrelated page elements.
Return exactly one complete, submission-ready, compilable source file in ONE code block and nothing else outside the code block. Include all required imports/headers, helpers, and the complete entry point.

PAGE CONTENT:
${pageContent}`;
}

// -------------------------------------------------------------
// Normalized Provider Result Builder & Validator
// -------------------------------------------------------------
function formatMcqAnswer(text, questionText = '') {
  if (!text) return { letter: null, text: '', raw: '' };
  let clean = text.normalize('NFKD').replace(/[\u2217\u22c5\u00d7·×⋅]/g, '*').trim();

  // If question options are known, test against them directly (longest first)
  if (questionText) {
    const stopWords = /^(Question|Marks|Negative|Answer here|Clear|Prev|Next|Submit|Section|Time|View|Multi Choice|Single File|degree|batch|roll number|name|email|test name)/i;
    const knownOptions = questionText
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => Boolean(l) && !stopWords.test(l) && l.length < 150 && !l.includes('?') && !l.endsWith(':') && l.length >= 1);

    const norm = (s) => s.normalize('NFKD').replace(/[\u2217\u22c5\u00d7·×⋅]/g, '*').replace(/\s+/g, '').toLowerCase();
    const normClean = norm(clean);
    const sorted = [...knownOptions].sort((a, b) => b.length - a.length);

    for (const opt of sorted) {
      const normOpt = norm(opt);
      if (normOpt.length >= 2 && normClean.includes(normOpt)) {
        return { letter: null, text: opt, raw: clean };
      }
    }
  }

  // 1. Explicit answer marker: "ANSWER: B - Text" or "ANSWER: C"
  const explicitMatch = clean.match(/(?:\*{0,2}(?:FINAL\s+ANSWER|CORRECT\s+ANSWER|THE\s+CORRECT\s+ANSWER\s+IS|CORRECT\s+OPTION|ANSWER)\*{0,2})\s*[:\-]?\s*([^\n\r]+)/i);
  if (explicitMatch && explicitMatch[1]) {
    const candidate = explicitMatch[1].replace(/^\*+|\*+$/g, '').trim();
    const parsed = candidate.match(/^(?:Option\s+)?(?:\(?([A-Da-d])\)?[\).\:\-\s]*)\s*(.*)$/);
    if (parsed) {
      return {
        letter: parsed[1].toUpperCase(),
        text: (parsed[2] || '').trim(),
        raw: clean
      };
    }
    return { letter: null, text: candidate, raw: clean };
  }

  // 2. Direct Big-O formula
  const bigOMatch = clean.replace(/\r?\n/g, ' ').match(/O\s*\(\s*([A-Za-z0-9_*\s\+\-\^!]+)\s*\)/i);
  if (bigOMatch) {
    const inner = bigOMatch[1].replace(/[\s·×⋅*]+/g, '*').trim();
    return { letter: null, text: `O(${inner})`, raw: clean };
  }

  // 3. Option letter on standalone line
  const lines = clean.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  for (const line of lines) {
    if (/^(#|option evaluation|evaluation|analysis|explanation|question|note)/i.test(line)) continue;
    const optionMatch = line.match(/^(?:Option\s+)?(?:\*{0,2}\(?([A-Da-d])\)?\*{0,2})[\).\:\-\s]\s*(.*)$/);
    if (optionMatch) {
      return {
        letter: optionMatch[1].toUpperCase(),
        text: (optionMatch[2] || '').replace(/^\*+|\*+$/g, '').trim(),
        raw: clean
      };
    }
  }

  // 4. Declarative sentence ending
  const sentencePattern = /(?:is|equals?|answer is|result is|length is|time complexity is|complexity is)\s*[:\-]?\s*([A-Da-d]\b|[0-9]+(?:\.[0-9]+)?|O\([^\)]+\)|[^\n\.,]+)[.\s]*$/im;
  const sentenceMatch = clean.match(sentencePattern);
  if (sentenceMatch && sentenceMatch[1] && sentenceMatch[1].trim().length < 40) {
    const res = sentenceMatch[1].replace(/[.\s]+$/, '').trim();
    if (/^[A-Da-d]$/.test(res)) return { letter: res.toUpperCase(), text: '', raw: clean };
    if (res.length > 1) return { letter: null, text: res, raw: clean };
  }

  // Fallback line
  const filtered = lines.filter((l) => l.length >= 2 && !/^(#|ai overview|evaluation|analysis|explanation)/i.test(l));
  const fallback = filtered[0] || clean.slice(0, 80);
  return { letter: null, text: fallback, raw: clean };
}

function validateProviderResult(provider, requestId, mode, payload, questionText = '') {
  if (mode === 'mcq') {
    const raw = typeof payload === 'string' ? payload : (payload.text || payload.code || '');
    const cleanRaw = (raw || '').trim();

    // Check if AI explicitly stated no question/MCQ exists or returned N/A
    const notApplicable = /ANSWER:\s*(?:N\/A|NONE|NOT\s+APPLICABLE|NO\s+(?:PRACTICE\s+)?(?:QUESTION|MCQ))/i.test(cleanRaw) ||
      /no\s+(?:practice\s+)?(?:multiple[\s-]choice\s+question|mcq|question)\s+(?:found|present|contained)/i.test(cleanRaw);

    if (notApplicable) {
      return {
        provider,
        requestId,
        type: 'mcq',
        valid: false,
        notAQuestion: true,
        reason: 'AI found no MCQ on this page (ensure you are on an actual question page)',
        raw
      };
    }

    const mcq = formatMcqAnswer(cleanRaw, questionText);
    const valid = Boolean(mcq.letter || (mcq.text && mcq.text.length < 150));
    return {
      provider,
      requestId,
      type: 'mcq',
      valid,
      answer: mcq,
      raw
    };
  }

  // Coding validation
  const code = typeof payload === 'string' ? payload : (payload.code || payload.text || '');
  const looksLikeCode = /(#include|public\s+class\s+Main|\bint\s+main\s*\(|\bdef\s+main\s*\(|\bimport\s+java|\bfunction\b|class\s+\w+)/i.test(code);
  return {
    provider,
    requestId,
    type: 'coding',
    valid: looksLikeCode && code.trim().length > 30,
    code: code.trim(),
    raw: typeof payload === 'object' ? payload.text : code
  };
}

// -------------------------------------------------------------
// Single Execution & Autofill Pipeline
// -------------------------------------------------------------
async function autoFillAssignment(tabId, result) {
  if (!tabId || !result || !result.valid) return { ok: false, error: 'Invalid AI answer' };

  try {
    const msgType = result.type === 'mcq' ? 'SELECT_MCQ_OPTION' : 'TYPE_INTO_EDITOR';
    const payload = result.type === 'mcq'
      ? { type: msgType, answer: result.answer }
      : { type: msgType, text: result.code, append: false };

    let res;
    try {
      res = await chrome.tabs.sendMessage(tabId, payload);
    } catch (_error) {
      await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
      res = await chrome.tabs.sendMessage(tabId, payload);
    }

    if (res?.ok) {
      const detail = result.type === 'mcq'
        ? `Option '${res.selected?.matched || 'choice'}' marked on portal`
        : 'Code placed into assignment editor';
      addDiagnostic(`${result.provider}-autofill`, detail);
      setStatus(`${PROVIDER_NAMES[result.provider] || result.provider} answer applied. Review before submitting.`, 'ready');
      return { ok: true };
    }

    const err = res?.error || (result.type === 'mcq' ? 'Could not match option on portal' : 'Assignment editor not found');
    addDiagnostic(`${result.provider}-autofill`, err);
    setStatus(err, 'error');
    return { ok: false, error: err };
  } catch (error) {
    addDiagnostic(`${result.provider}-autofill`, error.message);
    setStatus(`Autofill failed: ${error.message}`, 'error');
    return { ok: false, error: error.message };
  }
}

async function handleCompletedResult(provider, requestId, rawPayload) {
  const current = await chrome.storage.local.get('satoriActiveRequest');
  const active = current.satoriActiveRequest;
  if (!active || active.requestId !== requestId) {
    addDiagnostic('lifecycle', `Ignored stale/cancelled response from ${provider} (request ${requestId})`);
    return;
  }

  await chrome.alarms.clear(`satori-timeout-${requestId}`);
  activeRequestMeta = null;
  await chrome.storage.local.remove('satoriActiveRequest');

  const validated = validateProviderResult(provider, requestId, active.mode, rawPayload, active.questionText);

  if (!validated.valid) {
    const reason = validated.reason || (active.mode === 'mcq'
      ? 'No reliable MCQ option found in response.'
      : 'Response did not contain a complete compilable code block.');
    setStatus(reason, 'error');
    addDiagnostic('validation-failed', reason);
    return;
  }

  // Store in cache for popup display
  const storageUpdate = {
    latestProvider: provider,
    [`latest${provider.charAt(0).toUpperCase() + provider.slice(1)}Response`]: active.mode === 'mcq' ? (validated.answer.text || validated.answer.letter) : validated.code,
    [`latest${provider.charAt(0).toUpperCase() + provider.slice(1)}RawResponse`]: validated.raw
  };
  await chrome.storage.local.set(storageUpdate);

  await autoFillAssignment(active.assignmentTabId, validated);
}

// -------------------------------------------------------------
// Request Lifecycle & Cancellation Management
// -------------------------------------------------------------
async function cancelActiveRequest(reason = 'Request cancelled by user.') {
  const current = await chrome.storage.local.get('satoriActiveRequest');
  if (current.satoriActiveRequest?.requestId) {
    await chrome.alarms.clear(`satori-timeout-${current.satoriActiveRequest.requestId}`);
  }
  activeRequestId += 1;
  activeRequestMeta = null;
  activeChatGPTRequest = null;
  activeGeminiRequest = null;
  await chrome.storage.local.remove(['satoriActiveRequest', 'activeChatGPTRequest', 'activeGeminiRequest']);
  setStatus(reason, 'cancelled');
  addDiagnostic('cancel', reason);
}

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (!alarm.name.startsWith('satori-timeout-')) return;
  const current = await chrome.storage.local.get('satoriActiveRequest');
  if (!current.satoriActiveRequest) return;
  const requestId = Number(alarm.name.replace('satori-timeout-', ''));
  if (current.satoriActiveRequest.requestId === requestId) {
    await cancelActiveRequest('Satori request timed out after 2 minutes.');
  }
});

chrome.tabs.onRemoved.addListener(async (tabId) => {
  const current = await chrome.storage.local.get('satoriActiveRequest');
  if (current.satoriActiveRequest?.providerTabId === tabId) {
    await cancelActiveRequest('AI provider tab was closed; request cancelled.');
  }
});

// -------------------------------------------------------------
// Provider Tab Management (Reused, Never Steals Window Focus)
// -------------------------------------------------------------
async function getReusableTab(domainMatch, storageKeyTab, storageKeyWin, windowId) {
  const stored = await chrome.storage.local.get([storageKeyTab, storageKeyWin]);
  if (stored[storageKeyTab] && stored[storageKeyWin] === windowId) {
    try {
      const tab = await chrome.tabs.get(stored[storageKeyTab]);
      if (tab?.windowId === windowId && domainMatch.test(tab.url || '')) return tab;
    } catch (_e) {}
  }

  const tabs = await chrome.tabs.query({ windowId });
  const inactive = tabs.find((t) => !t.active && domainMatch.test(t.url || ''));
  if (inactive?.id) {
    await chrome.storage.local.set({ [storageKeyTab]: inactive.id, [storageKeyWin]: windowId });
    return inactive;
  }
  return null;
}

// 1. Google AI Mode
async function startGoogleSearch(query, requestId, mode, assignmentTab, questionText) {
  const url = `https://www.google.com/search?q=${encodeURIComponent(query.slice(0, 30000))}`;
  const windowId = assignmentTab?.windowId;
  let tab = windowId ? await getReusableTab(/^https:\/\/(www\.)?google\./i, 'satoriGoogleTabId', 'satoriGoogleWindowId', windowId) : null;
  const targetTabId = tab?.id || null;

  const initiateWatch = async (tabId) => {
    try {
      await chrome.scripting.executeScript({ target: { tabId }, files: ['google.js'] }).catch(() => {});
      await chrome.tabs.sendMessage(tabId, {
        type: 'START_GOOGLE_WATCH',
        requestId,
        mode
      });
      addDiagnostic('google-watch', `MutationObserver attached to Google Search tab ${tabId}`);
    } catch (err) {
      addDiagnostic('google-error', err.message);
    }
  };

  let handled = false;
  const listener = (updatedTabId, changeInfo) => {
    if (updatedTabId === targetTabId && changeInfo.status === 'complete' && !handled) {
      handled = true;
      chrome.tabs.onUpdated.removeListener(listener);
      initiateWatch(targetTabId);
    }
  };
  chrome.tabs.onUpdated.addListener(listener);

  if (tab?.id) {
    await chrome.tabs.update(tab.id, { url, active: false });
  } else {
    tab = await chrome.tabs.create({ url, active: false, windowId });
    await chrome.storage.local.set({ satoriGoogleTabId: tab.id, satoriGoogleWindowId: tab.windowId });
  }
}

// 2. Gemini
async function startGeminiSearch(prompt, requestId, mode, assignmentTab, questionText) {
  const windowId = assignmentTab?.windowId;
  let tab = windowId ? await getReusableTab(/^https:\/\/gemini\.google\.com\//i, 'satoriGeminiTabId', 'satoriGeminiWindowId', windowId) : null;
  activeGeminiRequest = { requestId, mode, questionText, tabId: null, assignmentTabId: assignmentTab?.id };

  const sendPrompt = (tabId, retries = 15) => {
    chrome.tabs.sendMessage(tabId, { type: 'FILL_AND_SEND_GEMINI', prompt, requestId, mode }, (res) => {
      if (chrome.runtime.lastError || !res?.ok) {
        if (retries > 0) setTimeout(() => sendPrompt(tabId, retries - 1), 1000);
        else setStatus('Gemini composer was not ready. Check the background Gemini tab.', 'error');
      } else {
        addDiagnostic('gemini-submit', 'Prompt dispatched to Gemini MutationObserver');
      }
    });
  };

  const url = 'https://gemini.google.com/app';
  if (tab?.id) {
    activeGeminiRequest.tabId = tab.id;
    await chrome.tabs.update(tab.id, { url, active: false });
    setTimeout(() => sendPrompt(tab.id), 1200);
  } else {
    tab = await chrome.tabs.create({ url, active: false, windowId });
    activeGeminiRequest.tabId = tab.id;
    await chrome.storage.local.set({ satoriGeminiTabId: tab.id, satoriGeminiWindowId: tab.windowId });
    setTimeout(() => sendPrompt(tab.id), 1800);
  }
}

// 3. ChatGPT (Reused Conversation, Background)
async function startChatGPTSearch(prompt, requestId, mode, assignmentTab, questionText) {
  const windowId = assignmentTab?.windowId;
  let tab = windowId ? await getReusableTab(/https:\/\/(chatgpt\.com|chat\.openai\.com)\//i, 'satoriChatGPTTabId', 'satoriChatGPTWindowId', windowId) : null;
  activeChatGPTRequest = { requestId, mode, questionText, tabId: null, assignmentTabId: assignmentTab?.id };

  const startPolling = (tabId) => {
    let pollCount = 0;
    const interval = setInterval(async () => {
      pollCount += 1;
      const current = await chrome.storage.local.get('satoriActiveRequest');
      if (current.satoriActiveRequest?.requestId !== requestId || pollCount > 100) {
        clearInterval(interval);
        return;
      }
      try {
        chrome.tabs.sendMessage(tabId, { type: 'POLL_LATEST_RESPONSE' }, (res) => {
          if (chrome.runtime.lastError || !res?.ok) return;
          if (res.ready && res.result) {
            clearInterval(interval);
            handleCompletedResult('chatgpt', requestId, res.result);
          }
        });
      } catch (_e) {
        clearInterval(interval);
      }
    }, 1000);
  };

  const sendPrompt = (tabId, retries = 15) => {
    chrome.tabs.sendMessage(tabId, { type: 'FILL_AND_SEND_CHATGPT', prompt, requestId, mode }, (res) => {
      if (chrome.runtime.lastError || !res?.ok) {
        if (retries > 0) setTimeout(() => sendPrompt(tabId, retries - 1), 800);
        else setStatus('ChatGPT composer was not ready. Check the background ChatGPT tab.', 'error');
      } else {
        addDiagnostic('chatgpt-submit', 'Prompt dispatched to ChatGPT MutationObserver');
        startPolling(tabId);
      }
    });
  };

  const url = 'https://chatgpt.com/';
  if (tab?.id) {
    activeChatGPTRequest.tabId = tab.id;
    let isAlive = false;
    try {
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['chatgpt.js'] }).catch(() => {});
      const ping = await Promise.race([
        chrome.tabs.sendMessage(tab.id, { type: 'PING_CHATGPT' }),
        new Promise((_, r) => setTimeout(() => r(new Error('timeout')), 500))
      ]);
      if (ping?.ok) isAlive = true;
    } catch (_e) {}

    if (isAlive) {
      setTimeout(() => sendPrompt(tab.id), 50);
    } else {
      await chrome.tabs.update(tab.id, { url, active: false });
      setTimeout(() => sendPrompt(tab.id), 1200);
    }
  } else {
    tab = await chrome.tabs.create({ url, active: false, windowId });
    activeChatGPTRequest.tabId = tab.id;
    await chrome.storage.local.set({ satoriChatGPTTabId: tab.id, satoriChatGPTWindowId: tab.windowId });
    setTimeout(() => sendPrompt(tab.id), 1500);
  }
}

// -------------------------------------------------------------
// Unified Request Dispatcher
// -------------------------------------------------------------
async function dispatchSatoriRequest({ provider, mode, pageContent, questionText, assignmentTabId, windowId }) {
  let assignmentTab = null;
  if (assignmentTabId) {
    try { assignmentTab = await chrome.tabs.get(assignmentTabId); } catch (_e) {}
  }
  if (!assignmentTab?.id) {
    const active = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    assignmentTab = active[0];
  }
  if (!assignmentTab?.id) throw new Error('No active assignment tab found.');

  activeRequestId += 1;
  const requestId = activeRequestId;
  activeRequestMeta = {
    requestId,
    provider,
    mode,
    startedAt: Date.now(),
    estimateSec: provider === 'google' ? 10 : provider === 'gemini' ? 8 : 12
  };

  await chrome.storage.local.set({
    satoriActiveRequest: {
      requestId,
      provider,
      mode,
      assignmentTabId: assignmentTab.id,
      questionText,
      startedAt: Date.now()
    }
  });

  await chrome.alarms.create(`satori-timeout-${requestId}`, { delayInMinutes: 2 });
  setStatus(`${PROVIDER_NAMES[provider] || provider} is processing ${mode === 'mcq' ? 'MCQ' : 'code'}…`, 'waiting');
  addDiagnostic('request', `Started ${provider} ${mode} (request ${requestId})`);

  const prompt = buildDirectPrompt(provider, mode, pageContent);

  if (provider === 'google') {
    startGoogleSearch(pageContent, requestId, mode, assignmentTab, questionText);
  } else if (provider === 'gemini') {
    startGeminiSearch(prompt, requestId, mode, assignmentTab, questionText);
  } else {
    startChatGPTSearch(prompt, requestId, mode, assignmentTab, questionText);
  }
}

// -------------------------------------------------------------
// Keyboard Shortcut Commands (Alt+Shift+M, Alt+Shift+C, Alt+Shift+X)
// -------------------------------------------------------------
chrome.commands.onCommand.addListener(async (command) => {
  if (command === 'satori-cancel') {
    await cancelActiveRequest();
    return;
  }

  const mode = command === 'satori-mcq' ? 'mcq' : command === 'satori-code' ? 'coding' : null;
  if (!mode) return;

  const tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  const assignmentTab = tabs.find((t) => t.id && !/google\.|gemini\.|chatgpt\./i.test(t.url || '')) || tabs[0];
  if (!assignmentTab?.id) return;

  let page;
  try {
    page = await chrome.tabs.sendMessage(assignmentTab.id, { type: 'EXTRACT_QUESTION' });
  } catch (_e) {
    await chrome.scripting.executeScript({ target: { tabId: assignmentTab.id }, files: ['content.js'] });
    page = await chrome.tabs.sendMessage(assignmentTab.id, { type: 'EXTRACT_QUESTION' });
  }

  if (!page?.ok || !page.fullText || page.fullText.trim().length < 10) {
    setStatus('Could not read enough page text to solve question.', 'error');
    return;
  }

  const stored = await chrome.storage.local.get(['satoriProvider']);
  const provider = stored.satoriProvider || 'chatgpt';

  await dispatchSatoriRequest({
    provider,
    mode,
    pageContent: page.fullText,
    questionText: page.text || page.fullText,
    assignmentTabId: assignmentTab.id,
    windowId: assignmentTab.windowId
  });
});

// -------------------------------------------------------------
// Message Gateway (Provider Responses & Popup Triggers)
// -------------------------------------------------------------
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === 'CANCEL_REQUEST') {
    cancelActiveRequest();
    sendResponse({ ok: true });
    return true;
  }

  if (message.type === 'GOOGLE_RESPONSE') {
    handleCompletedResult('google', message.requestId || message.detail?.requestId, message.detail);
    return true;
  }
  if (message.type === 'GEMINI_RESPONSE') {
    handleCompletedResult('gemini', message.requestId || message.detail?.requestId, message.detail);
    return true;
  }
  if (message.type === 'CHATGPT_RESPONSE') {
    handleCompletedResult('chatgpt', message.requestId || message.detail?.requestId, message.detail);
    return true;
  }

  if (message.type === 'GEMINI_DIAGNOSTIC' || message.type === 'CHATGPT_DIAGNOSTIC') {
    addDiagnostic(message.type.toLowerCase(), message.detail);
    return true;
  }

  if (message.type === 'OPEN_PROVIDER_REQUEST') {
    dispatchSatoriRequest({
      provider: message.provider,
      mode: message.mode,
      pageContent: message.pageContent,
      questionText: message.questionText,
      assignmentTabId: message.assignmentTabId,
      windowId: message.windowId
    }).then(() => sendResponse({ ok: true }))
      .catch((err) => sendResponse({ ok: false, error: err.message }));
    return true;
  }

  return false;
});
