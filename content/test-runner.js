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
    el.dispatchEvent(new MouseEvent('mousedown', opts));
    el.dispatchEvent(new MouseEvent('mouseup', opts));
    el.click();
  }

  function findButtonByText(regex) {
    const list = Array.from(document.querySelectorAll('button, [role="button"], a, input, div, span'));
    return list.find(el => isVisible(el) && !el.disabled && regex.test((el.innerText || el.textContent || el.value || '').trim())) || null;
  }

  function findCompileButton() {
    return findButtonByText(/^(compile\s*(&|and)?\s*run|run\s*code|run|execute)$/i) || findButtonByText(/compile/i);
  }

  function findNextButton() {
    const list = Array.from(document.querySelectorAll('button, [role="button"], a, div, span'));
    return list.find(el => isVisible(el) && !el.disabled && /^(save\s*(&|and)?\s*next|next(\s*question)?|submit(\s*code|\s*answer)?)$/i.test((el.innerText || el.textContent || el.value || '').trim())) ||
           list.find(el => {
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
    async runAndWatch(timeoutMs = 15000) {
      const compileBtn = findCompileButton();
      if (!compileBtn) throw new Error('Could not find Compile & Run button on page.');
      
      compileBtn.click();
      window.satoToast.show('Clicked Compile & Run. Waiting for results…', 'loading', 0);

      const startTime = Date.now();
      return new Promise((resolve) => {
        const interval = setInterval(() => {
          const status = readTestcaseStatus();
          if (status.completed) {
            clearInterval(interval);
            resolve(status);
            return;
          }
          if (Date.now() - startTime > timeoutMs) {
            clearInterval(interval);
            resolve({ completed: false, passedAll: false, summary: 'Execution timed out.' });
          }
        }, 500);
      });
    }
  };
})();
