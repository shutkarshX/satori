(() => {
  if (window.__satoriContentLoaded) return;
  window.__satoriContentLoaded = true;

  let lastEditable = null;

  // -------------------------------------------------------------
  // Floating Satori Status Widget (Clean DOM, Draggable, Lifecycle)
  // -------------------------------------------------------------
  const statusWidget = {
    root: null,
    expanded: false,
    timer: null,
    dismissTimer: null
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
        <span class="satori-status-detail">Ready</span>
      </div>`;

    const style = document.createElement('style');
    style.textContent = `
      #satori-status-widget {
        position: fixed;
        right: 18px;
        bottom: 18px;
        z-index: 2147483647;
        font: 12px/1.35 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        color: #202124;
        user-select: none;
      }
      #satori-status-widget .satori-status-pill {
        display: flex;
        align-items: center;
        gap: 7px;
        border: 1px solid #d7dbe0;
        border-radius: 999px;
        background: #ffffff;
        box-shadow: 0 4px 18px rgba(0,0,0,0.12);
        padding: 7px 12px;
        cursor: grab;
        font: inherit;
        color: inherit;
        outline: none;
        transition: border-color 0.2s, background 0.2s, box-shadow 0.2s;
      }
      #satori-status-widget .satori-status-pill:active { cursor: grabbing; }
      #satori-status-widget .satori-status-icon { font-size: 13px; line-height: 1; }
      #satori-status-widget .satori-status-time { font-variant-numeric: tabular-nums; font-weight: 500; font-size: 11px; }
      #satori-status-widget .satori-status-panel {
        margin-top: 7px;
        min-width: 200px;
        max-width: 280px;
        padding: 10px 12px;
        border: 1px solid #d7dbe0;
        border-radius: 10px;
        background: #ffffff;
        box-shadow: 0 6px 24px rgba(0,0,0,0.14);
      }
      #satori-status-widget .satori-status-panel strong { display: block; font-size: 12px; font-weight: 600; }
      #satori-status-widget .satori-status-panel span { display: block; margin-top: 4px; color: #5f6368; font-size: 11px; word-break: break-word; }
      
      #satori-status-widget.satori-waiting .satori-status-pill { border-color: #e5b84b; background: #fff8df; color: #7a5800; }
      #satori-status-widget.satori-ready .satori-status-pill   { border-color: #63b77a; background: #eaf7ee; color: #1e6633; }
      #satori-status-widget.satori-error .satori-status-pill   { border-color: #e28a83; background: #fdf0ef; color: #a51d14; }
      #satori-status-widget.satori-cancelled .satori-status-pill { border-color: #d7dbe0; background: #f1f3f4; color: #5f6368; }
    `;

    document.documentElement.appendChild(style);
    document.body.appendChild(root);
    statusWidget.root = root;

    const pill = root.querySelector('.satori-status-pill');
    let drag = null;
    let moved = false;

    pill.addEventListener('pointerdown', (event) => {
      if (event.button !== 0) return;
      moved = false;
      drag = {
        x: event.clientX,
        y: event.clientY,
        left: root.getBoundingClientRect().left,
        top: root.getBoundingClientRect().top
      };
      pill.setPointerCapture?.(event.pointerId);
    });

    pill.addEventListener('pointermove', (event) => {
      if (!drag) return;
      const dx = event.clientX - drag.x;
      const dy = event.clientY - drag.y;
      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) moved = true;
      root.style.left = `${Math.max(4, Math.min(window.innerWidth - root.offsetWidth - 4, drag.left + dx))}px`;
      root.style.top = `${Math.max(4, Math.min(window.innerHeight - root.offsetHeight - 4, drag.top + dy))}px`;
      root.style.right = 'auto';
      root.style.bottom = 'auto';
    });

    pill.addEventListener('pointerup', () => { drag = null; });

    pill.addEventListener('click', () => {
      if (moved) { moved = false; return; }
      statusWidget.expanded = !statusWidget.expanded;
      const panel = root.querySelector('.satori-status-panel');
      if (panel) panel.hidden = !statusWidget.expanded;
    });
  }

  function renderStatus(value) {
    ensureStatusWidget();
    if (!statusWidget.root || !value) return;
    const root = statusWidget.root;

    root.classList.remove('satori-waiting', 'satori-ready', 'satori-error', 'satori-cancelled');
    const kind = value.kind || 'waiting';
    root.classList.add(`satori-${kind}`);

    const iconEl = root.querySelector('.satori-status-icon');
    const detailEl = root.querySelector('.satori-status-detail');
    const timeEl = root.querySelector('.satori-status-time');

    if (iconEl) {
      iconEl.textContent = kind === 'ready' ? '✓' : kind === 'error' ? '×' : kind === 'cancelled' ? '–' : '◉';
    }
    if (detailEl) {
      detailEl.textContent = value.text || 'Satori';
    }

    if (statusWidget.timer) {
      clearInterval(statusWidget.timer);
      statusWidget.timer = null;
    }
    if (statusWidget.dismissTimer) {
      clearTimeout(statusWidget.dismissTimer);
      statusWidget.dismissTimer = null;
    }

    const startedAt = Number(value.startedAt || value.at || Date.now());
    const estimate = Number(value.estimateSec || 0);

    const updateTime = () => {
      if (!timeEl) return;
      if (kind !== 'waiting' || !estimate) {
        timeEl.textContent = kind === 'ready' ? 'DONE' : kind === 'error' ? 'ERROR' : kind === 'cancelled' ? 'CANCEL' : '—';
        return;
      }
      const elapsed = (Date.now() - startedAt) / 1000;
      const remaining = Math.max(0, Math.ceil(estimate - elapsed));
      timeEl.textContent = remaining > 0 ? `~${remaining}s` : 'working…';
    };

    updateTime();
    if (kind === 'waiting') {
      statusWidget.timer = setInterval(updateTime, 500);
    }

    // Auto-dismiss after 6s for terminal states (ready/error/cancelled), then reset to idle
    if (kind === 'ready' || kind === 'error' || kind === 'cancelled') {
      statusWidget.dismissTimer = setTimeout(() => {
        if (statusWidget.root) {
          root.classList.remove('satori-waiting', 'satori-ready', 'satori-error', 'satori-cancelled');
          if (iconEl) iconEl.textContent = '◉';
          if (timeEl) timeEl.textContent = '—';
          if (detailEl) detailEl.textContent = 'Ready';
        }
      }, 6000);
    }
  }

  // Initialize widget immediately on page load
  ensureStatusWidget();
  renderStatus({ kind: 'idle', text: 'Satori ready', at: Date.now() });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.satoriStatus) {
      renderStatus(changes.satoriStatus.newValue);
    }
  });

  chrome.storage.local.get('satoriStatus', (result) => {
    if (result.satoriStatus) renderStatus(result.satoriStatus);
  });

  // -------------------------------------------------------------
  // Page Text Reading & Editor Interactions
  // -------------------------------------------------------------
  const isEditable = (el) => {
    if (!el) return false;
    return el.matches?.('textarea, input:not([type="hidden"]), [contenteditable="true"], .monaco-editor textarea, .CodeMirror textarea') || el.isContentEditable;
  };

  document.addEventListener('focusin', (event) => {
    if (isEditable(event.target)) lastEditable = event.target;
  }, true);

  const visibleText = (node) => {
    if (!node || node.namespaceURI === 'http://www.w3.org/2000/svg') return '';
    return (node.innerText || node.textContent || '')
      .replace(/\u00a0/g, ' ')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  };

  function extractQuestion() {
    const selection = window.getSelection()?.toString().trim();
    if (selection && selection.length > 20) return selection;

    const candidates = [
      ...document.querySelectorAll(
        '[role="main"], main, article, [class*="question" i], [class*="problem" i], ' +
        '[class*="assessment" i], [id*="question" i], [id*="problem" i], section'
      )
    ];

    const score = (el, text) => {
      let val = 0;
      const meta = `${el.id || ''} ${el.className || ''}`;
      if (/question|problem|assessment/i.test(meta)) val += 80;
      if (/options?|choices?|answers?/i.test(text)) val += 25;
      if (/input|output|constraints|sample|example/i.test(text)) val += 20;
      if (/[?]/.test(text)) val += 20;
      if (text.length >= 80 && text.length <= 20000) val += 15;
      if (text.length > 28000) val -= 30;
      if (/^(navigation|sidebar|header|footer)/i.test(meta)) val -= 80;
      return val;
    };

    const ranked = candidates
      .map((el) => {
        const text = visibleText(el);
        return { text, score: score(el, text) };
      })
      .filter((item) => item.text.length >= 40 && item.text.length < 30000)
      .sort((a, b) => b.score - a.score || b.text.length - a.text.length);

    return ranked[0]?.text || visibleText(document.body).slice(0, 30000);
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

  // -------------------------------------------------------------
  // MCQ Option Selection (Safety First: Letter + Text Verification)
  // -------------------------------------------------------------
  function selectMcqOption(answerInput) {
    const answer = typeof answerInput === 'string'
      ? { letter: null, text: answerInput, raw: answerInput }
      : (answerInput || {});
    const cleanAnswer = String(answer.text || answer.raw || '').trim();
    const targetLetter = String(answer.letter || '').trim().toUpperCase() || null;
    if (!cleanAnswer && !targetLetter) throw new Error('No answer provided for MCQ.');

    const norm = (str) => (str || '')
      .normalize('NFKD')
      .replace(/[\u2217\u22c5\u00d7·×⋅]/g, '*')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();

    const candidates = [
      ...document.querySelectorAll('label, [class*="option" i], [class*="choice" i], [class*="answer" i], li, tr, [role="radio"]')
    ].filter((node) => node.offsetParent !== null || node.matches('[role="radio"]'));

    const unique = [...new Set(candidates)];
    const visibleRadios = [...document.querySelectorAll('input[type="radio"], [role="radio"]')]
      .filter((node) => node.offsetParent !== null || node.matches('[role="radio"]'));

    const click = (element, matched) => {
      if (!element) return null;
      element.scrollIntoView({ behavior: 'smooth', block: 'center' });
      const radio = element.matches('input[type="radio"]') ? element : element.querySelector('input[type="radio"]');
      if (radio) {
        radio.click();
        radio.dispatchEvent(new Event('change', { bubbles: true }));
        radio.dispatchEvent(new Event('input', { bubbles: true }));
      } else {
        element.click();
        element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
      }
      return { matched, type: 'selected' };
    };

    // 1. Text matching candidates
    let textMatches = [];
    if (cleanAnswer) {
      const target = norm(cleanAnswer);
      const rawMatches = unique.filter((node) => {
        const text = norm(visibleText(node));
        return text && (text === target || (target.length > 4 && text.length <= 180 && (text.includes(target) || target.includes(text))));
      });
      // Deduplicate nested elements: if a parent already matched (e.g. <label> contains <span>), keep only the top-level option container
      textMatches = rawMatches.filter((node) => !rawMatches.some((other) => other !== node && other.contains(node)));
    }

    // 2. Letter matching candidates (A -> 0, B -> 1, ...)
    const letterIndex = targetLetter ? targetLetter.charCodeAt(0) - 65 : -1;
    let letterTarget = null;
    if (letterIndex >= 0) {
      const explicit = visibleRadios.find((input) => {
        const value = `${input.value || ''} ${input.id || ''} ${input.getAttribute('aria-label') || ''}`.toUpperCase();
        return value.includes(targetLetter) || value.trim() === String(letterIndex);
      });
      letterTarget = explicit || visibleRadios[letterIndex] || null;
      if (letterTarget) {
        letterTarget = letterTarget.closest('label, [class*="option" i], [class*="choice" i], [role="radio"]') || letterTarget;
      }
    }

    // 3. Verification & Conflict Detection
    // Both text and letter match: ensure they point to the exact same option
    if (textMatches.length === 1 && letterTarget) {
      const textElement = textMatches[0];
      const sameTarget = textElement === letterTarget || textElement.contains(letterTarget) || letterTarget.contains(textElement);
      if (!sameTarget) {
        throw new Error(`MCQ conflict: text matched option '${visibleText(textElement).slice(0, 30)}', but letter matched '${targetLetter}'. No option selected.`);
      }
      return click(textElement, visibleText(textElement).slice(0, 80));
    }

    // Unique text match
    if (textMatches.length === 1) {
      return click(textMatches[0], visibleText(textMatches[0]).slice(0, 80));
    }

    // Ambiguous multiple text matches -> DO NOTHING (safety)
    if (textMatches.length > 1) {
      throw new Error('MCQ answer matches multiple page options. Nothing was selected to prevent incorrect submission.');
    }

    // Unique letter fallback
    if (letterTarget) {
      return click(letterTarget, targetLetter);
    }

    throw new Error(`Could not find a unique page option matching: ${cleanAnswer.slice(0, 80) || targetLetter}`);
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    try {
      if (message.type === 'EXTRACT_QUESTION') {
        sendResponse({
          ok: true,
          text: extractQuestion(),
          fullText: extractFullPage(),
          title: document.title,
          url: location.href
        });
      }
      if (message.type === 'TYPE_INTO_EDITOR') {
        sendResponse({ ok: true, typed: typeIntoEditor(message.text || '', Boolean(message.append)) });
      }
      if (message.type === 'SELECT_MCQ_OPTION') {
        sendResponse({ ok: true, selected: selectMcqOption(message.answer || message.text || '') });
      }
    } catch (error) {
      sendResponse({ ok: false, error: error.message });
    }
    return true;
  });
})();
