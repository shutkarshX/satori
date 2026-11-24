// Fast path: read token + test IDs from localStorage, fetch encrypted
// answer key, decrypt, return [{question, correct}] — no Gemini involved.
(() => {
  if (window.__satoFastPathLoaded) return;
  window.__satoFastPathLoaded = true;

  const SECRET = 'k3QL95NjdP!cA34CsXL';
  const ENDPOINT = 'https://api.examly.io/api/9DECJfxqhu0cgJAQ';

  function findToken() {
    // 1. Direct check localStorage 'token' (frequently a JSON object containing a .token JWT)
    try {
      const storedToken = localStorage.getItem('token');
      if (storedToken) {
        if (storedToken.trim().startsWith('{')) {
          const parsed = JSON.parse(storedToken);
          if (parsed?.token && typeof parsed.token === 'string') return parsed.token;
          if (parsed?.jwtToken && typeof parsed.jwtToken === 'string') return parsed.jwtToken;
          if (parsed?.accessToken && typeof parsed.accessToken === 'string') return parsed.accessToken;
        } else if (!storedToken.startsWith('{') && !storedToken.startsWith('[')) {
          return storedToken.replace(/^"|"$/g, '');
        }
      }
    } catch (_e) {}

    const directKeys = ['jwt_token', 'jwtToken', 'access_token', 'id_token', 'user_token'];
    for (const k of directKeys) {
      const v = localStorage.getItem(k);
      if (v && typeof v === 'string' && v.trim() && !v.startsWith('{') && !v.startsWith('[')) {
        return v.replace(/^"|"$/g, '');
      }
    }

    // Check JSON items
    for (const k of ['formData', 'currentUser', 'user', 'auth', 'authData', 'session']) {
      try {
        const parsed = JSON.parse(localStorage.getItem(k) || 'null');
        if (parsed?.token && typeof parsed.token === 'string') return parsed.token;
        if (parsed?.jwtToken && typeof parsed.jwtToken === 'string') return parsed.jwtToken;
        if (parsed?.accessToken && typeof parsed.accessToken === 'string') return parsed.accessToken;
      } catch (_e) {}
    }

    // Check cookies as fallback
    const cookieMatch = document.cookie.match(/(?:^|;\s*)(?:token|jwt_token|accessToken)=([^;]+)/i);
    if (cookieMatch) return decodeURIComponent(cookieMatch[1]);

    return '';
  }

  function readState() {
    const tok = JSON.parse(localStorage.getItem('formData') || 'null');
    if (!tok || !tok.user_id || !tok.school_id)
      throw new Error('no user/school id in formData');

    const ae = JSON.parse(localStorage.getItem('accord_event') || 'null');
    if (!ae || !ae.list || !ae.list.t_id)
      throw new Error('no test data in accord_event');

    const rawCid = (location.search.match(/[?&]id=([^&]+)/) || [])[1];
    if (!rawCid) throw new Error('no c_id in URL');
    // Examly URLs often concatenate course_id and test_id (each 36-char UUID); extract the 36-char course_id
    const cid = rawCid.length > 36 ? rawCid.slice(0, 36) : rawCid;

    const rawToken = findToken();
    if (!rawToken) throw new Error('no authorization token found in storage');
    // Examly expects the raw JWT token in the Authorization header (WITHOUT "Bearer ")
    const authorization = rawToken.replace(/^Bearer\s+/i, '');

    return {
      tok,
      cid,
      tid: ae.list.t_id,
      mod: ae.mod_id,
      sub: ae.sub_mod_id,
      sess: localStorage.getItem('sessionId') || '',
      attempt: Number(ae.attempt_no || ae.list?.attempt_no || 1),
      authorization,
    };
  }

  async function extractFast() {
    const { tok, cid, tid, mod, sub, sess, attempt, authorization } = readState();
    const pass = (tok.user_id + tok.school_id + SECRET).replace(/-/g, '');

    const body = {
      user_id: tok.user_id, c_id: cid, t_id: tid,
      client_data: { session_id: sess || '' },
      attempt_no: attempt, test_type: 'normal',
      mod_id: mod, sub_mod_id: sub,
    };

    const resp = await chrome.runtime.sendMessage({
      type: 'SATO_RELAY_FETCH',
      url: ENDPOINT,
      init: {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': authorization
        },
        credentials: 'include',
        body: JSON.stringify(body),
      },
    });
    if (resp?.error) throw new Error(resp.error);
    console.log('[fastpath] status:', resp.status, 'raw:', resp.body ? resp.body.slice(0, 800) : '<empty>');
    if (!resp.body || resp.body.trim().startsWith('<')) {
      const match = resp.body?.match(/<title>([^<]+)<\/title>/i);
      const title = match ? match[1] : 'HTML returned instead of JSON';
      throw new Error(`Endpoint returned HTTP ${resp.status || ''}: ${title}`);
    }
    const j = JSON.parse(resp.body);
    if (!j.data) {
      const msg = typeof j.message === 'object' ? JSON.stringify(j.message) : (j.message || (typeof j.error === 'object' ? JSON.stringify(j.error) : j.error) || resp.body.slice(0, 100));
      throw new Error(`no data in response (${msg})`);
    }

    const decryptedStr = await window.satoCrypto.decrypt(pass, j.data);
    const parsed = JSON.parse(decryptedStr);
    
    // Support all known Examly payload shapes:
    // 1. frozen_test_data array with section questions
    // 2. direct questions or data array
    const sections = parsed.frozen_test_data || [];
    const list = sections.length > 0
      ? sections.flatMap(s => s.questions || [])
      : (Array.isArray(parsed) ? parsed : (parsed.questions || parsed.data || []));

    console.log('[fastpath] Decrypted total questions:', list.length);

    return list.map(q => {
      const qText = window.satoCrypto.stripHtml(q.question_data);
      // Answer may be in actual_answer.args[0] or options or actual_answer directly
      const rawAns = q.mcq_questions?.actual_answer?.args?.[0]
        || (Array.isArray(q.actual_answer?.args) ? q.actual_answer.args[0] : null)
        || q.actual_answer;
      return {
        question: qText,
        correct: window.satoCrypto.stripHtml(typeof rawAns === 'string' ? rawAns : (rawAns?.text || '')),
      };
    }).filter(a => a.correct);
  }

  window.satoFastPath = { extractFast };
})();
