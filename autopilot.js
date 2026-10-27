// -------------------------------------------------------------------------
// Satori - Master Course Completion Orchestrator
// Pure Sequential Pipeline:
// 1. PAGE_LOAD  -> Wait for DOM & iframes to settle
// 2. DISMISS    -> Clear modals & popups
// 3. ACTIONS    -> Handle Videos (mute/seek) OR Reading (smooth scroll + Mark as Read)
// 4. VERIFY     -> Hard confirmation of completion
// 5. NEXT_NODE  -> Clean forward advance (Next button OR Module jump)
// -------------------------------------------------------------------------

(() => {
  if (!window.location.hostname.includes('futureskillsprime.in')) return;

  let isAutoRunning = false;
  let pipelineTimer = null;
  let lastNavigatedId = null;

  function fspLog(phase, msg, detail = '') {
    console.log(`%c[Satori Pipeline | ${phase}] %c${msg}`, 'color: #0b57d0; font-weight: bold;', 'color: inherit;', detail);
  }

  const sleep = (ms) => new Promise(res => setTimeout(res, ms));

  function getCommunityId() {
    const urlParams = new URLSearchParams(window.location.search);
    return urlParams.get('c_id') || '';
  }

  function triggerClick(el) {
    if (!el) return false;
    ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'].forEach(name => {
      try {
        el.dispatchEvent(new MouseEvent(name, { bubbles: true, cancelable: true, view: window }));
      } catch (_e) {}
    });
    if (typeof el.click === 'function') el.click();
    return true;
  }

  // -------------------------------------------------------------------------
  // PHASE 1: PAGE LOAD & SETTLE
  // -------------------------------------------------------------------------
  async function phasePageLoad() {
    fspLog('PAGE_LOAD', 'Waiting for slide content, timers, and iframes to settle...');
    await sleep(800); // 800ms settling time for AJAX page transitions
  }

  // -------------------------------------------------------------------------
  // PHASE 2: DISMISS POPUPS & MODALS
  // -------------------------------------------------------------------------
  async function phaseDismissModals() {
    const modalButtons = [...document.querySelectorAll('button, a, .btn, span, [role="button"]')];
    for (const btn of modalButtons) {
      const text = (btn.innerText || btn.textContent || '').trim();
      if (/^Complete\s*(Now|Later)$/i.test(text)) {
        fspLog('MODAL', `Dismissing "${text}" popup...`);
        triggerClick(btn);
        await sleep(400);
      }
    }
  }

  // -------------------------------------------------------------------------
  // PHASE 3A: VIDEO HANDLING (Mute, Seek Bar, Complete)
  // -------------------------------------------------------------------------
  async function handleVideoElement(video) {
    fspLog('VIDEO', 'Handling video player...');
    video.muted = true;
    video.volume = 0;

    if (!video.ended) {
      if (video.paused) video.play().catch(() => {});
      // Allow video to register metadata, then seek to 99%
      await sleep(400);
      if (video.duration && video.currentTime < video.duration - 0.5) {
        video.currentTime = Math.max(0, video.duration - 0.2);
        fspLog('VIDEO', `Seek bar moved to ${Math.round(video.duration)}s (Complete)`);
      }
      // Wait 1.0s for the video player's internal 'ended' event to propagate
      await sleep(1000);
    }
    fspLog('VIDEO', 'Video finished cleanly.');
    return true;
  }

  // -------------------------------------------------------------------------
  // PHASE 3B: PAGE SCROLL & MARK AS READ
  // -------------------------------------------------------------------------
  async function handleReadingSlide() {
    fspLog('SCROLL', 'Performing natural page scroll to bottom...');
    try {
      window.scrollBy({ top: document.body.scrollHeight / 2, behavior: 'smooth' });
      await sleep(350);
      window.scrollBy({ top: document.body.scrollHeight, behavior: 'smooth' });
      await sleep(450);
    } catch (_e) {}

    // Check Mark as Read status
    const all = [...document.querySelectorAll('body *:not(#satori-status-widget):not(#satori-status-widget *)')];
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

      // Verify it turned to "Yes" with up to 3 seconds wait
      for (let i = 0; i < 3; i++) {
        await sleep(600);
        const checkYes = [...document.querySelectorAll('body *:not(#satori-status-widget):not(#satori-status-widget *)')].some(el => 
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

    // 1. Click bottom-right Next container (#next_container)
    const nextContainers = document.querySelectorAll('#next_container, #next_container1, .next_container, .next_container1');
    for (const nc of nextContainers) {
      if (!nc.classList.contains('btn_disable')) {
        fspLog('NEXT_NODE', 'Clicking unlocked #next_container');
        triggerClick(nc);
        return true;
      }
    }

    // 2. Click any element matching Next Node
    const candidates = [...document.querySelectorAll('body *:not(#satori-status-widget):not(#satori-status-widget *)')];
    for (const el of candidates) {
      if (el.closest('.previous_container, [id*="previous"]')) continue;
      const text = (el.innerText || el.textContent || '').trim();
      if (/^Next\s*Node\s*>*/i.test(text) && el.children.length === 0) {
        const btn = el.closest('a, button, [role="button"], div, li') || el;
        if (!btn.classList.contains('btn_disable')) {
          fspLog('NEXT_NODE', `Clicking "${text}" button`);
          triggerClick(btn);
          triggerClick(el);
          return true;
        }
      }
    }

    // 3. Module Jump in Table of Contents (for module boundaries like 6 -> 7)
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
    runOrchestratedStep();
  }

  function stop() {
    isAutoRunning = false;
    clearTimeout(pipelineTimer);
    pipelineTimer = null;
    fspLog('PIPELINE', 'Balanced Orchestrator STOPPED');
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
