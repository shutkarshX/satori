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
    const t = raw.trim();
    // Only accept explicit formats: "B", "B)", "Answer: B", with word boundaries to avoid English "a" or "All"
    const m =
      t.match(/^\(?([A-Da-d])\)?[\.\:\-\)]?$/) ||
      t.match(/^(?:answer|option|correct(?: answer)?)\s*(?:is)?\s*[:\-]?\s*\(?([A-Da-d])\b/i) ||
      t.match(/^\(?([A-Da-d])\b[\)\.\:\-]?\s/);
    return m ? m[1].toUpperCase() : null;
  }

  function getOptions(root = document) {
    // 1. Prefer real radio inputs
    const radios = Array.from(root.querySelectorAll('input[type="radio"]'));
    if (radios.length) {
      return radios.map((r) => ({
        input: r,
        el: r.closest('label') || (r.id && root.querySelector(`label[for="${CSS.escape(r.id)}"]`)) || r.parentElement,
      })).filter((o) => o.el);
    }
    // 2. ARIA role="radio"
    const ariaRadios = Array.from(root.querySelectorAll('[role="radio"]'));
    if (ariaRadios.length) {
      return ariaRadios.map((el) => ({ input: null, el }));
    }
    // 3. Option card fallback
    const cards = Array.from(root.querySelectorAll('[class*="choice-card" i], [class*="option-card" i]'));
    return cards.map((el) => ({ input: null, el }));
  }

  function click({ input, el }) {
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    (input || el).click();
  }

  window.satoMcqSelector = {
    select(rawAnswer, root = document) {
      const options = getOptions(root);
      if (!options.length) throw new Error('No MCQ options found on page');

      // 1. Letter match (by prefix like "A)", or by 0-indexed position A=0, B=1, etc.)
      const letter = extractLetter(rawAnswer);
      if (letter) {
        const idx = letter.charCodeAt(0) - 65;
        const byPrefix = options.find((o) => {
          const m = norm(o.el.innerText).match(/^([a-d])\b[\)\.\:\-]?\s/);
          return m && m[1].toUpperCase() === letter;
        });
        const hit = byPrefix || options[idx];
        if (hit) {
          click(hit);
          return `Option ${letter}`;
        }
      }

      // 2. Text / Math match: exact first, then math normalized, then best scored partial match
      const ans = stripLetter(rawAnswer.split('\n')[0]);
      const ansMath = cleanMathExpr(ans);

      const scored = options.map((o) => {
        const rawOpt = o.el.innerText || o.el.textContent || '';
        const t = stripLetter(rawOpt);
        const tMath = cleanMathExpr(t);
        let score = 0;

        if (t === ans || (ansMath.length >= 2 && tMath === ansMath)) {
          score = 5;
        } else if (t.length > 2 && ans.length > 2 && (t.includes(ans) || ans.includes(t))) {
          score = Math.min(t.length, ans.length) / Math.max(t.length, ans.length);
        } else if (ansMath.length >= 2 && (tMath.includes(ansMath) || ansMath.includes(tMath))) {
          score = 2;
        }
        return { o, score, length: t.length };
      }).filter((x) => x.score > 0.4).sort((a, b) => b.score - a.score || a.length - b.length);

      if (scored.length) {
        click(scored[0].o);
        return scored[0].o.el.innerText.trim().slice(0, 30);
      }

      throw new Error(`No matching option for: "${rawAnswer.slice(0, 40)}"`);
    }
  };
})();
