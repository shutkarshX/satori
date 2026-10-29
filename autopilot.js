// -------------------------------------------------------------------------
// Satori - Master Course Completion Orchestrator
// Pure Sequential Pipeline:
// 1. PAGE_LOAD  -> Wait for DOM & iframes to settle
// 2. DISMISS    -> Clear modals & popups
// 3. ACTIONS    -> Handle Videos (mute/seek/16x) OR Reading (smooth scroll + Mark as Read) OR Quiz
// 4. NEXT_NODE  -> Clean forward advance (Next button OR Module jump)
// -------------------------------------------------------------------------

(() => {
  if (!window.location.hostname.includes('futureskillsprime.in')) return;
  if (window.__satoriAutopilotActive) return;
  window.__satoriAutopilotActive = true;

  let isAutoRunning = false;
  let pipelineTimer = null;
  let lastNavigatedId = null;

  function fspLog(phase, msg, detail = '') {
    console.log(`%c[Satori Pipeline | ${phase}] %c${msg}`, 'color: #0b57d0; font-weight: bold;', 'color: inherit;', detail);
  }

  const sleep = (ms) => new Promise(res => setTimeout(res, ms));

  // -------------------------------------------------------------------------
  // Floating On-Screen Status Widget (Top-Right)
  // -------------------------------------------------------------------------
  const widget = {
    root: null,
    textEl: null,
    stopBtn: null
  };

  function updateWidgetStatus(text, isRunning) {
    if (window.top !== window) return;
    if (!widget.root) {
      if (!document.body) return;
      const root = document.createElement('div');
      root.id = 'satori-autopilot-floating-widget';
      root.innerHTML = `
        <div class="satori-ap-pill">
          <span class="satori-ap-icon">⚡</span>
          <span class="satori-ap-text">Autopilot Ready</span>
          <button type="button" class="satori-ap-stop-btn">Stop</button>
        </div>
      `;

      const style = document.createElement('style');
      style.textContent = `
        #satori-autopilot-floating-widget {
          position: fixed;
          top: 65px;
          right: 20px;
          z-index: 2147483647;
          font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
          font-size: 13px;
          user-select: none;
        }
        #satori-autopilot-floating-widget .satori-ap-pill {
          display: flex;
          align-items: center;
          gap: 9px;
          padding: 8px 14px;
          background: #ffffff;
          border: 1px solid #0b57d0;
          border-radius: 999px;
          box-shadow: 0 4px 18px rgba(11, 87, 208, 0.25);
          color: #172b4d;
          font-weight: 500;
          transition: all 0.2s ease;
        }
        #satori-autopilot-floating-widget.running .satori-ap-pill {
          background: #e8f0fe;
          border-color: #0b57d0;
          color: #0b57d0;
        }
        #satori-autopilot-floating-widget.stopped .satori-ap-pill {
          background: #f4f5f7;
          border-color: #dfe1e6;
          color: #5e6c84;
        }
        #satori-autopilot-floating-widget .satori-ap-icon {
          font-size: 15px;
          line-height: 1;
        }
        #satori-autopilot-floating-widget .satori-ap-stop-btn {
          background: #dc2626;
          color: #ffffff;
          border: none;
          border-radius: 6px;
          padding: 4px 9px;
          font-size: 11px;
          font-weight: 600;
          cursor: pointer;
          margin-left: 4px;
          outline: none;
        }
        #satori-autopilot-floating-widget .satori-ap-stop-btn:hover {
          background: #b91c1c;
        }
      `;
      document.documentElement.appendChild(style);
      document.body.appendChild(root);

      widget.root = root;
      widget.textEl = root.querySelector('.satori-ap-text');
      widget.stopBtn = root.querySelector('.satori-ap-stop-btn');

      widget.stopBtn.addEventListener('click', () => {
        stop();
      });
    }

    if (widget.root) {
      widget.root.className = isRunning ? 'running' : 'stopped';
      if (widget.textEl) widget.textEl.textContent = text;
      if (widget.stopBtn) widget.stopBtn.style.display = isRunning ? 'inline-block' : 'none';
    }

    try {
      chrome.storage.local.set({
        satoriAutopilotStatus: { text, running: isRunning, updatedAt: Date.now() },
        satoriAutopilotRunning: isRunning
      });
    } catch (_e) {}
  }

  // -------------------------------------------------------------------------
  // Synthetic Click Dispatcher
  // -------------------------------------------------------------------------
  function triggerClick(el) {
    if (!el) return false;
    ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'].forEach(name => {
      try {
        el.dispatchEvent(new MouseEvent(name, { bubbles: true, cancelable: true, view: window }));
      } catch (_e) {}
    });
    if (typeof el.click === 'function') {
      try { el.click(); } catch (_e) {}
    }
    return true;
  }

  // -------------------------------------------------------------------------
  // PHASE 1: PAGE LOAD & SETTLE
  // -------------------------------------------------------------------------
  async function phasePageLoad() {
    fspLog('PAGE_LOAD', 'Waiting for slide content, timers, and iframes to settle...');
    updateWidgetStatus('Waiting for slide to settle...', true);
    await sleep(800);
  }

  // -------------------------------------------------------------------------
  // PHASE 2: DISMISS POPUPS & MODALS
  // -------------------------------------------------------------------------
  async function phaseDismissModals() {
    const modalButtons = [...document.querySelectorAll('button, a, .btn, span, [role="button"]')];
    for (const btn of modalButtons) {
      if (btn.closest('#satori-autopilot-floating-widget')) continue;
      const text = (btn.innerText || btn.textContent || '').trim();
      if (/^Complete\s*(Now|Later)$/i.test(text)) {
        fspLog('MODAL', `Dismissing "${text}" popup...`);
        triggerClick(btn);
        await sleep(400);
      }
    }
  }

  // -------------------------------------------------------------------------
  // CONTINUOUS AUDIO SILENCER & MEDIA MUTING
  // -------------------------------------------------------------------------
  function enforceMuteAllMedia() {
    document.querySelectorAll('video, audio').forEach(m => {
      try {
        m.muted = true;
        m.volume = 0;
        m.defaultMuted = true;
      } catch (_e) {}
    });
  }

  window.addEventListener('play', (e) => {
    if (e.target && (e.target.tagName === 'VIDEO' || e.target.tagName === 'AUDIO')) {
      e.target.muted = true;
      e.target.volume = 0;
      e.target.defaultMuted = true;
    }
  }, true);

  // -------------------------------------------------------------------------
  // PHASE 3A: VIDEO HANDLING (Mute, 16x Speed, Seek Bar, Complete, Pause)
  // -------------------------------------------------------------------------
  async function handleVideoElement(video) {
    fspLog('VIDEO', 'Handling video player...');
    updateWidgetStatus('Completing video (accelerated)...', true);
    enforceMuteAllMedia();

    if (!video.ended) {
      if (video.paused) video.play().catch(() => {});
      await sleep(400);
      enforceMuteAllMedia();

      try { video.playbackRate = 16; } catch (_e) {}

      if (video.duration && video.currentTime < video.duration - 0.5) {
        video.currentTime = Math.max(0, video.duration - 0.2);
        fspLog('VIDEO', `Seek bar moved to ${Math.round(video.duration)}s (Complete)`);
      }
      await sleep(1000);
      try {
        video.pause();
      } catch (_e) {}
    }
    enforceMuteAllMedia();
    fspLog('VIDEO', 'Video finished cleanly and silenced.');
    return true;
  }

  // -------------------------------------------------------------------------
  // PHASE 3B: PAGE SCROLL & MARK AS READ
  // -------------------------------------------------------------------------
  async function handleReadingSlide() {
    fspLog('SCROLL', 'Performing natural page scroll to bottom...');
    updateWidgetStatus('Checking reading slide...', true);
    try {
      window.scrollBy({ top: document.body.scrollHeight / 2, behavior: 'smooth' });
      await sleep(350);
      window.scrollBy({ top: document.body.scrollHeight, behavior: 'smooth' });
      await sleep(450);
    } catch (_e) {}

    const all = [...document.querySelectorAll('body *:not(#satori-autopilot-floating-widget):not(#satori-autopilot-floating-widget *)')];
    const isAlreadyYes = all.some(el => el.children.length === 0 && (el.innerText?.trim() === 'Yes' || /Marked as Read\s*Yes/i.test(el.innerText || '')));
    if (isAlreadyYes) {
      fspLog('MARK_READ', 'Already marked as Yes.');
      return true;
    }

    const noPill = all.find(el => el.children.length === 0 && (el.innerText?.trim() === 'No' || /Mark as Read\s*No/i.test(el.innerText || '')));
    if (noPill) {
      fspLog('MARK_READ', 'Found orange "No". Clicking toggle...');
      const toggle = noPill.closest('span, div, label, a, button, .toggle, .switch') || noPill;
      triggerClick(toggle);
      triggerClick(noPill);

      for (let i = 0; i < 3; i++) {
        await sleep(600);
        const checkYes = [...document.querySelectorAll('body *:not(#satori-autopilot-floating-widget):not(#satori-autopilot-floating-widget *)')].some(el => 
          el.children.length === 0 && (el.innerText?.trim() === 'Yes' || /Marked as Read\s*Yes/i.test(el.innerText || ''))
        );
        if (checkYes) {
          fspLog('MARK_READ', 'Confirmed: status turned to Yes (Green)!');
          return true;
        }
      }
    }
    return true;
  }

  // -------------------------------------------------------------------------
  // PHASE 3C: QUIZ QUESTIONS
  // -------------------------------------------------------------------------
  async function handleQuizSlide() {
    const choices = [...document.querySelectorAll('input[type="radio"], input[type="checkbox"], [role="radio"]')];
    if (choices.length > 0) {
      fspLog('QUIZ', 'Selecting quiz option...');
      updateWidgetStatus('Solving quiz assessment...', true);
      const anySelected = choices.some(c => c.checked || c.getAttribute('aria-checked') === 'true');
      if (!anySelected) {
        triggerClick(choices[0]);
        await sleep(300);
      }
      const submitBtn = [...document.querySelectorAll('button, input[type="button"], input[type="submit"]')].find(b => 
        /^(submit|check|confirm|submit answer)$/i.test((b.innerText || b.value || '').trim())
      );
      if (submitBtn) {
        fspLog('QUIZ', 'Submitting quiz...');
        triggerClick(submitBtn);
        await sleep(600);
      }
    }
  }

  // -------------------------------------------------------------------------
  // PHASE 4: NEXT NODE ADVANCEMENT
  // -------------------------------------------------------------------------
  async function phaseAdvanceNext() {
    fspLog('NEXT_NODE', 'Advancing forward...');
    updateWidgetStatus('Advancing forward...', true);

    // 1. Click bottom-right Next container (#next_container)
    const nextContainers = document.querySelectorAll('#next_container, #next_container1, .next_container, .next_container1');
    for (const nc of nextContainers) {
      if (!nc.classList.contains('btn_disable')) {
        fspLog('NEXT_NODE', 'Clicking unlocked #next_container');
        const innerLink = nc.querySelector('a, button, [role="button"]') || nc;
        triggerClick(innerLink);
        triggerClick(nc);
        return true;
      }
    }

    // 2. Click any element matching Next Node
    const candidates = [...document.querySelectorAll('body *:not(#satori-autopilot-floating-widget):not(#satori-autopilot-floating-widget *)')];
    for (const el of candidates) {
      if (el.closest('.previous_container, [id*="previous"]')) continue;
      const text = (el.innerText || el.textContent || '').trim();
      if (/^Next\s*Node\s*>*/i.test(text) && (el.children.length === 0 || el.matches('a, button, [role="button"]'))) {
        const btn = el.closest('a, button, [role="button"], div, li') || el;
        if (!btn.classList.contains('btn_disable')) {
          fspLog('NEXT_NODE', `Clicking "${text}" button`);
          triggerClick(btn);
          triggerClick(el);
          return true;
        }
      }
    }

    // 3. Module Jump in Table of Contents
    const allTocNodes = [...document.querySelectorAll('.toc_list li, .tree_node, .content-list-item, [id*="page_unit_toc_"]')];
    for (let i = 0; i < allTocNodes.length; i++) {
      const item = allTocNodes[i];
      if (item.classList.contains('activeNode') || item.classList.contains('active') || item.querySelector('.active') || item.classList.contains('marked')) {
        for (let j = i + 1; j < allTocNodes.length; j++) {
          const nextItem = allTocNodes[j];
          if (nextItem.id && nextItem.id === lastNavigatedId) continue;
          lastNavigatedId = nextItem.id;
          const link = nextItem.querySelector('a') || nextItem;
          fspLog('NEXT_NODE', `Module jump to TOC item (${j + 1}/${allTocNodes.length})`);
          triggerClick(link);
          triggerClick(nextItem);
          return true;
        }
      }
    }

    return false;
  }

  // -------------------------------------------------------------------------
  // Master Balanced Pipeline Execution
  // -------------------------------------------------------------------------
  async function runOrchestratedStep() {
    if (!isAutoRunning) return;

    try {
      // 1. PAGE LOAD: Wait for DOM & iframes to settle
      await phasePageLoad();

      // 2. DISMISS: Clear any popup modals
      await phaseDismissModals();

      // 3. ACTION BASED ON CONTENT TYPE
      const videos = [...document.querySelectorAll('video')];
      const isVideo = videos.length > 0 && (videos[0].duration > 0 || videos[0].src || document.querySelector('.vjs-tech, .video-js'));

      if (isVideo) {
        await handleVideoElement(videos[0]);
      } else if (document.querySelectorAll('input[type="radio"], input[type="checkbox"]').length > 0) {
        await handleQuizSlide();
      } else {
        await handleReadingSlide();
      }

      // 4. BRIEF PAUSE: Let server & UI synchronize (500ms)
      await sleep(500);

      // 5. NEXT NODE: Advance cleanly
      await phaseAdvanceNext();

      // 6. POST-ADVANCE: Allow 1.5s for new slide transition
      await sleep(1500);

    } catch (err) {
      console.error('[Satori Orchestrator] Error:', err);
    }

    if (isAutoRunning) {
      pipelineTimer = setTimeout(runOrchestratedStep, 500);
    }
  }

  function start() {
    isAutoRunning = true;
    lastNavigatedId = null;
    fspLog('PIPELINE', 'Balanced Orchestrator ACTIVATED');
    updateWidgetStatus('Autopilot Active', true);
    runOrchestratedStep();
  }

  function stop() {
    isAutoRunning = false;
    clearTimeout(pipelineTimer);
    pipelineTimer = null;
    fspLog('PIPELINE', 'Balanced Orchestrator STOPPED');
    updateWidgetStatus('Autopilot Stopped', false);
  }

  // Extension Listeners
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg.type === 'START_AUTOPILOT') {
      start();
      sendResponse({ ok: true });
      return true;
    }
    if (msg.type === 'STOP_AUTOPILOT') {
      stop();
      sendResponse({ ok: true });
      return true;
    }
    return false;
  });

  chrome.storage.local.get(['satoriAutopilotRunning'], (res) => {
    if (res.satoriAutopilotRunning) start();
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.satoriAutopilotRunning) {
      if (changes.satoriAutopilotRunning.newValue) start();
      else stop();
    }
  });
})();
