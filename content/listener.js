// Global shortcut and runtime-message listener for supported editor pages.
(() => {
  if (window.__satoListenerLoaded) return;
  window.__satoListenerLoaded = true;

  function matchesKey(event, character) {
    const key = (event.key || '').toLowerCase();
    const code = (event.code || '').toLowerCase();
    const expected = character.toLowerCase();
    return key === expected || code === `key${expected}` || code === expected;
  }

  document.addEventListener('keydown', (event) => {
    if (!event.altKey) return;
    if (!chrome.runtime?.id) {
      window.satoToast.show('Extension was reloaded. Refresh this page to reconnect.', 'error', 3500);
      return;
    }
    if (matchesKey(event, 's')) {
      event.preventDefault(); event.stopPropagation(); event.stopImmediatePropagation();
      window.satoSnippetClient.addSnippet().then((result) => {
        window.satoToast.show(result.added ? `Added snippet #${result.count} (${result.snippet.length} chars)` : 'Highlight text first.', result.added ? 'info' : 'error', 2500);
      }).catch((error) => window.satoToast.show(error.message, 'error', 3000));
      return;
    }
    if (matchesKey(event, 'x')) {
      event.preventDefault(); event.stopPropagation(); event.stopImmediatePropagation();
      window.satoSnippetClient.clearSnippets().then((count) => window.satoToast.show(`Cleared ${count} snippet(s)`, 'info', 2000))
        .catch((error) => window.satoToast.show(error.message, 'error', 3000));
      return;
    }
    if (matchesKey(event, 'g')) {
      event.preventDefault(); event.stopPropagation(); event.stopImmediatePropagation();
      if (event.shiftKey) {
        // Alt + Shift + G: Grab and insert the latest answer directly from open Gemini
        window.satoWorkflowRunner.grabAndInsertFromGemini();
      } else {
        // Alt + G: Toggle side-by-side view
        chrome.runtime.sendMessage({ type: 'SATO_TOGGLE_SIDE_BY_SIDE' }, (res) => {
          window.satoToast.show(res?.open ? 'Gemini opened side-by-side!' : 'Gemini closed.', 'info', 2000);
        });
      }
      return;
    }
    if (matchesKey(event, 'f')) {
      event.preventDefault(); event.stopPropagation(); event.stopImmediatePropagation();
      window.satoWorkflowRunner.runCodeWorkflow(event.shiftKey, true);
      return;
    }
    if (matchesKey(event, 'v')) {
      event.preventDefault(); event.stopPropagation(); event.stopImmediatePropagation();
      if (event.shiftKey) {
        window.satoWorkflowRunner.selectClipboardMcq();
      } else {
        window.satoWorkflowRunner.pasteClipboardCode();
      }
      return;
    }
    if (matchesKey(event, 'c')) {
      event.preventDefault(); event.stopPropagation(); event.stopImmediatePropagation();
      window.satoWorkflowRunner.runCodeWorkflow(event.shiftKey, false);
      return;
    }
    if (matchesKey(event, 'm')) {
      event.preventDefault(); event.stopPropagation(); event.stopImmediatePropagation();
      window.satoWorkflowRunner.runMcqWorkflow(event.shiftKey);
    }
  }, true);

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'SATO_TRIGGER_CODE') {
      window.satoWorkflowRunner.runCodeWorkflow(Boolean(message.isNewChat), Boolean(message.isFollowUp));
      sendResponse({ received: true });
    } else if (message.type === 'SATO_TRIGGER_PASTE') {
      window.satoWorkflowRunner.pasteClipboardCode();
      sendResponse({ received: true });
    } else if (message.type === 'SATO_TRIGGER_MCQ') {
      window.satoWorkflowRunner.runMcqWorkflow(Boolean(message.isNewChat));
      sendResponse({ received: true });
    } else if (message.type === 'SATO_REQUEST_ABORT') {
      window.satoWorkflowRunner.abort();
      sendResponse({ received: true });
    } else if (message.type === 'SATO_PROCESS_ABORTED') {
      window.satoWorkflowRunner.abort(message.payload?.runId, false);
      sendResponse({ received: true });
    } else if (message.type === 'SATO_SHOW_PROGRESS') {
      window.satoWorkflowRunner.handleProgress(message.payload);
      sendResponse({ received: true });
    }
  });
})();
