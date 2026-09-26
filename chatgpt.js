(() => {
  window.__satoriChatGPTAdapterLoaded = true;

  const state = {
    requestId: 0,
    mode: 'text',
    baseline: new Set(),
    baselineCode: new Set(),
    baselineCount: 0,
    lastSentAt: 0,
    lastSignature: '',
    quietTimer: null
  };

  const clean = (value) => String(value || '')
    .replace(/\u00a0/g, ' ')
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .trim();

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

  const responseSnapshot = () => responseNodes().map((node) => {
    const text = nodeText(node);
    return { node, text, signature: signature(text) };
  });

  const candidateResponses = () => {
    const current = responseSnapshot();
    const newItems = current.filter((item) => !state.baseline.has(item.signature));
    if (newItems.length > 0) return newItems;
    return current;
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
      const proto = element.tagName.toLowerCase() === 'textarea' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
      if (setter) setter.call(element, text); else element.value = text;
      element.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
      element.dispatchEvent(new Event('change', { bubbles: true }));
      return;
    }

    // contenteditable (Lexical editor in modern ChatGPT)
    try {
      element.focus();
      document.execCommand('selectAll', false, null);
      document.execCommand('insertText', false, text);
    } catch (_e) {}

    if (!clean(nodeText(element)).includes(clean(text).slice(0, 30))) {
      let p = element.querySelector('p');
      if (!p) {
        p = document.createElement('p');
        element.appendChild(p);
      }
      p.textContent = text;
    }

    try {
      element.dispatchEvent(new InputEvent('beforeinput', { bubbles: true, cancelable: true, inputType: 'insertText', data: text }));
    } catch (_e) {}
    try {
      element.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
    } catch (_e) {
      element.dispatchEvent(new Event('input', { bubbles: true }));
    }
    element.dispatchEvent(new Event('change', { bubbles: true }));
  };

  const clickSend = () => {
    const input = findInput();
    const sendButton = [
      document.querySelector('button[data-testid="send-button"]'),
      document.querySelector('button[data-testid="fruitjuice-send-button"]'),
      document.querySelector('button[aria-label*="Send" i]'),
      document.querySelector('button[title*="Send" i]')
    ].find((btn) => btn && !btn.disabled && btn.getAttribute('aria-disabled') !== 'true');

    if (sendButton) {
      try {
        sendButton.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true }));
        sendButton.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
        sendButton.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true }));
        sendButton.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
        sendButton.click();
        return true;
      } catch (_e) {}
    }

    const form = input?.closest('form');
    if (form) {
      try { form.requestSubmit(); return true; } catch (_e) {}
    }

    if (input) {
      try {
        input.focus();
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true }));
        return true;
      } catch (_e) {}
    }

    return false;
  };

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
    const buttons = [...document.querySelectorAll('button')];
    const hasStopButton = buttons.some((button) => {
      if (button.disabled) return false;
      const label = `${button.getAttribute('data-testid') || ''} ${button.getAttribute('aria-label') || ''} ${button.getAttribute('title') || ''} ${button.innerText || ''}`;
      return /\bstop\b/i.test(label);
    });
    if (hasStopButton) return true;
    if (document.querySelector('.result-streaming, [class*="streaming" i]')) return true;
    return false;
  };

  const inspectForNewResponse = () => {
    if (!state.requestId || Date.now() < state.lastSentAt) return;
    const candidates = candidateResponses();
    const latest = candidates[candidates.length - 1];
    if (!latest || latest.signature === state.lastSignature) return;

    clearTimeout(state.quietTimer);
    state.quietTimer = setTimeout(() => {
      if (isGenerating()) {
        report('CHATGPT_DIAGNOSTIC', 'ChatGPT generation still in progress; waiting for completion');
        inspectForNewResponse();
        return;
      }

      const current = candidateResponses();
      const final = current[current.length - 1] || latest;
      if (!final || final.signature === state.lastSignature) return;

      const code = extractCode(final.text, final.node);

      if (state.mode === 'coding' && !code && Date.now() - state.lastSentAt < 12000) {
        report('CHATGPT_DIAGNOSTIC', 'generation quiet; waiting for code block');
        inspectForNewResponse();
        return;
      }

      state.lastSignature = final.signature;
      const finalCode = code || final.text;
      report('CHATGPT_RESPONSE', {
        text: final.text,
        code: finalCode,
        capturedAt: Date.now()
      });
    }, 800);
  };

  new MutationObserver(inspectForNewResponse).observe(document.documentElement, {
    childList: true, subtree: true, characterData: true
  });

  const checkExistingResponse = (prompt, mode) => {
    const cleanPrompt = clean(prompt);
    const users = [...document.querySelectorAll('[data-message-author-role="user"], [data-testid*="user" i]')];
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

      if (message.type !== 'FILL_CHATGPT_PROMPT') return false;

      const input = findInput();
      if (!input) {
        report('CHATGPT_DIAGNOSTIC', 'composer input not found');
        sendResponse({ ok: false, error: 'ChatGPT composer input not found.' });
        return true;
      }

      state.requestId = message.requestId || Date.now();
      state.mode = message.mode || 'text';
      state.baseline = new Set(responseSnapshot().map((item) => item.signature));
      state.baselineCode = new Set(
        [...document.querySelectorAll('pre code, pre, code-block, [class*="code-block" i], [class*="codeBlock" i], [data-code-block], [data-testid*="code" i]')]
          .map((element) => normalizeSource(nodeText(element)))
          .filter((text) => text.length > 20)
          .map(signature)
      );
      state.baselineCount = state.baseline.size;
      state.lastSignature = '';
      state.lastSentAt = Date.now();
      clearTimeout(state.quietTimer);

      setInput(input, message.prompt || '');

      setTimeout(() => {
        if (clickSend()) {
          report('CHATGPT_SUBMITTED', `prompt submitted; baseline responses=${state.baselineCount}`);
        } else {
          setTimeout(() => {
            if (clickSend()) report('CHATGPT_SUBMITTED', `prompt submitted on retry; baseline responses=${state.baselineCount}`);
            else report('CHATGPT_DIAGNOSTIC', 'send button not ready or disabled');
          }, 400);
        }
      }, 500);

      sendResponse({ ok: true, baselineCount: state.baselineCount });
      return true;
    } catch (err) {
      report('CHATGPT_DIAGNOSTIC', `adapter error: ${err.message}`);
      sendResponse({ ok: false, error: err.message });
      return true;
    }
  });
})();