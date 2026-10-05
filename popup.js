const $ = (id) => document.getElementById(id);
const DEFAULT_PROVIDER = 'chatgpt';

function providerLabel(provider) {
  return ({ google: 'Google AI Mode', gemini: 'Gemini', chatgpt: 'ChatGPT' })[provider] || 'AI provider';
}

function showSelectedProviderResponse(result) {
  const provider = $('provider').value;
  const response = provider === 'gemini' ? result.latestGeminiResponse : provider === 'google' ? result.latestGoogleResponse : result.latestChatGPTResponse;
  $('responseLabel').textContent = `Latest ${providerLabel(provider)} response`;
  $('response').value = response || '';
}

function showAiStatus(value) {
  const el = $('aiStatus');
  if (!value) {
    el.textContent = 'Idle — ready for a question';
    el.className = 'ai-status idle';
    return;
  }
  el.textContent = value.text || value;
  el.className = `ai-status ${value.kind || 'idle'}`;
}

function showDiagnostics(entries) {
  const lines = Array.isArray(entries)
    ? entries.map((entry) => `[${entry.time}] ${entry.step}: ${entry.detail}`)
    : [];
  $('diagnosticLog').textContent = lines.join('\n') || 'No request yet.';
}

async function refresh() {
  const result = await chrome.storage.local.get([
    'latestGoogleResponse',
    'latestGeminiResponse',
    'latestChatGPTResponse',
    'satoriStatus',
    'satoriDiagnostics',
    'satoriProvider'
  ]);
  $('provider').value = result.satoriProvider || DEFAULT_PROVIDER;
  $('providerLabel').textContent = providerLabel($('provider').value);
  showSelectedProviderResponse(result);
  showAiStatus(result.satoriStatus);
  showDiagnostics(result.satoriDiagnostics);
}

$('provider').addEventListener('change', async () => {
  await chrome.storage.local.set({ satoriProvider: $('provider').value });
  await refresh();
});

$('type').addEventListener('click', async () => {
  const draft = $('draft').value;
  if (!draft.trim()) {
    $('status').textContent = 'Add reviewed text/code first.';
    return;
  }
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (!tab?.id) {
    $('status').textContent = 'No active assignment tab.';
    return;
  }
  try {
    const result = await chrome.tabs.sendMessage(tab.id, {
      type: 'TYPE_INTO_EDITOR',
      text: draft,
      append: $('append').checked
    });
    $('status').textContent = result?.ok ? 'Placed into the focused assignment editor.' : (result?.error || 'Could not place text.');
  } catch (error) {
    $('status').textContent = `Could not reach the assignment page: ${error.message}`;
  }
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if (changes.satoriProvider || changes.latestGoogleResponse || changes.latestGeminiResponse || changes.latestChatGPTResponse ||
      changes.satoriStatus || changes.satoriDiagnostics) refresh();
});

refresh();
