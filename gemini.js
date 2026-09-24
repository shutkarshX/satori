(() => {
  const findInput = () => document.querySelector('textarea[placeholder], textarea, [contenteditable="true"]');
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
    const button = document.querySelector('button[aria-label*="Send" i], button[aria-label*="send" i], button[data-testid*="send" i]');
    if (button && !button.disabled) { button.click(); return true; }
    return false;
  };

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message.type === 'PING_GEMINI') { sendResponse({ ok: true }); return true; }
    if (message.type !== 'FILL_AND_SEND_GEMINI') return;
    const input = findInput();
    if (!input) { sendResponse({ ok: false, error: 'Gemini input is not ready yet.' }); return true; }
    setInput(input, message.prompt || '');
    setTimeout(clickSend, 500);
    sendResponse({ ok: true });
    return true;
  });
})();
