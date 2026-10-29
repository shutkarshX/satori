(() => {
  if (window.top !== window) return;
  const host = location.hostname;
  if (!(host === 'futureskillsprime.in' || host.endsWith('.futureskillsprime.in'))) return;
  if (window.__satoriCourseAutopilotInstalled) return;
  window.__satoriCourseAutopilotInstalled = true;

  const WAIT_MS = 1000;
  const VIDEO_WAIT_LIMIT_MS = 30 * 60 * 1000;
  let running = false;
  let cancelled = false;
  let loopPromise = null;
  let state = 'STOPPED';

  const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
  const visible = (el) => !!el && !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
  const status = async (text, nextState = state) => {
    state = nextState;
    try {
      await chrome.storage.local.set({
        satoriAutopilotStatus: { text, state, running, updatedAt: Date.now() }
      });
    } catch (_) {}
    console.info('[Satori Autopilot]', state, text);
  };
  const isCancelled = () => cancelled || !running;
  const visibleText = () => (document.body?.innerText || '').replace(/\s+/g, ' ').trim();

  function quizPresent() {
    return [...document.querySelectorAll('input[type="radio"], input[type="checkbox"]')]
      .some(visible);
  }

  function videoElements() {
    return [...document.querySelectorAll('video')].filter(visible);
  }

  function activeNodeSignature() {
    const active = document.querySelector('.toc_list .activeNode, .toc_list .active, .tree_node.activeNode, .tree_node.active, .content-list-item.active');
    const title = document.querySelector('h1, h2, .content-title, .lesson-title');
    return [
      location.href,
      active?.id || active?.innerText?.trim() || '',
      title?.innerText?.trim() || '',
      document.querySelector('video')?.currentSrc || ''
    ].join('|');
  }

  function completionEvidence() {
    const candidates = [...document.querySelectorAll(
      '[aria-label], [title], .status, .completion-status, .marked, .completed, .success, #next_container, #next_container1'
    )].filter(visible);
    const text = candidates.map(el => [
      el.innerText || '', el.getAttribute('aria-label') || '', el.getAttribute('title') || '', el.className || ''
    ].join(' ')).join(' ').toLowerCase();
    return /marked as read\s*:?\s*yes|status\s*:?\s*completed|lesson completed|content completed|completed successfully/.test(text);
  }

  function markAsReadControl() {
    return [...document.querySelectorAll('button, a, input[type="button"], [role="button"]')]
      .filter(visible)
      .find(el => /mark\s*as\s*read/i.test((el.innerText || el.value || el.getAttribute('aria-label') || '').trim()));
  }

  function nextControl() {
    const known = [...document.querySelectorAll('#next_container, #next_container1, .next_container, .next_container1')];
    for (const container of known) {
      if (!visible(container) || container.classList.contains('btn_disable') ||
          container.getAttribute('aria-disabled') === 'true') continue;
      const inner = container.matches('a,button,[role="button"]') ? container :
        container.querySelector('a:not(.disabled), button:not(:disabled), [role="button"]');
      const target = inner || container;
      if (visible(target) && !target.disabled && target.getAttribute('aria-disabled') !== 'true') return target;
    }
    return [...document.querySelectorAll('a, button, [role="button"]')]
      .filter(visible)
      .find(el => /^next node\s*[>›»]*$/i.test((el.innerText || el.getAttribute('aria-label') || '').trim()) &&
        !el.disabled && el.getAttribute('aria-disabled') !== 'true' && !el.classList.contains('btn_disable'));
  }

  async function waitForChange(before, timeoutMs = 12000) {
    const start = Date.now();
    while (!isCancelled() && Date.now() - start < timeoutMs) {
      await sleep(400);
      if (activeNodeSignature() !== before) return true;
    }
    return false;
  }

  async function handleVideo(video) {
    await status('Video detected. Letting it play normally; no seeking or muting.', 'VIDEO_WAIT');
    if (video.ended) return true;
    const started = Date.now();
    while (!isCancelled() && Date.now() - started < VIDEO_WAIT_LIMIT_MS) {
      if (video.ended) return true;
      await sleep(1000);
    }
    if (!isCancelled()) await status('Video has not ended within the wait limit. Paused for manual review.', 'ERROR_PAUSED');
    return false;
  }

  async function handleReading() {
    await status('Reading content detected. Checking its visible completion status.', 'READING_REVIEW');
    if (completionEvidence()) return true;
    const control = markAsReadControl();
    if (control) {
      const before = visibleText();
      if (isCancelled()) return false;
      control.click();
      const started = Date.now();
      while (!isCancelled() && Date.now() - started < 8000) {
        await sleep(400);
        if (completionEvidence() || visibleText() !== before && /marked as read\s*:?\s*yes/i.test(visibleText())) {
          return true;
        }
      }
    }
    await status('Could not verify that this reading node is complete. Please finish/check it manually, then restart.', 'ERROR_PAUSED');
    return false;
  }

  async function run() {
    await status('Started. Checking the current course node.', 'STARTING');
    while (!isCancelled()) {
      await sleep(WAIT_MS);
      if (isCancelled()) break;

      const quiz = quizPresent();
      const videos = videoElements();
      if (quiz && videos.length) {
        await status('This page contains both quiz controls and video. Paused because the node type is ambiguous.', 'QUIZ_PAUSED');
        break;
      }
      if (quiz) {
        await status('Quiz/assessment detected. Autopilot paused; answer and submit it yourself.', 'QUIZ_PAUSED');
        break;
      }

      let complete = false;
      if (videos.length) {
        complete = await handleVideo(videos[0]);
      } else {
        complete = await handleReading();
      }
      if (isCancelled()) break;
      if (!complete) break;

      await status('Visible completion evidence found. Checking for one enabled Next control.', 'VERIFYING_NODE');
      const next = nextControl();
      if (!next) {
        await status('No enabled Next control found. Autopilot stopped; this may be the course end or require manual review.', 'FINISHED');
        break;
      }

      const before = activeNodeSignature();
      if (isCancelled()) break;
      await status('Clicking Next once and verifying that the node changes.', 'NAVIGATING');
      next.click();
      const changed = await waitForChange(before);
      if (isCancelled()) break;
      if (!changed) {
        await status('The page did not visibly change after Next. Stopped instead of retrying blindly.', 'ERROR_PAUSED');
        break;
      }
      await status('Navigation verified. Checking the next node.', 'WAITING_FOR_PAGE');
    }
    running = false;
    if (state !== 'QUIZ_PAUSED' && state !== 'ERROR_PAUSED' && state !== 'FINISHED') {
      await status('Stopped.', 'STOPPED');
    } else {
      try {
        await chrome.storage.local.set({
          satoriAutopilotStatus: { text: state === 'QUIZ_PAUSED' ? 'Paused for quiz/assessment input.' : state === 'FINISHED' ? 'Stopped at course end or no enabled Next control.' : 'Paused because completion/navigation could not be verified.', state, running: false, updatedAt: Date.now() }
        });
      } catch (_) {}
    }
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === 'START_AUTOPILOT') {
      if (running) {
        sendResponse({ ok: true, state, text: 'Autopilot is already running.' });
        return true;
      }
      cancelled = false;
      running = true;
      loopPromise = run().catch(async error => {
        running = false;
        await status('Unexpected error: ' + (error?.message || 'unknown error'), 'ERROR_PAUSED');
      });
      sendResponse({ ok: true, state: 'STARTING', text: 'Autopilot started.' });
      return true;
    }
    if (message?.type === 'STOP_AUTOPILOT') {
      cancelled = true;
      running = false;
      state = 'STOPPED';
      status('Stop requested. No further automation actions will be scheduled.', 'STOPPED');
      sendResponse({ ok: true, state: 'STOPPED', text: 'Stop requested.' });
      return true;
    }
    if (message?.type === 'GET_AUTOPILOT_STATUS') {
      sendResponse({ ok: true, state, running });
      return true;
    }
    return false;
  });
})();