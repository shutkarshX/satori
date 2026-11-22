document.getElementById('trigger-btn').addEventListener('click', async () => {
  const statusBar = document.getElementById('status-bar');
  statusBar.textContent = 'Starting solve…';
  statusBar.style.color = '#38bdf8';
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) throw new Error('No active tab found.');
    chrome.tabs.sendMessage(tab.id, { type: 'SATO_TRIGGER_CODE', isNewChat: false, isFollowUp: false }, (result) => {
      if (chrome.runtime.lastError || !result?.received) {
        statusBar.textContent = `Unable to start: ${chrome.runtime.lastError?.message || 'Refresh the supported editor page.'}`;
        statusBar.style.color = '#ef4444';
        return;
      }
      statusBar.textContent = 'Started. Check the page status pill.';
      statusBar.style.color = '#22c55e';
      setTimeout(() => window.close(), 900);
    });
  } catch (error) {
    statusBar.textContent = error.message;
    statusBar.style.color = '#ef4444';
  }
});

document.getElementById('paste-btn').addEventListener('click', async () => {
  const statusBar = document.getElementById('status-bar');
  statusBar.textContent = 'Pasting clipboard…';
  statusBar.style.color = '#38bdf8';
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) throw new Error('No active tab found.');
    chrome.tabs.sendMessage(tab.id, { type: 'SATO_TRIGGER_PASTE' }, (result) => {
      if (chrome.runtime.lastError || !result?.received) {
        statusBar.textContent = `Paste unavailable: ${chrome.runtime.lastError?.message || 'Refresh the supported editor page.'}`;
        statusBar.style.color = '#ef4444';
        return;
      }
      statusBar.textContent = 'Paste requested. Check the page status pill.';
      statusBar.style.color = '#22c55e';
      setTimeout(() => window.close(), 900);
    });
  } catch (error) {
    statusBar.textContent = error.message;
    statusBar.style.color = '#ef4444';
  }
});

document.getElementById('stop-btn').addEventListener('click', () => {
  const statusBar = document.getElementById('status-bar');
  statusBar.textContent = 'Stopping active workflow…';
  statusBar.style.color = '#f59e0b';
  chrome.tabs.query({ active: true, currentWindow: true }).then(([tab]) => {
    if (tab?.id) chrome.tabs.sendMessage(tab.id, { type: 'SATO_REQUEST_ABORT' }, () => {});
    chrome.runtime.sendMessage({ type: 'SATO_ABORT_PROCESS' }, (result) => {
      if (chrome.runtime.lastError) {
        statusBar.textContent = `Stop failed: ${chrome.runtime.lastError.message}`;
        statusBar.style.color = '#ef4444';
        return;
      }
      statusBar.textContent = result?.aborted ? `Stopped ${result.aborted} workflow(s).` : 'Stop requested for active page workflow.';
      statusBar.style.color = '#22c55e';
      setTimeout(() => window.close(), 1000);
    });
  });
});
