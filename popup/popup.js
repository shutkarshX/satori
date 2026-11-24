document.getElementById('trigger-btn').addEventListener('click', async () => {
  const statusBar = document.getElementById('status-bar');
  statusBar.textContent = 'Starting solver…';
  statusBar.style.color = '#f59e0b';
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) throw new Error('No active tab found.');
    chrome.tabs.sendMessage(tab.id, { type: 'SATO_TRIGGER_CODE', isNewChat: false, isFollowUp: false }, (result) => {
      if (chrome.runtime.lastError || !result?.received) {
        statusBar.textContent = `Error: ${chrome.runtime.lastError?.message || 'Refresh the exam page.'}`;
        statusBar.style.color = '#f43f5e';
        return;
      }
      statusBar.textContent = 'Solver dispatched. Check pill on page.';
      statusBar.style.color = '#10b981';
      setTimeout(() => window.close(), 900);
    });
  } catch (error) {
    statusBar.textContent = error.message;
    statusBar.style.color = '#f43f5e';
  }
});

document.getElementById('paste-btn').addEventListener('click', async () => {
  const statusBar = document.getElementById('status-bar');
  statusBar.textContent = 'Pasting clipboard…';
  statusBar.style.color = '#f59e0b';
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) throw new Error('No active tab found.');
    chrome.tabs.sendMessage(tab.id, { type: 'SATO_TRIGGER_PASTE' }, (result) => {
      if (chrome.runtime.lastError || !result?.received) {
        statusBar.textContent = `Error: ${chrome.runtime.lastError?.message || 'Refresh the exam page.'}`;
        statusBar.style.color = '#f43f5e';
        return;
      }
      statusBar.textContent = 'Pasted into active editor.';
      statusBar.style.color = '#10b981';
      setTimeout(() => window.close(), 900);
    });
  } catch (error) {
    statusBar.textContent = error.message;
    statusBar.style.color = '#f43f5e';
  }
});

document.getElementById('stop-btn').addEventListener('click', () => {
  const statusBar = document.getElementById('status-bar');
  statusBar.textContent = 'Stopping active workflow…';
  statusBar.style.color = '#fbbf24';
  chrome.tabs.query({ active: true, currentWindow: true }).then(([tab]) => {
    if (tab?.id) chrome.tabs.sendMessage(tab.id, { type: 'SATO_REQUEST_ABORT' }, () => {});
    chrome.runtime.sendMessage({ type: 'SATO_ABORT_PROCESS' }, (result) => {
      if (chrome.runtime.lastError) {
        statusBar.textContent = `Stop failed: ${chrome.runtime.lastError.message}`;
        statusBar.style.color = '#f43f5e';
        return;
      }
      statusBar.textContent = result?.aborted ? `Stopped ${result.aborted} process.` : 'Stop signal sent.';
      statusBar.style.color = '#10b981';
      setTimeout(() => window.close(), 1000);
    });
  });
});
