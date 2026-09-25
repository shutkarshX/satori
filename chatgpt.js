(() => {
  // Marker used by the background service to verify that an injected adapter
  // survived page loading before sending the request.
  window.__satoriChatGPTAdapterLoaded = true;

  const state = {
    requestId: 0,
    mode: 'text',
    baseline: new Set(),
    baselineUsers: new Set(),
    lastSentAt: 0,
    lastSignature: '',
    pendingSignature: '',
    stableSignature: '',
    stableChecks: 0,
    quietTimer: null,
    stabilityTimer: null,
    responsePollTimer: null,
    promptText: '',
    awaitingUserSubmission: false,
    submitted: false
  };
  const clean = (value) => String(value || '').replace(/\u00a0/g, ' ').replace(/\r\n?/g, '\n').replace(/[ \t]+\n/g, '\n').trim();
  const normalizeSource = (value) => clean(value)
    .replace(/^(?:C\+\+|C#|C|Java|Python|JavaScript|TypeScript)\s*(?=(?:#include|import\s|package\s|public\s+class|class\s+|def\s+|function\s))/i, '')
    .replace(/^(?:C\+\+|C#|C|Java|Python|JavaScript|TypeScript)\s*\n(?=(?:#include|import\s|package\s|public\s+class|class\s+|def\s+|function\s))/i, '')
    .trim();
  const signature = (text) => `${text.length}:${text.slice(0, 80)}:${text.slice(-120)}`;
  const responseNodes = () => {
    const nodes = [
      ...document.querySelectorAll('[data-message-author-role="assistant"]'),
      ...document.querySelectorAll('[data-testid*="conversation-turn" i] .markdown'),
      ...document.querySelectorAll('.markdown, article')
    ];
    return [...new Set(nodes)].filter((node) => {
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
  const findInput = () => document.querySelector(
    '#prompt-textarea, textarea[data-id], textarea[placeholder], textarea, ' +
    '[contenteditable="true"][data-lexical-editor="true"], ' +
    '[contenteditable="true"][role="textbox"], [contenteditable="true"]'
  );
  const setInput = (element, text) => {
    element.focus();

    if (element.matches('textarea, input')) {
      // Prefer a browser editing operation for ChatGPT's React-controlled
      // textarea. This updates the DOM and fires the input path that React
      // uses to enable the Send control. Fall back to the native setter.
      let edited = false;
      try {
        element.focus();
        element.select();
        edited = document.execCommand('insertText', false, text);
      } catch (_error) {}

      if (!edited || clean(element.value || '') !== clean(text)) {
        const proto = element.tagName.toLowerCase() === 'textarea'
          ? HTMLTextAreaElement.prototype
          : HTMLInputElement.prototype;
        const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
        if (setter) setter.call(element, text);
        else element.value = text;
      }

      try {
        element.dispatchEvent(new InputEvent('beforeinput', {
          bubbles: true,
          cancelable: true,
          inputType: 'insertText',
          data: text
        }));
      } catch (_error) {}
      try {
        element.dispatchEvent(new InputEvent('input', {
          bubbles: true,
          inputType: 'insertText',
          data: text
        }));
      } catch (_error) {
        element.dispatchEvent(new Event('input', { bubbles: true }));
      }
      element.dispatchEvent(new Event('change', { bubbles: true }));
      return;
    }

    // ChatGPT's rich composer is a React-controlled contenteditable.
    // Mutating textContent alone can leave React's composer state empty,
    // which keeps the Send button disabled. Use the browser editing
    // command first so the page receives a real input mutation.
    try {
      document.execCommand('selectAll', false, null);
      document.execCommand('insertText', false, text);
    } catch (_error) {}

    if (clean(element.innerText || element.textContent || '') !== clean(text)) {
      element.textContent = text;
    }

    element.dispatchEvent(new InputEvent('beforeinput', {
      bubbles: true,
      cancelable: true,
      inputType: 'insertText',
      data: text
    }));
    element.dispatchEvent(new InputEvent('input', {
      bubbles: true,
      inputType: 'insertText',
      data: text
    }));
  };
  const findSendButton = () => {
    const input = findInput();
    const composer = input?.closest('form');
    const scopedSelectors = [
      'button[data-testid="send-button"]',
      'button[aria-label*="send" i]',
      'button[type="submit"]'
    ];
    const scoped = composer
      ? scopedSelectors.flatMap((selector) => [...composer.querySelectorAll(selector)])
      : [];
    const candidates = scoped.length ? scoped : [
      ...document.querySelectorAll('button[data-testid="send-button"]'),
      ...document.querySelectorAll('button[data-testid*="send" i]'),
      ...document.querySelectorAll('button[aria-label*="send" i]'),
      ...document.querySelectorAll('button[title*="send" i]')
    ];
    return candidates.find((candidate) =>
      !candidate.disabled &&
      candidate.getAttribute('aria-disabled') !== 'true' &&
      candidate.offsetParent !== null &&
      !/stop|cancel/i.test(`${candidate.getAttribute('aria-label') || ''} ${candidate.innerText || ''}`)
    ) || null;
  };

  const composerHasPrompt = () => {
    const input = findInput();
    if (!input) return false;
    const value = input.matches('textarea, input')
      ? input.value
      : clean(input.innerText || input.textContent || '');
    return state.promptText.length > 0 && value.trim().length > 0;
  };

  const userMessageNodes = () => [...document.querySelectorAll('[data-message-author-role="user"]')];

  const hasSubmittedUserMessage = () => {
    const prompt = clean(state.promptText);
    if (!prompt) return false;
    return userMessageNodes().some((node) => {
      const text = clean(node.innerText || node.textContent || '');
      const nodeSignature = signature(text);
      if (state.baselineUsers.has(nodeSignature)) return false;
      return text === prompt || text.includes(prompt.slice(0, Math.min(160, prompt.length)));
    });
  };

  const waitForPhysicalSubmission = () => {
    if (!state.requestId || !state.awaitingUserSubmission) return;
    if (hasSubmittedUserMessage()) {
      state.submitted = true;
      state.awaitingUserSubmission = false;
      state.lastSentAt = Date.now();
      report('CHATGPT_SUBMITTED', 'physical Enter submission verified by new user message');
      report('CHATGPT_DIAGNOSTIC', `physical submission verified; assistant nodes=${responseNodes().length}, generating=${isGenerating()}`);
    }
  };

  // Observe only the user's real key press. Never synthesize Enter or click Send.
  document.addEventListener('keydown', (event) => {
    if (!state.requestId || !state.awaitingUserSubmission) return;
    if (!event.isTrusted || event.key !== 'Enter' || event.shiftKey || event.ctrlKey || event.altKey || event.metaKey) return;
    if (!composerHasPrompt()) return;
    state.lastSentAt = Date.now();
    report('CHATGPT_DIAGNOSTIC', 'physical Enter detected in ChatGPT composer; waiting for ChatGPT to create the user message');
    setTimeout(waitForPhysicalSubmission, 250);
    setTimeout(waitForPhysicalSubmission, 700);
    setTimeout(waitForPhysicalSubmission, 1400);
  }, true);

  
    const input = findInput();
    if (!input) return false;
    const value = input.matches('textarea, input')
      ? input.value
      : clean(input.innerText || input.textContent || '');
    return state.promptText.length > 0 && value.trim().length > 0;
  };

  const userMessageNodes = () => [...document.querySelectorAll('[data-message-author-role="user"]')];

  const hasSubmittedUserMessage = () => {
    const prompt = clean(state.promptText);
    if (!prompt) return false;
    return userMessageNodes().some((node) => {
      const text = clean(node.innerText || node.textContent || '');
      const nodeSignature = signature(text);
      if (state.baselineUsers.has(nodeSignature)) return false;
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
      const composerStillHasPrompt = composerHasPrompt();
      report('CHATGPT_DIAGNOSTIC', `prompt not visible as a user message after submit; retry ${attempt + 1}/3; composer=${composerStillHasPrompt ? 'has prompt' : 'cleared'}; assistant nodes=${responseNodes().length}; generating=${isGenerating()}`);
      setTimeout(() => {
        if (!hasSubmittedUserMessage()) {
          if (composerHasPrompt()) {
            const method = clickSend();
            report('CHATGPT_DIAGNOSTIC', method === 'button'
              ? 'Enter did not submit; Send button fallback clicked'
              : method === 'keyboard-attempt'
                ? 'Enter retry attempted again'
                : 'composer unavailable during submission retry');
          } else if (responseNodes().length > state.baseline.size || isGenerating()) {
            report('CHATGPT_DIAGNOSTIC', 'composer cleared/new generation detected; treating submission as accepted');
            return;
          }
        }
        verifySubmission(attempt + 1);
      }, 1200);
      return;
    }

    if (composerHasPrompt()) {
      const method = clickSend();
      report('CHATGPT_DIAGNOSTIC', method === 'button'
        ? 'final verification failed; Send button fallback clicked'
        : 'final verification failed; no Send button available');
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
    clearInterval(state.responsePollTimer);
    state.responsePollTimer = null;
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
      clearInterval(state.responsePollTimer);
      state.responsePollTimer = null;
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
    state.baselineUsers = new Set(userMessageNodes().map((node) => signature(clean(node.innerText || node.textContent || ''))));
    state.lastSignature = '';
    resetStability();
    state.lastSentAt = Date.now();
    clearTimeout(state.quietTimer);
    setInput(input, message.prompt || '');

    clearInterval(state.responsePollTimer);
    state.responsePollTimer = setInterval(() => {
      if (!state.requestId || Date.now() - state.lastSentAt > 45000) {
        clearInterval(state.responsePollTimer);
        state.responsePollTimer = null;
        return;
      }
      inspect();
    }, 800);

    const currentInput = findInput();
    const inputText = currentInput
      ? (currentInput.matches('textarea, input')
        ? currentInput.value
        : clean(currentInput.innerText || currentInput.textContent || ''))
      : '';
    report('CHATGPT_DIAGNOSTIC', `composer ready: ${currentInput?.id || currentInput?.getAttribute('data-testid') || currentInput?.tagName || 'none'}; text=${inputText.length}; send=${findSendButton() ? 'available' : 'none'}`);
    report('CHATGPT_DIAGNOSTIC', 'prompt ready in the existing ChatGPT tab — press Enter to submit');

    sendResponse({ ok: true, baselineCount: state.baseline.size, awaitingUserSubmission: true });
    return true;
  });
})();