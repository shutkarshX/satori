// Coordinates problem extraction, Gemini execution, cancellation, and editor insertion.
(() => {
  if (window.__satoWorkflowRunnerLoaded) return;
  window.__satoWorkflowRunnerLoaded = true;
  let activeRunId = null;
  let activeRunStartTime = 0;
  const cancelledRuns = new Set();
  const makeRunId = () => `run-${Date.now()}-${Math.random().toString(36).slice(2)}`;

  function ensureActive(runId) {
    if (cancelledRuns.has(runId)) throw new Error('Process stopped by user.');
  }

  async function solve(mode, isNewChat = false, isFollowUp = false) {
    // If a previous run got stuck for >25s without completing, auto-unlock!
    if (activeRunId && Date.now() - activeRunStartTime > 25000) {
      activeRunId = null;
    }
    if (activeRunId) {
      window.satoToast.show('Already solving... press popup Stop to abort if stuck.', 'info', 2000);
      return;
    }
    const runId = makeRunId();
    activeRunId = runId;
    activeRunStartTime = Date.now();
    try {
      const target = mode === 'code' ? window.satoEditorDetector.getActiveTarget() : null;
      if (mode === 'code' && !target) throw new Error('Click into the site editor first.');

      window.satoToast.show(mode === 'mcq' ? 'Extracting MCQ problem…' : (isFollowUp ? 'Extracting follow-up / error…' : 'Extracting problem…'), 'loading', 0);
      const { text: question, snippetCount } = await window.satoExtractor.extract(mode);
      ensureActive(runId);
      const editorName = target ? (window.satoEditorDetector.isMonaco(target) ? 'Monaco' : (window.satoEditorDetector.isCodeMirror(target) ? 'CodeMirror' : 'Editor')) : null;
      const label = mode === 'mcq' ? 'Solving MCQ' : (isFollowUp ? 'Follow-up: Solving Code' : (isNewChat ? 'New Chat: Solving Code' : 'Solving Code'));
      window.satoToast.show(`${label}${snippetCount ? ` [${snippetCount} snippets]` : ''} (${question.length} chars)…`, 'loading', 0);

      const response = await chrome.runtime.sendMessage({
        type: 'SATO_SOLVE_QUESTION',
        payload: { question, mode, isNewChat, isFollowUp, runId }
      });
      ensureActive(runId);
      if (!response?.success) throw new Error(response?.error || 'Gemini solver failed.');

      if (mode === 'code') {
        const writeTarget = window.satoEditorDetector.getActiveTarget();
        if (!writeTarget) throw new Error('Target editor disappeared from page.');
        window.satoToast.show(`Writing answer into ${editorName}…`, 'loading', 0);
        window.satoTyper.insert(writeTarget, response.solution);
        ensureActive(runId);
        if (snippetCount) await window.satoSnippetClient.clearSnippets();
        window.satoToast.show(`Done! Inserted into ${editorName}`, 'success', 3000);
      } else {
        const rootContainer = window.satoExtractor.getLastContainer();
        window.satoToast.show('Selecting answer option…', 'loading', 0);
        const selected = window.satoMcqSelector.select(response.solution, rootContainer);
        if (snippetCount) await window.satoSnippetClient.clearSnippets();
        window.satoToast.show(`Done! Selected: ${selected}`, 'success', 3500);
      }
    } catch (error) {
      window.satoToast.show(error.message || 'Error occurred', 'error', 4000);
    } finally {
      if (activeRunId === runId) activeRunId = null;
      cancelledRuns.delete(runId);
    }
  }

  window.satoWorkflowRunner = {
    abort(runId = activeRunId, notifyBackground = true) {
      if (!runId || runId !== activeRunId) return;
      cancelledRuns.add(runId);
      window.satoToast.show('Process stopped by user', 'error', 2500);
      if (notifyBackground) chrome.runtime.sendMessage({ type: 'SATO_ABORT_PROCESS', runId }).catch(() => {});
    },
    handleProgress(payload) {
      if (!payload || payload.runId !== activeRunId || cancelledRuns.has(payload.runId)) return;
      window.satoToast.show(payload.detail, payload.status === 'streaming' ? 'loading' : 'info', 0);
    },
    runCodeWorkflow(isNewChat = false, isFollowUp = false) {
      return solve('code', isNewChat, isFollowUp);
    },
    runMcqWorkflow(isNewChat = false) {
      return solve('mcq', isNewChat, false);
    },
    async grabAndInsertFromGemini() {
      try {
        const target = window.satoEditorDetector.getActiveTarget();
        if (!target) throw new Error('Click into the site editor first.');
        window.satoToast.show('Fetching latest code from Gemini…', 'loading', 0);
        const res = await chrome.runtime.sendMessage({ type: 'SATO_GET_LATEST_GEMINI_CODE' });
        if (!res?.success || !res?.code) throw new Error(res?.error || 'No code found in Gemini.');
        const editorName = window.satoEditorDetector.isMonaco(target) ? 'Monaco' : 'Editor';
        window.satoTyper.insert(target, res.code);
        window.satoToast.show(`Inserted latest code from Gemini (${editorName})!`, 'success', 2500);
      } catch (err) {
        window.satoToast.show(err.message, 'error', 3000);
      }
    },
    async pasteClipboardCode() {
      try {
        const target = window.satoEditorDetector.getActiveTarget();
        if (!target) throw new Error('Click into the site editor first.');
        
        let text = '';
        try {
          text = await navigator.clipboard.readText();
        } catch (_clipErr) {
          // If navigator.clipboard is blocked by browser permissions, use paste fallback via offscreen textarea
          const helper = document.createElement('textarea');
          helper.style.position = 'fixed';
          helper.style.left = '-9999px';
          document.body.appendChild(helper);
          helper.focus();
          document.execCommand('paste');
          text = helper.value;
          helper.remove();
        }

        if (!text || !text.trim()) throw new Error('Clipboard is empty.');
        window.satoTyper.insert(target, text);
        window.satoToast.show('Pasted code into editor. Running compile…', 'info', 2000);
        
        // Auto Compile & Run and Advance if testcases pass
        if (window.satoTestRunner) {
          setTimeout(async () => {
            try {
              const res = await window.satoTestRunner.runAndWatch(18000);
              if (res.passedAll) {
                window.satoToast.show(`✓ ${res.summary}! Advancing…`, 'success', 2500);
                setTimeout(() => {
                  try { window.satoTestRunner.clickNext(); } catch (_e) {}
                }, 1000);
              } else if (res.completed) {
                window.satoToast.show(`⚠️ Tests: ${res.summary}. Check editor.`, 'error', 4500);
              } else {
                window.satoToast.show('Execution finished or timed out.', 'info', 3000);
              }
            } catch (err) {
              window.satoToast.show(err.message, 'info', 3000);
            }
          }, 400);
        }
      } catch (error) {
        window.satoToast.show(`Clipboard paste error: ${error.message}`, 'error', 3500);
      }
    },
    async selectClipboardMcq() {
      try {
        let text = '';
        try {
          text = await navigator.clipboard.readText();
        } catch (_clipErr) {
          const helper = document.createElement('textarea');
          helper.style.position = 'fixed';
          helper.style.left = '-9999px';
          document.body.appendChild(helper);
          helper.focus();
          document.execCommand('paste');
          text = helper.value;
          helper.remove();
        }

        if (!text || !text.trim()) throw new Error('Clipboard is empty. Copy the option/letter first.');
        const rootContainer = window.satoExtractor.getLastContainer();
        const selected = window.satoMcqSelector.select(text.trim(), rootContainer);
        window.satoToast.show(`Done! Selected: ${selected}`, 'success', 3500);
      } catch (error) {
        window.satoToast.show(`MCQ select error: ${error.message}`, 'error', 3500);
      }
    }
  };
})();
