(() => {
  window.__satoriGoogleAdapterLoaded = Date.now();

  const state = {
    requestId: 0,
    mode: 'mcq',
    baselineText: '',
    baselineCode: '',
    quietTimer: null,
    lastSignature: '',
    aiModeTriggered: false,
    startTime: 0
  };

  function sendLiveTelemetry(event, details = '') {
    try {
      chrome.runtime.sendMessage({
        type: 'LIVE_TELEMETRY',
        event: `[google] ${event}`,
        details,
        url: location.href
      });
    } catch (_e) {}
  }

  const clean = (value) => String(value || '')
    .replace(/\u00a0/g, ' ')
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .trim();

  const signature = (text) => `${text.length}:${text.slice(0, 100)}:${text.slice(-160)}`;
  const unavailable = /AI\s*Overview\s*(?:is\s*not|isn'?t)\s*available|Can'?t\s*generate\s*(?:an\s*)?AI\s*overview|No\s*AI\s*Overview\s*available/i;

  const isTransientPlaceholder = (val) => {
    const s = String(val || '').replace(/^AI\s*Overview\s*/i, '').trim();
    if (!s || s.length < 15) return true;
    if (/^(thinking|loading|generating)(\.\.\.)?$/i.test(s)) return true;
    if (/^thinking\s*generative ai is experimental/i.test(s)) return true;
    if (/^(generative ai is experimental|learning more)/i.test(s) && s.length < 120) return true;
    if (/^AI\s*Overview\s*(is\s*)?(thinking|generating|loading)/i.test(s)) return true;
    return false;
  };

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

  
  function tryTriggerAIMode() {
    if (state.aiModeTriggered) return false;

    // 1. Check for tab/link pointing to udm=50 (Google AI Mode)
    const aiModeLink = document.querySelector('a[href*="udm=50"]');
    if (aiModeLink) {
      state.aiModeTriggered = true;
      sendLiveTelemetry('SWITCHING_TO_AI_MODE_VIA_LINK', { href: aiModeLink.href });
      aiModeLink.click();
      return true;
    }

    // 2. Check for button / link / tab with text "AI Mode", "AI Overview", or "Generate"
    const candidates = [...document.querySelectorAll('a, button, [role="tab"], div[role="button"]')];
    const target = candidates.find(el => {
      const t = (el.innerText || el.textContent || '').trim().toLowerCase();
      return t === 'ai mode' || t === 'ai overview' || t === 'generate' || t.startsWith('get an ai overview');
    });

    if (target) {
      state.aiModeTriggered = true;
      sendLiveTelemetry('SWITCHING_TO_AI_MODE_VIA_BUTTON', { text: (target.innerText || '').slice(0, 30) });
      target.click();
      return true;
    }

    // 3. Fallback: Append udm=50 to current URL to force Google AI Mode
    if (!window.location.search.includes('udm=50')) {
      state.aiModeTriggered = true;
      sendLiveTelemetry('SWITCHING_TO_AI_MODE_VIA_URL_REDIRECT');
      const newUrl = new URL(window.location.href);
      newUrl.searchParams.set('udm', '50');
      window.location.href = newUrl.toString();
      return true;
    }

    return false;
  }

  function checkImmediateGenerateButton() {
    const genButtons = [...document.querySelectorAll('button, [role="button"]')].filter(b => {
      const t = (b.innerText || b.getAttribute('aria-label') || '').trim().toLowerCase();
      return t === 'generate' || t.startsWith('get an ai overview');
    });
    for (const btn of genButtons) {
      if (!btn.__satoriGenClicked) {
        btn.__satoriGenClicked = true;
        try {
          btn.click();
          sendLiveTelemetry('GOOGLE_GENERATE_BUTTON_CLICKED');
        } catch (_e) {}
      }
    }
  }

  function looksLikeCode(str) {
    if (!str || typeof str !== 'string') return false;
    const s = str.trim();
    if (s.length < 30) return false;
    if (/(#include|import\s+(?:sys|math|os|java|stdio|vector)|from\s+\w+\s+import|using\s+namespace|package\s+\w+)/i.test(s)) return true;
    if (/(class\s+\w+|def\s+\w+\s*\(|function\s+\w+\s*\(|public\s+(?:static\s+)?void\s+main|\bint\s+main|\bvoid\s+main)/i.test(s)) return true;
    if (/(?:scanf|printf|cin\s*>>|cout\s*<<|System\.out\.print|print\s*\(|console\.log)/i.test(s)) return true;
    if (/(\bint\b|\bvoid\b|\bchar\b|\bfloat\b|\bdouble\b|\bbool\b)\s+\w+\s*[\(\=;]/i.test(s)) return true;
    if (/(for\s*\(.*?;.*?;.*?\)|while\s*\(.*?\)|if\s*\(.*?\)\s*\{|return\s+0;)/i.test(s)) return true;
    const lines = s.split('\n');
    const codeyLines = lines.filter(l => /[;{}()=\[\]]/.test(l) || /^\s{4,}/.test(l)).length;
    if (lines.length >= 3 && codeyLines / lines.length > 0.35) return true;
    return false;
  }

  function extractCodeBlock(text) {
    if (!text) return '';
    const fenced = text.match(/```(?:c|cpp|c\+\+|java|python|javascript|js)?\s*([\s\S]*?)```/i);
    if (fenced && fenced[1] && fenced[1].trim().length >= 30) return fenced[1].trim();
    const startMatch = text.match(/(?:^|\n)\s*(#include|import\s+|class\s+|def\s+|void\s+|int\s+main|using\s+namespace)/i);
    if (startMatch && startMatch.index !== undefined) {
      const sub = text.slice(startMatch.index);
      const endMatch = sub.match(/\n\s*(?:###\s*(?:Explanation|How it works|Complexity)|Key Highlights:|Explanation:\s*\n|Note:\s*This code|Here is how the code works:)/i);
      if (endMatch && endMatch.index !== undefined && endMatch.index > 25) {
        return sub.slice(0, endMatch.index).trim();
      }
      return sub.trim();
    }
    return text.trim();
  }

  function readOverview(mode = 'mcq') {
    // 1. Strict AI Overview selectors
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

    const validCandidates = candidates
      .filter((value) => !unavailable.test(value) && !isTransientPlaceholder(value) && !/^(Shopping|Sponsored|Ads|Top ads)/i.test(value) && !value.includes('.o3lpyf') && !value.includes('var(--'))
      .map((val) => val.replace(/^AI\s+Overview\s*/i, '').trim())
      .filter((val) => !isTransientPlaceholder(val));

    const text = validCandidates.sort((a, b) => b.length - a.length)[0] || '';

    // ---------------------------------------------------------
    // Extract Code Blocks specifically from Google Search AI Mode
    // ---------------------------------------------------------
    const codeCandidates = [];

    // Strategy 1: Find Google's "Use code with caution." card & click ONLY its specific Copy button
    const allElements = Array.from(document.querySelectorAll('*'));
    const cautionElements = allElements.filter(el => {
      const t = (el.textContent || '').trim();
      return (t === 'Use code with caution.' || t === 'Use code with caution' || (t.startsWith('Use code with caution') && t.length < 40)) &&
             el.children.length === 0;
    });

    cautionElements.forEach((cautionEl) => {
      // Find copy button ONLY in the exact footer bar containing this caution text
      const parentBar = cautionEl.parentElement;
      if (parentBar) {
        // The copy button is specifically inside this bar and has aria-label="Copy code" / "Copy", or is the button in this bar
        const copyBtn = parentBar.querySelector('button[aria-label*="copy" i], [role="button"][aria-label*="copy" i], button');
        if (copyBtn && !copyBtn.__satoriClicked) {
          copyBtn.__satoriClicked = true;
          try {
            copyBtn.click();
            sendLiveTelemetry('GOOGLE_COPY_BUTTON_CLICKED', {
              tag: copyBtn.tagName,
              aria: copyBtn.getAttribute('aria-label') || copyBtn.getAttribute('title') || ''
            });
          } catch (_e) {}
        }
      }

      // Ancestor code container: walk up to find the container holding both code and caution footer
      let container = cautionEl.parentElement;
      for (let depth = 0; depth < 6 && container; depth++, container = container.parentElement) {
        if (container.id === 'rso' || container.id === 'search' || container.tagName === 'BODY') break;
        const raw = clean(container.innerText || container.textContent || '');
        if (raw.length >= 40 && raw.includes('Use code with caution')) {
          const codePart = raw
            .replace(/\n?\s*Use code with caution[\s\S]*$/i, '')
            .replace(/Copy code\s*$/i, '')
            .trim();
          if (codePart.length >= 30 && looksLikeCode(codePart) && !codePart.includes('window.sn=') && !codePart.includes('var(--')) {
            codeCandidates.push(stripLeadingLanguageTag(codePart));
            break;
          }
        }
      }
    });

    // Strategy 2: If not found, strictly look for buttons with aria-label specifically containing "Copy code"
    if (codeCandidates.length === 0) {
      const copyButtons = [...document.querySelectorAll('button[aria-label*="Copy code" i], [role="button"][aria-label*="Copy code" i]')];
      copyButtons.forEach(btn => {
        if (!btn.__satoriClicked) {
          btn.__satoriClicked = true;
          try {
            btn.click();
            sendLiveTelemetry('GOOGLE_COPY_BUTTON_CLICKED_BY_ARIA', { aria: btn.getAttribute('aria-label') || '' });
          } catch (_e) {}
        }

        let card = btn.parentElement;
        for (let depth = 0; depth < 6 && card; depth++, card = card.parentElement) {
          if (card.id === 'rso' || card.tagName === 'BODY') break;
          const pre = card.querySelector('pre, code');
          const sourceText = pre ? (pre.innerText || pre.textContent || '') : (card.innerText || card.textContent || '');
          const rawCode = clean(sourceText)
            .replace(/^Use code with caution\.\s*/i, '')
            .replace(/\n?\s*Use code with caution[\s\S]*$/i, '')
            .replace(/Copy code\s*$/i, '')
            .trim();
          if (rawCode.length >= 40 && looksLikeCode(rawCode) && !rawCode.includes('window.sn=') && !rawCode.includes('var(--')) {
            codeCandidates.push(stripLeadingLanguageTag(rawCode));
            break;
          }
        }
      });
    }

    // Strategy 3: Pre or Code elements directly (read-only, no clicking)
    if (codeCandidates.length === 0) {
      const preElements = [...document.querySelectorAll('pre, [role="region"] pre, .code-block pre')];
      preElements.forEach(pre => {
        const rawCode = clean(pre.innerText || pre.textContent || '')
          .replace(/^Use code with caution\.\s*/i, '')
          .replace(/\n?\s*Use code with caution[\s\S]*$/i, '')
          .replace(/Copy code\s*$/i, '')
          .trim();
        if (rawCode.length >= 40 && looksLikeCode(rawCode) && !rawCode.includes('window.sn=') && !rawCode.includes('var(--')) {
          codeCandidates.push(stripLeadingLanguageTag(rawCode));
        }
      });
    }

    // Strategy 4: Markdown fenced code blocks or raw text extraction
    if (codeCandidates.length === 0) {
      const fenced = [...(document.body.innerText || '').matchAll(/\`\`\`(?:c|cpp|c\+\+|java|python|javascript)?\s*([\s\S]*?)\`\`\`/g)]
        .map(match => clean(match[1]))
        .filter(val => val.length >= 40 && !val.includes('window.sn=') && !val.includes('var(--'));
      codeCandidates.push(...fenced);
    }

    // Strategy 5: Extract from text if text contains code
    if (codeCandidates.length === 0 && text) {
      const extracted = extractCodeBlock(text);
      if (extracted && extracted.length >= 35 && looksLikeCode(extracted) && !extracted.includes('window.sn=') && !extracted.includes('var(--')) {
        codeCandidates.push(stripLeadingLanguageTag(extracted));
      }
    }

    const code = codeCandidates
      .filter((c) => !unavailable.test(c) && !c.includes('var(--') && !c.includes('.o3lpyf') && !c.includes('window.sn='))
      .sort((a, b) => b.length - a.length)[0] || '';

    const isActivelyGenerating = Boolean(
      document.querySelector('[aria-busy="true"], [data-loading="true"], [role="progressbar"], div[jsname="N760b"] [class*="shimmer" i], div[jsname="N760b"] [class*="loading" i]')
    );

    // If in coding mode and code is captured, we are DONE (never block on residual loading shimmers)
    const isLoading = mode === 'coding'
      ? (!code || isTransientPlaceholder(code))
      : (isActivelyGenerating || (!text && !code));

    return {
      text,
      code,
      loading: isLoading
    };
  }

  const report = (type, detail) => {
    sendLiveTelemetry(type, detail);
    try {
      chrome.runtime.sendMessage({ type, requestId: state.requestId, detail });
    } catch (_error) {}
  };

  function checkAndTriggerAIModeIfAppropriate(reading) {
    if (state.aiModeTriggered) return false;

    const pageText = document.body ? (document.body.innerText || '') : '';

    // Condition A: Google explicitly displays "An AI Overview is not available"
    if (unavailable.test(pageText)) {
      sendLiveTelemetry('AI_MODE_TRIGGERED_BY_UNAVAILABLE_BANNER', { preview: pageText.slice(0, 100) });
      return tryTriggerAIMode();
    }

    // Condition B: Google shows a "Generate" / "Get an AI overview" button
    checkImmediateGenerateButton();

    // Condition C: For coding mode, if results loaded (#rso present, no loading spinners) but no code card exists
    if (state.mode === 'coding' && !reading?.code) {
      const hasFinishedSearch = Boolean(document.querySelector('#rso, #center_col, #search'));
      const hasSpinners = Boolean(document.querySelector('[aria-busy="true"], [role="progressbar"], div[jsname="N760b"] [class*="loading" i]'));
      const elapsed = Date.now() - (state.startTime || Date.now());

      if ((hasFinishedSearch && !hasSpinners && !reading?.loading) || elapsed > 3000) {
        sendLiveTelemetry('AI_MODE_TRIGGERED_NO_CODE_IN_OVERVIEW');
        return tryTriggerAIMode();
      }
    }

    return false;
  }

  const inspect = () => {
    if (!state.requestId) return;
    const reading = readOverview(state.mode);
    checkAndTriggerAIModeIfAppropriate(reading);
    if (reading.loading) return; // Still actively generating

    const selected = state.mode === 'coding' ? reading.code : reading.text;
    if (!selected || isTransientPlaceholder(selected) || unavailable.test(selected) || selected.includes('var(--') || selected.includes('.o3lpyf') || selected.includes('window.sn=')) return;

    const baseline = state.mode === 'coding' ? state.baselineCode : state.baselineText;
    const sig = signature(selected);
    if (sig === state.lastSignature || (baseline && selected === baseline)) return;

    clearTimeout(state.quietTimer);
    // Instant dispatch (250ms quiet time) once solid code candidate is detected
    const delay = state.mode === 'coding' ? 250 : 800;
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
    }, delay);
  };

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message.type === 'PING_GOOGLE') {
      sendResponse({ ok: true });
      return true;
    }

    if (message.type === 'READ_GOOGLE_AI_OVERVIEW') {
      try {
        const overview = readOverview(message.mode || 'mcq');
        sendResponse({ ok: true, ...overview });
      } catch (error) {
        sendResponse({ ok: false, error: error.message });
      }
      return true;
    }

    if (message.type === 'FORCE_AI_MODE') {
      tryTriggerAIMode();
      sendResponse({ ok: true });
      return true;
    }

    if (message.type === 'START_GOOGLE_WATCH') {
      state.requestId = message.requestId || Date.now();
      state.mode = message.mode || 'mcq';
      state.baselineText = clean(message.baselineText || '');
      state.baselineCode = clean(message.baselineCode || '');
      state.lastSignature = '';
      state.startTime = Date.now();
      state.aiModeTriggered = false;
      sendLiveTelemetry('START_GOOGLE_WATCH', { requestId: state.requestId, mode: state.mode });
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
