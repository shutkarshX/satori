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

const isTransientPlaceholder = (val) => {
  const s = String(val || '').replace(/^AI\s*Overview\s*/i, '').trim();
  if (!s || s.length < 15) return true;
  if (/^(thinking|loading|generating)(\.\.\.)?$/i.test(s)) return true;
  if (/^thinking\s*generative ai is experimental/i.test(s)) return true;
  if (/^(generative ai is experimental|learning more)/i.test(s) && s.length < 120) return true;
  if (/^AI\s*Overview\s*(is\s*)?(thinking|generating|loading)/i.test(s)) return true;
  return false;
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

function sendLiveTelemetry(event, details = '') {
  try {
    fetch('http://127.0.0.1:8999/log', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ event, details, context: 'background' })
    }).catch(() => {});
  } catch (_e) {}
}

const addDiagnostic = (step, detail) => {
  sendLiveTelemetry(step, detail);
  chrome.storage.local.get('satoriDiagnostics', ({ satoriDiagnostics = [] }) => {
    const entries = Array.isArray(satoriDiagnostics) ? satoriDiagnostics : [];
    entries.push({ time: new Date().toLocaleTimeString(), step, detail });
    chrome.storage.local.set({ satoriDiagnostics: entries.slice(-30) });
  });
};

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

CRITICAL INSTRUCTIONS FOR AUTOMATED GRADING & PLATFORM CONSTRAINTS:
1. STRICTLY OBEY BLACKLISTED & WHITELISTED RULES: Check the problem text for any "Blacklisted" or "Whitelisted" keywords, functions, data structures, or header files. Never use any blacklisted items (e.g. built-in sorting, specific libraries). Strictly use any required whitelisted items.
2. EXACT FORMATTING: Output strings, spaces, and line breaks must match the sample outputs 100%. No extra conversational text or debugging prints.
3. COMPLETE SINGLE FILE: Return exactly one complete, submission-ready, compilable source file in ONE code block and nothing else outside the code block. Include all required imports/headers, helpers, and the complete entry point.

PAGE CONTENT:
${pageContent}`;
}

// -------------------------------------------------------------
// Normalized Provider Result Builder & Validator
// -------------------------------------------------------------
function formatMcqAnswer(text, questionText = '', structuredOptions = []) {
  if (!text) return { letter: null, text: '', raw: '' };
  let clean = text.normalize('NFKD').replace(/[\u2217\u22c5\u00d7·×⋅]/g, '*').trim();
  const norm = (s) => s.normalize('NFKD').replace(/[\u2217\u22c5\u00d7·×⋅]/g, '*').replace(/\s+/g, '').toLowerCase();

  // 1. Authoritative matching against structured options (if provided from page DOM)
  if (Array.isArray(structuredOptions) && structuredOptions.length > 0) {
    // A. Check for explicit Option Letter mention e.g. "Option B", "**B**", "ANSWER: B", "Correct: B"
    const explicitLetterMatch = clean.match(/(?:(?:correct\s+(?:answer|option)|final\s+answer|answer)\s*(?:is)?\s*[:\-]?\s*|\boption\s+)\(?([A-Da-d])\)?\b/i);
    if (explicitLetterMatch && explicitLetterMatch[1]) {
      const targetLetter = explicitLetterMatch[1].toUpperCase();
      const matched = structuredOptions.find(o => (o.letter || '').toUpperCase() === targetLetter);
      if (matched) {
        return { letter: matched.letter, text: matched.text, raw: clean };
      }
    }

    // B. Check if AI response contains any known option text (longest first)
    const normClean = norm(clean);
    const sortedStructured = [...structuredOptions]
      .filter(o => o.text && o.text.trim().length >= 2)
      .sort((a, b) => b.text.length - a.text.length);

    for (const opt of sortedStructured) {
      const normOpt = norm(opt.text);
      if (normOpt.length >= 2 && normClean.includes(normOpt)) {
        return { letter: opt.letter, text: opt.text, raw: clean };
      }
    }
  }

  // 2. If question options are known from questionText, test against them directly (longest first)
  if (questionText) {
    const stopWords = /^(Question|Marks|Negative|Answer here|Clear|Prev|Next|Submit|Section|Time|View|Multi Choice|Single File|degree|batch|roll number|name|email|test name)/i;
    const knownOptions = questionText
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => Boolean(l) && !stopWords.test(l) && l.length < 150 && !l.includes('?') && !l.endsWith(':') && l.length >= 1);

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
    // Require at least 3 characters and not a common suffix like "ed"
    if (res.length >= 3 && !/^(ed|ing|ly|es|s|th|st|nd|rd)$/i.test(res)) {
      return { letter: null, text: res, raw: clean };
    }
  }

  // Fallback: pick the first complete sentence or line with substantive content (> 10 chars)
  const filtered = lines.filter((l) => l.length >= 8 && !/^(#|ai overview|evaluation|analysis|explanation|here is|note)/i.test(l));
  const fallback = filtered[0] || clean.slice(0, 120);
  return { letter: null, text: fallback, raw: clean };
}

function validateProviderResult(provider, requestId, mode, payload, questionText = '', structuredOptions = []) {
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

    const mcq = formatMcqAnswer(cleanRaw, questionText, structuredOptions);
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
  const code = typeof payload === 'string'
    ? payload
    : (payload.code || (looksLikeCode(payload.text) ? extractCodeBlock(payload.text) : ''));
  const isValid = looksLikeCode(code) && code.trim().length > 30;
  return {
    provider,
    requestId,
    type: 'coding',
    valid: isValid,
    code: code.trim(),
    raw: typeof payload === 'object' ? (payload.text || payload.code) : code
  };
}

function looksLikeCode(str) {
  if (!str || typeof str !== 'string') return false;
  const s = str.trim();
  if (s.length < 30) return false;
  if (/(#include|import\s+(?:sys|math|os|java|stdio|vector)|from\s+\w+\s+import|using\s+namespace|package\s+\w+)/i.test(s)) return true;
  if (/(class\s+\w+|def\s+\w+\s*\(|function\s+\w+\s*\(|public\s+(?:static\s+)?void\s+main|\bint\s+main|\bvoid\s+main)/i.test(s)) return true;
  if (/(?:scanf|printf|cin\s*>>|cout\s*<<|System\.out\.print|print\s*\(|console\.log)/i.test(s)) return true;
  if (/(\bint\b|\bvoid\b|\bchar\b|\bfloat\b|\bdouble\b|\bbool\b)\s+\w+\s*[\(\=;]/i.test(s)) return true;
  if (/(for\s*\(.*?;.*?;.*?\)|while\s*\(.*?\)|if\s*\(.*?\)\s*\{|return\s+0;)/i.test(s)) return true;
  const lines = s.split('\n');
  const codeyLines = lines.filter(l => /[;{}()=\[\]]/.test(l) || /^\s{4,}/.test(l)).length;
  if (lines.length >= 3 && codeyLines / lines.length > 0.35) return true;
  return false;
}

function extractCodeBlock(text) {
  if (!text) return '';
  const fenced = text.match(/```(?:c|cpp|c\+\+|java|python|javascript|js)?\s*([\s\S]*?)```/i);
  if (fenced && fenced[1] && fenced[1].trim().length >= 30) return fenced[1].trim();
  const startMatch = text.match(/(?:^|\n)\s*(#include|import\s+|class\s+|def\s+|void\s+|int\s+main|using\s+namespace)/i);
  if (startMatch && startMatch.index !== undefined) {
    const sub = text.slice(startMatch.index);
    const endMatch = sub.match(/\n\s*(?:###\s*(?:Explanation|How it works|Complexity)|Key Highlights:|Explanation:\s*\n|Note:\s*This code|Here is how the code works:)/i);
    if (endMatch && endMatch.index !== undefined && endMatch.index > 25) {
      return sub.slice(0, endMatch.index).trim();
    }
    return sub.trim();
  }
  return text.trim();
}

// -------------------------------------------------------------
// Single Execution & Autofill Pipeline
// -------------------------------------------------------------
function typeIntoMainWorldEditor(codeText) {
  // 1. Monaco Editor (Global window.monaco in MAIN world)
  try {
    if (window.monaco?.editor) {
      const models = window.monaco.editor.getModels?.();
      if (models && models.length > 0) {
        models[0].setValue(codeText);
        return { ok: true, editor: 'monaco' };
      }
    }
  } catch (_e) {}

  // 2. Ace Editor (Global window.ace or .ace_editor in MAIN world)
  try {
    const aceNodes = [...document.querySelectorAll('.ace_editor')];
    for (const node of aceNodes) {
      if (node.env?.editor) {
        node.env.editor.setValue(codeText, 1);
        node.env.editor.clearSelection();
        return { ok: true, editor: 'ace' };
      }
      if (window.ace?.edit) {
        const ed = window.ace.edit(node);
        if (ed) {
          ed.setValue(codeText, 1);
          ed.clearSelection();
          return { ok: true, editor: 'ace' };
        }
      }
    }
  } catch (_e) {}

  // 3. CodeMirror (v5 cm.CodeMirror, or v6 cm.view)
  try {
    const cmNodes = [...document.querySelectorAll('.CodeMirror')];
    for (const node of cmNodes) {
      if (node.CodeMirror) {
        node.CodeMirror.setValue(codeText);
        return { ok: true, editor: 'codemirror' };
      }
    }
  } catch (_e) {}

  // 4. Any textarea or contenteditable element in the editor container
  try {
    const candidates = [
      document.activeElement,
      document.querySelector('.monaco-editor textarea'),
      document.querySelector('.ace_text-input'),
      document.querySelector('.CodeMirror textarea'),
      document.querySelector('[class*="editor" i] textarea, [class*="code" i] textarea'),
      document.querySelector('textarea'),
      document.querySelector('[contenteditable="true"]')
    ].filter(Boolean);

    for (const el of candidates) {
      if (el.isContentEditable || el.matches?.('[contenteditable="true"]')) {
        el.focus();
        document.execCommand('selectAll', false, null);
        document.execCommand('insertText', false, codeText);
        return { ok: true, editor: 'contenteditable' };
      }
      if (el.tagName?.toLowerCase() === 'textarea' || el.tagName?.toLowerCase() === 'input') {
        el.focus();
        try {
          const dt = new DataTransfer();
          dt.setData('text/plain', codeText);
          el.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: dt }));
        } catch (_e) {}
        const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
        const descriptor = Object.getOwnPropertyDescriptor(proto, 'value');
        if (descriptor?.set) descriptor.set.call(el, codeText); else el.value = codeText;
        el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: codeText }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        return { ok: true, editor: 'textarea' };
      }
    }
  } catch (_e) {}

  return { ok: false };
}

async function autoFillAssignment(tabId, result) {
  if (!tabId || !result || !result.valid) return { ok: false, error: 'Invalid AI answer' };

  try {
    const msgType = result.type === 'mcq' ? 'SELECT_MCQ_OPTION' : 'TYPE_INTO_EDITOR';
    const payload = result.type === 'mcq'
      ? { type: msgType, answer: result.answer }
      : { type: msgType, text: result.code, append: false };

    // For coding: execute directly into the page's MAIN world across all frames first (Monaco, Ace, CodeMirror, etc.)
    if (result.type === 'coding') {
      try {
        const mainResults = await chrome.scripting.executeScript({
          target: { tabId, allFrames: true },
          world: 'MAIN',
          func: typeIntoMainWorldEditor,
          args: [result.code]
        });
        const anySuccess = (mainResults || []).some(r => r.result?.ok);
        if (anySuccess) {
          const usedEditor = (mainResults || []).find(r => r.result?.ok)?.result?.editor || 'editor';
          addDiagnostic(`${result.provider}-autofill`, `Code placed into ${usedEditor} via MAIN world`);
          setStatus(`${PROVIDER_NAMES[result.provider] || result.provider} code placed into ${usedEditor}. Review before submitting.`, 'ready');
          return { ok: true };
        }
      } catch (mainErr) {
        console.warn('[Satori Background] MAIN world injection error:', mainErr);
      }
    }

    let res;
    try {
      res = await chrome.tabs.sendMessage(tabId, payload);
    } catch (_error) {
      await chrome.scripting.executeScript({ target: { tabId, allFrames: true }, files: ['content.js'] });
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

  const validated = validateProviderResult(provider, requestId, active.mode, rawPayload, active.questionText, active.structuredOptions || []);

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

// 1. Google AI Mode (Polling + Mutation Observer for instantaneous capture)
async function startGoogleSearch(query, requestId, mode, assignmentTab, questionText) {
  const url = `https://www.google.com/search?q=${encodeURIComponent(query.slice(0, 30000))}`;
  const windowId = assignmentTab?.windowId;
  let tab = windowId ? await getReusableTab(/^https:\/\/(www\.)?google\./i, 'satoriGoogleTabId', 'satoriGoogleWindowId', windowId) : null;

  const startPollingGoogle = (tabId) => {
    let attempts = 0;
    const interval = setInterval(async () => {
      attempts++;
      const current = await chrome.storage.local.get('satoriActiveRequest');
      if (current.satoriActiveRequest?.requestId !== requestId || attempts > 180) {
        clearInterval(interval);
        return;
      }

      try {
        chrome.tabs.sendMessage(tabId, { type: 'READ_GOOGLE_AI_OVERVIEW', mode }, (res) => {
          if (chrome.runtime.lastError || !res?.ok || res.loading) return;
          const text = (res.text || '').trim();
          const code = (res.code || '').trim();
          const effectiveCode = code || (looksLikeCode(text) ? extractCodeBlock(text) : '');

          const isReady = mode === 'coding'
            ? Boolean(effectiveCode && effectiveCode.length >= 50 && looksLikeCode(effectiveCode) && !effectiveCode.includes('var(--') && !effectiveCode.includes('.o3lpyf') && !effectiveCode.includes('window.sn='))
            : Boolean(text && text.length >= 15 && !isTransientPlaceholder(text) && !text.includes('var(--') && !text.includes('.o3lpyf') && !text.includes('window.sn='));

          if (isReady) {
            clearInterval(interval);
            addDiagnostic('google-poll', `Answer captured directly via polling (${mode === 'coding' ? effectiveCode.length : text.length} chars)`);
            handleCompletedResult('google', requestId, {
              requestId,
              mode,
              text: res.text,
              code: effectiveCode || res.code,
              capturedAt: Date.now()
            });
          }
        });
      } catch (_e) {
        clearInterval(interval);
      }
    }, 1000);
  };

  const initiateWatch = async (tabId) => {
    try {
      await chrome.scripting.executeScript({ target: { tabId }, files: ['google.js'] }).catch(() => {});
      await chrome.tabs.sendMessage(tabId, {
        type: 'START_GOOGLE_WATCH',
        requestId,
        mode
      });
      addDiagnostic('google-watch', `Watch attached to Google Search tab ${tabId}`);
      startPollingGoogle(tabId);
    } catch (err) {
      addDiagnostic('google-error', err.message);
      startPollingGoogle(tabId);
    }
  };

  if (tab?.id) {
    const targetTabId = tab.id;
    let handled = false;
    const listener = (updatedTabId, changeInfo) => {
      if (updatedTabId === targetTabId && changeInfo.status === 'complete' && !handled) {
        handled = true;
        chrome.tabs.onUpdated.removeListener(listener);
        initiateWatch(targetTabId);
      }
    };
    chrome.tabs.onUpdated.addListener(listener);
    await chrome.tabs.update(tab.id, { url, active: false });
    setTimeout(() => { if (!handled) { handled = true; initiateWatch(targetTabId); } }, 1500);
  } else {
    tab = await chrome.tabs.create({ url, active: false, windowId });
    const targetTabId = tab.id;
    await chrome.storage.local.set({ satoriGoogleTabId: tab.id, satoriGoogleWindowId: tab.windowId });
    let handled = false;
    const listener = (updatedTabId, changeInfo) => {
      if (updatedTabId === targetTabId && changeInfo.status === 'complete' && !handled) {
        handled = true;
        chrome.tabs.onUpdated.removeListener(listener);
        initiateWatch(targetTabId);
      }
    };
    chrome.tabs.onUpdated.addListener(listener);
    setTimeout(() => { if (!handled) { handled = true; initiateWatch(targetTabId); } }, 1800);
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
async function dispatchSatoriRequest({ provider, mode, pageContent, questionText, structuredOptions = [], assignmentTabId, windowId }) {
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
      structuredOptions,
      startedAt: Date.now()
    }
  });

  await chrome.alarms.create(`satori-timeout-${requestId}`, { delayInMinutes: 5 });
  setStatus(`${PROVIDER_NAMES[provider] || provider} is processing ${mode === 'mcq' ? 'MCQ' : 'code'}…`, 'waiting');
  addDiagnostic('request', `Started ${provider} ${mode} (request ${requestId})`);

  const prompt = buildDirectPrompt(provider, mode, pageContent);

  if (provider === 'google') {
    // For Google AI Mode, keep the actual question text at the start so Google triggers AI Overview,
    // and append strict grading & blacklist/whitelist constraints at the end
    const googleQuery = mode === 'coding'
      ? `${pageContent}\n\nStrictly follow all blacklisted and whitelisted constraints, pass all sample test cases, and return complete code.`
      : pageContent;
    startGoogleSearch(googleQuery, requestId, mode, assignmentTab, questionText);
  } else if (provider === 'gemini') {
    startGeminiSearch(prompt, requestId, mode, assignmentTab, questionText);
  } else {
    startChatGPTSearch(prompt, requestId, mode, assignmentTab, questionText);
  }
}

// -------------------------------------------------------------
// Keyboard Shortcut Commands (Alt+Shift+M, Alt+Shift+C, Alt+Shift+X)
// -------------------------------------------------------------
async function executeShortcutCommand(command, senderTab = null, directPageText = '', directOptions = []) {
  console.log('[Satori Background] Command executing:', command);
  addDiagnostic('shortcut-command', `Command executing: ${command}`);
  if (command === 'satori-cancel') {
    await cancelActiveRequest();
    return;
  }

  const mode = command === 'satori-mcq' ? 'mcq' : command === 'satori-code' ? 'coding' : null;
  if (!mode) return;
  setStatus(`${mode === 'coding' ? 'Coding' : 'MCQ'} shortcut detected. Reading the active assignment tab…`, 'waiting');

  let assignmentTab = senderTab;
  if (!assignmentTab?.id) {
    const activeTabs = await chrome.tabs.query({ active: true });
    assignmentTab = activeTabs.find((t) => t.id && !/^(chrome|edge|chrome-extension|about):/i.test(t.url || '') && !/google\.|gemini\.|chatgpt\./i.test(t.url || '')) || activeTabs[0];
  }

  if (!assignmentTab?.id) {
    console.warn('[Satori Background] Active tab is an internal or provider page. Ignoring shortcut.');
    setStatus('Cannot run on internal browser pages (e.g. chrome://). Switch to an assignment tab.', 'error');
    return;
  }

  let pageContent = (directPageText || '').trim();
  let questionText = pageContent;
  let structuredOptions = directOptions || [];

  // If shortcut provided live page content directly from active tab, use it immediately!
  if (pageContent.length >= 20) {
    addDiagnostic('shortcut-input', `Using live page text directly (${pageContent.length} chars)`);
  } else {
    // Extract question across top frame and all iframe frames
    let page;
    try {
      page = await chrome.tabs.sendMessage(assignmentTab.id, { type: 'EXTRACT_QUESTION' });
    } catch (_e) {}

    if (page?.copiedText && page.copiedText.trim().length >= 20) {
      pageContent = page.copiedText.trim();
      questionText = pageContent;
      structuredOptions = page.options || [];
      addDiagnostic('shortcut-input', `Using copied text from tab (${pageContent.length} chars)`);
    } else if (page?.fullText && page.fullText.trim().length >= 20) {
      pageContent = page.fullText;
      questionText = page.text || page.fullText;
      structuredOptions = page.options || [];
    } else {
      try {
        await chrome.scripting.executeScript({ target: { tabId: assignmentTab.id, allFrames: true }, files: ['content.js'] }).catch(() => {});
        const frameResults = await chrome.scripting.executeScript({
          target: { tabId: assignmentTab.id, allFrames: true },
          func: () => {
            if (typeof extractQuestion === 'function') {
              const full = extractFullPage();
              const text = extractQuestion();
              const opts = typeof extractStructuredMcq === 'function' ? extractStructuredMcq() : [];
              return {
                ok: true,
                text,
                fullText: full,
                options: opts.map(o => ({ letter: o.letter, text: o.text }))
              };
            }
            return null;
          }
        });
        const candidates = (frameResults || [])
          .map(r => r.result)
          .filter(r => r && r.ok && r.fullText && r.fullText.trim().length >= 20)
          .sort((a, b) => b.fullText.length - a.fullText.length);
        if (candidates.length > 0) {
          page = candidates[0];
          pageContent = page.fullText;
          questionText = page.text || page.fullText;
          structuredOptions = page.options || [];
        }
      } catch (injErr) {
        console.error('[Satori Background] Multi-frame extraction error:', injErr);
      }
    }
  }

  if (!pageContent || pageContent.length < 10) {
    setStatus('Could not read enough page text to solve question.', 'error');
    addDiagnostic('shortcut-error', 'Too little text found to solve.');
    return;
  }

  const stored = await chrome.storage.local.get(['satoriProvider']);
  const provider = stored.satoriProvider || 'google';

  await dispatchSatoriRequest({
    provider,
    mode,
    pageContent,
    questionText: questionText || pageContent,
    structuredOptions,
    assignmentTabId: assignmentTab.id,
    windowId: assignmentTab.windowId
  });
}

chrome.commands.onCommand.addListener(async (command) => {
  await executeShortcutCommand(command);
});

// -------------------------------------------------------------
// Message Gateway (Provider Responses & Popup Triggers)
// -------------------------------------------------------------
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === 'LIVE_TELEMETRY') {
    sendLiveTelemetry(message.event, message.details);
    return false;
  }

  if (message.type === 'TRIGGER_SHORTCUT_DIRECT') {
    executeShortcutCommand(message.command, _sender?.tab, message.pageText || '', message.options || []);
    sendResponse({ ok: true });
    return true;
  }

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
      structuredOptions: message.structuredOptions || [],
      assignmentTabId: message.assignmentTabId,
      windowId: message.windowId
    }).then(() => sendResponse({ ok: true }))
      .catch((err) => sendResponse({ ok: false, error: err.message }));
    return true;
  }

  return false;
});
