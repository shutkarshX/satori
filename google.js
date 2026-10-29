(() => {
  if (window.__satoriGoogleAdapterLoaded) return;
  window.__satoriGoogleAdapterLoaded = true;

  const state = {
    requestId: 0,
    mode: 'mcq',
    baselineText: '',
    baselineCode: '',
    quietTimer: null,
    lastSignature: ''
  };

  const clean = (value) => String(value || '')
    .replace(/\u00a0/g, ' ')
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .trim();

  const signature = (text) => `${text.length}:${text.slice(0, 100)}:${text.slice(-160)}`;
  const unavailable = /AI\s*Overview\s*is\s*not\s*available|Can'?t\s*generate\s*an\s*AI\s*overview|No\s*AI\s*Overview\s*available/i;

  const isTransientPlaceholder = (val) => {
    const s = String(val || '').replace(/^AI\s*Overview\s*/i, '').trim();
    if (!s || s.length < 15) return true;
    if (/^(thinking|loading|generating)(\.\.\.)?$/i.test(s)) return true;
    if (/^thinking\s*generative ai is experimental/i.test(s)) return true;
    if (/^(generative ai is experimental|learning more)/i.test(s) && s.length < 120) return true;
    if (/^AI\s*Overview\s*(is\s*)?(thinking|generating|loading)/i.test(s)) return true;
    return false;
  };

  function readOverview(mode = 'mcq') {
    // 1. Strict AI Overview selectors ONLY
    const selectors = [
      '[data-attrid="wa"]',
      '[data-attrid="AIOverview"]',
      '[data-mce-source]',
      'div[jsname="N760b"]',
      'div[data-async-context*="generative"]',
      'div[aria-label*="AI Overview" i]'
    ];
    const nodes = selectors.flatMap((selector) => [...document.querySelectorAll(selector)]);
    const isExcluded = (node) => Boolean(node.closest?.('.commercial-unit, #tads, .pla-unit, [data-text-ad]'));
    const candidates = nodes.map((node) => clean(node.innerText || node.textContent || '')).filter((text) => text.length > 40);
    nodes.forEach((node) => {
      if (isExcluded(node)) return;
      let parent = node;
      for (let depth = 0; depth < 8 && parent; depth += 1, parent = parent.parentElement) {
        // Exclude organic search results, google ads, shopping carousel
        if (parent.id === 'rso') break;
        if (isExcluded(parent)) break;
        const text = clean(parent.innerText || '');
        if (text.length > 40 && text.length < 20000) candidates.push(text);
      }
    });

    const labels = [...document.querySelectorAll('h1,h2,h3,[role="heading"],div,span')]
      .filter((node) => /^AI Overview$/i.test((node.innerText || '').trim()));
    labels.forEach((label) => {
      let parent = label;
      for (let depth = 0; depth < 8 && parent; depth += 1, parent = parent.parentElement) {
        if (parent.id === 'rso') break;
        if (isExcluded(parent)) break;
        const nearby = clean(parent.innerText || '');
        if (nearby.length > 60 && nearby.length < 20000) {
          candidates.push(nearby);
          break;
        }
      }
    });

    // Filter out shopping ads, product results, unavailable banners, and transient loading/thinking placeholders
    const validCandidates = candidates
      .filter((value) => !unavailable.test(value) && !isTransientPlaceholder(value) && !/^(Shopping|Sponsored|Ads|Top ads)/i.test(value) && !value.includes('.o3lpyf') && !value.includes('var(--'))
      .map((val) => val.replace(/^AI\s+Overview\s*/i, '').trim())
      .filter((val) => !isTransientPlaceholder(val));

    const text = validCandidates.sort((a, b) => b.length - a.length)[0] || '';

    // Extract Code Blocks specifically
    // In Google AI Mode, code is rendered inside a dedicated dark code card containing "Use code with caution" and a Copy button at the bottom.
    const codeCandidates = [];

    // Find the Copy buttons on Google Search
    const copyButtons = [...document.querySelectorAll('button, [role="button"]')].filter(btn => {
      const label = (btn.innerText || btn.getAttribute('aria-label') || btn.getAttribute('title') || '').toLowerCase();
      const hasCopyIcon = Boolean(btn.querySelector('svg, path[d*="M16 1H4"], path[d*="M19 3H5"], path[d*="copy" i]'));
      return label.includes('copy') || hasCopyIcon || btn.closest('[class*="code" i]')?.querySelector('button') === btn;
    });

    copyButtons.forEach(btn => {
      let card = btn.closest('pre, [class*="code-block" i], [class*="snippet" i], div');
      for (let depth = 0; depth < 5 && card; depth++) {
        const pre = card.querySelector('pre, code');
        if (pre) {
          const rawCode = clean(pre.innerText || pre.textContent || '')
            .replace(/^Use code with caution\.\s*/i, '')
            .replace(/Copy code\s*$/i, '')
            .trim();
          if (rawCode.length >= 50 && !rawCode.includes('window.sn=') && !rawCode.includes('var(--')) {
            codeCandidates.push(rawCode);
            return;
          }
        }
        card = card.parentElement;
      }
    });

    // Strategy 2: Pre or Code elements directly (the code box itself)
    if (codeCandidates.length === 0) {
      const preElements = [...document.querySelectorAll('pre, [role="region"] pre, .code-block pre')];
      preElements.forEach(pre => {
        const rawCode = clean(pre.innerText || pre.textContent || '')
          .replace(/^Use code with caution\.\s*/i, '')
          .replace(/Copy code\s*$/i, '')
          .trim();
        if (rawCode.length >= 50 && !rawCode.includes('window.sn=') && !rawCode.includes('var(--')) {
          codeCandidates.push(rawCode);
        }
      });
    }

    // Strategy 3: Markdown fenced code blocks (if raw text generated)
    if (codeCandidates.length === 0) {
      const fenced = [...(document.body.innerText || '').matchAll(/```(?:c|cpp|c\+\+|java|python|javascript)?\s*([\s\S]*?)```/g)]
        .map(match => clean(match[1]))
        .filter(val => val.length >= 50 && !val.includes('window.sn=') && !val.includes('var(--'));
      codeCandidates.push(...fenced);
    }

    const code = codeCandidates
      .filter((c) => !unavailable.test(c) && !c.includes('var(--') && !c.includes('.o3lpyf') && !c.includes('window.sn='))
      .sort((a, b) => b.length - a.length)[0] || '';

    const isActivelyGenerating = Boolean(
      document.querySelector('[aria-busy="true"], [data-loading="true"], [role="progressbar"], div[jsname="N760b"] [class*="shimmer" i], div[jsname="N760b"] [class*="loading" i]') ||
      /^(thinking|loading|generating)/im.test(document.body?.innerText || '')
    );

    return {
      text,
      code,
      loading: isActivelyGenerating || (!text && !code)
    };
  }

  const report = (type, detail) => {
    try {
      chrome.runtime.sendMessage({ type, requestId: state.requestId, detail });
    } catch (_error) {}
  };

  const inspect = () => {
    if (!state.requestId) return;
    const reading = readOverview(state.mode);
    if (reading.loading) return; // Still actively generating

    const selected = state.mode === 'coding' ? reading.code : reading.text;
    if (!selected || isTransientPlaceholder(selected) || unavailable.test(selected) || selected.includes('var(--') || selected.includes('.o3lpyf') || selected.includes('window.sn=')) return;

    const baseline = state.mode === 'coding' ? state.baselineCode : state.baselineText;
    const sig = signature(selected);
    if (sig === state.lastSignature || (baseline && selected === baseline)) return;

    clearTimeout(state.quietTimer);
    state.quietTimer = setTimeout(() => {
      if (!state.requestId) return;
      const current = readOverview(state.mode);
      if (current.loading) return;

      const finalSelected = state.mode === 'coding' ? current.code : current.text;
      const finalSig = signature(finalSelected);
      if (!finalSelected || isTransientPlaceholder(finalSelected) || unavailable.test(finalSelected) || finalSelected.includes('var(--') || finalSelected.includes('window.sn=') || finalSig === state.lastSignature) return;

      state.lastSignature = finalSig;
      const capturedRequestId = state.requestId;
      state.requestId = 0;
      report('GOOGLE_RESPONSE', {
        requestId: capturedRequestId,
        mode: state.mode,
        text: current.text,
        code: current.code,
        capturedAt: Date.now()
      });
    }, 900);
  };

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message.type === 'PING_GOOGLE') {
      sendResponse({ ok: true });
      return true;
    }

    if (message.type === 'READ_GOOGLE_AI_OVERVIEW') {
      try {
        sendResponse({ ok: true, ...readOverview(message.mode || 'mcq') });
      } catch (error) {
        sendResponse({ ok: false, error: error.message });
      }
      return true;
    }

    if (message.type === 'START_GOOGLE_WATCH') {
      state.requestId = message.requestId || Date.now();
      state.mode = message.mode || 'mcq';
      state.baselineText = clean(message.baselineText || '');
      state.baselineCode = clean(message.baselineCode || '');
      state.lastSignature = '';
      clearTimeout(state.quietTimer);
      inspect();
      sendResponse({ ok: true });
      return true;
    }

    if (message.type === 'STOP_GOOGLE_WATCH') {
      state.requestId = 0;
      clearTimeout(state.quietTimer);
      state.quietTimer = null;
      sendResponse({ ok: true });
      return true;
    }

    return false;
  });

  const observer = new MutationObserver(inspect);
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    characterData: true
  });
})();
