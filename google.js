(() => {
  if (window.__satoriGoogleAdapterLoaded) return;
  window.__satoriGoogleAdapterLoaded = true;

  const clean = (value) => String(value || '')
    .replace(/\u00a0/g, ' ')
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .trim();

  function readOverview(mode = 'mcq') {
    const selectors = ['[data-attrid="wa"]', '[data-attrid="AIOverview"]', '[data-mce-source]', 'div[jsname="N760b"]'];
    const nodes = selectors.flatMap((selector) => [...document.querySelectorAll(selector)]);
    const candidates = nodes.map((node) => clean(node.innerText || node.textContent || '')).filter((text) => text.length > 40);
    nodes.forEach((node) => {
      let parent = node;
      for (let depth = 0; depth < 7 && parent; depth += 1) {
        const text = clean(parent.innerText || '');
        if (text.length > 40 && text.length < 40000) candidates.push(text);
        parent = parent.parentElement;
      }
    });
    const label = [...document.querySelectorAll('h1,h2,h3,div,span')].find((node) => /^AI Overview$/i.test((node.innerText || '').trim()));
    if (label?.parentElement) {
      const nearby = clean(label.parentElement.parentElement?.innerText || label.parentElement.innerText || '');
      if (nearby.length > 40) candidates.push(nearby);
    }
    const unavailable = /AI\s*Overview\s*is\s*not\s*available|Can'?t\s*generate\s*an\s*AI\s*overview|No\s*AI\s*Overview\s*available/i;
    const text = candidates.filter((value) => !unavailable.test(value)).sort((a, b) => b.length - a.length)[0]?.replace(/^AI\s+Overview\s*/i, '').trim() || '';
    const codeCandidates = [...document.querySelectorAll('pre code, pre, [role="textbox"][aria-label*="code" i]')]
      .map((node) => clean(node.innerText || node.textContent || '')).filter((value) => value.length > 20);
    const fenced = [...(document.body.innerText || '').matchAll(new RegExp('```[^\\n]*\\n?([\\s\\S]*?)```', 'g'))]
      .map((match) => clean(match[1])).filter((value) => value.length > 20);
    const code = [...codeCandidates, ...fenced].sort((a, b) => b.length - a.length)[0] || '';
    return { text, code, loading: /generating|loading/i.test(document.body?.innerText || '') && !text };
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message.type === 'PING_GOOGLE') { sendResponse({ ok: true }); return true; }
    if (message.type === 'READ_GOOGLE_AI_OVERVIEW') {
      try { sendResponse({ ok: true, ...readOverview(message.mode || 'mcq') }); }
      catch (error) { sendResponse({ ok: false, error: error.message }); }
      return true;
    }
    return false;
  });
})();