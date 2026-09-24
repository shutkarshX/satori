(() => {
  const findInput = () => document.querySelector('#prompt-textarea, textarea[placeholder], textarea, [contenteditable="true"]');
  const setInput = (element, text) => {
    element.focus();
    if (element.matches('textarea, input')) {
      const proto = element.tagName.toLowerCase() === 'textarea' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
      if (setter) setter.call(element, text); else element.value = text;
    } else {
      document.execCommand('selectAll', false);
      document.execCommand('insertText', false, text);
    }
    element.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
  };
  const clickSend = () => {
    const button = document.querySelector('button[data-testid="send-button"], button[aria-label*="Send" i], button[type="submit"]');
    if (button && !button.disabled) { button.click(); return true; }
    return false;
  };
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message.type === 'PING_CHATGPT') { sendResponse({ ok: true }); return true; }
    if (message.type !== 'FILL_AND_SEND_CHATGPT') return;
    const input = findInput();
    if (!input) { sendResponse({ ok: false, error: 'ChatGPT input is not ready yet.' }); return true; }
    setInput(input, message.prompt || '');
    let tries = 0;
    const sendWhenReady = () => {
      if (clickSend()) { sendResponse({ ok: true, sent: true }); return; }
      tries += 1;
      if (tries < 20) { setTimeout(sendWhenReady, 500); return; }
      sendResponse({ ok: false, error: 'ChatGPT input was filled, but its Send button did not become available.' });
    };
    setTimeout(sendWhenReady, 700);
    return true;
  });
})();
