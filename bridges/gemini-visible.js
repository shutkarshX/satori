// Spoof visibility API and requestAnimationFrame in Gemini's page context
if (window.__satoVisibilityInstalled) {
  // Already initialized for this Gemini document.
} else {
window.__satoVisibilityInstalled = true;
try {
  Object.defineProperty(document, 'hidden', { get: () => false, configurable: true });
  Object.defineProperty(document, 'visibilityState', { get: () => 'visible', configurable: true });
  document.addEventListener('visibilitychange', (e) => e.stopImmediatePropagation(), true);

  // Polyfill requestAnimationFrame so background rendering doesn't pause
  window.requestAnimationFrame = (cb) => setTimeout(() => cb(performance.now()), 16);
  window.cancelAnimationFrame = (id) => clearTimeout(id);

  // Force document to report having focus even when user is on another tab
  Object.defineProperty(document, 'hasFocus', { value: () => true, configurable: true });

  // Web Audio keep-alive: exempts this tab from Chrome's background rendering throttle
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  if (AudioCtx && !window.__satoAudioKeepAlive) {
    const ctx = new AudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.00001, ctx.currentTime);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    window.__satoAudioKeepAlive = ctx;
  }
} catch (_e) {}
}
