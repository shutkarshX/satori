(() => {
  const state = {
    requestId: 0,
    baseline: new Set(),
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

  const responseNodes = () => [...document.querySelectorAll(
    'model-response, message-content, [data-message-author-role="model"], [data-testid*="model" i], [data-test-id*="model" i]'
  )].filter((node) => clean(node.innerText || node.textContent).length > 0);

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
    'textarea[placeholder], textarea, [contenteditable="true"][role="textbox"], [contenteditable="true"]'
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
      'button[aria-label*="Send" i], button[aria-label*="send" i], button[data-testid*="send" i], button[mattooltip*="Send" i]'
    )];
    const button = buttons.find((candidate) => !candidate.disabled && candidate.getAttribute('aria-disabled') !== 'true');
    if (button) { button.click(); return true; }
    return false;
  };

  const extractCode = (text, node) => {
    const fenced = [...text.matchAll(/```(?:[A-Za-z0-9_+#.-]+)?\s*\n?([\s\S]*?)```/g)]
      .map((match) => clean(match[1])).filter((value) => value.length > 20);
    if (fenced.length) return fenced.sort((a, b) => b.length - a.length)[0];
    const domCode = node ? [...node.querySelectorAll('pre code, pre')]
      .map((element) => clean(element.innerText || element.textContent)).filter((value) => value.length > 20) : [];
    return domCode.sort((a, b) => b.length - a.length)[0] || '';
  };

  const inspectForNewResponse = () => {
    if (!state.requestId || Date.now() < state.lastSentAt) return;
    const generating = [...document.querySelectorAll('button')].some((button) =>
      /stop|cancel/i.test(`${button.getAttribute('aria-label') || ''} ${button.getAttribute('data-tooltip') || ''}`) &&
      !button.disabled && button.offsetParent !== null
    );
    const candidates = responseSnapshot().filter((item) => !state.baseline.has(item.signature));
    const latest = candidates[candidates.length - 1];
    if (!latest || latest.signature === state.lastResponseSignature) return;
    clearTimeout(state.quietTimer);
    state.quietTimer = setTimeout(() => {
      if (generating) {
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
