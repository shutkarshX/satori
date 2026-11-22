// Inserts answer text into standard fields or supported code editors.
(() => {
  if (window.__satoNativeTyperLoaded) return;
  window.__satoNativeTyperLoaded = true;

  function stripLanguageHeader(code) {
    return (code || '')
      .replace(/^```(?:java|c\+\+|cpp|c|python|py|javascript|js|typescript|ts|csharp|cs)?\s*\n/i, '')
      .replace(/```\s*$/i, '')
      .replace(/^(?:java|c\+\+|cpp|c|python|py|javascript|js|typescript|ts|csharp|cs)\s+(?=(?:#include|import|public|class|def|package))/i, '')
      .trim();
  }

  function injectNativeValue(element, text) {
    element.focus();
    const proto = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
    if (setter) setter.call(element, text);
    else element.value = text;
    element.dispatchEvent(new InputEvent('input', { bubbles: true, composed: true, inputType: 'insertText', data: text }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
    if (element.value !== text) throw new Error('The editor did not accept the inserted text.');
  }

  function injectContentEditable(element, text) {
    element.focus();
    document.execCommand('selectAll', false, null);
    const inserted = document.execCommand('insertText', false, text);
    if (!inserted) {
      element.innerText = text;
      element.dispatchEvent(new InputEvent('input', { bubbles: true, composed: true, inputType: 'insertText', data: text }));
    }
    const actual = (element.innerText || element.textContent || '').replace(/\u00a0/g, ' ').trim();
    if (actual !== text.replace(/\u00a0/g, ' ').trim()) throw new Error('The editable field did not accept the inserted text.');
  }

  function injectCodeEditor(element, text) {
    const editor = element.closest('.monaco-editor, .CodeMirror, .ace_editor') || element;
    const input = element.matches('textarea') ? element : (editor.querySelector('textarea.inputarea, textarea, .ace_text-input') || element);
    input.focus();
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', code: 'KeyA', ctrlKey: true, bubbles: true }));
    document.execCommand('selectAll', false, null);
    let pasteHandled = false;
    try {
      const transfer = new DataTransfer();
      transfer.setData('text/plain', text);
      const event = new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: transfer });
      pasteHandled = !input.dispatchEvent(event);
    } catch (_error) {}
    if (!pasteHandled) throw new Error('The code editor did not confirm the paste. No success was reported.');
  }

  window.satoTyper = {
    insert(target, rawText) {
      if (!target) throw new Error('No target editor found. Click into the answer box first.');
      const text = stripLanguageHeader(rawText);
      if (window.satoEditorDetector.isMonaco(target) || window.satoEditorDetector.isCodeMirror(target) || target.closest('.ace_editor')) {
        injectCodeEditor(target, text);
      } else if (target.isContentEditable || target.getAttribute('contenteditable') === 'true') {
        injectContentEditable(target, text);
      } else if (target.matches('textarea, input')) {
        injectNativeValue(target, text);
      } else {
        throw new Error('This editor type is not supported for verified insertion.');
      }
      return true;
    }
  };
})();
