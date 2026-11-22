// Bridges the extension to Gemini's composer and confirms prompt submission.
(() => {
  if (window.__satoGeminiBridge) return;
  window.__satoGeminiBridge = true;

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const normalize = (value) => (value || '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();

  function findInput() {
    return document.querySelector(
      'rich-textarea [contenteditable="true"], [contenteditable="true"][role="textbox"], textarea[placeholder], textarea, [contenteditable="true"]'
    );
  }

  function composerText(element = findInput()) {
    if (!element) return '';
    return element.matches('textarea, input') ? element.value || '' : element.innerText || element.textContent || '';
  }

  function isGenerating() {
    return Boolean(document.querySelector('.result-streaming, [class*="streaming" i]')) ||
      Array.from(document.querySelectorAll('button, [role="button"]')).some((button) =>
        /\b(stop response|stop generating)\b/i.test(`${button.getAttribute('aria-label') || ''} ${button.innerText || ''}`)
      );
  }

  async function waitUntilIdle(timeout = 90000) {
    const started = Date.now();
    let idleSince = 0;
    while (Date.now() - started < timeout) {
      if (isGenerating()) idleSince = 0;
      else if (!idleSince) idleSince = Date.now();
      else if (Date.now() - idleSince >= 900) return;
      await sleep(250);
    }
    throw new Error('Gemini is still generating; follow-up was not sent.');
  }

  function dismissCancelModal() {
    const confirm = Array.from(document.querySelectorAll('button, [role="button"]'))
      .find((button) => /yes,\s*cancel/i.test(button.innerText || button.textContent || ''));
    if (confirm) confirm.click();
  }

  function setInputText(element, text) {
    element.focus();
    if (element.matches('textarea, input')) {
      const proto = element.tagName.toLowerCase() === 'textarea' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
      if (setter) setter.call(element, text);
      else element.value = text;
      element.dispatchEvent(new InputEvent('input', { bubbles: true, composed: true, inputType: 'insertText', data: text }));
      return;
    }
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(element);
    selection.removeAllRanges();
    selection.addRange(range);
    const inserted = document.execCommand('insertText', false, text);
    if (!inserted || normalize(composerText(element)) !== normalize(text)) {
      element.replaceChildren(document.createTextNode(text));
      element.dispatchEvent(new InputEvent('input', { bubbles: true, composed: true, inputType: 'insertText', data: text }));
    }
  }

  function findSendButton() {
    return Array.from(document.querySelectorAll(
      'button[aria-label*="send" i], button[data-testid*="send" i], button[mattooltip*="send" i], button[class*="send" i]'
    )).find((button) => !button.disabled && button.getAttribute('aria-disabled') !== 'true');
  }

  function userMessageCount() {
    return document.querySelectorAll('[data-message-author-role="user"], user-query, [class*="user-query" i]').length;
  }

  function submittedPromptVisible(prompt, previousCount) {
    const userNodes = document.querySelectorAll(
      '[data-message-author-role="user"], user-query, [class*="user-query" i]'
    );
    if (userNodes.length <= previousCount) return false;
    const latest = userNodes[userNodes.length - 1];
    const latestText = normalize(latest?.innerText || latest?.textContent || '');
    const expected = normalize(prompt);
    return Boolean(expected && latestText && (latestText.includes(expected.slice(0, 80)) || expected.includes(latestText.slice(0, 80))));
  }

  async function clickSend(prompt) {
    const previousUserCount = userMessageCount();
    const started = Date.now();
    let button = null;
    while (Date.now() - started < 10000) {
      button = findSendButton();
      if (button) break;
      await sleep(200);
    }
    if (!button) throw new Error('Gemini Send button did not become enabled.');
    button.click();

    // In background/hidden tabs, synthetic Enter keydown is required to submit
    const input = findInput();
    if (input) {
      input.focus();
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
    }

    const confirmStarted = Date.now();
    while (Date.now() - confirmStarted < 12000) {
      const cleared = !normalize(composerText());
      if (cleared || submittedPromptVisible(prompt, previousUserCount) || isGenerating()) return;
      // Retry clicking send and Enter key if not cleared
      const curBtn = findSendButton();
      if (curBtn) curBtn.click();
      if (input) {
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
      }
      await sleep(250);
    }
    throw new Error('Gemini prompt is still in the input box; Send was not confirmed.');
  }

  async function submitPrompt(promptText, isNewChat = false) {
    dismissCancelModal();
    if (!isNewChat) await waitUntilIdle();

    const start = Date.now();
    let input = null;
    while (Date.now() - start < 10000) {
      input = findInput();
      if (input) break;
      await sleep(100);
    }
    if (!input) throw new Error('Gemini input box not found. Ensure Gemini is open and signed in.');

    const nodes = document.querySelectorAll(
      'model-response, message-content, [data-message-author-role="model"], .model-response-text, [data-test-id*="model-response" i]'
    );
    const baseline = nodes.length;
    const baselineText = nodes.length ? (nodes[nodes.length - 1].innerText || nodes[nodes.length - 1].textContent || '').trim() : '';

    setInputText(input, promptText);
    await sleep(250);
    if (normalize(composerText(input)) !== normalize(promptText)) {
      throw new Error('Gemini composer did not accept the prompt text.');
    }
    await clickSend(promptText);
    return { baseline, baselineText };
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'SATO_CANCEL_GENERATION') {
      const stop = Array.from(document.querySelectorAll('button, [role="button"]'))
        .find((button) => /\b(stop response|stop generating)\b/i.test(`${button.getAttribute('aria-label') || ''} ${button.innerText || ''}`));
      if (stop) stop.click();
      sendResponse({ success: true, stopped: Boolean(stop) });
      return true;
    }
    if (message.type !== 'SATO_SUBMIT_PROMPT') return;
    submitPrompt(message.payload.prompt, message.payload.isNewChat)
      .then((result) => sendResponse({ success: true, ...result }))
      .catch((error) => sendResponse({ success: false, error: error.message }));
    return true;
  });
})();
