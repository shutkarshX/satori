// DOM scraper for Examly problem statements & MCQ choice cards
(() => {
  if (window.__satoExtractorLoaded) return;
  window.__satoExtractorLoaded = true;
  let targetContainer = null;

  function clean(raw) {
    return (raw || '').replace(/\u00a0/g, ' ').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  }

  function scrapeCode() {
    const selectors = [
      '[class*="problem-statement" i]', '[class*="statement" i]', '[class*="question-description" i]',
      '[class*="problem" i]', '[class*="question" i]', '[class*="description" i]',
      '[class*="left-pane" i]', '[class*="left-panel" i]', 'article', 'main', '.content'
    ];
    let best = '';
    for (const sel of selectors) {
      for (const el of Array.from(document.querySelectorAll(sel))) {
        if (el.matches('textarea, .monaco-editor, .CodeMirror, button, nav, header')) continue;
        if (el.closest('.monaco-editor, .CodeMirror')) continue;
        const clone = el.cloneNode(true);
        clone.querySelectorAll('textarea, .monaco-editor, .CodeMirror, script, style, nav, button').forEach((n) => n.remove());
        const cleaned = clean(clone.innerText || clone.textContent);
        if (cleaned.length > best.length && cleaned.length > 50) {
          best = cleaned;
        }
      }
      if (best.length > 100) return best;
    }
    if (best.length > 30) return best;

    const bodyClone = document.body.cloneNode(true);
    bodyClone.querySelectorAll('.monaco-editor, .CodeMirror, textarea, nav, header, footer, script, style, button').forEach((n) => n.remove());
    return clean(bodyClone.innerText || bodyClone.textContent).slice(0, 4000);
  }

  function scrapeMcq() {
    const containers = Array.from(document.querySelectorAll('.box, .question-container, [class*="question" i], [class*="problem" i], article'));
    for (const c of containers) {
      const radios = c.querySelectorAll('input[type="radio"], [role="radio"]');
      if (radios.length > 0 && !Array.from(radios).some((r) => r.checked || r.getAttribute('aria-checked') === 'true')) {
        targetContainer = c;
        const clone = c.cloneNode(true);
        clone.querySelectorAll('nav, header, footer, script, style, .tag, h2, button').forEach((e) => e.remove());
        return clean(clone.innerText || clone.textContent);
      }
    }
    return '';
  }

  function detectLanguage() {
    const langBtn = Array.from(document.querySelectorAll('button, select, [role="button"], span, div'))
      .find((el) => /^(C\s*\(17\)|C\+\+|Java|Python|JavaScript|TypeScript|C#)/i.test((el.innerText || el.textContent || '').trim()));
    return langBtn ? (langBtn.innerText || langBtn.textContent || '').trim() : '';
  }

  window.satoExtractor = {
    async addSnippet() {
      return window.satoSnippetClient.addSnippet();
    },
    async clearSnippets() {
      return window.satoSnippetClient.clearSnippets();
    },
    async extract(mode = 'code') {
      const list = await window.satoSnippetClient.getSnippets();
      let text = '';
      if (list && list.length > 0) {
        text = list.join('\n\n---\n\n');
      } else {
        const sel = window.satoSnippetClient.getSelectionText();
        text = (sel && sel.length > 5) ? sel : (mode === 'mcq' ? scrapeMcq() : scrapeCode());
      }
      if (!text || text.length < 5) throw new Error('Could not find question description on this page. Highlight text or use Alt+S.');

      if (mode === 'code') {
        const lang = detectLanguage();
        if (lang) text = `Programming Language: ${lang}\n\n${text}`;
      }
      return { text, snippetCount: (list ? list.length : 0) };
    },
    getLastContainer() {
      return targetContainer || document;
    }
  };
})();
