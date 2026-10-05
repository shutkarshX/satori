
// 3. ChatGPT (Reused Conversation, Background)
async function startChatGPTSearch(prompt, requestId, mode, assignmentTab, questionText) {
  const windowId = assignmentTab?.windowId;
  let tab = windowId ? await getReusableTab(/https:\/\/(chatgpt\.com|chat\.openai\.com)\//i, 'satoriChatGPTTabId', 'satoriChatGPTWindowId', windowId) : null;
  activeChatGPTRequest = { requestId, mode, questionText, tabId: null, assignmentTabId: assignmentTab?.id };

  const startChatGPTPolling = (tabId, baselineCount) => {
    let pollCount = 0;
    let lastSignature = '';
    const interval = setInterval(async () => {
      pollCount += 1;
      try {
        const current = await chrome.storage.local.get('satoriActiveRequest');
        if (current.satoriActiveRequest?.requestId !== requestId || pollCount > 120) {
          clearInterval(interval);
          return;
        }

        const results = await chrome.scripting.executeScript({
          target: { tabId },
          func: (baseline, previousSignature, mode) => {
            const clean = (value) => String(value || '').replace(/\u00a0/g, ' ').replace(/\r\n?/g, '\n').trim();
            const textOf = (el) => clean(el?.innerText || el?.textContent || '');
            const signature = (text) => text.length + ':' + text.slice(0, 80) + ':' + text.slice(-120);

            let nodes = [...document.querySelectorAll('[data-message-author-role="assistant"]')].filter((n) => textOf(n));
            if (!nodes.length) {
              nodes = [...document.querySelectorAll('h4')]
                .filter((h) => /^ChatGPT said:/i.test(textOf(h)))
                .map((h) => h.nextElementSibling || h.parentElement || h)
                .filter((n) => textOf(n));
            }

            const latest = nodes[nodes.length - 1];
            if (!latest || nodes.length <= baseline) return { ready: false };

            const text = textOf(latest);
            const sig = signature(text);
            if (sig === previousSignature) return { ready: false };

            const buttons = [...document.querySelectorAll('button')];
            const generating = buttons.some((button) => {
              if (button.disabled) return false;
              const label = (button.getAttribute('aria-label') || '') + ' ' +
                (button.getAttribute('data-testid') || '') + ' ' +
                (button.getAttribute('title') || '') + ' ' + textOf(button);
              return /\bstop\b/i.test(label);
            }) || Boolean(document.querySelector('.result-streaming, [class*="streaming" i]'));

            if (generating) return { ready: false, generating: true };

            let code = '';
            const elements = [...latest.querySelectorAll('pre code, pre, code-block, [class*="code-block" i], [data-code-block]')];
            const values = elements.map(textOf).filter((value) => value.length > 20);
            if (values.length) code = values.sort((x, y) => y.length - x.length)[0];

            if (!code && /#include|\bpublic\s+class\s+Main\b|\bint\s+main\s*\(|\bdef\s+main\s*\(/i.test(text)) {
              code = text;
            }

            if (mode === 'coding' && code.length < 30) {
              return { ready: false, waitingForCode: true };
            }

            return { ready: true, signature: sig, text, code: code || text };
          },
          args: [baselineCount, lastSignature, mode]
        });

        const result = results?.[0]?.result;
        if (result?.ready) {
          lastSignature = result.signature || lastSignature;
          clearInterval(interval);
          await handleCompletedResult('chatgpt', requestId, {
            text: result.text,
            code: result.code,
            capturedAt: Date.now()
          });
        }
      } catch (_error) {
        // Keep polling through transient background-tab execution failures.
      }
    }, 1000);
  };

  const sendPrompt = (tabId, retries = 15) => {
    chrome.tabs.sendMessage(tabId, { type: 'FILL_AND_SEND_CHATGPT', prompt, requestId, mode }, (res) => {
      if (chrome.runtime.lastError || !res?.ok) {
        if (retries > 0) setTimeout(() => sendPrompt(tabId, retries - 1), 800);
        else setStatus('ChatGPT composer was not ready. Check the background ChatGPT tab.', 'error');
      } else {
        addDiagnostic('chatgpt-submit', 'Prompt dispatched to ChatGPT MutationObserver');
        startChatGPTPolling(tabId, Number(res.baselineCount) || 0);
      }
    });
  };

  const url = 'https://chatgpt.com/';
  if (tab?.id) {
    activeChatGPTRequest.tabId = tab.id;
    let isAlive = false;
    try {
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['chatgpt.js'] }).catch(() => {});
      const ping = await Promise.race([
        chrome.tabs.sendMessage(tab.id, { type: 'PING_CHATGPT' }),