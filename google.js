(() => {
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message.type === 'PING_GOOGLE') { sendResponse({ ok: true }); return true; }
    return false;
  });
})();
