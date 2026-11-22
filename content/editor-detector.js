(() => {
  if (window.__satoEditorDetectorLoaded) return;
  window.__satoEditorDetectorLoaded = true;
  let lastFocused = null;

  function isEditableElement(el) {
    if (!el || el.nodeType !== Node.ELEMENT_NODE) return false;
    if (el.matches('textarea, input:not([type="hidden"]):not([type="radio"]):not([type="checkbox"])')) return true;
    if (el.isContentEditable || el.getAttribute('contenteditable') === 'true') return true;
    if (el.closest('.monaco-editor, .monaco-mouse-cursor-text, .view-lines, .CodeMirror, .ace_editor, [role="textbox"]')) return true;
    return false;
  }

  function track(el) {
    if (isEditableElement(el)) {
      lastFocused = el;
    }
  }

  document.addEventListener('focusin', (e) => track(e.target), true);
  document.addEventListener('click', (e) => track(e.target), true);
  document.addEventListener('mousedown', (e) => track(e.target), true);

  function findFallbackTarget() {
    // 1. Monaco Editor (Examly uses Monaco)
    const monacoInput = document.querySelector('.monaco-editor textarea.inputarea, .monaco-editor textarea');
    if (monacoInput) return monacoInput;

    const monacoContainer = document.querySelector('.monaco-editor');
    if (monacoContainer) return monacoContainer;

    // 2. CodeMirror
    const cmInput = document.querySelector('.CodeMirror textarea, .CodeMirror');
    if (cmInput) return cmInput;

    // 3. Ace Editor
    const aceInput = document.querySelector('.ace_text-input, .ace_editor');
    if (aceInput) return aceInput;

    // 4. Any visible textarea or editable element
    const candidates = Array.from(document.querySelectorAll('textarea, [contenteditable="true"]'));
    return candidates.find((el) => el.offsetParent !== null && !el.disabled && !el.readOnly) || candidates[0] || null;
  }

  window.satoEditorDetector = {
    getActiveTarget() {
      // Prioritize actual code editors (Monaco/CodeMirror) over arbitrary inputs
      const monaco = document.querySelector('.monaco-editor textarea.inputarea, .monaco-editor textarea, .monaco-editor');
      const cm = document.querySelector('.CodeMirror textarea, .CodeMirror');
      const codeEditor = monaco || cm;

      if (codeEditor) {
        lastFocused = codeEditor;
        return codeEditor;
      }

      if (document.activeElement && isEditableElement(document.activeElement)) {
        lastFocused = document.activeElement;
        return document.activeElement;
      }
      if (lastFocused && document.body.contains(lastFocused) && isEditableElement(lastFocused)) {
        return lastFocused;
      }
      return findFallbackTarget();
    },

    isMonaco(el) {
      return Boolean(el && (el.closest('.monaco-editor') || el.classList?.contains('monaco-editor') || document.querySelector('.monaco-editor')));
    },

    isCodeMirror(el) {
      return Boolean(el && (el.closest('.CodeMirror') || el.classList?.contains('CodeMirror')));
    }
  };
})();
