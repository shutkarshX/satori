(() => {
  if (window.__satoToastLoaded) return;
  window.__satoToastLoaded = true;
  let toastEl = null;
  let textSpan = null;
  let iconSpan = null;
  let timerId = null;
  let hideAnimTimer = null;

  function ensureToast() {
    if (toastEl && document.body.contains(toastEl)) return toastEl;
    toastEl = document.createElement('div');
    toastEl.id = 'sato-toast-pill';

    iconSpan = document.createElement('span');
    textSpan = document.createElement('span');
    toastEl.appendChild(iconSpan);
    toastEl.appendChild(textSpan);

    Object.assign(toastEl.style, {
      position: 'fixed',
      bottom: '24px',
      right: '24px',
      zIndex: '2147483647',
      padding: '10px 18px',
      borderRadius: '24px',
      fontSize: '13px',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      fontWeight: '500',
      color: '#ffffff',
      background: 'rgba(25, 27, 34, 0.95)',
      boxShadow: '0 8px 24px rgba(0, 0, 0, 0.3)',
      backdropFilter: 'blur(8px)',
      border: '1px solid rgba(255, 255, 255, 0.15)',
      display: 'none',
      alignItems: 'center',
      gap: '8px',
      transition: 'opacity 0.2s ease, transform 0.2s ease',
      transform: 'translateY(8px)',
      opacity: '0',
      pointerEvents: 'none'
    });
    document.body.appendChild(toastEl);
    return toastEl;
  }

  window.satoToast = {
    show(message, type = 'info', autoHideMs = 3000) {
      ensureToast();
      clearTimeout(timerId);
      clearTimeout(hideAnimTimer);

      const icons = { info: '⚡', loading: '⏳', success: '✓', error: '⚠️' };
      iconSpan.textContent = icons[type] || '•';
      textSpan.textContent = message;

      toastEl.style.display = 'flex';
      requestAnimationFrame(() => {
        toastEl.style.opacity = '1';
        toastEl.style.transform = 'translateY(0)';
      });

      if (autoHideMs > 0) {
        timerId = setTimeout(() => this.hide(), autoHideMs);
      }
    },

    hide() {
      if (!toastEl) return;
      clearTimeout(timerId);
      clearTimeout(hideAnimTimer);

      toastEl.style.opacity = '0';
      toastEl.style.transform = 'translateY(8px)';
      hideAnimTimer = setTimeout(() => {
        if (toastEl) toastEl.style.display = 'none';
      }, 200);
    }
  };
})();
