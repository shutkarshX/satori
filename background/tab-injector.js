const CONTENT_FILES = [
  'content/toast-pill.js',
  'content/editor-detector.js',
  'content/native-typer.js',
  'content/mcq-selector.js',
  'content/snippet-client.js',
  'content/examly-extractor.js',
  'content/workflow-runner.js',
  'content/listener.js'
];

function isSupportedEditorUrl(url = '') {
  try {
    const parsed = new URL(url);
    return parsed.hostname === 'examly.io' || parsed.hostname.endsWith('.examly.io') ||
      (parsed.protocol === 'file:' && parsed.pathname.endsWith('/test-sandbox.html'));
  } catch (_error) {
    return false;
  }
}

async function ensureScriptsInTab(tabId) {
  try {
    const tab = await chrome.tabs.get(tabId);
    if (!isSupportedEditorUrl(tab.url)) return false;
    await chrome.scripting.executeScript({ target: { tabId }, files: CONTENT_FILES });
    return true;
  } catch (_error) {
    return false;
  }
}

async function injectIntoSupportedTabs() {
  try {
    const tabs = await chrome.tabs.query({});
    for (const tab of tabs) {
      if (tab.id && isSupportedEditorUrl(tab.url)) await ensureScriptsInTab(tab.id);
    }
  } catch (_error) {}
}

chrome.runtime.onInstalled.addListener(() => { injectIntoSupportedTabs(); });
chrome.runtime.onStartup.addListener(() => { injectIntoSupportedTabs(); });
