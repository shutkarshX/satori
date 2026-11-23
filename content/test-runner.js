// Helper for finding Examly execution controls, watching testcase results, and advancing.
(() => {
  if (window.__satoTestRunnerLoaded) return;
  window.__satoTestRunnerLoaded = true;

  function isVisible(el) {
    if (!el || el.offsetParent === null) return false;
    const s = window.getComputedStyle(el);
    return s.display !== 'none' && s.visibility !== 'hidden' && s.opacity !== '0';
  }

  function triggerClick(el) {
    if (!el) return;
    const opts = { bubbles: true, cancelable: true, view: window };
    ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'].forEach(evtType => {
      try {
        el.dispatchEvent(new MouseEvent(evtType, opts));
      } catch (_e) {}
    });
    if (typeof el.click === 'function') {
      try { el.click(); } catch (_e) {}
    }
  }

  function findButtonByText(regex) {
    const list = Array.from(document.querySelectorAll('button, [role="button"], a, input, div, span'));
    return list.find(el => isVisible(el) && !el.disabled && regex.test((el.innerText || el.textContent || el.value || '').trim())) || null;
  }

  function findCompileButton() {
    // 1. Direct class or id check
    const direct = document.querySelector('.compile-btn, [class*="compile"], [class*="run-btn"], [id*="compile"], [id*="run"]');
    if (direct && isVisible(direct)) return direct;

    // 2. Text match
    return findButtonByText(/^(compile\s*(&|and)?\s*run|run\s*code|run|execute)$/i) || findButtonByText(/compile/i);
  }

  function findNextButton() {
    // 1. Examly specific next-btn container
    const examlyNext = document.querySelector('.next-btn, [class*="next-btn"], testtaking-footer [class*="next"]');
    if (examlyNext && isVisible(examlyNext)) return examlyNext;

    // 2. Parent of element with text "Next"
    const nextTextEl = Array.from(document.querySelectorAll('div, span, button')).find(el => {
      return isVisible(el) && !el.disabled && /^(next|save\s*(&|and)?\s*next)$/i.test((el.innerText || el.textContent || '').trim());
    });
    if (nextTextEl) {
      const parentBtn = nextTextEl.closest('.next-btn, [class*="next-btn"], button, [role="button"]') || nextTextEl;
      if (isVisible(parentBtn)) return parentBtn;
    }

    // 3. Fallback aria/class scan
    const list = Array.from(document.querySelectorAll('button, [role="button"], a, div, span'));
    return list.find(el => {
      if (!isVisible(el) || el.disabled) return false;
      const aria = (el.getAttribute('aria-label') || el.getAttribute('title') || '').toLowerCase();
      if (aria.includes('next') || aria.includes('forward')) return true;
      const cls = (el.className || '').toString().toLowerCase();
      return (cls.includes('next') || cls.includes('chevron-right') || cls.includes('arrow-right')) && !cls.includes('prev');
    }) || document.querySelector('[class*="pagination" i] [class*="next" i], [class*="nav" i] [class*="next" i]');
  }

  function readTestcaseStatus() {
    // Check known Examly result containers or scan DOM for pass/fail signatures
    const bodyText = document.body.innerText || '';
    
    // Pattern 1: "X/X Testcases Passed" or "X / X test cases passed"
    const ratioMatch = bodyText.match(/(\d+)\s*\/\s*(\d+)\s*test\s*cases?\s*passed/i);
    if (ratioMatch) {
      const passed = parseInt(ratioMatch[1], 10);
      const total = parseInt(ratioMatch[2], 10);
      return { completed: true, passedAll: (passed === total && total > 0), summary: `${passed}/${total} Testcases Passed` };
    }

    // Pattern 2: "Compilation Error" / "Compilation Failed" / "Build Failed"
    if (/compilation\s*(failed|error)|syntax\s*error/i.test(bodyText)) {
      const errMatch = bodyText.match(/(compilation\s*(failed|error)[^\n]*)/i);
      return { completed: true, passedAll: false, summary: errMatch ? errMatch[1].slice(0, 40) : 'Compilation Failed' };
    }
    // Pattern 3: Explicit testcase failure cards or "X Testcases Failed"
    const failMatch = bodyText.match(/(\d+)\s*test\s*cases?\s*failed/i);
    if (failMatch) {
      return { completed: true, passedAll: false, summary: `${failMatch[1]} Testcases Failed` };
    }
    return { completed: false };
  }

  window.satoTestRunner = {
    findCompileButton,
    findNextButton,
    clickNext() {
      const nextBtn = findNextButton();
      if (!nextBtn) throw new Error('Could not find Next / Save & Next button.');
      triggerClick(nextBtn);
      return true;
    },
    async runAndWatch(timeoutMs = 18000) {
      const compileBtn = findCompileButton();
      if (!compileBtn) throw new Error('Could not find Compile & Run button on page.');
      
      // Initial status before compile to ignore stale previous output
      const initialStatus = readTestcaseStatus();
      const initialSummary = initialStatus.completed ? initialStatus.summary : null;

      triggerClick(compileBtn);
      window.satoToast.show('Clicked Compile & Run. Waiting for results…', 'loading', 0);

      const startTime = Date.now();
      // Wait at least 1500ms before reading DOM so Examly has time to send network request & clear old view
      await new Promise(r => setTimeout(r, 1500));

      return new Promise((resolve) => {
        const interval = setInterval(() => {
          const status = readTestcaseStatus();
          // Only complete if test results actually changed or a fresh completed state is observed
          if (status.completed) {
            if (!initialSummary || status.summary !== initialSummary || Date.now() - startTime > 3000) {
              clearInterval(interval);
              resolve(status);
              return;
            }
          }
          if (Date.now() - startTime > timeoutMs) {
            clearInterval(interval);
            resolve({ completed: false, passedAll: false, summary: 'Execution timed out.' });
          }
        }, 600);
      });
    }
  };
})();
