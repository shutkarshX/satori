(() => {
  if (window.__satoriContentLoaded) return;
  window.__satoriContentLoaded = true;

  let lastEditable = null;

  const statusWidget = {
    root: null,
    expanded: false,
    timer: null
  };

  function ensureStatusWidget() {
    if (statusWidget.root || !document.body) return;
    const root = document.createElement('div');
    root.id = 'satori-status-widget';
    root.innerHTML = `
      <button type="button" class="satori-status-pill" aria-label="Satori status">
        <span class="satori-status-icon">◉</span>
        <span class="satori-status-time">—</span>
      </button>
      <div class="satori-status-panel" hidden>
        <strong>Satori</strong>
        <span class="satori-status-detail">Idle</span>
      </div>`;
    const style = document.createElement('style');
    style.textContent = `
      #satori-status-widget{position:fixed;right:18px;bottom:18px;z-index:2147483647;font:12px/1.35 system-ui,sans-serif;color:#202124;user-select:none}
      #satori-status-widget .satori-status-pill{display:flex;align-items:center;gap:7px;border:1px solid #d7dbe0;border-radius:999px;background:#fff;box-shadow:0 4px 18px rgba(0,0,0,.14);padding:7px 11px;cursor:grab}
      #satori-status-widget .satori-status-pill:active{cursor:grabbing}
      #satori-status-widget .satori-status-icon{font-size:13px}
      #satori-status-widget .satori-status-time{font-variant-numeric:tabular-nums}
      #satori-status-widget .satori-status-panel{margin-top:7px;min-width:190px;padding:10px 11px;border:1px solid #d7dbe0;border-radius:10px;background:#fff;box-shadow:0 6px 24px rgba(0,0,0,.16)}
      #satori-status-widget .satori-status-panel strong,#satori-status-widget .satori-status-panel span{display:block}
      #satori-status-widget .satori-status-panel span{margin-top:4px;color:#5f6368}
      #satori-status-widget.satori-waiting .satori-status-pill{border-color:#e5b84b;background:#fff8df}
      #satori-status-widget.satori-ready .satori-status-pill{border-color:#63b77a;background:#eaf7ee}
      #satori-status-widget.satori-error .satori-status-pill{border-color:#e28a83;background:#fdf0ef}
    `;
    document.documentElement.appendChild(style);
    document.body.appendChild(root);
    statusWidget.root = root;

    const pill = root.querySelector('.satori-status-pill');
    let drag = null;
    pill.addEventListener('pointerdown', (event) => {
      if (event.button !== 0) return;
      drag = { x: event.clientX, y: event.clientY, left: root.getBoundingClientRect().left, top: root.getBoundingClientRect().top };
      pill.setPointerCapture?.(event.pointerId);
    });
    pill.addEventListener('pointermove', (event) => {
      if (!drag) return;
      const dx = event.clientX - drag.x, dy = event.clientY - drag.y;
      root.style.left = `${Math.max(4, Math.min(window.innerWidth - root.offsetWidth - 4, drag.left + dx))}px`;
      root.style.top = `${Math.max(4, Math.min(window.innerHeight - root.offsetHeight - 4, drag.top + dy))}px`;
      root.style.right = 'auto'; root.style.bottom = 'auto';
    });
    pill.addEventListener('pointerup', () => { drag = null; });
    pill.addEventListener('click', () => {
      if (drag) return;
      statusWidget.expanded = !statusWidget.expanded;
      root.querySelector('.satori-status-panel').hidden = !statusWidget.expanded;
    });
  }

  function renderStatus(value) {
    ensureStatusWidget();
    if (!statusWidget.root || !value) return;
    const root = statusWidget.root;
    root.classList.remove('satori-waiting','satori-ready','satori-error');
    root.classList.add(`satori-${value.kind || 'waiting'}`);
    root.querySelector('.satori-status-icon').textContent = value.kind === 'ready' ? '✓' : value.kind === 'error' ? '×' : '◉';
    root.querySelector('.satori-status-detail').textContent = value.text || 'Satori';
    if (statusWidget.timer) clearInterval(statusWidget.timer);

    const startedAt = Number(value.startedAt || value.at || Date.now());
    const estimate = Number(value.estimateSec || 0);
    const timeEl = root.querySelector('.satori-status-time');

    const updateTime = () => {
      if (value.kind !== 'waiting' || !estimate) {
        timeEl.textContent = value.kind === 'ready' ? 'DONE' : value.kind === 'error' ? 'ERROR' : '—';
        return;
      }
      const elapsed = (Date.now() - startedAt) / 1000;
      const remaining = Math.max(0, Math.ceil(estimate - elapsed));
      timeEl.textContent = remaining > 0 ? `~${remaining}s` : 'working…';
    };
    updateTime();
    if (value.kind === 'waiting') statusWidget.timer = setInterval(updateTime, 500);

    if (value.kind === 'ready' || value.kind === 'error') {
      setTimeout(() => {
        if (statusWidget.root && statusWidget.root.classList.contains(`satori-${value.kind}`)) {
          statusWidget.root.remove();
          statusWidget.root = null;
        }
      }, 4500);
    }
  }

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.satoriStatus) renderStatus(changes.satoriStatus.newValue);
  });
  chrome.storage.local.get('satoriStatus', (result) => renderStatus(result.satoriStatus));

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
      || cleanAnswer.match(/^\(?([A-Da-d])\)?$/)
      || cleanAnswer.match(/^([A-Da-d])[\).\:\s]/);
    const targetLetter = letterMatch ? letterMatch[1].toUpperCase() : null;

    // Search for radio inputs, option cards, or choice elements
    const inputs = [...document.querySelectorAll('input[type="radio"], [role="radio"]')];
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
      .replace(/[\u2217\u22c5\u00d7·×⋅]/g, '*')
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

      // Only accept a unique containment match; ambiguous fuzzy matches must fail safely.
      if (normTarget.length > 4) {
        const matches = broadCandidates.filter((card) => {
          const text = norm(visibleText(card));
          return text && text.length <= 180 && (text.includes(normTarget) || normTarget.includes(text));
        });
        const uniqueMatches = [...new Set(matches)];
        if (uniqueMatches.length === 1) {
          const card = uniqueMatches[0];
          return highlightAndClick(card, visibleText(card).slice(0, 40));
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
