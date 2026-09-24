(() => {
  const state = {
    requestId: 0,
    mode: 'text',
    baseline: new Set(),
    lastSentAt: 0,
    lastSignature: '',
    pendingSignature: '',
    stableSignature: '',
    stableChecks: 0,
    quietTimer: null,
    stabilityTimer: null,
    promptText: ''
  };
  const clean = (value) => String(value || '').replace(/\u00a0/g, ' ').replace(/\r\n?/g, '\n').replace(/[ \t]+\n/g, '\n').trim();
  const normalizeSource = (value) => clean(value)
    .replace(/^(?:C\+\+|C#|C|Java|Python|JavaScript|TypeScript)\s*(?=(?:#include|import\s|package\s|public\s+class|class\s+|def\s+|function\s))/i, '')
    .replace(/^(?:C\+\+|C#|C|Java|Python|JavaScript|TypeScript)\s*\n(?=(?:#include|import\s|package\s|public\s+class|class\s+|def\s+|function\s))/i, '')
    .trim();
  const signature = (text) => `${text.length}:${text.slice(0, 80)}:${text.slice(-120)}`;
  const responseNodes = () => {
    const primary = [...document.querySelectorAll('[data-message-author-role="assistant"]')];
    const nodes = primary.length ? primary : [...document.querySelectorAll('[data-testid*="conversation-turn" i] .markdown, .markdown, article')];
    return nodes.filter((node) => {
      const text = clean(node.innerText || node.textContent);
      return text.length > 0 && !node.closest?.('[data-message-author-role="user"]');
    });
  };
  const snapshot = () => responseNodes().map((node) => {
    const text = clean(node.innerText || node.textContent);
    return { node, text, signature: signature(text) };
  });
  const report = (type, detail) => {
    try { chrome.runtime.sendMessage({ type, requestId: state.requestId, detail }); } catch (_error) {}
  };
  const findInput = () => document.querySelector('textarea[data-id], textarea[placeholder], textarea, [contenteditable="true"][role="textbox"], [contenteditable="true"]');
  const setInput = (element, text) => {
    element.focus();
    if (element.matches('textarea, input')) {
      const proto = element.tagName.toLowerCase() === 'textarea' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
      if (setter) setter.call(element, text); else element.value = text;
    } else element.textContent = text;
    element.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
  };
  const clickSend = () => {
    const buttons = [...document.querySelectorAll(
      'button[data-testid="send-button"], button[data-testid*="send" i], button[aria-label*="send" i], button[aria-label*="submit" i], button[type="submit"]'
    )];
    const button = buttons.find((candidate) =>
      !candidate.disabled &&
      candidate.getAttribute('aria-disabled') !== 'true' &&
      candidate.offsetParent !== null
    );
    if (button) { button.click(); return 'button'; }

    const input = findInput();
    const form = input?.closest('form');
    const formButton = form?.querySelector(
      'button[type="submit"], button[data-testid*="send" i], button[aria-label*="send" i]'
    );
    if (formButton &&
        !formButton.disabled &&
        formButton.getAttribute('aria-disabled') !== 'true') {
      formButton.click();
      return 'form-button';
    }

    // Do not use form.requestSubmit() as a fallback. On some ChatGPT UI
    // states it clears/submits the composer without reliably creating the
    // assistant turn. Prefer the same Enter action a user would perform.
    if (input) {
      input.focus();
      input.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'Enter',
        code: 'Enter',
        bubbles: true,
        cancelable: true
      }));
      input.dispatchEvent(new KeyboardEvent('keyup', {
        key: 'Enter',
        code: 'Enter',
        bubbles: true,
        cancelable: true
      }));
      return 'keyboard-attempt';
    }
    return '';
  };

  const composerHasPrompt = () => {
    const input = findInput();
    if (!input) return false;
    const value = input.matches('textarea, input')
      ? input.value
      : clean(input.innerText || input.textContent || '');
    return state.promptText.length > 0 && value.trim().length > 0;
  };

  const userMessageNodes = () => {
    const primary = [...document.querySelectorAll('[data-message-author-role="user"]')];
    const fallback = [...document.querySelectorAll('[data-testid*="conversation-turn" i]')];
    return primary.length ? primary : fallback;
  };

  const hasSubmittedUserMessage = () => {
    const prompt = clean(state.promptText);
    if (!prompt) return false;
    return userMessageNodes().some((node) => {
      const text = clean(node.innerText || node.textContent || '');
      return text === prompt || text.includes(prompt.slice(0, Math.min(160, prompt.length)));
    });
  };

  const submitWithEnter = () => {
    const input = findInput();
    if (!input) return false;
    input.focus();
    input.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'Enter',
      code: 'Enter',
      bubbles: true,
      cancelable: true
    }));
    input.dispatchEvent(new KeyboardEvent('keyup', {
      key: 'Enter',
      code: 'Enter',
      bubbles: true,
      cancelable: true
    }));
    return true;
  };

  const verifySubmission = (attempt = 0) => {
    if (!state.requestId) return;

    if (hasSubmittedUserMessage()) {
      report('CHATGPT_DIAGNOSTIC', `prompt submission verified; user message detected, assistant nodes=${responseNodes().length}, generating=${isGenerating()}`);
      return;
    }

    if (attempt < 3) {
      report('CHATGPT_DIAGNOSTIC', `prompt not visible as a user message after submit; retry ${attempt + 1}/3`);
      setTimeout(() => {
        if (!hasSubmittedUserMessage()) submitWithEnter();
        verifySubmission(attempt + 1);
      }, 1200);
      return;
    }

    report('CHATGPT_DIAGNOSTIC', `prompt submission could not be verified after 3 attempts; assistant nodes=${responseNodes().length}, generating=${isGenerating()}`);
  };
  const extractCode = (text, node) => {
    const fenced = [...text.matchAll(/\`\`\`(?:[A-Za-z0-9_+#.-]+)?\s*\n?([\s\S]*?)\`\`\`/g)]
      .map((match) => normalizeSource(match[1]))
      .filter((value) => value.length > 20);
    if (fenced.length) return fenced.sort((a, b) => b.length - a.length)[0];
    const elements = [...(node?.querySelectorAll?.('pre code, pre') || []), ...document.querySelectorAll('pre code, pre')];
    return elements.map((element) => normalizeSource(element.innerText || element.textContent))
      .filter((value) => value.length > 20)
      .sort((a, b) => b.length - a.length)[0] || '';
  };
  const looksComplete = (code) => {
    if (code.length < 220) return false;
    const hasEntryPoint = /#include|public\s+class\s+Main|\bint\s+main\s*\(|\bmain\s*\(/i.test(code);
    const hasOutputOrReturn = /return\b|printf\s*\(|System\.out|cout\s*<<|console\.log|print\s*\(/i.test(code);
    const hasBalancedBraces = (code.match(/{/g) || []).length === (code.match(/}/g) || []).length;
    const hasClosingStructure = /}\s*$/.test(code);
    return hasEntryPoint && hasOutputOrReturn && hasBalancedBraces && hasClosingStructure;
  };
  const isGenerating = () => [...document.querySelectorAll('button')].some((button) =>
    /stop generating|stop/i.test(`${button.getAttribute('aria-label') || ''} ${button.innerText || ''}`) &&
    !button.disabled &&
    button.offsetParent !== null
  );

  const resetStability = () => {
    state.pendingSignature = '';
    state.stableSignature = '';
    state.stableChecks = 0;
    clearTimeout(state.stabilityTimer);
  };

  const emitStableResponse = (final, code) => {
    if (state.lastSignature === final.signature) return;
    state.lastSignature = final.signature;
    report('CHATGPT_RESPONSE', { text: final.text, code, capturedAt: Date.now() });
  };

  const confirmCodingResponse = () => {
    if (!state.requestId || state.mode !== 'coding') return;
    const latest = snapshot().filter((item) => !state.baseline.has(item.signature)).at(-1);
    if (!latest || latest.signature === state.lastSignature) return;
    if (isGenerating()) {
      resetStability();
      report('CHATGPT_DIAGNOSTIC', 'generation still in progress; resetting code stability');
      return;
    }

    const code = extractCode(latest.text, latest.node);
    if (!looksComplete(code)) {
      resetStability();
      report('CHATGPT_DIAGNOSTIC', `candidate incomplete (${code.length} chars); waiting for final code`);
      return;
    }

    if (state.stableSignature === latest.signature) {
      state.stableChecks += 1;
    } else {
      state.stableSignature = latest.signature;
      state.stableChecks = 1;
    }

    if (state.stableChecks < 3) {
      report('CHATGPT_DIAGNOSTIC', `complete candidate detected (${code.length} chars); stability check ${state.stableChecks}/3`);
      clearTimeout(state.stabilityTimer);
      state.stabilityTimer = setTimeout(confirmCodingResponse, 1200);
      return;
    }

    emitStableResponse(latest, code);
  };

  const inspect = () => {
    if (!state.requestId || Date.now() < state.lastSentAt) return;
    const latest = snapshot().filter((item) => !state.baseline.has(item.signature)).at(-1);
    if (!latest || latest.signature === state.lastSignature) return;

    clearTimeout(state.quietTimer);
    state.quietTimer = setTimeout(() => {
      if (isGenerating()) {
        resetStability();
        report('CHATGPT_DIAGNOSTIC', 'generation still in progress; waiting for completion');
        return;
      }

      const final = snapshot().filter((item) => !state.baseline.has(item.signature)).at(-1);
      if (!final || final.signature === state.lastSignature) return;

      if (state.mode === 'coding') {
        confirmCodingResponse();
        return;
      }

      state.lastSignature = final.signature;
      report('CHATGPT_RESPONSE', { text: final.text, code: extractCode(final.text, final.node), capturedAt: Date.now() });
    }, 1200);
  };

  new MutationObserver(inspect).observe(document.documentElement, { childList: true, subtree: true, characterData: true });

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message.type === 'PING_CHATGPT') {
      sendResponse({ ok: true, input: Boolean(findInput()), responses: responseNodes().length });
      return true;
    }

    if (message.type !== 'FILL_AND_SEND_CHATGPT') return;

    const input = findInput();
    if (!input) {
      report('CHATGPT_DIAGNOSTIC', 'composer not found');
      sendResponse({ ok: false, error: 'ChatGPT composer is not ready yet.' });
      return true;
    }

    state.requestId = message.requestId || Date.now();
    state.mode = message.mode || 'text';
    state.promptText = String(message.prompt || '');
    state.baseline = new Set(snapshot().map((item) => item.signature));
    state.lastSignature = '';
    resetStability();
    state.lastSentAt = Date.now();
    clearTimeout(state.quietTimer);
    setInput(input, message.prompt || '');

    setTimeout(() => {
      const method = clickSend();
      if (method === 'button') report('CHATGPT_SUBMITTED', 'prompt submitted using ChatGPT Send button');
      else if (method === 'form-button') report('CHATGPT_SUBMITTED', 'prompt submitted using ChatGPT composer submit button');
      else if (method === 'form') report('CHATGPT_SUBMITTED', 'prompt submitted using ChatGPT composer form');
      else if (method === 'keyboard-attempt') report('CHATGPT_DIAGNOSTIC', 'Send button unavailable; keyboard submit attempted but not confirmed');
      else report('CHATGPT_DIAGNOSTIC', 'ChatGPT Send button, form, and composer were unavailable');
      setTimeout(verifySubmission, 2500);
    }, 700);

    sendResponse({ ok: true, baselineCount: state.baseline.size });
    return true;
  });
})();