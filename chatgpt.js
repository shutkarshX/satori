(() => {
  window.__satoriChatGPTAdapterLoaded = true;

  const state = {
    requestId: 0,
    mode: 'text',
    baseline: new Set(),
    baselineNodes: new Set(),
    baselineAssistantSignatures: new Map(),
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
    const assistantMessages = [...document.querySelectorAll('[data-message-author-role="assistant"]')];
    if (assistantMessages.length) {
      return assistantMessages.filter((node) => clean(node.innerText || node.textContent).length > 0);
    }
    const fallback = [
      ...document.querySelectorAll('[data-testid*="conversation-turn" i] .markdown'),
      ...document.querySelectorAll('.markdown, article')
    ];
    return [...new Set(fallback)].filter((node) => {
      const text = clean(node.innerText || node.textContent);
      return text.length > 0 && !node.closest?.('[data-message-author-role="user"]');
    });
  };
  const snapshot = () => responseNodes().map((node) => {
    const text = clean(node.innerText || node.textContent);
    return { node, text, signature: signature(text) };
  });
  const candidateResponses = () => snapshot().filter((item) => {
    if (!state.baselineNodes.has(item.node)) return true;
    return state.baselineAssistantSignatures.get(item.node) !== item.signature;
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

    try {
      const selection = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(element);
      selection.removeAllRanges();
      selection.addRange(range);
      document.execCommand('delete', false, null);
      document.execCommand('insertText', false, text);
    } catch (_error) {}

    if (clean(element.innerText || element.textContent || '') !== clean(text)) {
      element.innerHTML = '';
      const p = document.createElement('p');
      p.textContent = text;
      element.appendChild(p);
    }

    try {
      element.dispatchEvent(new InputEvent('beforeinput', {
        bubbles: true,
        cancelable: true,
        inputType: 'insertText',
        data: text
      }));
    } catch (_e) {}
    try {
      element.dispatchEvent(new InputEvent('input', {
        bubbles: true,
        inputType: 'insertText',
        data: text
      }));
    } catch (_e) {
      element.dispatchEvent(new Event('input', { bubbles: true }));
    }
    element.dispatchEvent(new Event('change', { bubbles: true }));
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
    const currentUsers = userMessageNodes();
    const newUsers = currentUsers.filter((node) => !state.baselineUsers.has(node));

    // The DOM node identity is the authoritative signal. Prompt matching is
    // only a fallback because ChatGPT may render user text with extra wrappers,
    // hidden labels, or whitespace.
    if (newUsers.length > 0) return true;

    if (!prompt) return false;
    return currentUsers.some((node) => {
      if (state.baselineUsers.has(node)) return false;
      const text = clean(node.innerText || node.textContent || '');
      return text === prompt || text.includes(prompt.slice(0, Math.min(160, prompt.length)));
    });
  };

  const markSubmitted = (reason) => {
    if (!state.requestId || !state.awaitingUserSubmission || state.submitted) return;
    state.submitted = true;
    state.awaitingUserSubmission = false;
    state.lastSentAt = Date.now();
    report('CHATGPT_SUBMITTED', reason);
    report('CHATGPT_DIAGNOSTIC', `ChatGPT submission verified: ${reason}; user messages=${userMessageNodes().length}, assistant nodes=${responseNodes().length}, generating=${isGenerating()}`);
  };

  const verifySubmission = () => {
    if (!state.requestId || !state.awaitingUserSubmission) return;
    const hasAssistantResponse = candidateResponses().length > 0;
    const newUserMessage = hasSubmittedUserMessage();
    const composerCleared = !composerHasPrompt();
    const generating = isGenerating();

    if (hasAssistantResponse || newUserMessage) {
      markSubmitted('new turn detected in conversation');
      return;
    }
    if (composerCleared || generating) {
      markSubmitted(`ChatGPT accepted the submission (composerCleared=${composerCleared}, generating=${generating})`);
      return;
    }
    report('CHATGPT_DIAGNOSTIC', `submission still pending; user messages=${userMessageNodes().length}; composerFilled=${composerHasPrompt() ? 'yes' : 'no'}; generating=${generating}`);
  };

  document.addEventListener('keydown', (event) => {
    if (!state.requestId || !state.awaitingUserSubmission) return;
    if (!event.isTrusted || event.key !== 'Enter' || event.shiftKey || event.ctrlKey || event.altKey || event.metaKey) return;
    report('CHATGPT_DIAGNOSTIC', 'physical Enter detected in ChatGPT tab; waiting for ChatGPT to create the user message');
    setTimeout(verifySubmission, 250);
    setTimeout(verifySubmission, 700);
    setTimeout(verifySubmission, 1400);
  }, true);

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
    if (!code || code.trim().length < 15) return false;
    const openBraces = (code.match(/{/g) || []).length;
    const closeBraces = (code.match(/}/g) || []).length;
    if (openBraces > 0 && openBraces !== closeBraces) return false;
    return true;
  };
  const isGenerating = () => {
    // 1. ChatGPT shows a stop button (square) while generating
    const stopBtn = document.querySelector(
      'button[data-testid="stop-button"], ' +
      'button[aria-label*="Stop generating" i], ' +
      'button[aria-label*="Stop" i], ' +
      'button[title*="Stop" i]'
    );
    if (stopBtn && !stopBtn.disabled && stopBtn.offsetParent !== null) return true;

    // 2. ChatGPT shows streaming indicators (e.g. .result-streaming, pulsing dots)
    if (document.querySelector('.result-streaming, [class*="streaming"]')) return true;

    // 3. While generating, the send button is absent or disabled
    const sendButton = document.querySelector(
      'button[data-testid="send-button"], ' +
      'button[aria-label*="Send prompt" i], ' +
      'button[aria-label*="Send message" i]'
    );
    if (!sendButton || sendButton.disabled || sendButton.getAttribute('aria-disabled') === 'true') {
      // If we recently submitted (<45s) and send button is not ready, it's still processing
      if (Date.now() - state.lastSentAt < 45000) return true;
    }

    return false;
  };

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
    report('CHATGPT_RESPONSE', { text: final.text, code: code || final.text, capturedAt: Date.now() });
  };

  const clickSend = () => {
    const sendButton = [
      document.querySelector('button[data-testid="send-button"]'),
      document.querySelector('button[aria-label*="Send prompt" i]'),
      document.querySelector('button[aria-label*="Send message" i]'),
      document.querySelector('button[title*="Send" i]')
    ].find((button) => button && !button.disabled && button.getAttribute('aria-disabled') !== 'true' && button.offsetParent !== null);

    if (sendButton) {
      sendButton.click();
      return true;
    }
    const input = findInput();
    const form = input?.closest('form');
    if (form) {
      try {
        form.requestSubmit();
        return true;
      } catch (_e) {}
    }
    return false;
  };

  const attemptAutoSubmit = (retries = 20) => {
    if (state.submitted || !state.awaitingUserSubmission) return;
    if (clickSend()) {
      state.lastSentAt = Date.now();
      report('CHATGPT_SUBMITTED', 'auto-clicked ChatGPT send button');
      report('CHATGPT_DIAGNOSTIC', 'auto-clicked ChatGPT send button; waiting for submission confirmation');
      setTimeout(verifySubmission, 150);
      setTimeout(verifySubmission, 400);
      setTimeout(verifySubmission, 900);
      return;
    }
    if (retries > 0) {
      setTimeout(() => attemptAutoSubmit(retries - 1), 200);
    } else {
      report('CHATGPT_DIAGNOSTIC', 'auto-send button not ready yet; press Enter in assignment tab to submit');
    }
  };

  const confirmCodingResponse = () => {
    if (!state.requestId || state.mode !== 'coding') return;
    const latest = candidateResponses().at(-1);
    if (!latest || latest.signature === state.lastSignature) return;

    if (isGenerating()) {
      resetStability();
      return;
    }

    const code = extractCode(latest.text, latest.node);
    if (code && !looksComplete(code)) {
      resetStability();
      return;
    }

    // Only emit "Code not available" if the model has truly stopped and has written a substantial answer
    if (!code) {
      if (Date.now() - state.lastSentAt < 12000) {
        // Less than 12s since send, model might still be preparing the response
        return;
      }
    }

    const finalCode = code || 'Code not available';
    emitStableResponse(latest, finalCode);
  };

  const inspect = () => {
    if (!state.requestId || !state.submitted || Date.now() < state.lastSentAt) return;
    const latest = candidateResponses().at(-1);
    if (!latest || latest.signature === state.lastSignature) return;

    if (isGenerating()) {
      resetStability();
      return;
    }

    clearTimeout(state.quietTimer);
    state.quietTimer = setTimeout(() => {
      if (isGenerating()) {
        resetStability();
        return;
      }

      const final = candidateResponses().at(-1);
      if (!final || final.signature === state.lastSignature) return;

      if (state.mode === 'coding') {
        confirmCodingResponse();
        return;
      }

      state.lastSignature = final.signature;
      clearInterval(state.responsePollTimer);
      state.responsePollTimer = null;
      report('CHATGPT_RESPONSE', { text: final.text, code: extractCode(final.text, final.node), capturedAt: Date.now() });
    }, 450);
  };

  new MutationObserver(inspect).observe(document.documentElement, { childList: true, subtree: true, characterData: true });

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message.type === 'PING_CHATGPT') {
      sendResponse({ ok: true, input: Boolean(findInput()), responses: responseNodes().length });
      return true;
    }

    if (message.type === 'SUBMIT_CHATGPT_PROMPT') {
      const input = findInput();
      const hasPrompt = composerHasPrompt();
      const form = input?.closest('form');
      if (!input) {
        sendResponse({ ok: false, error: 'ChatGPT composer input was not found.' });
        return true;
      }
      if (!hasPrompt) {
        sendResponse({ ok: false, error: 'ChatGPT composer is empty.' });
        return true;
      }

      if (clickSend()) {
        state.lastSentAt = Date.now();
        report('CHATGPT_DIAGNOSTIC', 'assignment-tab Enter triggered ChatGPT submission; verifying new user message');
        setTimeout(verifySubmission, 250);
        setTimeout(verifySubmission, 700);
        setTimeout(verifySubmission, 1400);
        sendResponse({ ok: true });
        return true;
      } else {
        sendResponse({ ok: false, error: 'ChatGPT composer could not be submitted.' });
        return true;
      }
    }

    if (message.type !== 'FILL_CHATGPT_PROMPT') return;

    const input = findInput();
    if (!input) {
      report('CHATGPT_DIAGNOSTIC', 'composer not found');
      sendResponse({ ok: false, error: 'ChatGPT composer is not ready yet.' });
      return true;
    }

    state.requestId = message.requestId || Date.now();
    state.mode = message.mode || 'text';
    state.promptText = String(message.prompt || '');
    const baselineSnapshot = snapshot();
    state.baseline = new Set(baselineSnapshot.map((item) => item.signature));
    state.baselineNodes = new Set(baselineSnapshot.map((item) => item.node));
    state.baselineAssistantSignatures = new Map(baselineSnapshot.map((item) => [item.node, item.signature]));
    state.baselineUsers = new Set(userMessageNodes());
    state.lastSignature = '';
    resetStability();
    state.lastSentAt = 0;
    state.awaitingUserSubmission = true;
    state.submitted = false;
    clearTimeout(state.quietTimer);
    setInput(input, message.prompt || '');
    setTimeout(() => attemptAutoSubmit(20), 80);

    state.startTime = Date.now();
    clearInterval(state.responsePollTimer);
    state.responsePollTimer = setInterval(() => {
      if (!state.requestId) {
        clearInterval(state.responsePollTimer);
        state.responsePollTimer = null;
        return;
      }
      if (state.awaitingUserSubmission) verifySubmission();
      inspect();

      if (Date.now() - state.startTime > 60000 && !isGenerating()) {
        clearInterval(state.responsePollTimer);
        state.responsePollTimer = null;
        const latest = candidateResponses().at(-1);
        const code = latest ? extractCode(latest.text, latest.node) : '';
        const fallback = state.mode === 'coding' ? (code || 'Code not available') : (latest?.text || 'No response captured');
        emitStableResponse(latest || { text: fallback, signature: 'timeout' }, fallback);
      }
    }, 350);

    const currentInput = findInput();
    const inputText = currentInput
      ? (currentInput.matches('textarea, input')
        ? currentInput.value
        : clean(currentInput.innerText || currentInput.textContent || ''))
      : '';
    report('CHATGPT_DIAGNOSTIC', `composer ready: ${currentInput?.id || currentInput?.getAttribute('data-testid') || currentInput?.tagName || 'none'}; text=${inputText.length}; auto-submitting...`);

    sendResponse({ ok: true, baselineCount: state.baseline.size, awaitingUserSubmission: true });
    return true;
  });
})();