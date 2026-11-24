(() => {
  if (window.__satoMcqSelectorLoaded) return;
  window.__satoMcqSelectorLoaded = true;
  const norm = (s) => (s || '')
    .normalize('NFKD')
    .replace(/[\u2217\u22c5\u00d7·×⋅]/g, '*')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();

  const stripLetter = (s) => norm(s)
    .replace(/^(?:answer|correct answer|correct option|option)\s*[:\-]?\s*/i, '')
    .replace(/^[a-d][\)\.\:\-]\s*/, '')
    .trim();

  function cleanMathExpr(str) {
    return str
      .replace(/[\s^_{}()]/g, '')
      .replace(/2\s*k/g, '2k')
      .toLowerCase();
  }

  function extractLetter(raw) {
    if (!raw) return null;
    const firstLine = raw.trim().split('\n')[0].trim();

    // 1. Standalone single letter: "A", "B", "C", "D" or "(B)"
    const single = firstLine.match(/^\(?([A-Da-d])\)?[\.\:\-\)]?$/);
    if (single) return single[1].toUpperCase();

    // 2. Explicit prefix: "Answer: B", "Option B", "Correct: B"
    const explicit = firstLine.match(/^(?:answer|option|correct(?:\s+answer|\s+option)?)\s*[:\-]?\s*\(?([A-Da-d])\b/i);
    if (explicit) return explicit[1].toUpperCase();

    // 3. Leading option letter: "B) 2^k", "B. 2^k", "B - 2^k"
    const leading = firstLine.match(/^([A-Da-d])[\)\.\:\-]\s+/);
    if (leading) return leading[1].toUpperCase();

    return null;
  }

  function getOptions(root = document) {
    // 1. Prefer real visible radio inputs
    const allRadios = Array.from(root.querySelectorAll('input[type="radio"]'));
    const visibleRadios = allRadios.filter((r) => r.offsetParent !== null || r.checkVisibility?.() !== false);
    const radios = visibleRadios.length ? visibleRadios : allRadios;
    if (radios.length) {
      return radios.map((r) => ({
        input: r,
        el: r.closest('label') || (r.id && root.querySelector(`label[for="${CSS.escape(r.id)}"]`)) || r.parentElement,
      })).filter((o) => o.el);
    }

    // 2. ARIA role="radio"
    const ariaRadios = Array.from(root.querySelectorAll('[role="radio"]'))
      .filter((el) => el.offsetParent !== null || el.checkVisibility?.() !== false);
    if (ariaRadios.length) {
      return ariaRadios.map((el) => ({ input: null, el }));
    }

    // 3. Option card fallback on Examly
    const cards = Array.from(root.querySelectorAll('[class*="choice" i], [class*="option" i], [class*="answer" i]'))
      .filter((el) => el.offsetParent !== null && !el.matches('body, main, article, .question-container'));
    return cards.map((el) => ({ input: null, el }));
  }

  function click({ input, el }) {
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    if (input) {
      input.checked = true;
      input.click();
      input.dispatchEvent(new Event('change', { bubbles: true }));
      input.dispatchEvent(new Event('input', { bubbles: true }));
    } else {
      el.click();
      el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
    }
  }

  window.satoMcqSelector = {
    select(rawAnswer, root = document) {
      const options = getOptions(root);
      if (!options.length) throw new Error('No MCQ options found on page. Make sure the question options are visible.');

      // Priority 1: Exact text / math matching (Most reliable - prevents picking wrong positional letter)
      const firstLine = (rawAnswer || '').trim().split('\n')[0].trim();
      const ansText = stripLetter(firstLine);
      const ansMath = cleanMathExpr(ansText);

      if (ansText.length >= 1) {
        for (const o of options) {
          const rawOpt = o.el.innerText || o.el.textContent || '';
          const tText = stripLetter(rawOpt);
          const tMath = cleanMathExpr(tText);

          // Exact text match or exact math formula match
          if (tText === ansText || (ansMath.length >= 2 && tMath === ansMath)) {
            click(o);
            return rawOpt.trim().slice(0, 40);
          }
        }
      }

      // Priority 2: Explicit Letter match ("A", "B", "C", "D")
      const letter = extractLetter(rawAnswer);
      if (letter) {
        const idx = letter.charCodeAt(0) - 65;
        // Search by prefix in option text first: "B) ..."
        const byPrefix = options.find((o) => {
          const m = norm(o.el.innerText).match(/^([a-d])\b[\)\.\:\-]?\s/);
          return m && m[1].toUpperCase() === letter;
        });
        const hit = byPrefix || options[idx];
        if (hit) {
          click(hit);
          return `Option ${letter} (${(hit.el.innerText || '').trim().slice(0, 30)})`;
        }
      }

      // Priority 3: Fuzzy / Substring word match
      if (ansText.length > 2) {
        for (const o of options) {
          const rawOpt = o.el.innerText || o.el.textContent || '';
          const tText = stripLetter(rawOpt);
          if (tText.includes(ansText) || ansText.includes(tText)) {
            click(o);
            return rawOpt.trim().slice(0, 40);
          }
        }
      }

      throw new Error(`Could not find an option matching "${firstLine.slice(0, 40)}". You can click it directly.`);
    }
  };
})();
