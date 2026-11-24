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
      cursor: 'grab',
      userSelect: 'none',
      pointerEvents: 'auto'
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
