const $ = (id) => document.getElementById(id);
const status = (message, error = false) => {
  $('status').textContent = message;
  $('status').style.color = error ? '#b3261e' : '#4a5560';
};

async function activeTab() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tabs[0]?.id) throw new Error('No active tab found.');
  return tabs[0];
}

async function sendToAssignment(tabId, message) {
  try {
    return await chrome.tabs.sendMessage(tabId, message);
  } catch (firstError) {
    try {
      await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
      return await chrome.tabs.sendMessage(tabId, message);
    } catch (_retryError) {
      throw new Error('The extension cannot access this tab. Reload the assignment page, then try again.');
    }
  }
}

async function extract() {
  const tab = await activeTab();
  if (tab.url?.startsWith('chrome://')) throw new Error('Chrome internal pages cannot be read. Open the assignment page first.');
  const result = await sendToAssignment(tab.id, { type: 'EXTRACT_QUESTION' });
  if (!result?.ok) throw new Error(result?.error || 'Could not read the page.');
  if (!result.text || result.text.length < 10) throw new Error('Very little text was found. Select the question manually, then try again.');
  $('question').value = result.text;
  status(`Read ${result.text.length.toLocaleString()} characters from the page.`);
}

function buildPrompt() {
  const question = $('question').value.trim();
  if (!question) throw new Error('Read or enter a question first.');
  const extra = $('extra').value.trim();
  if ($('mode').value === 'mcq') {
    return `You are helping me study a practice assignment. Analyze the MCQ below. Explain the reasoning, evaluate every option, and then state the best answer clearly as: ANSWER: <option letter/text>. If the question is ambiguous or information is missing, say so instead of pretending certainty. Do not submit anything.\n\n${extra ? `Additional instructions: ${extra}\n\n` : ''}QUESTION:\n${question}`;
  }
  return `You are helping me study a practice coding assignment. Solve the problem below. First explain the algorithm, proof idea, edge cases, and time/space complexity. Then provide complete code in the requested language, respecting the exact input/output format. Check the examples and mention any assumptions. Do not submit anything.\n\n${extra ? `Additional instructions: ${extra}\n\n` : ''}PROBLEM:\n${question}`;
}

$('extract').addEventListener('click', async () => {
  try { await extract(); } catch (e) { status(e.message, true); }
});

$('gemini').addEventListener('click', async () => {
  try {
    const prompt = buildPrompt();
    const result = await chrome.runtime.sendMessage({ type: 'OPEN_OR_REUSE_GEMINI', prompt });
    if (!result?.ok) throw new Error('Could not open Gemini.');
    status(result.reused ? 'Reused Gemini and sent the prompt.' : 'Opened Gemini and sent the prompt.');
  } catch (e) { status(e.message, true); }
});

$('type').addEventListener('click', async () => {
  try {
    const text = $('draft').value;
    if (!text.trim()) throw new Error('Enter the reviewed answer or code first.');
    const tab = await activeTab();
    const result = await sendToAssignment(tab.id, { type: 'TYPE_INTO_EDITOR', text, append: $('append').checked });
    if (!result?.ok) throw new Error(result?.error || 'Click inside the assignment editor first.');
    status('Text typed into the focused editor. Review it before submitting.');
  } catch (e) { status(e.message, true); }
});
