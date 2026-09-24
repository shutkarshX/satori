(() => {
  let lastEditable = null;

  const isEditable = (el) => {
    if (!el) return false;
    return el.matches?.('textarea, input:not([type="hidden"]), [contenteditable="true"], .monaco-editor textarea, .CodeMirror textarea') || el.isContentEditable;
  };

  document.addEventListener('focusin', (event) => {
    if (isEditable(event.target)) lastEditable = event.target;
  }, true);

  const visibleText = (node) => {
    if (!node || node.namespaceURI === 'http://www.w3.org/2000/svg') return '';
    // Do not clone arbitrary portal elements: cloning can re-render malformed SVG charts.
    return (node.innerText || node.textContent || '').replace(/\u00a0/g, ' ').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  };

  function extractQuestion() {
    const selection = window.getSelection()?.toString().trim();
    if (selection && selection.length > 20) return selection;
    const candidates = [
      '[role="main"]', 'main', 'article', '[class*="question"]', '[class*="Question"]',
      '[class*="problem"]', '[class*="Problem"]', '[class*="assessment"]'
    ];
    let best = '';
    for (const selector of candidates) {
      document.querySelectorAll(selector).forEach((el) => {
        const text = visibleText(el);
        if (text.length > best.length && text.length < 30000) best = text;
      });
    }
    return best || visibleText(document.body).slice(0, 30000);
  }

  function setNativeValue(element, value) {
    const tag = element.tagName.toLowerCase();
    const proto = tag === 'textarea' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const descriptor = Object.getOwnPropertyDescriptor(proto, 'value');
    if (descriptor?.set) descriptor.set.call(element, value); else element.value = value;
    element.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: value }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function typeIntoEditor(text, append = false) {
    const target = lastEditable || document.activeElement;
    if (!isEditable(target)) throw new Error('Click inside the assignment answer box first, then try again.');
    if (target.isContentEditable || target.matches('[contenteditable="true"]')) {
      const existing = append ? target.innerText : '';
      target.focus();
      document.execCommand('selectAll', false);
      document.execCommand('insertText', false, existing + text);
    } else {
      const existing = append ? target.value : '';
      setNativeValue(target, existing + text);
      target.focus();
    }
    return true;
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    try {
      if (message.type === 'EXTRACT_QUESTION') sendResponse({ ok: true, text: extractQuestion(), title: document.title, url: location.href });
      if (message.type === 'TYPE_INTO_EDITOR') sendResponse({ ok: true, typed: typeIntoEditor(message.text || '', Boolean(message.append)) });
    } catch (error) {
      sendResponse({ ok: false, error: error.message });
    }
    return true;
  });
})();
