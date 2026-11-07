(() => {
  // Clean up stale listeners/widgets from previous extension instances so page refresh is never needed
  if (window.__satoriKeydownHandler) {
    window.removeEventListener('keydown', window.__satoriKeydownHandler, true);
  }
  document.querySelectorAll('#satori-status-widget').forEach(w => w.remove());
  window.__satoriContentLoaded = Date.now();

  function isExtensionValid() {
    try {
      return Boolean(typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.id);
    } catch (_e) {
      return false;
    }
  }

  let lastEditable = null;
  function sendLiveTelemetry(event, details = '') {
    if (!isExtensionValid()) return;
    try {
      const p = chrome.runtime.sendMessage({
        type: 'LIVE_TELEMETRY',
        event,
        details,
        url: location.href
      });
      if (p && typeof p.catch === 'function') p.catch(() => {});
    } catch (_e) {}
  }


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
    if (window.location.hostname.includes("futureskillsprime.in")) return;
    // If an existing widget element already exists in document, clean up duplicates
    const existing = [...document.querySelectorAll('#satori-status-widget')];
    if (existing.length > 0) {
      statusWidget.root = existing[0];
      for (let i = 1; i < existing.length; i++) existing[i].remove();
      return;
    }
    if (!document.body) return;

    const root = document.createElement('div');
    root.id = 'satori-status-widget';
    root.innerHTML = `
      <div class="satori-status-pill" aria-label="Satori status">
        <span class="satori-status-icon">◉</span>
        <span class="satori-status-time">—</span>
        <button type="button" class="satori-quick-btn" id="satori-quick-code" title="Solve Code (Alt+Shift+C)">⚡ Code</button>
        <button type="button" class="satori-quick-btn" id="satori-quick-mcq" title="Solve MCQ (Alt+Shift+M)">✓ MCQ</button>
      </div>
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
      #satori-status-widget .satori-quick-btn {
        border: none;
        background: #f1f3f4;
        color: #1a73e8;
        font-weight: 600;
        font-size: 11px;
        padding: 3px 8px;
        border-radius: 6px;
        cursor: pointer;
        transition: background 0.15s, color 0.15s;
      }
      #satori-status-widget .satori-quick-btn:hover { background: #1a73e8; color: #fff; }
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

    pill.addEventListener('click', (e) => {
      if (e.target?.closest?.('.satori-quick-btn')) return;
      if (moved) { moved = false; return; }
      statusWidget.expanded = !statusWidget.expanded;
      const panel = root.querySelector('.satori-status-panel');
      if (panel) panel.hidden = !statusWidget.expanded;
    });

    const codeBtn = root.querySelector('#satori-quick-code');
    if (codeBtn) {
      codeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        sendLiveTelemetry('QUICK_BUTTON_CLICKED', 'satori-code');
        triggerShortcutDirect('satori-code');
      });
    }

    const mcqBtn = root.querySelector('#satori-quick-mcq');
    if (mcqBtn) {
      mcqBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        sendLiveTelemetry('QUICK_BUTTON_CLICKED', 'satori-mcq');
        triggerShortcutDirect('satori-mcq');
      });
    }
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

  if (isExtensionValid() && chrome.storage?.onChanged) {
    try {
      chrome.storage.onChanged.addListener((changes, area) => {
        if (!isExtensionValid()) return;
        if (area === 'local' && changes.satoriStatus) {
          renderStatus(changes.satoriStatus.newValue);
        }
      });
    } catch (_e) {}
  }

  if (isExtensionValid() && chrome.storage?.local) {
    try {
      const p = chrome.storage.local.get('satoriStatus', (result) => {
        if (!isExtensionValid() || chrome.runtime?.lastError) return;
        if (result?.satoriStatus) renderStatus(result.satoriStatus);
      });
      if (p && typeof p.catch === 'function') p.catch(() => {});
    } catch (_e) {}
  }

  // -------------------------------------------------------------
  // Page Text Reading & Editor Interactions
  // -------------------------------------------------------------
  const isEditable = (el) => {
    if (!el) return false;
    return el.matches?.('textarea, input:not([type="hidden"]), [contenteditable="true"], .monaco-editor textarea, .CodeMirror textarea, .ace_text-input, [class*="editor" i] textarea') || el.isContentEditable;
  };

  document.addEventListener('focusin', (event) => {
    if (isEditable(event.target)) lastEditable = event.target;
  }, true);

  // Track clicks on editor containers (e.g. Ace, Monaco, CodeMirror) even if the underlying textarea isn't focused yet
  document.addEventListener('click', (event) => {
    const editor = event.target?.closest?.('.monaco-editor, .CodeMirror, .ace_editor, [class*="editor" i], [class*="code" i]');
    if (editor) {
      const textarea = editor.querySelector('textarea, [contenteditable="true"]');
      if (textarea) lastEditable = textarea;
    }
  }, true);

  const visibleText = (node) => {
    if (!node || node.namespaceURI === 'http://www.w3.org/2000/svg') return '';
    return (node.innerText || node.textContent || '')
      .replace(/\u00a0/g, ' ')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  };

  function cleanProblemText(text) {
    if (!text) return '';
    // Start strictly from Question No / Problem Statement / Problem Description / Task / Coding, stripping preceding portal/student header
    const match = text.match(/(?:question\s*(?:no\.?|number)?\s*[:\d]|problem\s*(?:statement|description)?|task\s*(?:description)?|single\s*file\s*programming|multi(?:ple)?\s*choice|coding\s*question|practice\s*question|q\s*[:\.\d])/i);
    if (match && match.index > 0 && match.index < 4000) {
      text = text.slice(match.index);
    }
    // Keep all following details intact (language C (17), fill your code here, testcases, instructions)
    return text.trim();
  }

  function extractQuestion() {
    const selection = window.getSelection()?.toString().trim();
    if (selection && selection.length > 20) return cleanProblemText(selection);

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

    const raw = ranked[0]?.text || visibleText(document.body).slice(0, 30000);
    return cleanProblemText(raw);
  }

  function extractFullPage() {
    return cleanProblemText(visibleText(document.body).slice(0, 50000));
  }

  function setNativeValue(element, value) {
    const tag = element.tagName.toLowerCase();
    const proto = tag === 'textarea' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const descriptor = Object.getOwnPropertyDescriptor(proto, 'value');
    if (descriptor?.set) descriptor.set.call(element, value); else element.value = value;
    element.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: value }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function stripLeadingLanguageTag(code) {
  if (!code || typeof code !== 'string') return '';
  let s = code.trim();
  // Strip leading single-word language identifiers (e.g. "c\n", "java\n", "cpp\n", "python\n")
  s = s.replace(/^(?:c|cpp|c\+\+|java|python|py|javascript|js|typescript|ts|c#|cs|golang|go|rust|rs|kotlin|swift|ruby|php)\s*\n+/i, '');
  // Strip "Language: C\n"
  s = s.replace(/^language:\s*(?:c|cpp|c\+\+|java|python|javascript|c#)\s*\n+/i, '');
  // Strip leading language tag immediately preceding code keyword on same line
  s = s.replace(/^(?:c|cpp|c\+\+|java|python|py)\s+(?=(?:#include|import|public|class|def|void|int|using)\b)/i, '');
  return s.trim();
}

  function typeIntoEditor(rawText, append = false) {
    const text = stripLeadingLanguageTag(rawText);
    // 1. Gather all potential editor elements (focused, last clicked, or anywhere in DOM)
    const candidates = [
      lastEditable,
      isEditable(document.activeElement) ? document.activeElement : null,
      document.querySelector('.monaco-editor textarea'),
      document.querySelector('.ace_text-input'),
      document.querySelector('.CodeMirror textarea'),
      document.querySelector('[class*="editor" i] textarea, [class*="code" i] textarea'),
      ...document.querySelectorAll('textarea'),
      ...document.querySelectorAll('[contenteditable="true"]')
    ].filter((el) => Boolean(el));

    if (candidates.length === 0) {
      throw new Error('Click inside the assignment answer box first, then try again.');
    }

    // Deduplicate candidates
    const uniqueTargets = [...new Set(candidates)];

    for (const target of uniqueTargets) {
      try {
        target.focus();

        // A. ContentEditable
        if (target.isContentEditable || target.matches?.('[contenteditable="true"]')) {
          const existing = append ? target.innerText : '';
          document.execCommand('selectAll', false, null);
          document.execCommand('insertText', false, existing + text);
          return true;
        }

        // B. Textarea / Input (Monaco, Ace, CodeMirror, standard forms)
        if (target.tagName?.toLowerCase() === 'textarea' || target.tagName?.toLowerCase() === 'input') {
          // 1. Dispatch synthetic paste event (supported by Monaco, Ace, and CodeMirror input handlers)
          // Synthetic paste event removed to prevent anti-paste traps on test portals

          // 2. Set native value & trigger input/change
          const existing = append ? target.value : '';
          setNativeValue(target, existing + text);

          // 3. Document execCommand fallback
          try {
            document.execCommand('selectAll', false, null);
            document.execCommand('insertText', false, existing + text);
          } catch (_e) {}

          target.focus();
          return true;
        }
      } catch (_e) {}
    }

    throw new Error('Could not write into assignment editor. Click the code box first.');
  }

  // -------------------------------------------------------------
  // MCQ Option Selection (Safety First: Letter + Text Verification)
  // -------------------------------------------------------------
  function selectMcqOption(answerInput) {
    console.log('[Satori Content] selectMcqOption called with input:', answerInput);
    const answer = typeof answerInput === 'string'
      ? { letter: null, text: answerInput, raw: answerInput }
      : (answerInput || {});
    const cleanAnswer = String(answer.text || answer.raw || '').trim();
    const targetLetter = String(answer.letter || '').trim().toUpperCase() || null;
    console.log('[Satori Content] Parsing answer:', { cleanAnswer, targetLetter });
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

    console.log(`[Satori Content] Found ${candidates.length} candidate option elements, ${visibleRadios.length} visible radios.`);

    const click = (element, matched) => {
      if (!element) return null;
      console.log('[Satori Content] Clicking matched element:', element, 'Label/Text:', matched);
      try {
        element.scrollIntoView({ behavior: 'smooth', block: 'center' });
      } catch (_e) {}

      // Find all clickable targets associated with this option:
      // 1. The input radio/checkbox
      // 2. The surrounding <label>
      // 3. Any custom styled checkmark/circle elements (e.g. .radio, .custom-radio, .mat-radio, etc.)
      const label = element.closest('label') || (element.matches('label') ? element : null);
      const radio = element.matches('input[type="radio"], input[type="checkbox"]')
        ? element
        : element.querySelector('input[type="radio"], input[type="checkbox"]') ||
          (label ? label.querySelector('input[type="radio"], input[type="checkbox"]') : null);

      const customCheckmark = element.querySelector('[class*="radio" i], [class*="circle" i], [class*="check" i], span, [role="radio"]') || element;

      const triggerFullClick = (el) => {
        if (!el) return;
        ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'].forEach((evtName) => {
          try {
            el.dispatchEvent(new MouseEvent(evtName, { bubbles: true, cancelable: true, view: window }));
          } catch (_e) {}
        });
        if (typeof el.click === 'function') el.click();
      };

      // 1. Click native radio
      if (radio) {
        radio.checked = true;
        triggerFullClick(radio);
        radio.dispatchEvent(new Event('input', { bubbles: true }));
        radio.dispatchEvent(new Event('change', { bubbles: true }));
      }

      // 2. Click label
      if (label && label !== radio) {
        triggerFullClick(label);
      }

      // 3. Click custom checkmark element (essential for custom Angular/React UI frameworks)
      if (customCheckmark && customCheckmark !== radio && customCheckmark !== label) {
        triggerFullClick(customCheckmark);
      }

      // 4. Click the element container itself as fallback
      if (element !== radio && element !== label && element !== customCheckmark) {
        triggerFullClick(element);
      }

      return { matched, type: 'selected' };
    };

    // 1. Text matching candidates
    let textMatches = [];
    if (cleanAnswer) {
      const target = norm(cleanAnswer);
      const rawMatches = unique.filter((node) => {
        const text = norm(visibleText(node));
        if (!text) return false;
        // Ignore nodes that contain the entire question or multiple other options
        if (text.length > 300) return false;

        // Exact match
        if (text === target) return true;

        // Clean standalone match: word boundary match for short answers like "n+1" or "O(n)"
        if (target.length <= 10) {
          // Look for target as a standalone token or exact expression in the option
          const escaped = target.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          const regex = new RegExp(`(?:^|[^a-z0-9])${escaped}(?:[^a-z0-9]|$)`, 'i');
          return regex.test(text);
        }

        // Substring match in either direction for longer text
        if (target.length > 5 && text.length <= 250 && (text.includes(target) || target.includes(text))) return true;

        // Token overlap: if 60%+ of meaningful words match
        const targetWords = target.split(/\s+/).filter(w => w.length > 2);
        const textWords = text.split(/\s+/).filter(w => w.length > 2);
        if (targetWords.length >= 2 && textWords.length >= 2) {
          const matchedWords = targetWords.filter(w => textWords.includes(w));
          if (matchedWords.length / targetWords.length >= 0.6 || matchedWords.length / textWords.length >= 0.6) {
            return true;
          }
        }
        return false;
      });
      // Deduplicate nested elements: if a parent already matched (e.g. <label> contains <span>), keep only the top-level option container
      textMatches = rawMatches.filter((node) => !rawMatches.some((other) => other !== node && other.contains(node)));
      console.log(`[Satori Content] Text matching for "${target}": found ${rawMatches.length} raw, ${textMatches.length} deduplicated matches:`, textMatches.map(n => visibleText(n).slice(0, 40)));
    }

    // 2. Letter matching candidates (A -> 0, B -> 1, ...)
    const letterIndex = targetLetter ? targetLetter.charCodeAt(0) - 65 : -1;
    let letterTarget = null;
    if (letterIndex >= 0 && visibleRadios.length > letterIndex) {
      // Direct sequential radio index (A = 0, B = 1, C = 2, D = 3)
      letterTarget = visibleRadios[letterIndex];
      if (letterTarget) {
        letterTarget = letterTarget.closest('label, [class*="option" i], [class*="choice" i], [role="radio"]') || letterTarget;
      }
    }

    // 3. Verification & Selection Strategy
    // A. Priority 1: Authoritative Letter Match
    if (letterTarget) {
      const letterTargetText = norm(visibleText(letterTarget));
      const answerText = norm(cleanAnswer);
      const textAgrees = !answerText ||
        letterTargetText === answerText ||
        letterTargetText.includes(answerText) ||
        answerText.includes(letterTargetText);

      if (textAgrees || textMatches.length !== 1) {
        console.log(`[Satori Content] Selecting option by Letter [${targetLetter}]:`, letterTarget);
        return click(letterTarget, targetLetter);
      }

      const textElement = textMatches[0];
      const sameTarget = textElement === letterTarget ||
        textElement.contains(letterTarget) ||
        letterTarget.contains(textElement);

      if (sameTarget) {
        return click(letterTarget, targetLetter);
      }

      // If unique text matches a different option, prefer the direct text match
      console.warn(`[Satori Content] Discrepancy between letter [${targetLetter}] and text match [${visibleText(textElement)}]. Selecting matching text element.`);
      return click(textElement, visibleText(textElement).slice(0, 80));
    }

    // B. Priority 2: If exact text match exists, prefer it immediately
    const exactMatches = textMatches.filter(node => norm(visibleText(node)) === norm(cleanAnswer));
    if (exactMatches.length === 1) {
      return click(exactMatches[0], visibleText(exactMatches[0]).slice(0, 80));
    }

    // C. Single unique text match
    if (textMatches.length === 1) {
      return click(textMatches[0], visibleText(textMatches[0]).slice(0, 80));
    }

    // D. If multiple text elements matched, pick the highest scoring best match
    if (textMatches.length > 1) {
      const target = norm(cleanAnswer);
      const scored = textMatches.map(node => {
        const text = norm(visibleText(node));
        let score = 0;
        if (text === target) score += 100;
        if (text.startsWith(target) || target.startsWith(text)) score += 30;
        const targetWords = target.split(/\s+/).filter(w => w.length > 2);
        const textWords = text.split(/\s+/).filter(w => w.length > 2);
        const overlap = targetWords.filter(w => textWords.includes(w)).length;
        score += overlap * 10;
        score -= Math.abs(text.length - target.length) * 0.1;
        return { node, score };
      }).sort((a, b) => b.score - a.score);

      if (scored.length > 0) {
        console.log(`[Satori Content] Disambiguated multiple options, selected top scored (${scored[0].score} pts):`, scored[0].node);
        return click(scored[0].node, visibleText(scored[0].node).slice(0, 80));
      }
    }

    throw new Error(`Could not find a unique page option matching: ${cleanAnswer.slice(0, 80) || targetLetter}`);
  }

  function extractStructuredMcq() {
    // 1. Gather all visible radio inputs and their associated labels
    const visibleRadios = [...document.querySelectorAll('input[type="radio"], [role="radio"]')]
      .filter((node) => node.offsetParent !== null || node.matches('[role="radio"]'));

    if (visibleRadios.length >= 2) {
      const options = visibleRadios.map((radio, idx) => {
        const letter = String.fromCharCode(65 + idx); // A, B, C, D...
        const label = radio.closest('label, li, tr, [class*="option" i]') || radio.parentElement;
        const text = visibleText(label).replace(/^[A-Da-d][\).\:\-\s]+/, '').trim();
        return { letter, text, element: radio };
      });
      return options;
    }
    return [];
  }

  // Track user copy actions on the page
  document.addEventListener('copy', () => {
    try {
      const sel = window.getSelection()?.toString().trim();
      if (sel && sel.length > 10) window.__satoriLastCopiedText = sel;
    } catch (_e) {}
  }, true);

  async function triggerShortcutDirect(cmd) {
    sendLiveTelemetry('SHORTCUT_START', { cmd, url: location.href });
    renderStatus({
      kind: 'waiting',
      text: (cmd === 'satori-code' ? 'Solving Code' : 'Solving MCQ') + ' with Google AI…',
      estimateSec: 10,
      startedAt: Date.now()
    });

    // Extract LIVE question text from page (or user mouse selection if highlighted)
    let pageText = '';
    try {
      const sel = window.getSelection()?.toString().trim();
      if (sel && sel.length > 20) pageText = cleanProblemText(sel);
    } catch (_e) {}

    if (!pageText) {
      pageText = extractFullPage() || extractQuestion();
    }

    const structuredOpts = extractStructuredMcq();

    sendLiveTelemetry('LIVE_PAGE_READ', {
      cmd,
      textLen: pageText.length,
      preview: pageText.slice(0, 200),
      optionsCount: structuredOpts.length
    });

    if (!isExtensionValid()) return;
    try {
      const p = chrome.runtime.sendMessage({
        type: 'TRIGGER_SHORTCUT_DIRECT',
        command: cmd,
        pageText,
        options: structuredOpts.map(o => ({ letter: o.letter, text: o.text }))
      });
      if (p && typeof p.catch === 'function') p.catch(() => {});
    } catch (_e) {}
  }

  // -------------------------------------------------------------
  // Content Script Direct Keyboard Shortcut Listener
  // Catches Alt+Shift+M (MCQ), Alt+Shift+C/S (Code), Alt+Shift+X (Cancel)
  // directly in the webpage DOM so browser shortcut conflicts never block it
  // -------------------------------------------------------------
  window.__satoriKeydownHandler = async (e) => {
    if (e.altKey && e.shiftKey) {
      const code = e.code;
      const key = (e.key || '').toLowerCase();
      let cmd = null;
      if (code === 'KeyM' || key === 'm' || e.keyCode === 77) cmd = 'satori-mcq';
      else if (code === 'KeyC' || key === 'c' || e.keyCode === 67 || code === 'KeyS' || key === 's' || e.keyCode === 83) cmd = 'satori-code';
      else if (code === 'KeyX' || key === 'x' || e.keyCode === 88) cmd = 'satori-cancel';

      if (cmd) {
        e.preventDefault();
        e.stopPropagation();
        console.log('[Satori Content] In-page shortcut detected:', cmd);
        try {
          triggerShortcutDirect(cmd);
        } catch (_err) {
          // If extension context was invalidated, remove stale handler
          window.removeEventListener('keydown', window.__satoriKeydownHandler, true);
        }
      }
    }
  };
  window.addEventListener('keydown', window.__satoriKeydownHandler, true);

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    try {
      if (message.type === 'EXTRACT_QUESTION') {
        let selected = '';
        try {
          const sel = window.getSelection()?.toString().trim();
          if (sel && sel.length > 20) selected = cleanProblemText(sel);
        } catch (_e) {}

        const structuredOptions = extractStructuredMcq();
        const extractedQ = extractQuestion();
        const fullPage = extractFullPage();
        const effectiveText = selected || extractedQ;
        const effectiveFull = selected || fullPage;

        sendResponse({
          ok: true,
          text: effectiveText,
          fullText: effectiveFull,
          options: structuredOptions.map(o => ({ letter: o.letter, text: o.text })),
          title: document.title,
          url: location.href
        });
      }
      if (message.type === 'TYPE_INTO_EDITOR') {
        const typed = typeIntoEditor(message.text || '', Boolean(message.append));
        sendResponse({ ok: true, typed });
        return true;
      }
      if (message.type === 'COPY_AND_NOTIFY') {
        // Clipboard write removed to prevent domain permission prompts on test portals
        const typed = typeIntoEditor(message.text || '', Boolean(message.append));
        sendResponse({ ok: true, typed });
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
