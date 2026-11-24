importScripts('tab-injector.js', 'snippet-store.js', 'gemini-tab-manager.js', 'response-poller.js');

let pendingNewChat = false;
let pendingNewChatAt = 0;
const activeRuns = new Map();
const cancelledRuns = new Set();

function reportProgress(tabId, runId, status, detail) {
  if (!tabId) return;
  chrome.tabs.sendMessage(tabId, {
    type: 'SATO_SHOW_PROGRESS',
    payload: { runId, status, detail }
  }).catch(() => {});
}

function buildPrompt(question, mode, isFollowUp = false) {
  if (mode === 'mcq') {
    return 'You are solving a Multiple Choice Question (MCQ). State ONLY the correct letter option (e.g. A, B, C, or D) and exact option text. Format strictly as: ANSWER: [Letter] - [Option Text]\n\n' + question;
  }
  if (isFollowUp) {
    return 'The previous code failed some test cases or had issues. Check the required programming language from the prompt or write in the same language. Fix the algorithm to pass all edge cases. ' +
      'If the question provides Header or Footer snippets, do NOT duplicate them; write ONLY the missing code required to fill the gap. ' +
      'Provide ONLY the complete, corrected working code inside a single code block:\n\n' + question;
  }
  return 'Read the question carefully. Check the requested programming language (e.g. C, C++, Java, Python) in the prompt and provide complete, optimal, compiling code for it. ' +
    'IMPORTANT: If the question shows "Header Snippet" or "Footer Snippet", write ONLY the code that fills the gap between them. Do NOT re-declare or redefine anything already in the Header or Footer snippet (like main() if footer already has it). ' +
    'Do not output explanation or multiple choice options. Output strictly raw working code inside a single code block:\n\n' + question;
}

async function handleSolve(question, mode, callerTabId, runId, isNew = false, isFollowUp = false) {
  activeRuns.set(runId, { callerTabId });
  try {
    reportProgress(callerTabId, runId, 'info', 'Connecting to Gemini…');
    const tab = await self.satoTabManager.getOrCreateTab();
    activeRuns.set(runId, { callerTabId, geminiTabId: tab.id });
    if (cancelledRuns.has(runId)) throw new Error('Process aborted by user');
    const wantsNew = !isFollowUp && (isNew || (pendingNewChat && Date.now() - pendingNewChatAt < 6000));
    pendingNewChat = false;

    const isExistingConv = tab.url && tab.url.replace(/\/app\/?$/, '') !== 'https://gemini.google.com';
    if (wantsNew && isExistingConv) {
      reportProgress(callerTabId, runId, 'info', 'Opening a clean Gemini chat…');
      await self.satoTabManager.resetToFreshChat(tab);
    } else if (tab.status === 'loading') {
      await self.satoTabManager.waitForComplete(tab.id, 12000);
    }
    if (cancelledRuns.has(runId)) throw new Error('Process aborted by user');

    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['bridges/gemini-visible.js'], world: 'MAIN' }).catch(() => {});
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['bridges/gemini-bridge.js'] }).catch(() => {});

    reportProgress(callerTabId, runId, 'info', isFollowUp ? 'Sending follow-up to Gemini…' : 'Sending prompt to Gemini…');
    const prompt = buildPrompt(question, mode, isFollowUp);
    if (cancelledRuns.has(runId)) throw new Error('Process aborted by user');
    const submitRes = await new Promise((resolve) => {
      chrome.tabs.sendMessage(tab.id, {
        type: 'SATO_SUBMIT_PROMPT',
        payload: { prompt, isNewChat: wantsNew }
      }, (result) => resolve(chrome.runtime.lastError ? { success: false, error: chrome.runtime.lastError.message } : result));
    });
    if (cancelledRuns.has(runId)) {
      chrome.tabs.sendMessage(tab.id, { type: 'SATO_CANCEL_GENERATION' }).catch(() => {});
      throw new Error('Process aborted by user');
    }
    if (!submitRes?.success) throw new Error(submitRes?.error || 'Gemini did not confirm prompt submission.');

    reportProgress(callerTabId, runId, 'info', 'Prompt sent. Waiting for Gemini’s response…');
    const solution = await self.satoResponsePoller.poll(
      tab.id, submitRes.baseline, submitRes.baselineText, mode, callerTabId, runId
    );
    return { success: true, solution };
  } finally {
    activeRuns.delete(runId);
    cancelledRuns.delete(runId);
  }
}

async function handleGetLatestCode() {
  const tabs = await chrome.tabs.query({ url: '*://gemini.google.com/*' });
  if (!tabs || tabs.length === 0) return { success: false, error: 'No Gemini tab found' };
  
  // Prefer the active/focused tab or pinned tab
  const tab = tabs.find((t) => t.active) || tabs[0];
  const res = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: () => {
      const nodes = document.querySelectorAll(
        'model-response, message-content, [data-message-author-role="model"], .model-response-text'
      );
      const latest = nodes[nodes.length - 1];
      const text = latest ? (latest.innerText || latest.textContent || '').trim() : '';
      const codeEl = latest?.querySelector('pre code, pre, [data-code-block], [class*="code-block" i]');
      const rawCode = codeEl ? (codeEl.innerText || codeEl.textContent || '').trim() : '';
      const match = text.match(/```(?:[a-zA-Z0-9_+#.-]+)?\s*\n([\s\S]*?)```/);
      return rawCode || (match ? match[1].trim() : text);
    }
  }).catch(() => null);

  const code = res?.[0]?.result;
  if (!code || code.length < 5) return { success: false, error: 'No code found in Gemini response' };
  return { success: true, code };
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request?.type?.startsWith('SATO_SNIPPET_')) {
    self.satoSnippetStore.handleMessage(request, sender, sendResponse);
    return true;
  }
  if (request?.type === 'SATO_GET_LATEST_GEMINI_CODE') {
    handleGetLatestCode()
      .then(sendResponse)
      .catch((err) => sendResponse({ success: false, error: err.message }));
    return true;
  }
  if (request?.type === 'SATO_TOGGLE_SIDE_BY_SIDE') {
    self.satoTabManager.toggleSideBySide(sender?.tab)
      .then((res) => sendResponse({ success: true, ...res }))
      .catch((err) => sendResponse({ success: false, error: err.message }));
    return true;
  }
  if (request?.type === 'SATO_ABORT_PROCESS') {
    const requestedRunId = request.runId;
    const entries = [...activeRuns.entries()].filter(([id]) => !requestedRunId || id === requestedRunId);
    for (const [runId, run] of entries) {
      cancelledRuns.add(runId);
      self.satoResponsePoller.abort(runId);
      if (run.geminiTabId) chrome.tabs.sendMessage(run.geminiTabId, { type: 'SATO_CANCEL_GENERATION' }).catch(() => {});
      if (run.callerTabId) chrome.tabs.sendMessage(run.callerTabId, {
        type: 'SATO_PROCESS_ABORTED', payload: { runId }
      }).catch(() => {});
    }
    sendResponse({ success: true, aborted: entries.length });
    return true;
  }
  if (request?.type === 'SATO_SOLVE_QUESTION') {
    const payload = request.payload || {};
    const runId = payload.runId || `run-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    handleSolve(payload.question, payload.mode, sender?.tab?.id, runId, Boolean(payload.isNewChat), Boolean(payload.isFollowUp))
      .then((response) => sendResponse({ ...response, runId }))
      .catch((error) => sendResponse({ success: false, error: error.message, runId }));
    return true;
  }
});

chrome.commands.onCommand.addListener(async (command) => {
  const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!activeTab?.id) return;
  await ensureScriptsInTab(activeTab.id);
  const isNew = command.endsWith('-new');
  const isFollowUp = command.includes('-followup');
  const kind = command.startsWith('solve-code') ? 'CODE' : command.startsWith('solve-mcq') ? 'MCQ' : null;
  if (!kind) return;
  if (isNew) {
    pendingNewChat = true;
    pendingNewChatAt = Date.now();
  }
  chrome.tabs.sendMessage(activeTab.id, {
    type: `SATO_TRIGGER_${kind}`,
    isNewChat: isNew,
    isFollowUp
  }).catch(() => {});
});
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type !== 'SATO_RELAY_FETCH') return false;
  fetch(msg.url, msg.init)
    .then(async (r) => {
      const body = await r.text();
      sendResponse({ status: r.status, ok: r.ok, body });
    })
    .catch(err => sendResponse({ error: err.message }));
  return true;
});
