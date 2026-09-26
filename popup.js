const $ = (id) => document.getElementById(id);
let fullPageContext = '';
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
  const response = provider === 'gemini' ? result.latestGeminiResponse : provider === 'google' ? result.latestGoogleResponse : result.latestChatGPTResponse;
  const label = provider === 'gemini' ? 'Latest Gemini response' : provider === 'google' ? 'Latest Google AI response' : 'Latest ChatGPT response';
  $('responseLabel').textContent = label;
  showSavedResponse(response);
}

function showAiStatus(value) {
  if (!value) return;
  const el = $('aiStatus');
  el.textContent = value.text || value;
  el.className = `ai-status ${value.kind || 'idle'}`;
}

function showDiagnostics(entries) {
  const lines = Array.isArray(entries) ? entries.map((entry) => `[${entry.time}] ${entry.step}: ${entry.detail}`) : [];
  $('diagnosticLog').textContent = lines.join('\n') || 'No request yet.';
}

function updateProviderUI() {
  const labels = {
    google: 'Search Google AI Mode & show result',
    gemini: 'Ask Gemini & show result',
    chatgpt: 'Ask ChatGPT & show result'
  };
  $('googleSearch').textContent = labels[$('provider').value] || labels.google;
}

chrome.storage.local.get(['latestGoogleResponse', 'latestGeminiResponse', 'latestChatGPTResponse', 'satoriStatus', 'satoriDiagnostics'], (result) => {
  showSelectedProviderResponse(result);
  showAiStatus(result.satoriStatus);
  showDiagnostics(result.satoriDiagnostics);
});
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && (changes.latestGoogleResponse || changes.latestGeminiResponse || changes.latestChatGPTResponse)) {
    chrome.storage.local.get(['latestGoogleResponse', 'latestGeminiResponse', 'latestChatGPTResponse'], showSelectedProviderResponse);
  }
  if (area === 'local' && changes.satoriStatus) showAiStatus(changes.satoriStatus.newValue);
  if (area === 'local' && changes.satoriDiagnostics) showDiagnostics(changes.satoriDiagnostics.newValue);
});
updateProviderUI();
$('provider').addEventListener('change', updateProviderUI);
$('provider').addEventListener('change', async () => {
  const result = await chrome.storage.local.get(['latestGoogleResponse', 'latestGeminiResponse', 'latestChatGPTResponse']);
  showSelectedProviderResponse(result);
});

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
  fullPageContext = result.fullText || result.text;
  if (fullPageContext.length > result.text.length * 1.25) {
    status(`Read ${result.text.length.toLocaleString()} focused characters plus ${fullPageContext.length.toLocaleString()} full-page characters.`);
  }
  else status(`Read ${result.text.length.toLocaleString()} characters from the page.`);
}

function buildGoogleQuery() {
  const question = $('question').value.trim();
  if (!question) throw new Error('Read or enter a question first.');
  return fullPageContext || question;
}

function buildGeminiPrompt() {
  const question = $('question').value.trim();
  if (!question) throw new Error('Read or enter a question first.');
  const extra = $('extra').value.trim();
  const context = $('mode').value === 'coding' && fullPageContext.length > question.length * 1.25
    ? `\n\nFULL PAGE CONTEXT (use this to recover omitted problem details; solve only the coding problem):\n${fullPageContext}`
    : '';
  if ($('mode').value === 'mcq') {
    return `You are helping me study a practice assignment. Analyze the MCQ below and evaluate the options briefly. Finish your response with exactly this format:\nANSWER: <option letter or exact option text>\nCONFIDENCE: High, Medium, or Low\nIf the question is ambiguous or information is missing, say so instead of pretending certainty. Do not submit anything.\n\n${extra ? `Additional instructions: ${extra}\n\n` : ''}QUESTION:\n${question}${context}`;
  }
  return `Solve this practice coding problem. Use Gemini's code editor/code block and put the entire answer inside ONE code editor block only. Your response must contain exactly one complete, compilable, submission-ready source file. Start the block with the first import or header and end it after the complete entry point. Do not write any explanation, algorithm, complexity analysis, heading, introduction, conclusion, Markdown text outside the block, multiple solutions, alternative code, or partial code. Do not split the solution into multiple code blocks. Include every required import or header, helper functions, global declarations, the complete entry point, and the required class wrapper. If the language is Java, use import java.util.*; and public class Main with public static void main(String[] args). If the language is C++, include required headers and a complete main function. Preserve normal source formatting and indentation. Use the exact input/output format and requested language.\n\n${extra ? `Additional instructions: ${extra}\n\n` : ''}PROBLEM:\n${question}${context}`;
}

function buildChatGPTPrompt() {
  const question = $('question').value.trim();
  if (!question) throw new Error('Read or enter a question first.');
  const extra = $('extra').value.trim();
  const languageMatch = `${fullPageContext}\n${question}`.match(/\b(C\+\+|C#|C|Java|Python|JavaScript|TypeScript)\s*\(?\s*\d{1,2}/i);
  const language = languageMatch ? languageMatch[1] : 'the exact language selected by the assignment';
  if ($('mode').value === 'mcq') {
    return `Help me solve this practice MCQ. Explain the choice briefly and end with exactly: FINAL ANSWER: <option letter or exact option text>. Do not submit anything.\n\n${extra ? `Additional instructions: ${extra}\n\n` : ''}QUESTION:\n${question}`;
  }
  return `Solve this practice coding problem. The assignment language is EXACTLY: ${language}. Write code in that language only; do not use another language or another standard library. Return exactly one complete compilable source file in a single code block. Include all imports, helpers, and the entry point. Do not include explanation, headings, multiple solutions, or text outside the code block. Match the exact input and output format. If code is not possible or the prompt is not a coding question, reply strictly with: Code not available. Before answering, verify that the solution solves the problem shown below, not any earlier problem or example from conversation history.\n\n${extra ? `Additional instructions: ${extra}\n\n` : ''}PROBLEM:\n${question}`;
}

$('extract').addEventListener('click', async () => {
  try { await extract(); } catch (e) { status(e.message, true); }
});

$('googleSearch').addEventListener('click', async () => {
  try {
    const provider = $('provider').value;
    const mode = $('mode').value;
    const message = provider === 'google'
      ? { type: 'OPEN_GOOGLE_SEARCH', googleQuery: buildGoogleQuery(), mode }
      : provider === 'gemini'
        ? { type: 'OPEN_GEMINI_REQUEST', prompt: buildGeminiPrompt(), mode }
        : { type: 'OPEN_CHATGPT_REQUEST', prompt: buildChatGPTPrompt(), mode };
    const result = await chrome.runtime.sendMessage(message);
    if (!result?.ok) throw new Error(`Could not start ${provider}.`);
    status(`${provider === 'google' ? 'Google Search' : provider === 'gemini' ? 'Gemini' : 'ChatGPT'} opened in the background. Waiting for its response…`);
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
