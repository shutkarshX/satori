const $ = (id) => document.getElementById(id);
let fullPageContent = '';

const status = (message, error = false) => {
  $('status').textContent = message;
  $('status').style.color = error ? '#b3261e' : '#4a5560';
};

function showSavedResponse(response) {
  $('response').value = response || '';
  if (response) status('Latest AI response loaded.');
}

function showSelectedProviderResponse(result) {
  const provider = $('provider').value;
  const key = `latest${provider.charAt(0).toUpperCase() + provider.slice(1)}Response`;
  const response = result[key] || '';
  const names = { google: 'Google AI Mode', gemini: 'Gemini', chatgpt: 'ChatGPT' };
  $('responseLabel').textContent = `Latest ${names[provider] || provider} response`;
  showSavedResponse(response);
}

function showAiStatus(value) {
  if (!value) return;
  const el = $('aiStatus');
  el.textContent = value.text || 'Idle';
  el.className = `ai-status ${value.kind || 'idle'}`;
}

function showDiagnostics(entries) {
  const lines = Array.isArray(entries)
    ? entries.map((entry) => `[${entry.time}] ${entry.step}: ${entry.detail}`)
    : [];
  $('diagnosticLog').textContent = lines.join('\n') || 'No request yet.';
}

function updateButtonLabel() {
  const names = { google: 'Google AI Mode', gemini: 'Gemini', chatgpt: 'ChatGPT' };
  $('runSearch').textContent = `Solve with ${names[$('provider').value] || 'Selected AI'}`;
}

chrome.storage.local.get([
  'latestGoogleResponse', 'latestGeminiResponse', 'latestChatGPTResponse',
  'satoriStatus', 'satoriDiagnostics', 'satoriMode', 'satoriProvider'
], (result) => {
  if (result.satoriMode) $('mode').value = result.satoriMode;
  if (result.satoriProvider) $('provider').value = result.satoriProvider;
  updateButtonLabel();
  showSelectedProviderResponse(result);
  showAiStatus(result.satoriStatus);
  showDiagnostics(result.satoriDiagnostics);
});

$('mode').addEventListener('change', () => {
  chrome.storage.local.set({ satoriMode: $('mode').value });
});

$('provider').addEventListener('change', () => {
  chrome.storage.local.set({ satoriProvider: $('provider').value });
  updateButtonLabel();
  chrome.storage.local.get(['latestGoogleResponse', 'latestGeminiResponse', 'latestChatGPTResponse'], showSelectedProviderResponse);
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local') {
    if (changes.latestGoogleResponse || changes.latestGeminiResponse || changes.latestChatGPTResponse) {
      chrome.storage.local.get(['latestGoogleResponse', 'latestGeminiResponse', 'latestChatGPTResponse'], showSelectedProviderResponse);
    }
    if (changes.satoriStatus) showAiStatus(changes.satoriStatus.newValue);
    if (changes.satoriDiagnostics) showDiagnostics(changes.satoriDiagnostics.newValue);
  }
});

async function activeTab() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tabs[0]?.id) throw new Error('No active assignment tab found.');
  return tabs[0];
}

async function sendToAssignment(tabId, message) {
  try {
    return await chrome.tabs.sendMessage(tabId, message);
  } catch (_firstError) {
    try {
      await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
      return await chrome.tabs.sendMessage(tabId, message);
    } catch (_retryError) {
      throw new Error('Cannot access this tab. Reload the assignment page, then try again.');
    }
  }
}

async function extract() {
  const tab = await activeTab();
  if (tab.url?.startsWith('chrome://')) throw new Error('Chrome internal pages cannot be used with Satori.');
  const result = await sendToAssignment(tab.id, { type: 'EXTRACT_QUESTION' });
  if (!result?.ok) throw new Error(result?.error || 'Could not read page.');
  if (!result.text || result.text.length < 10) throw new Error('Too little text found on page.');

  $('question').value = result.text;
  fullPageContent = result.fullText || result.text;

  // Auto-detect question type
  const combined = `${result.text}\n${fullPageContent}`.toLowerCase();
  const isMcq = /\b(mcq|multiple choice|choose the correct|select the correct|option [a-d]|which of the following)\b/i.test(combined)
    || (!/\b(single file programming|problem statement|code constraints|sample test cases)\b/i.test(combined) && /\b(option|a\)|b\)|c\)|d\))\b/i.test(combined));

  const detectedMode = isMcq ? 'mcq' : 'coding';
  $('mode').value = detectedMode;
  chrome.storage.local.set({ satoriMode: detectedMode });
  status(`Read ${result.text.length.toLocaleString()} characters (detected ${detectedMode.toUpperCase()}).`);
}

$('extract').addEventListener('click', async () => {
  try { await extract(); } catch (e) { status(e.message, true); }
});

$('runSearch').addEventListener('click', async () => {
  try {
    const provider = $('provider').value;
    const mode = $('mode').value;
    const tab = await activeTab();
    const questionVal = $('question').value.trim();

    $('response').value = '';

    const pageContent = fullPageContent || questionVal;
    if (!pageContent) throw new Error('Read page content first.');

    const result = await chrome.runtime.sendMessage({
      type: 'OPEN_PROVIDER_REQUEST',
      provider,
      mode,
      pageContent,
      questionText: questionVal || pageContent,
      assignmentTabId: tab.id,
      windowId: tab.windowId
    });

    if (!result?.ok) throw new Error(result?.error || `Could not start ${provider}.`);
    const names = { google: 'Google AI Mode', gemini: 'Gemini', chatgpt: 'ChatGPT' };
    status(`${names[provider] || provider} started in the background. Waiting for response…`);
  } catch (e) { status(e.message, true); }
});

$('type').addEventListener('click', async () => {
  try {
    const text = $('draft').value;
    if (!text.trim()) throw new Error('Enter the reviewed answer or code first.');
    const tab = await activeTab();
    const result = await sendToAssignment(tab.id, { type: 'TYPE_INTO_EDITOR', text, append: $('append').checked });
    if (!result?.ok) throw new Error(result?.error || 'Click inside the assignment editor first.');
    status('Text placed into assignment editor. Review it before submitting.');
  } catch (e) { status(e.message, true); }
});
