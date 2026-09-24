(() => {
  const findInput = () => document.querySelector('textarea[placeholder], textarea, [contenteditable="true"]');

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
    const button = document.querySelector('button[aria-label*="Send" i], button[aria-label*="send" i], button[data-testid*="send" i]');
    if (button && !button.disabled) { button.click(); return true; }
    return false;
  };

  let lastResponse = '';
  let quietTimer;
  const readLatestResponse = () => {
    const nodes = [...document.querySelectorAll('model-response, message-content, [data-message-author-role="model"], [data-test-id*="model" i]')];
    const text = nodes.map((n) => n.innerText || n.textContent || '').map((s) => s.trim()).filter(Boolean).pop() || '';
    if (text && text !== lastResponse) {
      clearTimeout(quietTimer);
      quietTimer = setTimeout(() => {
        const finalText = (nodes.map((n) => n.innerText || n.textContent || '').map((s) => s.trim()).filter(Boolean).pop() || '').trim();
        if (finalText && finalText !== lastResponse) {
          lastResponse = finalText;
          chrome.runtime.sendMessage({ type: 'GEMINI_RESPONSE', text: finalText });
        }
      }, 1200);
    }
  };
  new MutationObserver(readLatestResponse).observe(document.documentElement, { childList: true, subtree: true, characterData: true });

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message.type === 'PING_GEMINI') { sendResponse({ ok: true }); return true; }
    if (message.type !== 'FILL_AND_SEND_GEMINI') return;
    const input = findInput();
    if (!input) { sendResponse({ ok: false, error: 'Gemini input is not ready yet.' }); return true; }
    lastResponse = '';
    setInput(input, message.prompt || '');
    setTimeout(() => clickSend(), 500);
    sendResponse({ ok: true });
    return true;
  });
})();
