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

    let savedPos = { top: null, left: null };
    try {
      const stored = localStorage.getItem('sato_toast_pos');
      if (stored) savedPos = JSON.parse(stored);
    } catch (_e) {}

    Object.assign(toastEl.style, {
      position: 'fixed',
      zIndex: '2147483647',
      padding: '8px 16px',
      borderRadius: '20px',
      fontSize: '12px',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", sans-serif',
      fontWeight: '600',
      letterSpacing: '0.2px',
      color: '#f8fafc',
      background: 'rgba(17, 19, 24, 0.94)',
      boxShadow: '0 10px 28px -4px rgba(0, 0, 0, 0.5), 0 0 0 1px rgba(255, 255, 255, 0.08)',
      backdropFilter: 'blur(12px)',
      display: 'none',
      alignItems: 'center',
      gap: '9px',
      transition: 'opacity 0.22s cubic-bezier(0.16, 1, 0.3, 1), transform 0.22s cubic-bezier(0.16, 1, 0.3, 1), border-color 0.2s ease',
      transform: 'translateY(10px) scale(0.97)',
      opacity: '0',
      cursor: 'grab',
      userSelect: 'none',
      pointerEvents: 'auto',
      border: '1px solid rgba(255, 255, 255, 0.1)'
    });

    if (savedPos.top !== null && savedPos.left !== null) {
      toastEl.style.top = savedPos.top + 'px';
      toastEl.style.left = savedPos.left + 'px';
      toastEl.style.bottom = 'auto';
      toastEl.style.right = 'auto';
    } else {
      toastEl.style.bottom = '24px';
      toastEl.style.right = '24px';
    }

    // Draggable positioning logic
    let isDragging = false;
    let startX = 0;
    let startY = 0;
    let initialLeft = 0;
    let initialTop = 0;

    toastEl.addEventListener('mousedown', (e) => {
      isDragging = true;
      toastEl.style.cursor = 'grabbing';
      clearTimeout(timerId); // Don't auto-hide while user is dragging
      const rect = toastEl.getBoundingClientRect();
      initialLeft = rect.left;
      initialTop = rect.top;
      startX = e.clientX;
      startY = e.clientY;
      e.preventDefault();
    });

    window.addEventListener('mousemove', (e) => {
      if (!isDragging) return;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      const newLeft = Math.max(10, Math.min(window.innerWidth - toastEl.offsetWidth - 10, initialLeft + dx));
      const newTop = Math.max(10, Math.min(window.innerHeight - toastEl.offsetHeight - 10, initialTop + dy));
      
      toastEl.style.left = newLeft + 'px';
      toastEl.style.top = newTop + 'px';
      toastEl.style.bottom = 'auto';
      toastEl.style.right = 'auto';
    });

    window.addEventListener('mouseup', () => {
      if (!isDragging) return;
      isDragging = false;
      toastEl.style.cursor = 'grab';
      // Save chosen position permanently for all future toasts
      const rect = toastEl.getBoundingClientRect();
      try {
        localStorage.setItem('sato_toast_pos', JSON.stringify({ top: Math.round(rect.top), left: Math.round(rect.left) }));
      } catch (_e) {}
    });

    document.body.appendChild(toastEl);
    return toastEl;
  }

  window.satoToast = {
    show(message, type = 'info', autoHideMs = 3000) {
      ensureToast();
      clearTimeout(timerId);
      clearTimeout(hideAnimTimer);

      const styles = {
        info: {
          border: '1px solid rgba(245, 158, 11, 0.45)',
          shadow: '0 8px 24px rgba(0, 0, 0, 0.4), 0 0 12px rgba(245, 158, 11, 0.15)',
          icon: '⚡',
          color: '#fbbf24'
        },
        loading: {
          border: '1px solid rgba(251, 191, 36, 0.4)',
          shadow: '0 8px 24px rgba(0, 0, 0, 0.4), 0 0 12px rgba(251, 191, 36, 0.12)',
          icon: '⏳',
          color: '#f59e0b'
        },
        success: {
          border: '1px solid rgba(16, 185, 129, 0.5)',
          shadow: '0 8px 24px rgba(0, 0, 0, 0.4), 0 0 14px rgba(16, 185, 129, 0.2)',
          icon: '✓',
          color: '#34d399'
        },
        error: {
          border: '1px solid rgba(244, 63, 94, 0.55)',
          shadow: '0 8px 24px rgba(0, 0, 0, 0.4), 0 0 14px rgba(244, 63, 94, 0.2)',
          icon: '✕',
          color: '#fb7185'
        }
      };

      const cfg = styles[type] || styles.info;
      iconSpan.textContent = cfg.icon;
      iconSpan.style.color = cfg.color;
      iconSpan.style.fontWeight = '700';
      textSpan.textContent = message;

      toastEl.style.border = cfg.border;
      toastEl.style.boxShadow = cfg.shadow;
      toastEl.style.display = 'flex';
      requestAnimationFrame(() => {
        toastEl.style.opacity = '1';
        toastEl.style.transform = 'translateY(0) scale(1)';
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
