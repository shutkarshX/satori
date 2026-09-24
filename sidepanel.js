const state = document.getElementById('state');
const answer = document.getElementById('answer');

function show(text, label = 'Gemini response received.') {
  state.textContent = label;
  answer.textContent = text || 'No readable response was found yet.';
}

chrome.runtime.onMessage.addListener((message) => {
  if (message.type === 'SATORI_STATUS') state.textContent = message.text;
  if (message.type === 'GEMINI_RESPONSE' && message.text) show(message.text);
});

chrome.storage.local.get(['latestGeminiResponse'], (result) => {
  if (result.latestGeminiResponse) show(result.latestGeminiResponse);
});

document.getElementById('clear').addEventListener('click', () => {
  answer.innerHTML = '<p class="muted">Gemini\'s answer will appear here after it finishes responding.</p>';
  state.textContent = 'Waiting for the next response.';
});
