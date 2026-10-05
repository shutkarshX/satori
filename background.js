let statusMeta = {};
const setStatus = (text, kind = 'waiting', extra = {}) => {
  if (kind === 'waiting') statusMeta = { ...statusMeta, ...extra };
  else statusMeta = {};
  return chrome.storage.local.set({
    satoriStatus: { text, kind, at: Date.now(), ...(kind === 'waiting' ? statusMeta : {}), ...extra }
  });
};

const PROVIDER_NAMES = { google: 'Google AI Mode', gemini: 'Gemini', chatgpt: 'ChatGPT' };

function buildShortcutPrompt(_provider, mode, pageText) {
  if (mode === 'mcq') {
    return `Solve the practice multiple-choice question contained in this page text.
Identify the actual question and its options yourself. Ignore navigation, buttons, timers, and unrelated page content.
Return ONLY the correct option in this exact format:
ANSWER: <Option Letter> - <Exact Option Text>

PAGE:
${pageText}`;
  }
  return `Solve the practice coding problem contained in this page text.
Identify the actual problem, required language, input/output format, constraints, and examples yourself. Ignore navigation, buttons, timers, and unrelated page content.
Return exactly one complete submission-ready source file in one code block and nothing else. Include all required imports/headers, helpers, and the complete entry point. Use the exact language requested by the assignment.

PAGE:
${pageText}`;
}

async function runShortcut(mode) {
  const tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  const assignmentTab = tabs.find((tab) => tab.id && !/^https:\/\/(www\\.)?google\\./i.test(tab.url || '') && !/^https:\/\/gemini\\.google\\.com\\//i.test(tab.url || '') && !/^https:\/\/(chatgpt\\.com|chat\\.openai\\.com)\\//i.test(tab.url || '')) || tabs[0];
  if (!assignmentTab?.id) throw new Error('No active assignment tab found.');

  const stored = await chrome.storage.local.get('satoriProvider');
  const provider = stored.satoriProvider || 'chatgpt';
  if (/^chrome:\/\//i.test(assignmentTab.url || '')) throw new Error('Chrome internal pages cannot be used with Satori.');

  let page;
  try {
    page = await chrome.tabs.sendMessage(assignmentTab.id, { type: 'EXTRACT_QUESTION' });
  } catch (_error) {
    await chrome.scripting.executeScript({ target: { tabId: assignmentTab.id }, files: ['content.js'] });
    page = await chrome.tabs.sendMessage(assignmentTab.id, { type: 'EXTRACT_QUESTION' });
  }
  if (!page?.ok || !page.fullText || page.fullText.trim().length < 10) throw new Error('Could not read enough page text.');

  const pageText = page.fullText;
  const requestId = ++activeRequestId;
  const prompt = buildShortcutPrompt(provider, mode, pageText);
  const questionText = page.text || pageText;

  await chrome.storage.local.set({ satoriMode: mode, satoriProvider: provider });
  await chrome.storage.local.remove([
    'latestGoogleResponse', 'latestGoogleRawResponse',
    'latestGeminiResponse', 'latestGeminiRawResponse',
    'latestChatGPTResponse', 'latestChatGPTRawResponse'
  ]);
  await chrome.storage.local.set({
    satoriActiveRequest: { requestId, provider, mode, assignmentTabId: assignmentTab.id, questionText, providerTabId: null, startedAt: Date.now() }
  });
  statusMeta = { requestId, provider, mode, startedAt: Date.now(), estimateSec: provider === 'google' ? 10 : provider === 'gemini' ? 8 : 12 };
  await chrome.alarms.create(`satori-timeout-${requestId}`, { delayInMinutes: 2 });
  setStatus(`${PROVIDER_NAMES[provider]} is processing ${mode === 'mcq' ? 'MCQ' : 'code'}…`, 'waiting');
  addDiagnostic('shortcut', `${mode} shortcut → ${provider} request ${requestId}`);

  if (provider === 'google') startGoogleSearch(pageText, requestId, mode, assignmentTab, questionText);
  else if (provider === 'gemini') startGeminiSearch(prompt, requestId, mode, assignmentTab, questionText);
  else startChatGPTSearch(prompt, requestId, mode, assignmentTab, questionText);
}

async function cancelActiveRequest(reason = 'Request cancelled by user.') {
  const current = await chrome.storage.local.get('satoriActiveRequest');
  if (current.satoriActiveRequest?.requestId) await chrome.alarms.clear(`satori-timeout-${current.satoriActiveRequest.requestId}`);
  activeRequestId += 1;
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
  if (current.satoriActiveRequest.requestId !== requestId) return;
  await cancelActiveRequest('Satori request timed out after 2 minutes.');
});


chrome.tabs.onRemoved.addListener(async (tabId) => {
  const current = await chrome.storage.local.get(['activeChatGPTRequest', 'activeGeminiRequest', 'satoriActiveRequest']);
  const requests = [current.activeChatGPTRequest, current.activeGeminiRequest, current.satoriActiveRequest].filter(Boolean);
  if (requests.some((request) => request.tabId === tabId || request.providerTabId === tabId)) {
    await cancelActiveRequest('Provider tab was closed; request cancelled.');
  }
});

chrome.commands.onCommand.addListener(async (command) => {
  if (command === 'satori-cancel') {
    try { await cancelActiveRequest(); } catch (error) { setStatus(error.message, 'error'); }
    return;
  }
  const mode = command === 'satori-mcq' ? 'mcq' : command === 'satori-code' ? 'coding' : null;
  if (!mode) return;
  try {
    await runShortcut(mode);
  } catch (error) {
    setStatus(error.message, 'error');
    addDiagnostic('shortcut-error', error.message);
  }
});
let activeRequestId = 0;
const addDiagnostic = (step, detail) => chrome.storage.local.get('satoriDiagnostics', (result) => {
  const entries = Array.isArray(result.satoriDiagnostics) ? result.satoriDiagnostics : [];
  entries.push({ time: new Date().toLocaleTimeString(), step, detail });
  chrome.storage.local.set({ satoriDiagnostics: entries.slice(-30) });
});

function formatMcqAnswer(text, questionText = '') {
  if (!text) return '';
  // Normalize unicode math symbols (e.g. 𝑂 -> O, ∗ -> *, · -> *, × -> *, etc.)
  let clean = text.normalize('NFKD').replace(/[\u2217\u22c5\u00d7·×⋅]/g, '*').trim();

  // If questionText is provided, extract options from it and check if any is matched
  if (questionText) {
    const stopWords = /^(Question|Marks|Negative|Answer here|Clear|Prev|Next|Submit|Section|Time|View|Multi Choice|Single File|degree|batch|roll number|name|email|test name)/i;
    const knownOptions = questionText
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => Boolean(l) && !stopWords.test(l) && l.length < 150 && !l.includes('?') && !l.endsWith(':') && l.length >= 1);

    const norm = (s) => s.normalize('NFKD').replace(/[\u2217\u22c5\u00d7·×⋅]/g, '*').replace(/\s+/g, '').toLowerCase();
    const normClean = norm(clean);

    // Look for exact options inside the AI explanation (longest first to prefer O(sum*n) over O(n) or O(sum))
    const sorted = [...knownOptions].sort((a, b) => b.length - a.length);
    for (const opt of sorted) {
      const normOpt = norm(opt);
      if (normOpt.length >= 2 && normClean.includes(normOpt)) {
        return opt;
      }
    }
  }

  // 1. Look for explicit answer indicators: "**ANSWER:** A - text", "ANSWER: B", "Correct Option: C", etc.
  const explicitMatch = clean.match(/(?:\*{0,2}(?:FINAL\s+ANSWER|CORRECT\s+ANSWER|THE\s+CORRECT\s+ANSWER\s+IS|CORRECT\s+OPTION|ANSWER)\*{0,2})\s*[:\-]?\s*([^\n\r]+)/i);
  if (explicitMatch && explicitMatch[1]) {
    const candidate = explicitMatch[1].replace(/^\*+|\*+$/g, '').trim();
    if (candidate && !/^(evaluation|analysis|explanation)/i.test(candidate)) {
      return candidate.replace(/^[\:\-\s]+/, '').replace(/\s+/g, ' ');
    }
  }

  // Check for Big-O notation directly (e.g. O(sum*n), O(N!), O(n2))
  const cleanFlat = clean.replace(/\r?\n/g, ' ');
  const bigOMatch = cleanFlat.match(/O\s*\(\s*([A-Za-z0-9_*\s\+\-\^!]+)\s*\)/i);
  if (bigOMatch) {
    const inner = bigOMatch[1].replace(/[\s·×⋅*]+/g, '*').trim();
    return `O(${inner})`;
  }

  // Pre-process lines: merge consecutive fragmented mathematical tokens (e.g. Google Search rendering 'O' '(' 'sum' '*' 'n' ')' on separate lines)
  const rawLines = clean.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const lines = [];
  for (let i = 0; i < rawLines.length; i++) {
    const line = rawLines[i];
    if (line.length <= 4 && /^[A-Za-z0-9_()*\+\-\/\^!]+$/.test(line)) {
      let formula = line;
      while (i + 1 < rawLines.length && rawLines[i + 1].length <= 6 && /^[A-Za-z0-9_()*\+\-\/\^!]+$/.test(rawLines[i + 1])) {
        i++;
        formula += rawLines[i];
      }
      lines.push(formula);
    } else {
      lines.push(line);
    }
  }

  // 2. Look for lines starting with an option letter, ignoring markdown headings
  for (const line of lines) {
    if (/^(#|option evaluation|evaluation|analysis|explanation|question|note)/i.test(line)) continue;
    const optionMatch = line.match(/^(?:Option\s+)?(?:\*{0,2}\(?([A-Da-d])\)?\*{0,2})[\).\:\-\s]\s*(.*)$/);
    if (optionMatch) {
      const letter = optionMatch[1].toUpperCase();
      const rest = (optionMatch[2] || '').replace(/^\*+|\*+$/g, '').trim();
      return rest ? `${letter} - ${rest}`.replace(/\s+/g, ' ') : letter;
    }
  }

  // 3. Look for standalone option patterns in whole text
  const standaloneMatch = clean.match(/\b([A-Da-d])\s*[\:\-\)]\s*([^\n\r\.]+)/);
  if (standaloneMatch && !/^(evaluation|analysis|explanation)/i.test(standaloneMatch[2])) {
    return `${standaloneMatch[1].toUpperCase()} - ${standaloneMatch[2].trim()}`.replace(/\s+/g, ' ');
  }

  // 4. Look for declarative sentence endings like "is 2.", "is B.", "equal to 2.", "answer is 2.", "complexity is O(sum*n)"
  const sentencePattern = /(?:is|equals?|answer is|result is|length is|time complexity is|complexity is)\s*[:\-]?\s*([A-Da-d]\b|[0-9]+(?:\.[0-9]+)?|O\([^\)]+\)|[^\n\.,]+)[.\s]*$/im;
  const sentenceMatch = clean.match(sentencePattern);
  if (sentenceMatch && sentenceMatch[1] && sentenceMatch[1].trim().length < 40) {
    const res = sentenceMatch[1].replace(/[.\s]+$/, '').trim();
    if (res.length > 1 || /^[A-Da-d0-9]$/.test(res)) return res;
  }

  // 5. Look for standalone Big-O complexity in merged lines
  const bigOMerged = lines.find((l) => /^O\([^\)]+\)$/i.test(l));
  if (bigOMerged) return bigOMerged;

  // 6. Fallback: filter out heading lines, colon endings, and single non-option characters
  const filteredLines = lines.filter((l) =>
    l.length >= 2 &&
    !/^(#|ai overview|option evaluation|evaluation|analysis|explanation|question|here is|the correct|is\s*:|note)/i.test(l) &&
    !/^(ai overview|is\s*[:\.]?)$/i.test(l)
  );
  let fallback = filteredLines[0] || clean.split(/\.\s+|\n/).find((s) => s.trim().length > 3 && !/^(ai overview|is\s*[:\.]?)$/i.test(s.trim())) || clean;
  if (/^O$/i.test(fallback.trim())) {
    const m = clean.match(/O\s*\([^)]+\)/i);
    if (m) fallback = m[0];
  }
  return fallback.length < 80 ? fallback.trim() : fallback.trim().slice(0, 80);
}

function looksLikeCode(text) {
  const value = String(text || '').trim();
  if (value.length < 20) return false;
  const signals = [
    /#include\s*[<"]/i, /\bpublic\s+(?:static\s+)?class\b/i, /\b(?:int|long|void|bool|double|float|string)\s+main\s*\(/i,
    /\bdef\s+\w+\s*\(/i, /\bfunction\s+\w+\s*\(/i, /=>/, /[{};][\s\\S]*[{};]/,
    /\bimport\s+(?:java|javafx|sys|os|math|collections)\b/i
  ];
  return signals.filter((pattern) => pattern.test(value)).length >= 1;
}

function buildProviderResult(provider, requestId, mode, selected, raw) {
  const text = String(selected || '').trim();
  if (mode === 'mcq') {
    const formatted = formatMcqAnswer(text);
    const letter = formatted.match(/^(?:Option\s+)?([A-D])(?:\s*[-:.)]|$)/i)?.[1]?.toUpperCase() || null;
    const answerText = formatted.replace(/^(?:Option\s+)?[A-D](?:\s*[-:.)]|\s+)/i, '').trim();
    return {
      provider, requestId, type: 'mcq',
      answer: { letter, text: answerText || formatted, raw: text },
      raw: String(raw || text),
      createdAt: Date.now()
    };
  }
  const fenced = text.match(/```([A-Za-z0-9_+#.-]+)?\s*\n([\s\S]*?)```/);
  const code = (fenced ? fenced[2] : text).trim();
  const language = fenced?.[1] || null;
  return {
    provider, requestId, type: 'coding',
    language,
    code,
    raw: String(raw || text),
    createdAt: Date.now()
  };
}

async function autoFillAssignment(tabId, providerResult) {
  if (!tabId || !providerResult) return { ok: false, error: 'No assignment target or provider result.' };
  const mode = providerResult.type;
  if (mode === 'coding' && (!providerResult.code || providerResult.code === 'Code not available')) {
    return { ok: false, error: 'No usable code was returned.' };
  }
  if (mode === 'coding' && !looksLikeCode(providerResult.code)) {
    return { ok: false, error: 'Provider returned text that does not look like source code.' };
  }
  try {
    const payload = mode === 'mcq'
      ? { type: 'SELECT_MCQ_OPTION', answer: providerResult.answer }
      : { type: 'TYPE_INTO_EDITOR', text: providerResult.code, append: false };
    let result;
    try { result = await chrome.tabs.sendMessage(tabId, payload); }
    catch (_error) {
      await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
      result = await chrome.tabs.sendMessage(tabId, payload);
    }
    if (result?.ok) {
      const detail = mode === 'mcq'
        ? `MCQ option '${result.selected?.matched || 'choice'}' marked on portal`
        : 'answer placed into the assignment editor';
      addDiagnostic(`${providerResult.provider}-autofill`, detail);
      setStatus(`${providerResult.provider} answer ${mode === 'mcq' ? 'selected' : 'placed in editor'}. Review before submitting.`, 'ready');
      return result;
    }
    const detail = result?.error || (mode === 'mcq' ? 'could not locate MCQ option' : 'assignment editor was not found');
    addDiagnostic(`${providerResult.provider}-autofill`, detail);
    setStatus(`${providerResult.provider} answer could not be applied: ${detail}`, 'error');
    return { ok: false, error: detail };
  } catch (error) {
    addDiagnostic(`${providerResult.provider}-autofill`, `could not place answer (${error.message})`);
    setStatus(`${providerResult.provider} answer could not be applied.`, 'error');
    return { ok: false, error: error.message };
  }
}

async function readGoogleAIOverview(tabId, mode = 'mcq') {
  try {
    let result;
    try {
      result = await chrome.tabs.sendMessage(tabId, { type: 'READ_GOOGLE_AI_OVERVIEW', mode });
    } catch (_error) {
      await chrome.scripting.executeScript({ target: { tabId }, files: ['google.js'] });
      result = await chrome.tabs.sendMessage(tabId, { type: 'READ_GOOGLE_AI_OVERVIEW', mode });
    }
    return result?.ok ? result : { text: '', code: '', loading: false };
  } catch (_error) {
    return { text: '', code: '', loading: false };
  }
}

async function handleGoogleResponse(message) {
  if (message.requestId !== activeRequestId) {
    addDiagnostic('google-stale', `ignored response for request ${message.requestId}`);
    return;
  }

  const current = await chrome.storage.local.get('satoriActiveRequest');
  if (!current.satoriActiveRequest || current.satoriActiveRequest.requestId !== message.requestId) {
    addDiagnostic('google-validation', 'ignored Google response without matching active request');
    return;
  }

  const mode = current.satoriActiveRequest.mode || message.mode || 'mcq';
  const raw = String(message.detail?.text || '').trim();
  const selected = mode === 'coding'
    ? String(message.detail?.code || '').trim()
    : raw;

  if (!selected) {
    setStatus(mode === 'coding' ? 'Google AI returned no usable code.' : 'Google AI returned an empty response.', 'error');
    addDiagnostic('google-parser', 'empty provider response');
    return;
  }

  const finalSelected = mode === 'mcq'
    ? formatMcqAnswer(selected, current.satoriActiveRequest.questionText || '')
    : selected;
  const providerResult = buildProviderResult('google', message.requestId, mode, finalSelected, raw);

  if (mode === 'coding' && !looksLikeCode(providerResult.code)) {
    setStatus('Google AI returned text that does not look like source code.', 'error');
    addDiagnostic('google-validation', 'coding result rejected before autofill');
    return;
  }

  await chrome.storage.local.set({
    latestGoogleResponse: finalSelected,
    latestGoogleRawResponse: raw,
    latestGoogleAt: Date.now(),
    latestProvider: 'google',
    latestProviderResult: providerResult
  });

  await chrome.alarms.clear(`satori-timeout-${message.requestId}`);
  await chrome.storage.local.remove('satoriActiveRequest');

  const applied = await autoFillAssignment(current.satoriActiveRequest.assignmentTabId, providerResult);
  if (!applied?.ok) return;

  const warning = mode === 'coding' &&
    !/(#include|public\\s+class\\s+Main|\\bint\\s+main\\s*\\(|\\bdef\\s+main\\s*\\()/i.test(selected);

  setStatus(`Google AI Overview captured.${warning ? ' It may be incomplete.' : ''}`, warning ? 'error' : 'ready');
  addDiagnostic('google-complete', `${selected.length} chars captured${mode === 'coding' ? ' as code' : ''}`);
}

async function startGoogleWatch(tabId, requestId, mode, baseline) {
  try {
    let result;
    try {
      result = await chrome.tabs.sendMessage(tabId, {
        type: 'START_GOOGLE_WATCH',
        requestId,
        mode,
        baselineText: baseline?.text || '',
        baselineCode: baseline?.code || ''
      });
    } catch (_error) {
      await chrome.scripting.executeScript({ target: { tabId }, files: ['google.js'] });
      result = await chrome.tabs.sendMessage(tabId, {
        type: 'START_GOOGLE_WATCH',
        requestId,
        mode,
        baselineText: baseline?.text || '',
        baselineCode: baseline?.code || ''
      });
    }
    if (!result?.ok) throw new Error(result?.error || 'Google adapter did not start its response watcher.');
    addDiagnostic('google-watch', 'Google AI Overview mutation watcher started');
  } catch (error) {
    if (requestId === activeRequestId) {
      await chrome.alarms.clear(`satori-timeout-${requestId}`);
      await chrome.storage.local.remove('satoriActiveRequest');
      setStatus('Google AI Overview watcher could not start.', 'error');
      addDiagnostic('google-error', error.message);
    }
  }
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

async function startGoogleSearch(query, requestId, mode, assignmentTab, questionText = '') {
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
    readGoogleAIOverview(targetTabId, mode).then((baseline) => {
      if (requestId !== activeRequestId) return;
      startGoogleWatch(targetTabId, requestId, mode, baseline);
    }).catch((error) => {
      addDiagnostic('google-error', `initial overview read failed: ${error.message}`);
    });
  };
  const listener = (updatedTabId, changeInfo) => {
    if (updatedTabId === targetTabId && changeInfo.status === 'complete') handleLoaded();
  };
  chrome.tabs.onUpdated.addListener(listener);
  try {
    if (tab?.id) {
      await chrome.storage.local.set({ satoriActiveRequest: { requestId, provider: 'google', mode, assignmentTabId: assignmentTab?.id, questionText, providerTabId: tab.id, startedAt: Date.now() } });
      await chrome.tabs.update(tab.id, { url, active: false });
    } else {
      tab = await chrome.tabs.create({ url, active: false, windowId });
      if (!tab?.id) throw new Error('Chrome did not create the tab.');
      targetTabId = tab.id;
      await chrome.storage.local.set({
        satoriGoogleTabId: tab.id,
        satoriGoogleWindowId: tab.windowId,
        satoriActiveRequest: { requestId, provider: 'google', mode, assignmentTabId: assignmentTab?.id, questionText, providerTabId: tab.id, startedAt: Date.now() }
      });
    }
    if (!reused && tab.status === 'complete') handleLoaded();
  } catch (error) {
    chrome.tabs.onUpdated.removeListener(listener);
    if (requestId === activeRequestId) {
      await chrome.alarms.clear(`satori-timeout-${requestId}`);
      await chrome.storage.local.remove('satoriActiveRequest');
      setStatus(`Could not open Google Search: ${error.message}`, 'error');
    }
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
    let result;
    try {
      result = await chrome.tabs.sendMessage(tabId, { type: 'FILL_AND_SEND_GEMINI', requestId, prompt, mode });
    } catch (_e) {
      await chrome.scripting.executeScript({ target: { tabId }, files: ['gemini.js'] }).catch(() => {});
      result = await chrome.tabs.sendMessage(tabId, { type: 'FILL_AND_SEND_GEMINI', requestId, prompt, mode });
    }
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
    await chrome.alarms.clear(`satori-timeout-${requestId}`);
    activeGeminiRequest = null;
    await chrome.storage.local.remove(['activeGeminiRequest', 'satoriActiveRequest']);
    setStatus('Gemini input was not ready. Open Gemini once, then try again.', 'error');
    addDiagnostic('gemini-error', 'input not found after retries');
  }
}

async function startGeminiSearch(prompt, requestId, mode, assignmentTab, questionText = '') {
  await chrome.storage.local.remove(['latestGeminiResponse', 'latestGeminiRawResponse']);
  const windowId = assignmentTab?.windowId;
  let tab = windowId ? await getReusableGeminiTab(windowId) : null;
  activeGeminiRequest = { requestId, mode, questionText, tabId: null, assignmentTabId: assignmentTab?.id };
  await chrome.storage.local.set({ activeGeminiRequest });
  addDiagnostic('gemini-tab', tab ? `reusing Gemini tab ${tab.id}` : 'creating reusable Gemini tab');
  setStatus('Opening Gemini in the background…', 'waiting');
  try {
    const url = 'https://gemini.google.com/app';
    if (tab?.id) {
      activeGeminiRequest.tabId = tab.id;
      await chrome.storage.local.set({ activeGeminiRequest });
      await chrome.tabs.update(tab.id, { url, active: false });
      setTimeout(() => sendGeminiPrompt(tab.id, requestId, prompt, mode), 1200);
    } else {
      tab = await chrome.tabs.create({ url, active: false, windowId });
      if (!tab?.id) throw new Error('Chrome did not create the Gemini tab.');
      activeGeminiRequest.tabId = tab.id;
      await chrome.storage.local.set({ satoriGeminiTabId: tab.id, satoriGeminiWindowId: tab.windowId, activeGeminiRequest });
      setTimeout(() => sendGeminiPrompt(tab.id, requestId, prompt, mode), 1800);
    }
  } catch (error) {
    activeGeminiRequest = null;
    await chrome.storage.local.remove(['activeGeminiRequest', 'satoriActiveRequest']);
    await chrome.alarms.clear(`satori-timeout-${requestId}`);
    setStatus(`Could not open Gemini: ${error.message}`, 'error');
    addDiagnostic('gemini-error', error.message);
  }
}

async function handleGeminiResponse(message) {
  if (message.requestId && message.requestId !== activeRequestId) {
    addDiagnostic('gemini-stale', `ignored response for request ${message.requestId}`);
    return;
  }
  if (!activeGeminiRequest) {
    const stored = await chrome.storage.local.get('activeGeminiRequest');
    if (stored.activeGeminiRequest) activeGeminiRequest = stored.activeGeminiRequest;
  }
  if (message.requestId && activeGeminiRequest?.requestId && message.requestId !== activeGeminiRequest.requestId) {
    addDiagnostic('gemini-validation', `ignored stale response for request ${message.requestId}`);
    return;
  }
  const responsePayload = message.detail ?? message.text;
  const payload = typeof responsePayload === 'string' ? { text: responsePayload, code: '' } : (responsePayload || {});
  
  if (!activeGeminiRequest) {
    const stored = await chrome.storage.local.get(['activeGeminiRequest', 'satoriMode']);
    if (stored.activeGeminiRequest) activeGeminiRequest = stored.activeGeminiRequest;
    else if (stored.satoriMode) activeGeminiRequest = { mode: stored.satoriMode };
  }
  const mode = payload.mode || activeGeminiRequest?.mode || 'coding';
  const raw = String(payload.text || '').trim();
  const selected = mode === 'coding' ? String(payload.code || '').trim() : raw;
  if (!selected) {
    setStatus(mode === 'coding' ? 'Gemini responded, but no reliable code block was found.' : 'Gemini returned an empty response.', 'error');
    addDiagnostic('gemini-parser', mode === 'coding' ? 'response found but code block missing' : 'empty response');
    return;
  }
  const finalSelected = mode === 'mcq' ? formatMcqAnswer(selected, activeGeminiRequest?.questionText || '') : selected;
  const requestId = activeGeminiRequest?.requestId || message.requestId || null;
  const providerResult = buildProviderResult('gemini', requestId, mode, finalSelected, raw);
  if (mode === 'coding' && !looksLikeCode(providerResult.code)) {
    setStatus('Gemini returned text that does not look like source code.', 'error');
    addDiagnostic('gemini-validation', 'coding result rejected before autofill');
    return;
  }
  await chrome.storage.local.set({ latestGeminiResponse: finalSelected, latestGeminiRawResponse: raw, latestGeminiAt: Date.now(), latestProvider: 'gemini', latestProviderResult: providerResult });
  const assignmentTabId = activeGeminiRequest?.assignmentTabId;
  if (requestId) await chrome.alarms.clear(`satori-timeout-${requestId}`);
  activeGeminiRequest = null;
  await chrome.storage.local.remove(['activeGeminiRequest', 'satoriActiveRequest']);
  const applied = await autoFillAssignment(assignmentTabId, providerResult);
  if (!applied?.ok) return;
  const warning = mode === 'coding' && !/(#include|public\s+class\s+Main|\bint\s+main\s*\(|\bdef\s+main\s*\()/i.test(selected);
  setStatus(`Gemini response captured.${warning ? ' It may be incomplete.' : ''}`, warning ? 'error' : 'ready');
  addDiagnostic('gemini-complete', `${selected.length} chars captured${mode === 'coding' ? ' as code' : ''}`);
}

let activeChatGPTRequest = null;
async function getReusableChatGPTTab(windowId) {
  const stored = await chrome.storage.local.get(['satoriChatGPTTabId', 'satoriChatGPTWindowId']);
  if (stored.satoriChatGPTTabId && stored.satoriChatGPTWindowId === windowId) {
    try {
      const tab = await chrome.tabs.get(stored.satoriChatGPTTabId);
      if (tab?.windowId === windowId && /https:\/\/(chatgpt\.com|chat\.openai\.com)\//i.test(tab.url || '')) return tab;
    } catch (_error) { addDiagnostic('chatgpt-tab', 'saved ChatGPT tab no longer exists'); }
  }
  const tabs = await chrome.tabs.query({ windowId });
  const inactive = tabs.find((tab) => !tab.active && /https:\/\/(chatgpt\.com|chat\.openai\.com)\//i.test(tab.url || ''));
  if (inactive?.id) {
    await chrome.storage.local.set({ satoriChatGPTTabId: inactive.id, satoriChatGPTWindowId: windowId });
    addDiagnostic('chatgpt-tab', `adopted existing inactive ChatGPT tab ${inactive.id}`);
    return inactive;
  }
  return null;
}
async function sendChatGPTPrompt(tabId, requestId, prompt, mode, retries = 15) {
  if (requestId !== activeRequestId) return;
  try {
    const result = await Promise.race([
      chrome.tabs.sendMessage(tabId, { type: 'FILL_CHATGPT_PROMPT', requestId, prompt, mode }),
      new Promise((_, reject) => setTimeout(() => reject(new Error('timed out waiting for adapter response')), 4000))
    ]);
    if (result?.ok) {
      addDiagnostic('chatgpt-input', `prompt ready; baseline responses=${result.baselineCount ?? 'unknown'}`);
      setStatus('ChatGPT prompt sent in background — waiting for response…', 'waiting');
      return;
    }
    addDiagnostic('chatgpt-input', result?.error || 'ChatGPT adapter rejected the prompt');
  } catch (error) {
    addDiagnostic('chatgpt-input', `adapter not ready (${error.message})`);
    if (retries === 13) {
      try {
        addDiagnostic('chatgpt-recovery', 'reloading ChatGPT tab to reset adapter connection');
        await chrome.tabs.reload(tabId);
        setTimeout(() => sendChatGPTPrompt(tabId, requestId, prompt, mode, retries - 1), 1800);
        return;
      } catch (_e) {}
    } else if (retries === 6) {
      try {
        addDiagnostic('chatgpt-recovery', 'replacing tab with fresh background ChatGPT tab');
        await chrome.tabs.remove(tabId).catch(() => {});
        await chrome.storage.local.remove(['satoriChatGPTTabId']);
        const freshTab = await chrome.tabs.create({
          url: 'https://chatgpt.com/',
          active: false,
          ...(activeChatGPTRequest?.assignmentWindowId ? { windowId: activeChatGPTRequest.assignmentWindowId } : {})
        });
        if (freshTab?.id) {
          if (activeChatGPTRequest) {
            activeChatGPTRequest.tabId = freshTab.id;
            await chrome.storage.local.set({ satoriChatGPTTabId: freshTab.id, satoriChatGPTWindowId: freshTab.windowId, activeChatGPTRequest });
          }
          setTimeout(() => sendChatGPTPrompt(freshTab.id, requestId, prompt, mode, retries - 1), 2000);
          return;
        }
      } catch (_e) {}
    }
  }
  if (retries > 0) setTimeout(() => sendChatGPTPrompt(tabId, requestId, prompt, mode, retries - 1), 800);
  else {
    await chrome.alarms.clear(`satori-timeout-${requestId}`);
    activeChatGPTRequest = null;
    await chrome.storage.local.remove(['activeChatGPTRequest', 'satoriActiveRequest']);
    setStatus('ChatGPT composer was not ready. Close existing ChatGPT tabs and try again.', 'error');
    addDiagnostic('chatgpt-error', 'composer not found after retries');
  }
}
async function startChatGPTSearch(prompt, requestId, mode, assignmentTab, questionText = '') {
  await chrome.storage.local.remove(['latestChatGPTResponse', 'latestChatGPTRawResponse']);
  const windowId = assignmentTab?.windowId;
  let tab = windowId ? await getReusableChatGPTTab(windowId) : null;

  activeChatGPTRequest = { requestId, mode, questionText, tabId: null, assignmentTabId: assignmentTab?.id, assignmentWindowId: assignmentTab?.windowId ?? null };
  await chrome.storage.local.set({ activeChatGPTRequest });

  const url = 'https://chatgpt.com/';
  try {
    if (tab?.id) {
      activeChatGPTRequest.tabId = tab.id;
      const isChatGPTUrl = /https:\/\/(chatgpt\.com|chat\.openai\.com)\//i.test(tab.url || '');

      let isAlive = false;
      if (isChatGPTUrl && !tab.discarded) {
        try {
          await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['chatgpt.js'] }).catch(() => {});
        } catch (_e) {}

        try {
          const check = await Promise.race([
            chrome.tabs.sendMessage(tab.id, { type: 'CHECK_EXISTING_RESPONSE', prompt, mode }),
            new Promise((_, reject) => setTimeout(() => reject(new Error('check timeout')), 600))
          ]);
          if (check?.ok && check.existing) {
            if (check.existing.generating) {
              addDiagnostic('chatgpt-tab', `ChatGPT is generating answer in tab ${tab.id}; waiting for completion…`);
              setStatus('ChatGPT is generating response in the background…', 'waiting');
              return;
            }
            if (check.existing.code) {
              const code = check.existing.code;
              const text = check.existing.text || code;
              addDiagnostic('chatgpt-instant', `captured existing answer from tab ${tab.id} (${code.length} chars)`);
              const finalExisting = mode === 'mcq' ? formatMcqAnswer(code, questionText) : code;
              const existingResult = buildProviderResult('chatgpt', requestId, mode, finalExisting, text);
              await chrome.storage.local.set({
                latestChatGPTResponse: finalExisting,
                latestChatGPTRawResponse: text,
                latestChatGPTAt: Date.now(),
                latestProvider: 'chatgpt',
                latestProviderResult: existingResult
              });
              await chrome.alarms.clear(`satori-timeout-${requestId}`);
              activeChatGPTRequest = null;
              await chrome.storage.local.remove(['activeChatGPTRequest', 'satoriActiveRequest']);
              const appliedExisting = await autoFillAssignment(assignmentTab?.id, existingResult);
              if (!appliedExisting?.ok) return;
              return;
            }
          }
        } catch (_e) {}

        try {
          const ping = await Promise.race([
            chrome.tabs.sendMessage(tab.id, { type: 'PING_CHATGPT' }),
            new Promise((_, reject) => setTimeout(() => reject(new Error('ping timeout')), 500))
          ]);
          if (ping?.ok) isAlive = true;
        } catch (_e) {}
      }

      if (isAlive) {
        activeChatGPTRequest.tabId = tab.id;
        await chrome.storage.local.set({ activeChatGPTRequest });
        addDiagnostic('chatgpt-tab', `reusing active ChatGPT tab ${tab.id}`);
        setStatus('Preparing ChatGPT prompt…', 'waiting');
        setTimeout(() => sendChatGPTPrompt(tab.id, requestId, prompt, mode), 30);
      } else {
        addDiagnostic('chatgpt-tab', `reloading ChatGPT tab ${tab.id} for fresh connection`);
        setStatus('Opening ChatGPT in the background…', 'waiting');
        await chrome.tabs.update(tab.id, { url, active: false });
        setTimeout(() => sendChatGPTPrompt(tab.id, requestId, prompt, mode), 1200);
      }
    } else {
      addDiagnostic('chatgpt-tab', 'creating reusable ChatGPT tab in the background');
      setStatus('Opening ChatGPT in the background…', 'waiting');
      tab = await chrome.tabs.create({ url, active: false, windowId });
      if (!tab?.id) throw new Error('Chrome did not create the ChatGPT tab.');
      activeChatGPTRequest.tabId = tab.id;
      activeChatGPTRequest.assignmentWindowId = windowId ?? tab.windowId;
      await chrome.storage.local.set({ satoriChatGPTTabId: tab.id, satoriChatGPTWindowId: tab.windowId, activeChatGPTRequest });
      setTimeout(() => sendChatGPTPrompt(tab.id, requestId, prompt, mode), 1500);
    }
  } catch (error) {
    activeChatGPTRequest = null;
    await chrome.storage.local.remove(['activeChatGPTRequest', 'satoriActiveRequest']);
    await chrome.alarms.clear(`satori-timeout-${requestId}`);
    setStatus(`Could not prepare ChatGPT: ${error.message}`, 'error');
    addDiagnostic('chatgpt-error', error.message);
  }
}

async function handleChatGPTResponse(message) {
  if (message.requestId && activeChatGPTRequest?.requestId && message.requestId !== activeChatGPTRequest.requestId) {
    addDiagnostic('chatgpt-validation', `ignored stale response for request ${message.requestId}`);
    return;
  }
  if (!activeChatGPTRequest) {
    const stored = await chrome.storage.local.get('activeChatGPTRequest');
    if (stored.activeChatGPTRequest) activeChatGPTRequest = stored.activeChatGPTRequest;
  }

  const mode = activeChatGPTRequest?.mode || 'coding';
  const responsePayload = message.detail ?? message.text;
  const payload = typeof responsePayload === 'string' ? { text: responsePayload, code: '' } : (responsePayload || {});
  const raw = String(payload.text || '').trim();
  const selected = mode === 'coding' ? String(payload.code || '').trim() : raw;

  if (!selected) {
    setStatus('ChatGPT did not return a valid answer.', 'error');
    addDiagnostic('chatgpt-validation', 'empty response');
    return;
  }

  const finalSelected = mode === 'mcq' ? formatMcqAnswer(selected, activeChatGPTRequest?.questionText || '') : selected;
  const requestId = activeChatGPTRequest?.requestId || message.requestId || null;
  const providerResult = buildProviderResult('chatgpt', requestId, mode, finalSelected, raw);
  await chrome.storage.local.set({ latestChatGPTResponse: finalSelected, latestChatGPTRawResponse: raw, latestChatGPTAt: Date.now(), latestProvider: 'chatgpt', latestProviderResult: providerResult });
  const assignmentTabId = activeChatGPTRequest?.assignmentTabId;
  if (requestId) await chrome.alarms.clear(`satori-timeout-${requestId}`);
  activeChatGPTRequest = null;
  await chrome.storage.local.remove(['activeChatGPTRequest', 'satoriActiveRequest']);
  const applied = await autoFillAssignment(assignmentTabId, providerResult);
  if (!applied?.ok) {
    addDiagnostic('chatgpt-complete', 'response captured but could not be applied to the assignment');
    return;
  }
  const warning = mode === 'coding' && !/(#include|public\s+class\s+Main|\bint\s+main\s*\(|\bdef\s+main\s*\()/i.test(selected);
  setStatus(`ChatGPT response captured.${warning ? ' It may be incomplete.' : ''}`, warning ? 'error' : 'ready');
  addDiagnostic('chatgpt-complete', `${selected.length} chars captured${mode === 'coding' ? ' as code' : ''}`);
}

chrome.runtime.onMessage.addListener(async (message, sender, sendResponse) => {
  if (message.type === 'CANCEL_REQUEST') { cancelActiveRequest(); sendResponse({ ok: true }); return true; }
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
  if (message.type === 'GOOGLE_RESPONSE') {
    handleGoogleResponse(message);
    return;
  }
  if (message.type === 'CHATGPT_RESPONSE') { handleChatGPTResponse(message); return; }
  if (message.type === 'CHATGPT_DIAGNOSTIC') { addDiagnostic('chatgpt', message.detail || 'ChatGPT adapter diagnostic'); return; }
  if (message.type === 'CHATGPT_SUBMITTED') { addDiagnostic('chatgpt-submit', message.detail || 'ChatGPT prompt submitted'); return; }
});
