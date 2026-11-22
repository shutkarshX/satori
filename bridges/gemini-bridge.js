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

    // Direct innerHTML with <p> ensures Angular's rich-textarea detects content immediately
    element.innerHTML = '';
    const p = document.createElement('p');
    p.textContent = text;
    element.appendChild(p);
    element.dispatchEvent(new InputEvent('input', { bubbles: true, composed: true, inputType: 'insertText', data: text }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
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
    let button = null;
    
    // Dynamic find: look for send button, but don't stall if missing
    for (let i = 0; i < 15; i++) {
      button = findSendButton();
      if (button) break;
      await sleep(100);
    }

    if (button) button.click();

    // Immediately dispatch synthetic Enter keydown on input
    const input = findInput();
    if (input) {
      input.focus();
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
    }

    window.scrollTo({ top: document.body.scrollHeight, behavior: 'instant' });

    // Dynamic verification: exit the moment input clears or response begins
    const startConfirm = Date.now();
    while (Date.now() - startConfirm < 3000) {
      const cleared = !normalize(composerText());
      if (cleared || submittedPromptVisible(prompt, previousUserCount) || isGenerating()) {
        window.scrollTo({ top: document.body.scrollHeight, behavior: 'instant' });
        return;
      }
      const curBtn = findSendButton();
      if (curBtn) curBtn.click();
      if (input) {
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
      }
      await sleep(150);
    }
    return;
  }

  async function submitPrompt(promptText, isNewChat = false) {
    dismissCancelModal();

    let input = null;
    for (let i = 0; i < 20; i++) {
      input = findInput();
      if (input) break;
      await sleep(100);
    }
    if (!input) throw new Error('Gemini input box not found. Ensure Gemini is open.');

    const nodes = document.querySelectorAll(
      'model-response, message-content, [data-message-author-role="model"], .model-response-text, [data-test-id*="model-response" i]'
    );
    const baseline = nodes.length;
    const baselineText = nodes.length ? (nodes[nodes.length - 1].innerText || nodes[nodes.length - 1].textContent || '').trim() : '';

    setInputText(input, promptText);
    await sleep(100);
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
