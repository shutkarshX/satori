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

    const highlightAndClick = (element, matchedLabel) => {
      if (!element) return null;
      element.scrollIntoView({ behavior: 'smooth', block: 'center' });

      const radio = element.matches('input[type="radio"]') ? element : element.querySelector('input[type="radio"]');
      if (radio) {
        radio.checked = true;
        radio.click();
        radio.dispatchEvent(new Event('change', { bubbles: true }));
        radio.dispatchEvent(new Event('input', { bubbles: true }));
      } else {
        element.click();
        element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
      }
      return { matched: matchedLabel, type: 'selected' };
    };

    // Priority 1: Match by exact or fuzzy text content inside option/label (Most Reliable)
    const norm = (str) => (str || '')
      .normalize('NFKD')
      .replace(/\u2217|\u22c5/g, '*')
      .replace(/\s+/g, '')
      .toLowerCase();

    const cleanTargetText = cleanAnswer
      .replace(/^(?:ANSWER|FINAL ANSWER|CORRECT OPTION|OPTION)\s*[:\-]?\s*/i, '')
      .replace(/^(?:\(?([A-Da-d])\)?[\).\:\-\s]*)/i, '')
      .replace(/[.\s]+$/, '')
      .trim();
    const normTarget = norm(cleanTargetText);

    // Look broadly for option containers, rows, labels, list items, divs with text
    const broadCandidates = [
      ...document.querySelectorAll('label, [class*="option" i], [class*="choice" i], [class*="answer" i], li, tr, [role="radio"]')
    ];

    if (normTarget.length >= 1) {
      // 1. Direct match (exact or substring)
      // Check for exact normalized matches first (handles whitespace differences like "O(sum*n)" vs "O(sum * n)")
      for (const card of broadCandidates) {
        const text = norm(visibleText(card));
        if (text && text === normTarget) {
          return highlightAndClick(card, visibleText(card).slice(0, 40));
        }
      }

      // If no exact match and text length > 2, try substring matches
      if (normTarget.length > 2) {
        for (const card of broadCandidates) {
          const text = norm(visibleText(card));
          if (text && (text.includes(normTarget) || (normTarget.length > 8 && text.length > 4 && normTarget.includes(text)))) {
            return highlightAndClick(card, visibleText(card).slice(0, 40));
          }
        }

        // 2. Word-overlap match
        const targetWords = cleanTargetText.split(/\s+/).filter((w) => w.length > 3);
        if (targetWords.length > 0) {
          let bestCandidate = null;
          let maxOverlap = 0;
          for (const card of broadCandidates) {
            const text = visibleText(card).toLowerCase();
            if (text.length > 200) continue; // Skip huge parent containers
            const count = targetWords.filter((w) => text.includes(w)).length;
            if (count > maxOverlap && count >= Math.ceil(targetWords.length * 0.6)) {
              maxOverlap = count;
              bestCandidate = card;
            }
          }
          if (bestCandidate) {
            return highlightAndClick(bestCandidate, visibleText(bestCandidate).slice(0, 40));
          }
        }
      }
    }

    // Priority 2: Fallback to target letter radio matching (only if text matching didn't find anything)
    if (targetLetter) {
      const letterIndex = targetLetter.charCodeAt(0) - 65; // A=0, B=1...
      // Only consider visible radio inputs
      const visibleRadios = inputs.filter((input) => input.offsetParent !== null || input.matches('[role="radio"]'));
      const matchedInput = visibleRadios.find((input) => {
        const val = (input.value || input.id || input.name || '').toUpperCase();
        return val.includes(targetLetter) || val === String(letterIndex);
      });
      if (matchedInput) {
        return highlightAndClick(matchedInput.closest('label, [class*="option" i], [class*="choice" i]') || matchedInput, targetLetter);
      }

      if (visibleRadios.length >= 2 && visibleRadios[letterIndex]) {
        const targetRadio = visibleRadios[letterIndex];
        return highlightAndClick(targetRadio.closest('label, [class*="option" i], [class*="choice" i]') || targetRadio, targetLetter);
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
