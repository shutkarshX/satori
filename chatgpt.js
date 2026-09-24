(() => {
  const state = { requestId: 0, baseline: new Set(), lastSentAt: 0, lastSignature: '', quietTimer: null };
  const clean = (value) => String(value || '').replace(/\u00a0/g, ' ').replace(/\r\n?/g, '\n').replace(/[ \t]+\n/g, '\n').trim();
  const signature = (text) => `${text.length}:${text.slice(0, 80)}:${text.slice(-120)}`;
  const responseNodes = () => [...document.querySelectorAll(
    '[data-message-author-role="assistant"], [data-testid*="conversation-turn" i] [data-message-author-role="assistant"], article'
  )].filter((node) => {
    const text = clean(node.innerText || node.textContent);
    return text.length > 0 && !node.closest?.('[data-message-author-role="user"]');
  });
  const snapshot = () => responseNodes().map((node) => ({ node, text: clean(node.innerText || node.textContent), signature: signature(clean(node.innerText || node.textContent)) }));
  const report = (type, detail) => { try { chrome.runtime.sendMessage({ type, requestId: state.requestId, detail }); } catch (_error) {} };
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
    const buttons = [...document.querySelectorAll('button[data-testid*="send" i], button[aria-label*="send" i], button[aria-label*="submit" i]')];
    const button = buttons.find((candidate) => !candidate.disabled && candidate.getAttribute('aria-disabled') !== 'true');
    if (button) { button.click(); return true; }
    const input = findInput();
    if (input) { input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true })); return true; }
    return false;
  };
  const extractCode = (text, node) => {
    const fenced = [...text.matchAll(/```(?:[A-Za-z0-9_+#.-]+)?\s*\n?([\s\S]*?)```/g)].map((match) => clean(match[1])).filter((value) => value.length > 20);
    if (fenced.length) return fenced.sort((a, b) => b.length - a.length)[0];
    const elements = [...(node?.querySelectorAll?.('pre code, pre') || []), ...document.querySelectorAll('pre code, pre')];
    return elements.map((element) => clean(element.innerText || element.textContent)).filter((value) => value.length > 20).sort((a, b) => b.length - a.length)[0] || '';
  };
  const isGenerating = () => [...document.querySelectorAll('button')].some((button) => /stop generating|stop/i.test(`${button.getAttribute('aria-label') || ''} ${button.innerText || ''}`) && !button.disabled && button.offsetParent !== null);
  const inspect = () => {
    if (!state.requestId || Date.now() < state.lastSentAt) return;
    const latest = snapshot().filter((item) => !state.baseline.has(item.signature)).at(-1);
    if (!latest || latest.signature === state.lastSignature) return;
    clearTimeout(state.quietTimer);
    state.quietTimer = setTimeout(() => {
      if (isGenerating()) { report('CHATGPT_DIAGNOSTIC', 'generation still in progress; waiting for completion'); inspect(); return; }
      const final = snapshot().filter((item) => !state.baseline.has(item.signature)).at(-1);
      if (!final || final.signature === state.lastSignature) return;
      state.lastSignature = final.signature;
      report('CHATGPT_RESPONSE', { text: final.text, code: extractCode(final.text, final.node), capturedAt: Date.now() });
    }, 1200);
  };
  new MutationObserver(inspect).observe(document.documentElement, { childList: true, subtree: true, characterData: true });
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message.type === 'PING_CHATGPT') { sendResponse({ ok: true, input: Boolean(findInput()), responses: responseNodes().length }); return true; }
    if (message.type !== 'FILL_AND_SEND_CHATGPT') return;
    const input = findInput();
    if (!input) { report('CHATGPT_DIAGNOSTIC', 'composer not found'); sendResponse({ ok: false, error: 'ChatGPT composer is not ready yet.' }); return true; }
    state.requestId = message.requestId || Date.now();
    state.baseline = new Set(snapshot().map((item) => item.signature));
    state.lastSignature = '';
    state.lastSentAt = Date.now();
    clearTimeout(state.quietTimer);
    setInput(input, message.prompt || '');
    setTimeout(() => { if (clickSend()) report('CHATGPT_SUBMITTED', 'prompt submitted'); else report('CHATGPT_DIAGNOSTIC', 'send button not found or disabled'); }, 500);
    sendResponse({ ok: true, baselineCount: state.baseline.size });
    return true;
  });
})();
