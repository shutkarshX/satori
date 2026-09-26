(() => {
  const state = {
    requestId: 0,
    baseline: new Set(),
    baselineCode: new Set(),
    baselineCount: 0,
    lastSentAt: 0,
    lastResponseSignature: '',
    quietTimer: null
  };

  const clean = (value) => String(value || '')
    .replace(/\u00a0/g, ' ')
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .trim();

  const normalizeSource = (value) => clean(value)
    .replace(/^(?:C\+\+|C#|C|Java|Python|JavaScript|TypeScript)\s*(?=(?:#include|import\s|package\s|public\s+class|class\s+|def\s+|function\s))/i, '')
    .replace(/^(?:C\+\+|C#|C|Java|Python|JavaScript|TypeScript)\s*\n(?=(?:#include|import\s|package\s|public\s+class|class\s+|def\s+|function\s))/i, '')
    .trim();

  const responseNodes = () => {
    const primary = [...document.querySelectorAll(
      'model-response, message-content, [data-message-author-role="model"], [data-testid*="model" i], [data-test-id*="model" i], .model-response-text, .response-container'
    )];
    const list = primary.length ? primary : [
      ...document.querySelectorAll('.conversation-container .model-response, [class*="model-response" i], [class*="response-content" i]')
    ];
    return list.filter((node) => {
      const text = clean(node.innerText || node.textContent);
      const userAncestor = node.closest?.('[data-message-author-role="user"], [data-message-author-role="human"], [data-author="user"]');
      return text.length > 0 && !userAncestor && !/^You said\b|^You asked\b/i.test(text);
    });
  };

  const nodeText = (node) => clean(node.innerText || node.textContent || '');
  const signature = (text) => `${text.length}:${text.slice(0, 80)}:${text.slice(-120)}`;
  const responseSnapshot = () => responseNodes().map((node) => {
    const text = nodeText(node);
    return { node, text, signature: signature(text) };
  });

  const report = (type, detail) => {
    try { chrome.runtime.sendMessage({ type, requestId: state.requestId, detail }); } catch (_error) { /* extension may be reloading */ }
  };

  const findInput = () => document.querySelector(
    'rich-textarea [contenteditable="true"], [contenteditable="true"][role="textbox"], textarea[placeholder], textarea, [contenteditable="true"]'
  );

  const setInput = (element, text) => {
    element.focus();
    if (element.matches('textarea, input')) {
      const proto = element.tagName.toLowerCase() === 'textarea' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
      if (setter) setter.call(element, text); else element.value = text;
    } else {
      element.textContent = text;
    }
    element.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
  };

  const clickSend = () => {
    const buttons = [...document.querySelectorAll(
      'button[aria-label*="Send" i], button[aria-label*="send" i], button[data-testid*="send" i], button[mattooltip*="Send" i], .send-button'
    )];
    const button = buttons.find((candidate) => !candidate.disabled && candidate.getAttribute('aria-disabled') !== 'true');
    if (button) { button.click(); return true; }
    // Fallback: send Enter key event to input
    const input = findInput();
    if (input) {
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
      return true;
    }
    return false;
  };

  const extractCode = (text, node) => {
    const codeScore = (value, distance = 0) =>
      (/#include|\bint\s+main\s*\(|public\s+class\s+Main|\bdef\s+main\s*\(|import\s+java\b/.test(value) ? 100 : 0) +
      (/[{}();]|\breturn\b|\bfor\s*\(|\bwhile\s*\(/.test(value) ? 30 : 0) +
      Math.min(value.length / 1000, 20) - distance;
    const copyAnchored = [];
    const copyButtons = [...document.querySelectorAll(
      'button[aria-label*="copy" i], button[title*="copy" i], [data-tooltip*="copy" i], [aria-label*="copy code" i]'
    )].filter((button) => button.offsetParent !== null);
    copyButtons.forEach((button) => {
      let current = button.parentElement;
      for (let distance = 1; current && distance <= 8; distance += 1, current = current.parentElement) {
        const descendants = [...current.querySelectorAll('pre, code, code-block, [class*="code" i], [data-code-block]')]
          .map((element) => normalizeSource(element.innerText || element.textContent))
          .filter((value) => value.length > 20 && !state.baselineCode.has(signature(value)));
        descendants.forEach((value) => copyAnchored.push({ value, score: codeScore(value, distance) + 120 }));
        const containerText = normalizeSource(current.innerText || current.textContent || '')
          .replace(/^\s*copy\s*$/gim, '').trim();
        if (!descendants.length && containerText.length > 40 &&
          /#include|\bpublic\s+class\s+Main\b|\bclass\s+Main\b|\bint\s+main\s*\(|\bstatic\s+void\s+main\b|\bdef\s+main\s*\(/i.test(containerText) &&
          !state.baselineCode.has(signature(containerText))) {
          copyAnchored.push({ value: containerText, score: codeScore(containerText, distance) + 100 });
        }
        if (descendants.length) break;
      }
    });
    report('GEMINI_DIAGNOSTIC', `visible copy buttons=${copyButtons.length}, anchored code candidates=${copyAnchored.length}`);
    const anchored = copyAnchored.sort((a, b) => b.score - a.score)[0]?.value || '';
    if (anchored) return anchored;
    const fenced = [...text.matchAll(/```(?:[A-Za-z0-9_+#.-]+)?\s*\n?([\s\S]*?)```/g)]
      .map((match) => normalizeSource(match[1])).filter((value) => value.length > 20);
    if (fenced.length) return fenced.sort((a, b) => b.length - a.length)[0];
    const selectors = 'pre code, pre, code-block, [class*="code-block" i], [class*="codeBlock" i], [data-code-block], [data-testid*="code" i]';
    const elements = [...(node?.querySelectorAll?.(selectors) || []), ...document.querySelectorAll(selectors)];
    const domCode = elements
      .map((element, index) => ({
        text: normalizeSource(element.innerText || element.textContent),
        index,
        score: 0
      }))
      .filter((candidate) => candidate.text.length > 20 && !state.baselineCode.has(signature(candidate.text)))
      .map((candidate) => ({
        ...candidate,
        score: codeScore(candidate.text, candidate.index)
      }));
    return domCode.sort((a, b) => b.score - a.score || b.index - a.index)[0]?.text || '';
  };

  const isGenerating = () => [...document.querySelectorAll('button')].some((button) =>
    /stop|cancel/i.test(`${button.getAttribute('aria-label') || ''} ${button.getAttribute('data-tooltip') || ''} ${button.innerText || ''}`) &&
    !button.disabled && button.offsetParent !== null
  );

  const inspectForNewResponse = () => {
    if (!state.requestId || Date.now() < state.lastSentAt) return;
    const candidates = responseSnapshot().filter((item) => !state.baseline.has(item.signature));
    const latest = candidates[candidates.length - 1];
    if (!latest || latest.signature === state.lastResponseSignature) return;
    clearTimeout(state.quietTimer);
    state.quietTimer = setTimeout(() => {
      if (isGenerating()) {
        report('GEMINI_DIAGNOSTIC', 'generation still in progress; waiting for completion');
        inspectForNewResponse();
        return;
      }
      const current = responseSnapshot().filter((item) => !state.baseline.has(item.signature));
      const final = current[current.length - 1];
      if (!final || final.signature === state.lastResponseSignature) return;
      state.lastResponseSignature = final.signature;
      report('GEMINI_RESPONSE', {
        text: final.text,
        code: extractCode(final.text, final.node),
        nodeCount: responseNodes().length,
        capturedAt: Date.now()
      });
    }, 1400);
  };

  new MutationObserver(inspectForNewResponse).observe(document.documentElement, {
    childList: true, subtree: true, characterData: true
  });

  setInterval(inspectForNewResponse, 1000);

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message.type === 'PING_GEMINI') {
      sendResponse({ ok: true, input: Boolean(findInput()), responses: responseNodes().length });
      return true;
    }
    if (message.type !== 'FILL_AND_SEND_GEMINI') return;
    const input = findInput();
    if (!input) {
      report('GEMINI_DIAGNOSTIC', 'input not found');
      sendResponse({ ok: false, error: 'Gemini input is not ready yet.' });
      return true;
    }
    state.requestId = message.requestId || Date.now();
    state.baseline = new Set(responseSnapshot().map((item) => item.signature));
    state.baselineCode = new Set([...document.querySelectorAll('pre code, pre, code-block, [class*="code-block" i], [class*="codeBlock" i], [data-code-block], [data-testid*="code" i]')]
      .map((element) => normalizeSource(element.innerText || element.textContent))
      .filter((text) => text.length > 20)
      .map(signature));
    state.baselineCount = state.baseline.size;
    state.lastResponseSignature = '';
    state.lastSentAt = Date.now();
    clearTimeout(state.quietTimer);
    setInput(input, message.prompt || '');
    setTimeout(() => {
      if (clickSend()) report('GEMINI_SUBMITTED', `prompt submitted; baseline responses=${state.baselineCount}`);
      else report('GEMINI_DIAGNOSTIC', 'send button not found or disabled');
    }, 500);
    sendResponse({ ok: true, baselineCount: state.baselineCount });
    return true;
  });
})();
