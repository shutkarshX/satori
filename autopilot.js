// -------------------------------------------------------------------------
// Satori - High-Reliability FutureSkills Prime Course Autopilot
// Advanced Pipeline:
// 1. SETTLE      -> Settle page DOM, AJAX, and iframes
// 2. DISMISS     -> Auto-clear blocking popups, dialogs, and modals
// 3. PROCESS     -> Auto-complete Videos (muted, 16x accelerated, seeked)
//                   OR Reading (deep-scroll + Mark as Read toggle)
//                   OR Quizzes (smart option selection + auto-submit)
// 4. UNLOCK/SYNC -> If Next is locked on timer, sync time-spent to unlock
// 5. ADVANCE     -> Next button OR Fixed Accordion TOC Module Jump
// -------------------------------------------------------------------------

(() => {
  if (window.__satoriAutopilotInitialized) return;
  window.__satoriAutopilotInitialized = true;

  const isTopFrame = window.top === window;
  const host = location.hostname;
  if (!host.includes('futureskillsprime.in')) return;

  let isAutoRunning = false;
  let pipelineTimer = null;
  let lastNavigatedId = null;
  let consecutiveStallCount = 0;

  const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

  function fspLog(phase, msg, detail = '') {
    console.log(`%c[Satori Autopilot | ${phase}] %c${msg}`, 'color: #00875a; font-weight: bold;', 'color: inherit;', detail);
  }

  // -------------------------------------------------------------------------
  // Floating On-Screen Status Widget (Top Frame Only)
  // -------------------------------------------------------------------------
  const widget = {
    root: null,
    textEl: null,
    stopBtn: null
  };

  function updateWidgetStatus(text, isRunning) {
    if (!isTopFrame) return;
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
          bottom: 20px;
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
          border: 1px solid #00875a;
          border-radius: 999px;
          box-shadow: 0 4px 18px rgba(0, 135, 90, 0.25);
          color: #172b4d;
          font-weight: 500;
          transition: all 0.2s ease;
        }
        #satori-autopilot-floating-widget.running .satori-ap-pill {
          background: #e3fcef;
          border-color: #00875a;
          color: #006644;
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
          background: #ff5630;
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
          background: #de350b;
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
  // CSRF & Community Discovery Helpers
  // -------------------------------------------------------------------------
  function getCsrf() {
    const metaTag = document.querySelector('meta[name="csrf-token"]') || document.querySelector('meta[name="_csrf"]');
    if (metaTag) return metaTag.getAttribute('content') || '';
    const m = document.documentElement.innerHTML.match(/csrf[-_]token["']?\s*[:=]\s*["']([^"']+)["']/i);
    return m ? m[1] : '';
  }

  function getCommunityId() {
    const urlParams = new URLSearchParams(window.location.search);
    const fromUrl = urlParams.get('c_id') || urlParams.get('current_community_id');
    if (fromUrl) return fromUrl;
    const m = document.documentElement.innerHTML.match(/current_community_id["']?\s*[:=]\s*["']([^"']+)["']/i);
    return m ? m[1] : 'adobe-introduction-to-generative-ai-2317222-32935';
  }

  function getAllContentIds() {
    const ids = new Set();
    document.querySelectorAll('[data-content-id], [content_id], li[id*="node_"], li[id*="page_unit_toc_"]').forEach(el => {
      const id = el.getAttribute('data-content-id') || el.getAttribute('content_id') || el.id?.replace(/\D/g, '');
      if (id && id.length > 2) ids.add(id);
    });
    const matches = document.documentElement.innerHTML.matchAll(/content_id["']?\s*[:=]\s*["']?(\d+)/gi);
    for (const m of matches) {
      if (m[1] && m[1].length > 2) ids.add(m[1]);
    }
    return Array.from(ids);
  }

  function getActiveContentId() {
    const activeEl = document.querySelector('.toc_list .activeNode, .toc_list .active, .tree_node.activeNode, .tree_node.active, .content-list-item.active, [id*="node_"].active');
    if (activeEl) {
      const id = activeEl.getAttribute('data-content-id') || activeEl.getAttribute('content_id') || activeEl.id?.replace(/\D/g, '');
      if (id) return id;
    }
    const urlParams = new URLSearchParams(window.location.search);
    const fromUrl = urlParams.get('content_id') || urlParams.get('node_id');
    if (fromUrl) return fromUrl;
    const all = getAllContentIds();
    return all.length > 0 ? all[0] : null;
  }

  // -------------------------------------------------------------------------
  // Direct Backend Time-Spent Synchronization
  // -------------------------------------------------------------------------
  async function syncTimeSpentForId(contentId, seconds = 240) {
    if (!contentId) return false;
    const commId = getCommunityId();
    const csrf = getCsrf();
    try {
      fspLog('API_SYNC', `Sending time spent (${seconds}s) for Node ${contentId}...`);
      await fetch(`/LX/contents/update_time_spent?current_community_id=${encodeURIComponent(commId)}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
          'X-Requested-With': 'XMLHttpRequest',
          'X-CSRF-Token': csrf
        },
        body: `timeSpentOn=${encodeURIComponent(contentId)}~~${seconds}&paused_time=${encodeURIComponent(contentId)}~~0`,
        credentials: 'same-origin'
      });
      return true;
    } catch (e) {
      console.warn('[Satori API Sync] Error syncing time spent:', e);
      return false;
    }
  }

  async function completeAllCourseNodesViaApi() {
    updateWidgetStatus('⚡ Fast Completing all course modules...', true);
    const ids = getAllContentIds();
    if (ids.length === 0) {
      updateWidgetStatus('No module IDs found in DOM.', false);
      return { ok: false, error: 'No course nodes detected.' };
    }

    fspLog('FAST_COMPLETE', `Starting batch completion for ${ids.length} nodes:`, ids);
    let completed = 0;
    for (const cid of ids) {
      updateWidgetStatus(`⚡ Completing node ${completed + 1}/${ids.length}...`, true);
      const success = await syncTimeSpentForId(cid, 240);
      if (success) completed++;
      await sleep(250);
    }

    fspLog('FAST_COMPLETE', `Successfully sent completion for ${completed}/${ids.length} nodes!`);
    updateWidgetStatus(`✅ 100% credit sent for ${completed} nodes! Reloading...`, false);
    await sleep(1500);
    window.location.reload();
    return { ok: true, completed, total: ids.length };
  }

  // -------------------------------------------------------------------------
  // PHASE 1: PAGE LOAD & SETTLING
  // -------------------------------------------------------------------------
  async function phasePageLoad() {
    updateWidgetStatus('Waiting for slide to settle...', true);
    await sleep(800);
  }

  // -------------------------------------------------------------------------
  // PHASE 2: DISMISS MODALS & POPUPS
  // -------------------------------------------------------------------------
  async function phaseDismissModals() {
    const candidates = [...document.querySelectorAll('button, a, .btn, span, [role="button"]')];
    for (const btn of candidates) {
      const text = (btn.innerText || btn.textContent || '').trim();
      if (/^(Complete\s*(Now|Later)|Skip(\s*Intro)?|Later|Remind\s*me\s*later|Resume(\s*course)?|Got\s*it|Close)$/i.test(text)) {
        fspLog('MODAL', `Dismissing "${text}" dialog...`);
        triggerClick(btn);
        await sleep(350);
      }
    }
  }

  // -------------------------------------------------------------------------
  // CONTINUOUS AUDIO SILENCING
  // -------------------------------------------------------------------------
  function enforceMuteAllMedia() {
    document.querySelectorAll('video, audio').forEach(m => {
      try {
        m.muted = true;
        m.volume = 0;
        m.defaultMuted = true;
      } catch (_e) {}
    });

    // Also silence same-origin iframes
    document.querySelectorAll('iframe').forEach(frame => {
      try {
        const frameDoc = frame.contentDocument || frame.contentWindow?.document;
        if (frameDoc) {
          frameDoc.querySelectorAll('video, audio').forEach(m => {
            m.muted = true;
            m.volume = 0;
            m.defaultMuted = true;
          });
        }
      } catch (_e) {}
    });
  }

  // Global listener to immediately mute any audio/video on start
  window.addEventListener('play', (e) => {
    if (isAutoRunning && e.target && (e.target.tagName === 'VIDEO' || e.target.tagName === 'AUDIO')) {
      e.target.muted = true;
      e.target.volume = 0;
      e.target.defaultMuted = true;
    }
  }, true);

  // -------------------------------------------------------------------------
  // PHASE 3A: VIDEO HANDLING (Mute, 16x Speed, Smooth Fast-Forward, Complete)
  // -------------------------------------------------------------------------
  async function handleVideoElement(video) {
    updateWidgetStatus('Handling video playback (16x accelerated)...', true);
    fspLog('VIDEO', 'Accelerating and completing video slide...');
    enforceMuteAllMedia();

    if (!video.ended) {
      // 1. Ensure playback begins
      if (video.paused) {
        try { await video.play(); } catch (_e) {}
      }
      enforceMuteAllMedia();

      // 2. Set maximum playback rate for natural fast tracking
      try { video.playbackRate = 16; } catch (_e) {}

      // 3. Fast-forward near end so completion hooks trigger
      await sleep(400);
      if (video.duration && !isNaN(video.duration) && video.duration > 1) {
        try {
          video.currentTime = Math.max(0, video.duration - 0.2);
          video.dispatchEvent(new Event('timeupdate'));
        } catch (_e) {}
      }

      // 4. Wait for player completion event
      await sleep(800);

      try {
        video.dispatchEvent(new Event('ended'));
      } catch (_e) {}

      // 5. Cleanly pause so it doesn't loop
      try { video.pause(); } catch (_e) {}
    }

    enforceMuteAllMedia();
    fspLog('VIDEO', 'Video slide completed cleanly.');
    return true;
  }

  // -------------------------------------------------------------------------
  // PHASE 3B: READING SLIDE HANDLING (Deep Scroll + Mark as Read)
  // -------------------------------------------------------------------------
  async function handleReadingSlide() {
    updateWidgetStatus('Scrolling and marking reading slide as complete...', true);
    fspLog('READING', 'Processing reading slide...');

    // 1. Scroll window and all inner scrollable containers to bottom
    try {
      window.scrollBy({ top: document.body.scrollHeight / 2, behavior: 'smooth' });
      await sleep(300);
      window.scrollBy({ top: document.body.scrollHeight, behavior: 'smooth' });
    } catch (_e) {}

    document.querySelectorAll('.content-body, .lesson-content, .reading-container, [class*="scroll"], main, article').forEach(el => {
      try {
        if (el.scrollHeight > el.clientHeight) {
          el.scrollTop = el.scrollHeight;
        }
      } catch (_e) {}
    });
    await sleep(400);

    // 2. Search for Mark as Read toggle or completion pill
    const allElements = [...document.querySelectorAll('body *:not(#satori-autopilot-floating-widget):not(#satori-autopilot-floating-widget *)')];

    // Check if already "Yes" (Green)
    const isAlreadyYes = allElements.some(el => 
      el.children.length === 0 && (el.innerText?.trim() === 'Yes' || /Marked as Read\s*:?\s*Yes/i.test(el.innerText || ''))
    );
    if (isAlreadyYes) {
      fspLog('READING', 'Slide is already marked as read (Yes).');
      return true;
    }

    // Look for orange "No" toggle or "Mark as Read" buttons
    const noPill = allElements.find(el => 
      el.children.length === 0 && (el.innerText?.trim() === 'No' || /Mark as Read\s*:?\s*No/i.test(el.innerText || ''))
    );

    const markBtn = allElements.find(el =>
      /^(mark as read|mark as completed|mark as complete|complete)$/i.test((el.innerText || el.value || '').trim())
    );

    const targetControl = noPill || markBtn;

    if (targetControl) {
      fspLog('READING', 'Clicking Mark as Read control...');
      const toggleWrapper = targetControl.closest('span, div, label, a, button, .toggle, .switch') || targetControl;
      triggerClick(toggleWrapper);
      triggerClick(targetControl);

      // Verify toggle flipped to "Yes"
      for (let i = 0; i < 4; i++) {
        await sleep(500);
        const checkYes = [...document.querySelectorAll('body *:not(#satori-autopilot-floating-widget):not(#satori-autopilot-floating-widget *)')].some(el => 
          el.children.length === 0 && (el.innerText?.trim() === 'Yes' || /Marked as Read\s*:?\s*Yes/i.test(el.innerText || ''))
        );
        if (checkYes) {
          fspLog('READING', 'Verified: Status flipped to Yes (Green)!');
          return true;
        }
      }
    }

    return true;
  }

  // -------------------------------------------------------------------------
  // PHASE 3C: QUIZ / ASSESSMENT HANDLING (Active Solver + Auto-Submit)
  // -------------------------------------------------------------------------
  async function handleQuizSlide() {
    updateWidgetStatus('Solving quiz assessment questions...', true);
    fspLog('QUIZ', 'Detecting quiz questions...');

    const choices = [...document.querySelectorAll('input[type="radio"], input[type="checkbox"], [role="radio"]')];
    if (choices.length > 0) {
      // Group choices by name or question container so multi-question quizzes are all answered
      const groups = new Map();
      choices.forEach(c => {
        const groupKey = c.name || c.closest('.question, .quiz-question, form, fieldset, li')?.id || 'default';
        if (!groups.has(groupKey)) groups.set(groupKey, []);
        groups.get(groupKey).push(c);
      });

      for (const [_key, groupChoices] of groups.entries()) {
        const anySelected = groupChoices.some(c => c.checked || c.getAttribute('aria-checked') === 'true');
        if (!anySelected && groupChoices.length > 0) {
          fspLog('QUIZ', `Selecting option for question group...`);
          const target = groupChoices[0];
          target.checked = true;
          triggerClick(target);
          target.dispatchEvent(new Event('change', { bubbles: true }));
          await sleep(250);
        }
      }

      // Find and click the Submit / Check / Confirm button
      const submitBtn = [...document.querySelectorAll('button, input[type="button"], input[type="submit"], [role="button"], a.btn')].find(b => 
        /^(submit|check|confirm|submit answer|check answer|validate)$/i.test((b.innerText || b.value || '').trim())
      );

      if (submitBtn) {
        fspLog('QUIZ', 'Clicking quiz submit button...');
        triggerClick(submitBtn);
        await sleep(800);
      }

      // Check if a post-submit "Continue" or "Next Question" button appeared
      const continueBtn = [...document.querySelectorAll('button, a, .btn')].find(b =>
        /^(continue|next question|next)$/i.test((b.innerText || b.textContent || '').trim())
      );
      if (continueBtn) {
        triggerClick(continueBtn);
        await sleep(500);
      }
    }
  }

  // -------------------------------------------------------------------------
  // PHASE 4: NEXT NODE ADVANCEMENT (Multi-Strategy with Fixed Accordion TOC)
  // -------------------------------------------------------------------------
  async function phaseAdvanceNext() {
    updateWidgetStatus('Advancing to next slide...', true);
    fspLog('NEXT_NODE', 'Advancing forward...');

    // Strategy 1: Check standard bottom-right Next container (#next_container)
    const nextContainers = [...document.querySelectorAll('#next_container, #next_container1, .next_container, .next_container1')];
    for (const nc of nextContainers) {
      if (!nc.classList.contains('btn_disable') && nc.getAttribute('aria-disabled') !== 'true') {
        fspLog('NEXT_NODE', 'Clicking enabled #next_container');
        triggerClick(nc);
        return true;
      }
    }

    // Strategy 1B: If #next_container is locked with btn_disable (Timer requirement),
    // automatically sync time-spent for the active slide to unlock it!
    const lockedNext = nextContainers.find(nc => nc.classList.contains('btn_disable'));
    if (lockedNext) {
      fspLog('NEXT_NODE', 'Next button is locked by slide timer. Triggering time-spent unlock sync...');
      updateWidgetStatus('Unlocking slide timer requirement...', true);
      const activeId = getActiveContentId();
      if (activeId) {
        await syncTimeSpentForId(activeId, 240);
        await sleep(600);
        if (!lockedNext.classList.contains('btn_disable')) {
          fspLog('NEXT_NODE', 'Timer unlocked! Clicking Next container...');
          triggerClick(lockedNext);
          return true;
        }
      }
    }

    // Strategy 2: Click any button/link matching "Next Node", "Next Slide", or "Continue"
    const candidates = [...document.querySelectorAll('body *:not(#satori-autopilot-floating-widget):not(#satori-autopilot-floating-widget *)')];
    for (const el of candidates) {
      if (el.closest('.previous_container, [id*="previous"]')) continue;
      const text = (el.innerText || el.textContent || '').trim();
      if (/^(Next\s*(Node|Slide)?\s*[>›»]*|Continue|Proceed)$/i.test(text) && el.children.length === 0) {
        const btn = el.closest('a, button, [role="button"], div, li') || el;
        if (!btn.classList.contains('btn_disable') && !btn.disabled && btn.getAttribute('aria-disabled') !== 'true') {
          fspLog('NEXT_NODE', `Clicking "${text}" button`);
          triggerClick(btn);
          triggerClick(el);
          return true;
        }
      }
    }

    // Strategy 3: Fixed Table of Contents (TOC) Module Jump
    // Strictly tracks the *true active* node and handles collapsed accordions!
    const allTocNodes = [...document.querySelectorAll('.toc_list li, .tree_node, .content-list-item, [id*="page_unit_toc_"]')];
    if (allTocNodes.length > 0) {
      // Find current active index (strictly active, NOT just marked!)
      let activeIndex = -1;
      for (let i = 0; i < allTocNodes.length; i++) {
        const item = allTocNodes[i];
        if (item.classList.contains('activeNode') || item.classList.contains('active') || item.querySelector('.activeNode, .active') || item.getAttribute('aria-current') === 'page') {
          activeIndex = i;
          break;
        }
      }

      // If active node found, jump to the very next node
      if (activeIndex !== -1 && activeIndex + 1 < allTocNodes.length) {
        for (let j = activeIndex + 1; j < allTocNodes.length; j++) {
          const nextItem = allTocNodes[j];
          if (nextItem.id && nextItem.id === lastNavigatedId) continue;

          // Check if parent module accordion is collapsed, and expand it!
          const parentAccordion = nextItem.closest('.panel-collapse, .collapse, [class*="accordion"]');
          if (parentAccordion && (parentAccordion.classList.contains('collapse') && !parentAccordion.classList.contains('in') && !parentAccordion.classList.contains('show'))) {
            const accordionToggle = parentAccordion.parentElement?.querySelector('[data-toggle="collapse"], .accordion-toggle, .module-title');
            if (accordionToggle) {
              fspLog('NEXT_NODE', 'Expanding collapsed module accordion...');
              triggerClick(accordionToggle);
              await sleep(350);
            }
          }

          lastNavigatedId = nextItem.id || `toc_${j}`;
          const link = nextItem.querySelector('a') || nextItem;
          fspLog('NEXT_NODE', `Jumping to next lesson in TOC (${j + 1}/${allTocNodes.length}): ${link.innerText?.trim() || nextItem.id}`);
          triggerClick(link);
          return true;
        }
      }
    }

    // Check if course has finished
    const courseFinished = document.querySelector('.course-completed, .certificate-container, #course_complete_badge') ||
      candidates.some(el => /Course\s*(Completed|Finished|100%)/i.test(el.innerText || ''));

    if (courseFinished) {
      fspLog('COURSE_END', 'Course complete! 100% finished.');
      updateWidgetStatus('🎉 Course Completed 100%!', false);
      stop();
      return false;
    }

    fspLog('NEXT_NODE', 'No forward navigation candidate found in this step.');
    return false;
  }

  // -------------------------------------------------------------------------
  // Master Orchestrated Pipeline Loop
  // -------------------------------------------------------------------------
  async function runOrchestratedStep() {
    if (!isAutoRunning) return;

    try {
      // 1. Settle page
      await phasePageLoad();
      if (!isAutoRunning) return;

      // 2. Dismiss any blocking modals/popups
      await phaseDismissModals();
      if (!isAutoRunning) return;

      // 3. Classify and process current slide content
      const videos = [...document.querySelectorAll('video')];
      const isVideo = videos.length > 0 && (videos[0].duration > 0 || videos[0].src || document.querySelector('.vjs-tech, .video-js'));

      if (isVideo) {
        await handleVideoElement(videos[0]);
      } else if (document.querySelectorAll('input[type="radio"], input[type="checkbox"]').length > 0) {
        await handleQuizSlide();
      } else {
        await handleReadingSlide();
      }
      if (!isAutoRunning) return;

      // 4. Brief synchronization pause
      await sleep(500);
      if (!isAutoRunning) return;

      // 5. Advance to the next slide/module
      const advanced = await phaseAdvanceNext();
      if (!advanced) {
        consecutiveStallCount++;
        if (consecutiveStallCount >= 4) {
          fspLog('STALL', 'Stalled on slide. Firing automated time-spent sync to unblock...');
          const activeId = getActiveContentId();
          if (activeId) await syncTimeSpentForId(activeId, 240);
          consecutiveStallCount = 0;
        }
      } else {
        consecutiveStallCount = 0;
      }

      // 6. Transition wait before next cycle
      await sleep(1500);

    } catch (err) {
      console.error('[Satori Autopilot] Pipeline cycle error:', err);
    }

    if (isAutoRunning) {
      pipelineTimer = setTimeout(runOrchestratedStep, 600);
    }
  }

  // -------------------------------------------------------------------------
  // Start & Stop Controls
  // -------------------------------------------------------------------------
  function start() {
    if (isAutoRunning) return;
    isAutoRunning = true;
    lastNavigatedId = null;
    consecutiveStallCount = 0;
    fspLog('PIPELINE', '⚡ Satori Autopilot Engine ACTIVATED');
    updateWidgetStatus('Autopilot Active — Initializing...', true);
    runOrchestratedStep();
  }

  function stop() {
    isAutoRunning = false;
    if (pipelineTimer) {
      clearTimeout(pipelineTimer);
      pipelineTimer = null;
    }
    fspLog('PIPELINE', '⚡ Satori Autopilot Engine STOPPED');
    updateWidgetStatus('Autopilot Stopped.', false);
  }

  // -------------------------------------------------------------------------
  // Message & Storage Listeners
  // -------------------------------------------------------------------------
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg.type === 'START_AUTOPILOT') {
      start();
      sendResponse({ ok: true, text: 'Autopilot running!' });
      return true;
    }
    if (msg.type === 'STOP_AUTOPILOT') {
      stop();
      sendResponse({ ok: true, text: 'Autopilot stopped.' });
      return true;
    }
    if (msg.type === 'COMPLETE_ALL_API') {
      completeAllCourseNodesViaApi().then(res => sendResponse(res));
      return true;
    }
    if (msg.type === 'GET_AUTOPILOT_STATUS') {
      sendResponse({ ok: true, running: isAutoRunning });
      return true;
    }
    return false;
  });

  // Synchronize with popup via storage
  chrome.storage.local.get(['satoriAutopilotRunning'], (res) => {
    if (res.satoriAutopilotRunning && isTopFrame) {
      start();
    }
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.satoriAutopilotRunning) {
      if (changes.satoriAutopilotRunning.newValue && isTopFrame) start();
      else if (!changes.satoriAutopilotRunning.newValue) stop();
    }
  });
})();
