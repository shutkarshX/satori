const $ = (id) => document.getElementById(id);

function showSelectedProviderResponse(result) {
  const provider = $('provider').value;
  const response = provider === 'gemini' ? result.latestGeminiResponse : provider === 'google' ? result.latestGoogleResponse : result.latestChatGPTResponse;
  const label = provider === 'gemini' ? 'Latest Gemini response' : provider === 'google' ? 'Latest Google AI response' : 'Latest ChatGPT response';
  $('responseLabel').textContent = label;
  $('response').value = response || '';
}

function showAiStatus(value) {
  if (!value) return;
  const el = $('aiStatus');
  el.textContent = value.text || value;
  el.className = `ai-status ${value.kind || 'idle'}`;
}

function showDiagnostics(entries) {
  const lines = Array.isArray(entries)
    ? entries.map((entry) => `[${entry.time}] ${entry.step}: ${entry.detail}`)
    : [];
  $('diagnosticLog').textContent = lines.join('\n') || 'No request yet.';
}

function updateProviderUI() {
  const labels = {
    google: 'Google AI Mode',
    gemini: 'Gemini',
    chatgpt: 'ChatGPT'
  };
  $('providerLabel').textContent = labels[$('provider').value] || 'AI provider';
}

chrome.storage.local.get([
  'latestGoogleResponse',
  'latestGeminiResponse',
  'latestChatGPTResponse',
  'satoriStatus',
  'satoriDiagnostics',
  'satoriProvider'
], (result) => {
  if (result.satoriProvider) $('provider').value = result.satoriProvider;
  updateProviderUI();
  showSelectedProviderResponse(result);
  showAiStatus(result.satoriStatus);
  showDiagnostics(result.satoriDiagnostics);
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if (changes.satoriProvider) {
    $('provider').value = changes.satoriProvider.newValue || 'chatgpt';
    updateProviderUI();
  }
  if (changes.latestGoogleResponse || changes.latestGeminiResponse || changes.latestChatGPTResponse) {
    chrome.storage.local.get(['latestGoogleResponse', 'latestGeminiResponse', 'latestChatGPTResponse'], showSelectedProviderResponse);
  }
  if (changes.satoriStatus) showAiStatus(changes.satoriStatus.newValue);
  if (changes.satoriDiagnostics) showDiagnostics(changes.satoriDiagnostics.newValue);
});

$('provider').addEventListener('change', async () => {
  const provider = $('provider').value;
  await chrome.storage.local.set({ satoriProvider: provider });
  updateProviderUI();
  const result = await chrome.storage.local.get(['latestGoogleResponse', 'latestGeminiResponse', 'latestChatGPTResponse']);
  showSelectedProviderResponse(result);
});