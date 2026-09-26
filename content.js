(() => {
  let lastEditable = null;

  const isEditable = (el) => {
    if (!el) return false;
    return el.matches?.('textarea, input:not([type="hidden"]), [contenteditable="true"], .monaco-editor textarea, .CodeMirror textarea') || el.isContentEditable;
  };

  document.addEventListener('focusin', (event) => {
    if (isEditable(event.target)) lastEditable = event.target;
  }, true);

  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' || event.shiftKey || event.ctrlKey || event.altKey || event.metaKey || !event.isTrusted) return;
    try { chrome.runtime.sendMessage({ type: 'CHATGPT_ASSIGNMENT_ENTER' }); } catch (_error) {}
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

  function extractFullPage() {
    return visibleText(document.body).slice(0, 50000);
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
    const fallback = [...document.querySelectorAll('textarea, [contenteditable="true"], .monaco-editor textarea, .CodeMirror textarea')]
      .find((element) => isEditable(element) && element.offsetParent !== null) || null;
    const target = lastEditable || (isEditable(document.activeElement) ? document.activeElement : fallback);
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

  function selectMcqOption(answerText) {
    if (!answerText) throw new Error('No answer text provided for MCQ.');
    const cleanAnswer = answerText.trim();

    // 1. Try to extract letter option like A, B, C, D
    const letterMatch = cleanAnswer.match(/(?:ANSWER|FINAL ANSWER|CORRECT OPTION|OPTION)\s*[:\-]?\s*\(?([A-Da-d])\)?/i)
      || cleanAnswer.match(/^([A-Da-d])[\).\:\s]/)
      || cleanAnswer.match(/\b([A-Da-d])\b/);
    const targetLetter = letterMatch ? letterMatch[1].toUpperCase() : null;

    // Search for radio inputs, option cards, or choice elements
    const inputs = [...document.querySelectorAll('input[type="radio"], [role="radio"]')];
    const optionCards = [...document.querySelectorAll('[class*="option" i], [class*="choice" i], label')];

    // Priority A: If target letter is found (e.g. 'A' -> 0, 'B' -> 1, 'C' -> 2, 'D' -> 3)
    if (targetLetter) {
      const letterIndex = targetLetter.charCodeAt(0) - 65; // A=0, B=1...
      // Check inputs with matching value or id
      const matchedInput = inputs.find((input) => {
        const val = (input.value || input.id || input.name || '').toUpperCase();
        return val.includes(targetLetter) || val === String(letterIndex);
      });
      if (matchedInput) {
        matchedInput.scrollIntoView({ behavior: 'smooth', block: 'center' });
        matchedInput.click();
        matchedInput.dispatchEvent(new Event('change', { bubbles: true }));
        return { matched: targetLetter, type: 'radio_value' };
      }

      // Check positional radio by index if count is 4
      if (inputs.length >= 2 && inputs[letterIndex]) {
        inputs[letterIndex].scrollIntoView({ behavior: 'smooth', block: 'center' });
        inputs[letterIndex].click();
        inputs[letterIndex].dispatchEvent(new Event('change', { bubbles: true }));
        return { matched: targetLetter, type: 'radio_index' };
      }
    }

    // Priority B: Match by text content inside option/label
    const cleanTargetText = cleanAnswer.replace(/^(?:ANSWER|FINAL ANSWER|CORRECT OPTION|OPTION)\s*[:\-]?\s*(?:\([A-Da-d]\)|[A-Da-d]\b)?/i, '').trim().toLowerCase();
    if (cleanTargetText.length > 2) {
      for (const card of optionCards) {
        const text = visibleText(card).toLowerCase();
        if (text && (text.includes(cleanTargetText) || cleanTargetText.includes(text))) {
          const radio = card.querySelector('input[type="radio"]') || card;
          radio.scrollIntoView({ behavior: 'smooth', block: 'center' });
          radio.click();
          radio.dispatchEvent(new Event('change', { bubbles: true }));
          return { matched: visibleText(card).slice(0, 30), type: 'text_match' };
        }
      }
    }

    throw new Error(`Could not find UI option matching: ${cleanAnswer.slice(0, 50)}`);
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    try {
      if (message.type === 'EXTRACT_QUESTION') sendResponse({ ok: true, text: extractQuestion(), fullText: extractFullPage(), title: document.title, url: location.href });
      if (message.type === 'TYPE_INTO_EDITOR') sendResponse({ ok: true, typed: typeIntoEditor(message.text || '', Boolean(message.append)) });
      if (message.type === 'SELECT_MCQ_OPTION') sendResponse({ ok: true, selected: selectMcqOption(message.answer || message.text || '') });
    } catch (error) {
      sendResponse({ ok: false, error: error.message });
    }
    return true;
  });
})();
