// Client helper communicating with background snippet buffer
(() => {
  if (window.__satoSnippetClientLoaded) return;
  window.__satoSnippetClientLoaded = true;
  async function callBackground(type, payload = {}) {
    const res = await chrome.runtime.sendMessage({ type, ...payload });
    if (!res || res.error) throw new Error(res?.error || 'Snippet service unavailable');
    return res;
  }

  function getSelectionText() {
    const el = document.activeElement;
    if (el && (el.tagName === 'TEXTAREA' || (el.tagName === 'INPUT' && el.type === 'text'))) {
      const { selectionStart: s, selectionEnd: e, value } = el;
      return (s !== undefined && e !== undefined && s !== e) ? value.slice(s, e).trim() : '';
    }
    return (window.getSelection()?.toString() || '').trim();
  }

  window.satoSnippetClient = {
    getSelectionText,
    async addSnippet() {
      const sel = getSelectionText();
      if (!sel || sel.length < 3) {
        const curr = await callBackground('SATO_SNIPPET_GET');
        return { count: curr.count, added: false };
      }
      const res = await callBackground('SATO_SNIPPET_ADD', { text: sel });
      return { count: res.count, added: true, snippet: sel };
    },
    async clearSnippets() {
      const res = await callBackground('SATO_SNIPPET_CLEAR');
      return res.cleared || 0;
    },
    async getSnippets() {
      const res = await callBackground('SATO_SNIPPET_GET');
      return res.list || [];
    }
  };
})();
