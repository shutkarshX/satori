// Service-worker poller for Gemini responses, keyed by workflow run ID.
(() => {
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const abortedRuns = new Set();

  function sanitizeCode(raw) {
    if (!raw) return '';
    return raw
      .replace(/^```(?:java|c\+\+|cpp|c|python|py|javascript|js|typescript|ts|csharp|cs)?\s*\n/i, '')
      .replace(/```\s*$/i, '')
      .replace(/^(?:java|c\+\+|cpp|c|python|py|javascript|js|typescript|ts|csharp|cs)\s+(?=(?:#include|import|public|class|def|package))/i, '')
      .trim();
  }

  function readGeminiState() {
    const nodes = document.querySelectorAll(
      'model-response, message-content, [data-message-author-role="model"], .model-response-text, [data-test-id*="model-response" i]'
    );
    const latest = nodes[nodes.length - 1];
    const text = latest ? (latest.innerText || latest.textContent || '').trim() : '';
    const codeEl = latest?.querySelector('pre code, pre, [data-code-block], [class*="code-block" i]');
    const rawCode = codeEl ? (codeEl.innerText || codeEl.textContent || '').trim() : '';
    const match = text.match(/```(?:[a-zA-Z0-9_+#.-]+)?\s*\n([\s\S]*?)```/);
    const code = rawCode || (match ? match[1].trim() : text);
    const isStreaming = Boolean(document.querySelector('.result-streaming, [class*="streaming" i]')) ||
      Array.from(document.querySelectorAll('button, [role="button"]')).some((button) =>
        /\b(stop response|stop generating)\b/i.test(`${button.getAttribute('aria-label') || ''} ${button.innerText || ''}`)
      );
    return { count: nodes.length, text, code, isStreaming };
  }

  self.satoResponsePoller = {
    abort(runId) {
      if (runId) abortedRuns.add(runId);
    },

    async poll(tabId, baseline, baselineText, mode, callerTabId, runId) {
      const start = Date.now();
      let lastText = '';
      let lastChange = start;
      let sawGrowth = false;
      try {
        while (Date.now() - start < 90000) {
          if (abortedRuns.has(runId)) throw new Error('Process aborted by user');
          await sleep(300);
          const result = await chrome.scripting.executeScript({ target: { tabId }, func: readGeminiState }).catch(() => null);
          const state = result?.[0]?.result;
          if (!state) continue;

          // Gemini can create an empty response node before streaming into it.
          const isNewTurn = state.count > baseline || (state.count === baseline && state.text !== baselineText);
          if (!isNewTurn || !state.text) continue;
          if (state.text !== lastText) {
            lastText = state.text;
            lastChange = Date.now();
            sawGrowth = true;
            if (callerTabId) {
              const lineCount = state.text.split('\n').filter(Boolean).length;
              chrome.tabs.sendMessage(callerTabId, {
                type: 'SATO_SHOW_PROGRESS',
                payload: { status: 'streaming', detail: `Gemini typing… (${lineCount} lines)`, runId }
              }).catch(() => {});
            }
          }
          const quietThreshold = (mode === 'code' && /```[\s\S]*?```/.test(state.text))
            ? 800
            : (state.isStreaming ? 3500 : (mode === 'mcq' ? 1000 : 1500));
          if (sawGrowth && state.text.length > 10 && Date.now() - lastChange >= quietThreshold) {
            return mode === 'code' ? sanitizeCode(state.code) : state.text;
          }
        }
        throw new Error('Timed out waiting for Gemini response (90 seconds). Check Gemini and retry.');
      } finally {
        abortedRuns.delete(runId);
      }
    }
  };
})();
