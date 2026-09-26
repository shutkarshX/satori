(() => {
  window.__satoriChatGPTAdapterLoaded = true;

  const state = {
    requestId: 0,
    mode: 'text',
    baseline: new Set(),
    baselineCode: new Set(),
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
  const nodeText = (el) => {
    if (!el) return '';
    const inner = clean(el.innerText || '');
    const text = clean(el.textContent || '');
    return (inner.length >= text.length * 0.5) ? inner : text;
  };
  const normalizeSource = (value) => clean(value)
    .replace(/^(?:C\+\+|C#|C|Java|Python|JavaScript|TypeScript)\s*(?=(?:#include|import\s|package\s|public\s+class|class\s+|def\s+|function\s))/i, '')
    .replace(/^(?:C\+\+|C#|C|Java|Python|JavaScript|TypeScript)\s*\n(?=(?:#include|import\s|package\s|public\s+class|class\s+|def\s+|function\s))/i, '')
    .replace(/^Copy\s*code\s*\n?/i, '')
    .replace(/^(?:C\+\+|C#|C|Java|Python|JavaScript|TypeScript)\s*\nCopy\s*code\s*\n?/i, '')
    .trim();
  const signature = (text) => `${text.length}:${text.slice(0, 80)}:${text.slice(-120)}`;
  const responseNodes = () => {
    const list = [...document.querySelectorAll('[data-message-author-role="assistant"]')];
    if (list.length) {
      return list.filter((node) => nodeText(node).length > 0);
    }
    const fallback = [
      ...document.querySelectorAll('[data-testid*="conversation-turn" i] .markdown'),
      ...document.querySelectorAll('article .markdown'),
      ...document.querySelectorAll('.markdown, article')
    ];
    return [...new Set(fallback)].filter((node) => {
      const text = nodeText(node);
      return text.length > 0 && !node.closest?.('[data-message-author-role="user"]');
    });
  };
  const snapshot = () => responseNodes().map((node) => {
    const text = nodeText(node);
    return { node, text, signature: signature(text) };
  });
  const candidateResponses = () => {
    const current = snapshot();
    const newItems = current.filter((item) => !state.baseline.has(item.signature));
    if (newItems.length > 0) return newItems;
    return current.filter((item) => {
      if (!state.baselineNodes.has(item.node)) return true;
      return state.baselineAssistantSignatures.get(item.node) !== item.signature;
    });
  };
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

    // contenteditable (e.g. Lexical in modern ChatGPT)
    try {
      const selection = window.getSelection();
      if (selection && selection.rangeCount > 0) {
        const range = document.createRange();
        range.selectNodeContents(element);
        selection.removeAllRanges();
        selection.addRange(range);
        document.execCommand('delete', false, null);
      }
      document.execCommand('insertText', false, text);
    } catch (_error) {}

    if (!clean(element.innerText || element.textContent || '').includes(clean(text).slice(0, 30))) {
      let p = element.querySelector('p');
      if (!p) {
        p = document.createElement('p');
        element.appendChild(p);
      }
      p.textContent = text;
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
    const codeScore = (value, distance = 0) =>
      (/#include|\bint\s+main\s*\(|public\s+class\s+Main|\bdef\s+main\s*\(|import\s+java\b/.test(value) ? 100 : 0) +
      (/[{}();]|\breturn\b|\bfor\s*\(|\bwhile\s*\(/.test(value) ? 30 : 0) +
      Math.min(value.length / 1000, 20) - distance;

    // 1. Check Copy buttons anywhere in assistant message or document
    const copyAnchored = [];
    const allButtons = [...(node?.querySelectorAll?.('button') || []), ...document.querySelectorAll('button')];
    const copyButtons = allButtons.filter((button) =>
      /copy/i.test(`${button.getAttribute('aria-label') || ''} ${button.getAttribute('title') || ''} ${button.innerText || ''} ${button.textContent || ''}`)
    );

    copyButtons.forEach((button) => {
      let current = button.parentElement;
      for (let distance = 1; current && distance <= 8; distance += 1, current = current.parentElement) {
        const descendants = [...current.querySelectorAll('pre, code, code-block, [class*="code" i], [data-code-block]')]
          .map((element) => normalizeSource(nodeText(element)))
          .filter((value) => value.length > 20 && !state.baselineCode.has(signature(value)));
        descendants.forEach((value) => copyAnchored.push({ value, score: codeScore(value, distance) + 120 }));

        const containerText = normalizeSource(nodeText(current))
          .replace(/^\s*copy\s*(?:code)?\s*$/gim, '').trim();
        if (!descendants.length && containerText.length > 40 &&
          /#include|\bpublic\s+class\s+Main\b|\bclass\s+Main\b|\bint\s+main\s*\(|\bstatic\s+void\s+main\b|\bdef\s+main\s*\(/i.test(containerText) &&
          !state.baselineCode.has(signature(containerText))) {
          copyAnchored.push({ value: containerText, score: codeScore(containerText, distance) + 100 });
        }
        if (descendants.length) break;
      }
    });

    const anchored = copyAnchored.sort((a, b) => b.score - a.score)[0]?.value || '';
    if (anchored) return anchored;

    // 2. Fenced Markdown ```code``` blocks
    const fenced = [...text.matchAll(/```(?:[A-Za-z0-9_+#.-]+)?\s*\n?([\s\S]*?)```/g)]
      .map((match) => normalizeSource(match[1]))
      .filter((value) => value.length > 20 && !state.baselineCode.has(signature(value)));
    if (fenced.length) return fenced.sort((a, b) => b.length - a.length)[0];

    // 3. DOM code elements (pre, code, code-block, etc.)
    const selectors = 'pre code, pre, code-block, [class*="code-block" i], [class*="codeBlock" i], [data-code-block], [data-testid*="code" i]';
    const elements = [...(node?.querySelectorAll?.(selectors) || []), ...document.querySelectorAll(selectors)];
    const domCode = elements
      .map((element, index) => ({
        text: normalizeSource(nodeText(element)),
        index,
        score: 0
      }))
      .filter((candidate) => candidate.text.length > 20 && !state.baselineCode.has(signature(candidate.text)))
      .map((candidate) => ({
        ...candidate,
        score: codeScore(candidate.text, candidate.index)
      }));

    const bestDom = domCode.sort((a, b) => b.score - a.score || b.index - a.index)[0]?.text || '';
    if (bestDom) return bestDom;

    // 4. Direct text extraction fallback: If the assistant output has C/Java/Python code embedded directly in the text
    if (/#include|\bpublic\s+class\s+Main\b|\bint\s+main\s*\(|\bdef\s+main\s*\(/i.test(text)) {
      const match = text.match(/(?:#include[\s\S]*|public\s+class\s+Main[\s\S]*|import\s+java[\s\S]*|def\s+[\s\S]*)/);
      if (match) {
        const rawCode = match[0].split(/\n\s*(?:Explanation|Output format|Sample test|Note|Time Complexity):/i)[0];
        const normalized = normalizeSource(rawCode);
        if (normalized.length > 30) return normalized;
      }
    }

    return '';
  };

  const isGenerating = () => {
    // 1. ChatGPT shows a stop button while generating
    const buttons = [...document.querySelectorAll('button')];
    const hasStopButton = buttons.some((button) => {
      if (button.disabled) return false;
      const label = `${button.getAttribute('data-testid') || ''} ${button.getAttribute('aria-label') || ''} ${button.getAttribute('title') || ''} ${button.innerText || ''}`;
      return /\bstop\b/i.test(label);
    });
    if (hasStopButton) return true;

    // 2. Streaming indicators or active generation classes
    if (document.querySelector('.result-streaming, [class*="streaming" i]')) return true;

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
    ].find((button) => button && !button.disabled && button.getAttribute('aria-disabled') !== 'true');

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
      setTimeout(verifySubmission, 100);
      setTimeout(verifySubmission, 300);
      setTimeout(verifySubmission, 700);
      return;
    }
    if (retries > 0) {
      setTimeout(() => attemptAutoSubmit(retries - 1), 80);
    } else {
      report('CHATGPT_DIAGNOSTIC', 'auto-send button not ready yet; press Enter in assignment tab to submit');
    }
  };

  const inspect = () => {
    if (!state.requestId || !state.submitted || Date.now() < state.lastSentAt) return;
    const candidates = candidateResponses();
    const latest = candidates[candidates.length - 1];
    if (!latest || latest.signature === state.lastSignature) return;

    clearTimeout(state.quietTimer);
    state.quietTimer = setTimeout(() => {
      if (isGenerating()) {
        report('CHATGPT_DIAGNOSTIC', 'ChatGPT generation still in progress; waiting for completion');
        inspect();
        return;
      }

      const current = candidateResponses();
      const final = current[current.length - 1] || latest;
      if (!final) return;

      const code = extractCode(final.text, final.node);

      // In coding mode, if model has not written the code block yet, wait briefly for code output
      if (state.mode === 'coding' && !code) {
        if (Date.now() - state.lastSentAt < 10000) {
          report('CHATGPT_DIAGNOSTIC', 'generation quiet but code block not found yet; waiting for code');
          inspect();
          return;
        }
      }

      if (final.signature === state.lastSignature) return;

      const finalCode = state.mode === 'coding' ? (code || 'Code not available') : (code || final.text);
      report('CHATGPT_DIAGNOSTIC', `Response captured: text=${final.text.length} chars, code=${finalCode.length} chars`);
      emitStableResponse(final, finalCode);
    }, 400);
  };

  new MutationObserver(inspect).observe(document.documentElement, { childList: true, subtree: true, characterData: true });

  const checkExistingResponse = (prompt, mode) => {
    const cleanPrompt = clean(prompt);
    const users = userMessageNodes();
    const latestUser = users[users.length - 1];

    let isMatch = false;
    if (latestUser) {
      const userText = clean(nodeText(latestUser));
      const promptSnippet = cleanPrompt.slice(0, 100);
      const problemMatch = cleanPrompt.match(/Problem Statement[\s\S]*?(?=\n\s*(?:Input format|Output format|Sample test|Constraints|Note))/i);
      const problemSnippet = problemMatch ? clean(problemMatch[0]).slice(0, 80) : '';

      isMatch = (promptSnippet && userText.includes(promptSnippet)) ||
                (problemSnippet && userText.includes(problemSnippet)) ||
                (userText.length > 40 && cleanPrompt.includes(userText.slice(0, 80)));
    } else {
      const pageText = clean(document.body.innerText || '');
      const problemMatch = cleanPrompt.match(/Problem Statement[\s\S]*?(?=\n\s*(?:Input format|Output format|Sample test|Constraints|Note))/i);
      if (problemMatch && pageText.includes(clean(problemMatch[0]).slice(0, 80))) {
        isMatch = true;
      }
    }

    if (!isMatch) return null;

    if (isGenerating()) {
      return { generating: true };
    }

    const responses = responseNodes();
    const latestAssistant = responses[responses.length - 1];
    if (!latestAssistant) return null;

    const assistantText = nodeText(latestAssistant);
    const code = extractCode(assistantText, latestAssistant);

    if (mode === 'coding' && (!code || code === 'Code not available')) {
      return null;
    }

    return {
      text: assistantText,
      code: mode === 'coding' ? code : (code || assistantText)
    };
  };

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    try {
      if (message.type === 'PING_CHATGPT') {
        sendResponse({ ok: true, input: Boolean(findInput()), responses: responseNodes().length });
        return true;
      }

      if (message.type === 'CHECK_EXISTING_RESPONSE') {
        const existing = checkExistingResponse(message.prompt, message.mode);
        if (existing) {
          sendResponse({ ok: true, existing });
          return true;
        }
        sendResponse({ ok: false });
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

      if (message.type !== 'FILL_CHATGPT_PROMPT') return false;

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
      state.baselineCode = new Set(
        [...document.querySelectorAll('pre code, pre, code-block, [class*="code-block" i], [class*="codeBlock" i], [data-code-block], [data-testid*="code" i]')]
          .map((element) => normalizeSource(nodeText(element)))
          .filter((text) => text.length > 20)
          .map(signature)
      );
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
      setTimeout(() => attemptAutoSubmit(20), 30);

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

        if (Date.now() - state.startTime > 75000 && !isGenerating()) {
          clearInterval(state.responsePollTimer);
          state.responsePollTimer = null;
          const candidates = candidateResponses();
          const latest = candidates[candidates.length - 1];
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
    } catch (err) {
      report('CHATGPT_DIAGNOSTIC', `adapter error in onMessage: ${err.message}`);
      sendResponse({ ok: false, error: err.message });
      return true;
    }
  });
})();