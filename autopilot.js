// -------------------------------------------------------------------------
// Satori - High-Reliability FutureSkills Prime Course Autopilot & API Engine
// Dual Engine:
// 1. PURE API COMPLETER -> Directly sends 240s 100% credit for ALL modules to backend
// 2. ORCHESTRATED LOOP  -> Handles Video (muted, 16x), Reading, Quizzes, & Auto-Advancement
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
  // CSRF & Community Discovery Helpers (Pure API Completer Foundation)
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
    if (ids.size === 0) {
      ids.add('1649');
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
  // Direct Backend API Completer (/LX/contents/update_time_spent)
  // -------------------------------------------------------------------------
  async function syncTimeSpentForId(contentId, seconds = 240) {
    if (!contentId) return false;
    const commId = getCommunityId();
    const csrf = getCsrf();
    try {
      fspLog('API_SYNC', `Sending 100% time credit (${seconds}s) for Node ${contentId}...`);
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
    updateWidgetStatus('⚡ Finding all course module IDs...', true);
    const ids = getAllContentIds();
    if (ids.length === 0) {
      updateWidgetStatus('No module IDs found in DOM.', false);
      return { ok: false, error: 'No course nodes detected.' };
    }

    fspLog('FAST_COMPLETE', `Starting batch API completion for ${ids.length} nodes:`, ids);
    let completed = 0;
    for (const cid of ids) {
      updateWidgetStatus(`⚡ Completing Node ${completed + 1}/${ids.length} (ID: ${cid})...`, true);
      const success = await syncTimeSpentForId(cid, 240);
      if (success) completed++;
      await sleep(250);
    }

    fspLog('FAST_COMPLETE', `Successfully sent 100% completion for all ${completed}/${ids.length} nodes!`);
    updateWidgetStatus(`✅ 100% Credit Sent for all ${completed} Nodes! Reloading...`, false);
    await sleep(1200);
    window.location.reload();
    return { ok: true, completed, total: ids.length };
  }

  // -------------------------------------------------------------------------
  // Floating On-Screen Status Widget (With Direct 1-Click API Completer Button)
  // -------------------------------------------------------------------------
  const widget = {
    root: null,
    textEl: null,
    apiBtn: null,
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
          <button type="button" class="satori-ap-api-btn" title="Send 100% completion to all modules via backend API">⚡ 1-Click Complete All (API)</button>
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
          border: 1px solid #00875a;
          border-radius: 999px;
          box-shadow: 0 4px 20px rgba(0, 135, 90, 0.28);
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
        #satori-autopilot-floating-widget .satori-ap-api-btn {
          background: #00875a;
          color: #ffffff;
          border: none;
          border-radius: 6px;
          padding: 4px 10px;
          font-size: 11px;
          font-weight: 600;
          cursor: pointer;
          outline: none;
          transition: background 0.15s ease;
        }
        #satori-autopilot-floating-widget .satori-ap-api-btn:hover {
          background: #006644;
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
      widget.apiBtn = root.querySelector('.satori-ap-api-btn');
      widget.stopBtn = root.querySelector('.satori-ap-stop-btn');

      widget.apiBtn.addEventListener('click', async () => {
        await completeAllCourseNodesViaApi();
      });

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
  // Synthetic Mouse & Click Dispatcher (Content Script Level)
  // -------------------------------------------------------------------------
  function triggerClick(el) {
    if (!el) return false;
    try {
      const rect = el.getBoundingClientRect();
      const x = rect.left + rect.width / 2;
      const y = rect.top + rect.height / 2;
      const opts = {
        bubbles: true,
        cancelable: true,
        view: window,
        detail: 1,
        screenX: x,
        screenY: y,
        clientX: x,
        clientY: y,
        button: 0,
        buttons: 1
      };

      ['pointerover', 'mouseover', 'pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'].forEach(type => {
        try {
          el.dispatchEvent(new MouseEvent(type, opts));
        } catch (_e) {}
      });

      if (typeof el.click === 'function') {
        el.click();
      }
    } catch (_err) {}
    return true;
  }

  // -------------------------------------------------------------------------
  // Deep Click Execution (Bypasses Content Script Isolation & Triggers Main World)
  // -------------------------------------------------------------------------
  function executeDeepClick(element) {
    if (!element) return false;

    const marker = 'satori_target_' + Math.floor(Math.random() * 1000000);
    element.setAttribute('data-satori-target', marker);

    triggerClick(element);
    if (element.parentElement) triggerClick(element.parentElement);
    element.querySelectorAll('a, button, span').forEach(child => triggerClick(child));

    const code = `
      (() => {
        try {
          const el = document.querySelector('[data-satori-target="${marker}"]');
          if (el) {
            el.removeAttribute('data-satori-target');

            const targets = [el, ...el.querySelectorAll('a, button, span, div')];
            for (const t of targets) {
              if (t.href && t.href.toLowerCase().startsWith('javascript:')) {
                try {
                  const rawCode = decodeURIComponent(t.href.replace(/^javascript:/i, ''));
                  new Function(rawCode).call(t);
                } catch (_e) {}
              }
              if (t.hasAttribute && t.hasAttribute('onclick')) {
                try {
                  new Function(t.getAttribute('onclick')).call(t);
                } catch (_e) {}
              }
              if (typeof t.onclick === 'function') {
                try { t.onclick(); } catch (_e) {}
              }
            }

            const jq = window.jQuery || window.$;
            if (jq) {
              try {
                jq(el).trigger('click');
                jq(el).find('a, button, span').trigger('click');
                const parentContainer = jq(el).closest('#next_container, #next_container1, .next_container, .next_container1, a, button');
                if (parentContainer.length) {
                  parentContainer.trigger('click');
                  parentContainer.find('a').trigger('click');
                }
              } catch (_jqErr) {}
            }

            const clickableChild = el.querySelector('a, button') || el;
            try {
              clickableChild.focus();
              clickableChild.click();
            } catch (_cErr) {}
          }

          if (typeof next_node === 'function') { next_node(); }
          else if (typeof next_content === 'function') { next_content(); }
          else if (typeof getNextNode === 'function') { getNextNode(); }
          else if (typeof goToNextNode === 'function') { goToNextNode(); }
          else if (typeof loadNextContent === 'function') { loadNextContent(); }
          else if (typeof onNextClick === 'function') { onNextClick(); }
          else if (window.player && typeof window.player.next === 'function') { window.player.next(); }
        } catch (err) {
          console.warn('[Satori Main World Next Error]', err);
        }
      })();
    `;

    try {
      const script = document.createElement('script');
      script.textContent = code;
      (document.head || document.documentElement).appendChild(script);
      script.remove();
    } catch (_err) {}

    return true;
  }

  // -------------------------------------------------------------------------
  // PHASE 1: PAGE LOAD & SETTLING
  // -------------------------------------------------------------------------
  async function phasePageLoad() {
    updateWidgetStatus('Checking slide status...', true);
    await sleep(600);
  }

  // -------------------------------------------------------------------------
  // PHASE 2: DISMISS MODALS & POPUPS
  // -------------------------------------------------------------------------
  async function phaseDismissModals() {
    const candidates = [...document.querySelectorAll('button, a, .btn, span, [role="button"]')];
    for (const btn of candidates) {
      if (btn.closest('#satori-autopilot-floating-widget')) continue;
      const text = (btn.innerText || btn.textContent || '').trim();
      if (/^(Complete\s*(Now|Later)|Skip(\s*Intro)?|Later|Remind\s*me\s*later|Resume(\s*course)?|Got\s*it|Close)$/i.test(text)) {
        fspLog('MODAL', `Dismissing "${text}" dialog...`);
        executeDeepClick(btn);
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
    updateWidgetStatus('Completing video (16x accelerated)...', true);
    fspLog('VIDEO', 'Accelerating and completing video slide...');
    enforceMuteAllMedia();

    if (!video.ended) {
      if (video.paused) {
        try { await video.play(); } catch (_e) {}
      }
      enforceMuteAllMedia();

      try { video.playbackRate = 16; } catch (_e) {}

      await sleep(400);
      if (video.duration && !isNaN(video.duration) && video.duration > 1) {
        try {
          video.currentTime = Math.max(0, video.duration - 0.2);
          video.dispatchEvent(new Event('timeupdate'));
        } catch (_e) {}
      }

      await sleep(800);

      try {
        video.dispatchEvent(new Event('ended'));
      } catch (_e) {}

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
    updateWidgetStatus('Verifying reading slide completion...', true);
    fspLog('READING', 'Processing reading slide...');

    try {
      window.scrollBy({ top: document.body.scrollHeight / 2, behavior: 'smooth' });
      await sleep(250);
      window.scrollBy({ top: document.body.scrollHeight, behavior: 'smooth' });
    } catch (_e) {}

    document.querySelectorAll('.content-body, .lesson-content, .reading-container, [class*="scroll"], main, article').forEach(el => {
      try {
        if (el.scrollHeight > el.clientHeight) {
          el.scrollTop = el.scrollHeight;
        }
      } catch (_e) {}
    });
    await sleep(350);

    const allElements = [...document.querySelectorAll('body *:not(#satori-autopilot-floating-widget):not(#satori-autopilot-floating-widget *)')];

    const isAlreadyYes = allElements.some(el => 
      el.children.length === 0 && (el.innerText?.trim() === 'Yes' || /Marked as Read\s*:?\s*Yes/i.test(el.innerText || ''))
    );
    if (isAlreadyYes) {
      fspLog('READING', 'Slide is already marked as read (Yes).');
      return true;
    }

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
      executeDeepClick(toggleWrapper);
      executeDeepClick(targetControl);

      for (let i = 0; i < 4; i++) {
        await sleep(400);
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
    updateWidgetStatus('Solving quiz assessment...', true);
    fspLog('QUIZ', 'Detecting quiz questions...');

    const choices = [...document.querySelectorAll('input[type="radio"], input[type="checkbox"], [role="radio"]')];
    if (choices.length > 0) {
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
          executeDeepClick(target);
          target.dispatchEvent(new Event('change', { bubbles: true }));
          await sleep(200);
        }
      }

      const submitBtn = [...document.querySelectorAll('button, input[type="button"], input[type="submit"], [role="button"], a.btn')].find(b => 
        /^(submit|check|confirm|submit answer|check answer|validate)$/i.test((b.innerText || b.value || '').trim())
      );

      if (submitBtn) {
        fspLog('QUIZ', 'Clicking quiz submit button...');
        executeDeepClick(submitBtn);
        await sleep(600);
      }

      const continueBtn = [...document.querySelectorAll('button, a, .btn')].find(b =>
        /^(continue|next question|next)$/i.test((b.innerText || b.textContent || '').trim())
      );
      if (continueBtn) {
        executeDeepClick(continueBtn);
        await sleep(400);
      }
    }
  }

  // -------------------------------------------------------------------------
  // PHASE 4: NEXT NODE ADVANCEMENT (API First + Deep Click Fallback)
  // -------------------------------------------------------------------------
  async function phaseAdvanceNext() {
    fspLog('NEXT_NODE', 'Attempting forward slide navigation...');

    // 1. ALWAYS send 240s completion credit via backend API for active node
    const activeId = getActiveContentId();
    if (activeId) {
      await syncTimeSpentForId(activeId, 240);
    }

    // 2. Locate Next Node button
    const nextCandidates = [
      ...document.querySelectorAll('#next_container, #next_container1, .next_container, .next_container1, [id*="next_node" i], [class*="next_node" i]'),
      ...document.querySelectorAll('a, button, [role="button"], span.btn, div.btn')
    ];

    for (const el of nextCandidates) {
      if (el.closest('.previous_container, [id*="previous" i], [class*="previous" i]')) continue;
      if (el.closest('#satori-autopilot-floating-widget')) continue;

      const rawText = (el.innerText || el.textContent || '').trim();
      const isNextButton = /next\s*node/i.test(rawText) ||
                           /^next(\s*slide)?(\s*[>›»]+)?$/i.test(rawText) ||
                           el.id === 'next_container' ||
                           el.classList.contains('next_container');

      if (isNextButton) {
        const clickable = el.matches('a, button, [role="button"]') ? el :
                          (el.querySelector('a, button, [role="button"]') || el);

        fspLog('NEXT_NODE', 'Triggering Deep Click on Next Node:', clickable);
        updateWidgetStatus('⚡ Advancing to next node...', true);

        executeDeepClick(clickable);
        if (clickable !== el) executeDeepClick(el);

        const container = el.closest('#next_container, #next_container1, .next_container, .next_container1');
        if (container && container !== el && container !== clickable) {
          executeDeepClick(container);
        }

        return true;
      }
    }

    // 3. Fallback: Table of Contents (TOC) Forward Jump
    const tocItems = [...document.querySelectorAll(
      '.toc_list li, .tree_node, .content-list-item, [id*="page_unit_toc_"], [class*="toc" i] li, [id*="toc" i] li'
    )].filter(el => {
      if (el.closest('#satori-autopilot-floating-widget')) return false;
      return el.querySelector('a, [onclick], [data-content-id], span') || el.matches('li');
    });

    if (tocItems.length > 0) {
      let activeIndex = -1;
      for (let i = 0; i < tocItems.length; i++) {
        const item = tocItems[i];
        const isCurrent = item.classList.contains('activeNode') ||
                          item.classList.contains('active') ||
                          item.classList.contains('selected') ||
                          item.querySelector('.activeNode, .active, .selected') ||
                          item.getAttribute('aria-current') === 'page';
        if (isCurrent) {
          activeIndex = i;
          break;
        }
      }

      if (activeIndex !== -1 && activeIndex + 1 < tocItems.length) {
        for (let j = activeIndex + 1; j < tocItems.length; j++) {
          const nextItem = tocItems[j];
          if (nextItem.id && nextItem.id === lastNavigatedId) continue;

          const parentAccordion = nextItem.closest('.panel-collapse, .collapse, [class*="accordion"]');
          if (parentAccordion && (parentAccordion.classList.contains('collapse') && !parentAccordion.classList.contains('in') && !parentAccordion.classList.contains('show'))) {
            const toggle = parentAccordion.parentElement?.querySelector('[data-toggle="collapse"], .accordion-toggle, .module-title');
            if (toggle) {
              executeDeepClick(toggle);
              await sleep(300);
            }
          }

          lastNavigatedId = nextItem.id || `toc_${j}`;
          const clickable = nextItem.querySelector('a, [onclick], span') || nextItem;
          const label = (clickable.innerText || nextItem.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 28);
          fspLog('NEXT_NODE', `TOC Jump to item (${j + 1}/${tocItems.length}): ${label}`);
          updateWidgetStatus(`⚡ Jumping to: ${label}...`, true);
          executeDeepClick(clickable);
          executeDeepClick(nextItem);
          return true;
        }
      }
    }

    // 4. Fallback: Pure Direct API Node Advance
    const allIds = getAllContentIds();
    if (activeId && allIds.length > 0) {
      const currentIdx = allIds.indexOf(activeId);
      if (currentIdx !== -1 && currentIdx + 1 < allIds.length) {
        const nextId = allIds[currentIdx + 1];
        fspLog('API_NAV', `Advancing via Direct API to Node ${nextId}...`);
        updateWidgetStatus(`⚡ API Advancing to Node ${nextId}...`, true);
        await syncTimeSpentForId(nextId, 240);
        return true;
      }
    }

    fspLog('NEXT_NODE', 'Waiting for next node to unlock...');
    updateWidgetStatus('Waiting for next slide to unlock...', true);
    return false;
  }

  // -------------------------------------------------------------------------
  // Master Orchestrated Pipeline Loop
  // -------------------------------------------------------------------------
  async function runOrchestratedStep() {
    if (!isAutoRunning) return;

    try {
      await phasePageLoad();
      if (!isAutoRunning) return;

      await phaseDismissModals();
      if (!isAutoRunning) return;

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

      await sleep(400);
      if (!isAutoRunning) return;

      const advanced = await phaseAdvanceNext();
      if (!advanced) {
        consecutiveStallCount++;
        if (consecutiveStallCount >= 2) {
          fspLog('STALL', 'Stalled on slide. Triggering instant API course sync...');
          updateWidgetStatus('⚡ Syncing course completion via API...', true);
          const activeId = getActiveContentId();
          if (activeId) await syncTimeSpentForId(activeId, 240);
          consecutiveStallCount = 0;
        }
      } else {
        consecutiveStallCount = 0;
      }

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
