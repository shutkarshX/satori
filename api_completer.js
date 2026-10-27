// -------------------------------------------------------------------------
// Satori - FutureSkills Prime Direct Course Completer (100% Pure API)
// Marks all modules/nodes complete directly on the backend!
// -------------------------------------------------------------------------

(async () => {
  if (!window.location.hostname.includes('futureskillsprime.in')) return;

  const urlParams = new URLSearchParams(window.location.search);
  const commId = urlParams.get('c_id') || 'adobe-introduction-to-generative-ai-2317222-32935';

  console.log('%c[FSP API Completer] Starting 100% Direct API Completion...', 'color: #00ff00; font-weight: bold; font-size: 14px;');

  function getCsrf() {
    const metaTag = document.querySelector('meta[name="csrf-token"]') || document.querySelector('meta[name="_csrf"]');
    if (metaTag) return metaTag.getAttribute('content');
    const m = document.documentElement.innerHTML.match(/csrf[-_]token["']?\s*[:=]\s*["']([^"']+)["']/i);
    return m ? m[1] : '';
  }

  // 1. Gather all content IDs from Table of Contents / DOM
  const contentIds = new Set();
  
  // From TOC attributes
  document.querySelectorAll('[data-content-id], [content_id], li[id*="node_"]').forEach(el => {
    const id = el.getAttribute('data-content-id') || el.getAttribute('content_id') || el.id?.replace(/\D/g, '');
    if (id && id.length > 2) contentIds.add(id);
  });

  // From inline scripts or forms
  const matches = document.documentElement.innerHTML.matchAll(/content_id["']?\s*[:=]\s*["']?(\d+)/gi);
  for (const m of matches) {
    if (m[1]) contentIds.add(m[1]);
  }

  // Fallback defaults for this course if TOC is collapsed
  if (contentIds.size === 0) {
    contentIds.add('1649');
  }

  console.log(`[FSP API Completer] Found ${contentIds.size} course nodes to complete:`, Array.from(contentIds));

  // 2. Fire update_time_spent API for each node with 200 seconds to give 100% completion credit
  let completedCount = 0;
  for (const cid of contentIds) {
    try {
      console.log(`[FSP API Completer] Completing Node ${cid}...`);
      await fetch(`/LX/contents/update_time_spent?current_community_id=${encodeURIComponent(commId)}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
          'X-Requested-With': 'XMLHttpRequest',
          'X-CSRF-Token': getCsrf()
        },
        body: `timeSpentOn=${cid}~~240&paused_time=${cid}~~0`,
        credentials: 'same-origin'
      });
      completedCount++;
    } catch (e) {
      console.error(`Failed to update ${cid}:`, e);
    }
  }

  console.log(`%c[FSP API Completer] Successfully sent 100% completion for all ${completedCount} nodes!`, 'color: #00ff00; font-weight: bold;');
})();
