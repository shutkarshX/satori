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

    // Filter out shopping ads, product results, and unavailable banners
    const text = candidates
      .filter((value) => !unavailable.test(value) && !/^(Shopping|Sponsored|Ads|Top ads)/i.test(value))
      .sort((a, b) => b.length - a.length)[0]
      ?.replace(/^AI\s+Overview\s*/i, '')
      .trim() || '';

    // Extract Code Blocks specifically
    // Strategy 1: Look for Google's code container / copy box
    // Google AI Overview renders code in elements with copy buttons, code blocks, or role="textbox"
    const codeCandidates = [];

    // Find any copy button inside AI overview or code blocks: buttons with "Copy", aria-label="Copy code", etc.
    const copyButtons = [...document.querySelectorAll('button, [role="button"]')].filter(btn => 
      /copy(\s*code)?/i.test(btn.innerText || btn.getAttribute('aria-label') || '')
    );
    copyButtons.forEach(btn => {
      // The code snippet is in the parent/sibling container of the copy button
      const container = btn.closest('[jscontroller], pre, [class*="code" i], div') || btn.parentElement;
      if (container) {
        const rawCode = clean(container.querySelector('pre, code, [role="textbox"]')?.innerText || container.innerText || '');
        const filtered = rawCode.replace(/^copy(\s*code)?\s*/i, '').trim();
        if (filtered.length > 20) codeCandidates.push(filtered);
      }
    });

    // Strategy 2: Pre / Code tags and textboxes
    const standardCodeEls = [...document.querySelectorAll('pre code, pre, [role="textbox"][aria-label*="code" i], .code-block, div[class*="highlight" i]')];
    standardCodeEls.forEach(el => {
      const c = clean(el.innerText || el.textContent || '');
      if (c.length > 20) codeCandidates.push(c);
    });

    // Strategy 3: Markdown fenced blocks
    const fenced = [...(document.body.innerText || '').matchAll(/```[^\n]*\n?([\s\S]*?)```/g)]
      .map((match) => clean(match[1]))
      .filter((value) => value.length > 20);

    const code = [...codeCandidates, ...fenced].sort((a, b) => b.length - a.length)[0] || '';

    return {
      text,
      code,
      loading: /generating|loading/i.test(document.body?.innerText || '') && !text
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
    const selected = state.mode === 'coding' ? reading.code : reading.text;
    if (!selected || unavailable.test(selected)) return;

    const baseline = state.mode === 'coding' ? state.baselineCode : state.baselineText;
    const sig = signature(selected);
    if (sig === state.lastSignature || (baseline && selected === baseline)) return;

    clearTimeout(state.quietTimer);
    state.quietTimer = setTimeout(() => {
      if (!state.requestId) return;
      const current = readOverview(state.mode);
      const finalSelected = state.mode === 'coding' ? current.code : current.text;
      const finalSig = signature(finalSelected);
      if (!finalSelected || unavailable.test(finalSelected) || finalSig === state.lastSignature) return;

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
