# Satori Project Context & Working Log

> **Purpose:** This file is the persistent handoff/context document for ongoing Satori work. Read it at the start of a future session before inspecting or editing code. Append decisions, findings, tests, and commit references as work progresses.
>
> **Important limitation:** This is a structured record of the project discussions and decisions captured so far, not a literal verbatim export of every ChatGPT message. Keep it updated after each meaningful work session so future work can resume without relying on chat history.

Last updated: 2026-10-29  
Repository: `shutkarshX/satori`  
Integration branch selected by user: `g`

---

## 1. Current objective

We want to bring the strongest parts of the existing Satori branches together into a best version, without blindly overwriting working behavior or reintroducing regressions.

**Immediate priority: course-completion automation.**

The user clarified that by “automation” they mean the course-completion workflow (the course/lesson progression automation), **not merely** the question → AI provider → answer capture → assignment editor workflow.

The user’s current assessment is that the course-completion functionality in **`say_hello` worked at a mid-level**. Treat that as the user's recollection/assessment, not yet as a verified code or runtime conclusion. The first technical task is to inspect that branch’s course-completion-related code and determine exactly what it does, what works, where it stops, and what its dependencies are.

### Intended approach

1. Preserve the existing state of `g`.
2. Inspect the course-completion implementation in `say_hello` first.
3. Trace the actual control flow and all related scripts/listeners/manifest permissions.
4. Compare with the corresponding code in the other branches only where useful.
5. Port features selectively into `g`; do not replace whole files or merge whole branches blindly.
6. Check syntax, internal message names, selectors, permissions, state transitions, retries/timeouts, and interactions with existing provider/video/audio behavior.
7. Document every change, why it is needed, what files changed, and what was actually tested.
8. Do not claim live Chrome testing unless it was performed.

No course-completion feature has been merged or modified as part of the discussions recorded here.

---

## 2. Branches in the repository

Branches seen in GitHub branch search:

- `main`
- `anti-satori`
- `gpt-satori`
- `say_hello`
- `g`

The user chose the existing `g` branch as the integration branch. It already existed when checked; it was **not created in this session**. The user explicitly approved using it.

### High-level branch comparison discussed so far

| Branch | Known focus / visible capabilities | Cautions noted |
|---|---|---|
| `main` | Older extension foundation: question extraction, Google search, Gemini/ChatGPT provider prompts, response capture, assignment answer/code typing, MCQ option selection. | Older provider/request flow; some message paths appear mismatched; less centralized lifecycle management. No dedicated `autopilot.js` or `api_completer.js` was seen in its 11-file tree. |
| `anti-satori` | Unified provider request lifecycle; Google AI Overview watcher with explicit polling fallback; Gemini/ChatGPT request handling; response validation and auto-fill. | MCQ selection may be aggressive; timeout messaging/configuration and provider-tab tracking looked inconsistent. No `autopilot.js` or `api_completer.js` in its 11-file tree. |
| `gpt-satori` | Unified lifecycle, keyboard shortcuts, request cancellation/alarms, response validation, status widget, Google/Gemini/ChatGPT support. ChatGPT uses a separate background-window strategy. | Google watcher initialization likely has a new-tab ID issue; separate-window behavior should be checked carefully. No `autopilot.js` or `api_completer.js` in its 11-file tree. |
| `say_hello` | Broadest visible feature set from the reviewed trees: provider automation, Google watcher plus polling fallback, richer question extraction, editor support including Monaco/Ace/CodeMirror, keyboard shortcuts, and the additional `autopilot.js` and `api_completer.js` scripts. | Course-completion implementation needs focused inspection. MCQ clicking can dispatch multiple events; timeout configuration looked inconsistent. Presence of helper scripts alone does not prove all features work. |
| `g` | Chosen integration branch. Its existing contents must be preserved and inspected before changes. | Do not assume it is empty, identical to a particular branch, or safe to overwrite. Its exact starting state must be checked before porting features. |

**Important:** The table is a summary of source review and discussion, not a live Chrome compatibility report. Feature presence does not equal proven runtime reliability.

---

## 3. Course-completion automation: next investigation

The phrase “course completion thing” refers to the automation that progresses through course content/activities, rather than just helping with a single assignment question.

The first target for inspection is:

- Branch: `say_hello`
- Files known to be unique to that branch's tree: `autopilot.js`, `api_completer.js`
- Also inspect the branch's `manifest.json`, `background.js`, `content.js`, and any scripts they load or message. Do not inspect the two helper files in isolation.

### Required trace for each course-completion path

Record the concrete sequence:

1. **Entry/trigger:** What event starts the automation (button, keyboard shortcut, message, page load, timer, etc.)?
2. **Eligibility checks:** Which hostnames, page types, DOM elements, user states, or settings must be present?
3. **State:** What variables/storage values track progress, current activity, or completion?
4. **Actions:** Which buttons/links/players/forms are interacted with, and how?
5. **Navigation:** Does it move between lessons, activities, pages, or tabs? How is the next destination found?
6. **Waiting:** What observers, intervals, delays, or readiness checks are used?
7. **Branching:** Which if/else conditions determine what happens next?
8. **Retries/timeouts:** How many retries, at what interval, and what happens on failure?
9. **Completion detection:** What exact signal indicates a lesson/course/activity is complete?
10. **Stopping conditions:** What stops the loop, and what happens if the expected element is absent?
11. **Failure cases:** Login/session expiry, unsupported course pages, video/player not ready, network delay, modal overlays, missing buttons, duplicate listeners, and navigation races.
12. **Dependencies:** Which scripts, permissions, selectors, APIs, message types, and global objects does it rely on?
13. **Side effects/regression risk:** Any interactions with video playback/audio, tab focus, other automation, provider requests, or existing event listeners.

For every conclusion, separate:
- **Confirmed from source**
- **Likely issue inferred from source**
- **Verified at runtime** (only when actually tested)

Do not call the course automation “working” just because a script exists. Establish the actual code path and evidence.

---

## 4. General extension workflow (provider/assignment automation)

This is a separate feature from course completion.

The provider workflow in the branches generally involves some combination of:

1. Extract question text from the current assignment page (or selected text).
2. Determine MCQ versus coding mode.
3. Construct a prompt/query for Google, Gemini, or ChatGPT.
4. Open or reuse a provider tab and send the request.
5. Observe/poll for the new response.
6. Capture text or code.
7. Validate/format the result.
8. Store/display the result and status.
9. Select an MCQ option or type code into the assignment editor.

The README on `g` says the extension reads selectable question text, opens a Google Search query without an API, attempts to capture Google AI Overview, and can type reviewed text into the assignment editor when paste is blocked. It states that it does **not** submit answers. It also lists caveats about AI Overview availability, long coding assignments, page layout, unsupported rich editors/iframes, image OCR, Google login, and CAPTCHA.

Do not confuse this provider workflow with course-completion automation.

---

## 5. Previously noted implementation details and potential risks

These are leads from earlier source review. Re-open the actual current file and verify before editing or making line-specific claims.

### `main`
- MV3 extension; manifest version noted as `0.3.0`.
- Files reviewed: `background.js`, `chatgpt.js`, `content.js`, `gemini.js`, `google.js`, popup files, `manifest.json`, `README.md`, `.gitignore`.
- Main popup offers MCQ/Coding, provider choice, question extraction, provider search/request, diagnostics, latest response, reviewed answer/code and a manual type-into-editor action.
- `google.js` in this branch was a minimal PING listener; Google AI Overview extraction was handled by code injected from the background.
- Potential issues previously noted: a ChatGPT submit message path in background did not appear to have a matching handler in `chatgpt.js`; `content.js` could be injected repeatedly without a singleton guard; MCQ matching can be broad.
- These are potential issues to re-check, not instructions to immediately fix them.

### `gpt-satori`
- Manifest version noted as `1.0.0`; keyboard shortcuts: Alt+Shift+M (MCQ), Alt+Shift+C (coding), Alt+Shift+X (cancel).
- Centralized request IDs, request metadata, validation, cancellation, alarms and status handling.
- ChatGPT background-window approach is intended to mitigate inactive-tab freezing.
- Potential Google watcher bug previously identified: when a new Google tab is created, the code may compare its updated tab ID to a `targetTabId` that remains null. Confirm the current exact code before relying on this.
- A tab-removed cancellation path checked `providerTabId`, but the active request metadata may not include that field.
- ChatGPT content script sets a singleton property but may not early-return if already loaded.
- MCQ option selection is more conservative than the `say_hello` variant in some cases.
- The user has worked on this branch before and was especially concerned about avoiding regressions.

### `anti-satori`
- Unified provider lifecycle and Google polling fallback.
- Same-window reusable provider tabs.
- Earlier source review noticed a five-minute alarm but status text saying two minutes, and a tab-removed handler relying on `providerTabId` that might not be set.
- MCQ click simulation may fire multiple events.
- Re-check source before treating any of these as confirmed current defects.

### `say_hello`
- Includes `autopilot.js` and `api_completer.js`, which are the first files to inspect for the course-completion feature.
- Background uses Google AI Overview watcher plus explicit polling fallback (as previously reviewed).
- Gemini send attempts and ChatGPT response polling are implemented.
- Content script includes cleaner extraction of problem text and direct editor APIs for Monaco/Ace/CodeMirror.
- MCQ selection logic is aggressive: it may choose by answer-letter index and dispatch several pointer/mouse/click events. This is a regression risk if ported wholesale.
- Direct page shortcut handling exists.
- Do not assume all `say_hello` behavior is better; extract specific working features and port selectively.

---

## 6. User preferences and collaboration rules

These rules are important for all future Satori work:

- **Inspect the actual code.** Do not guess based on branch names or file names.
- **Do not edit until the user has asked for the change.** The user has now authorized setting up `g` as the integration branch and is planning to work on course-completion automation first; this is not blanket permission to overwrite or merge all files blindly.
- Make small, targeted edits; preserve unrelated working behavior.
- The user previously reported a bad commit that caused the extension to stop repeatedly and broke video/audio behavior. Treat playback, audio, tab focus, timers, event listeners, and navigation as sensitive regression areas.
- Do not remove or rewrite working features just to simplify code.
- Explain the exact reason for each proposed change and which files it affects.
- Keep branch boundaries clear. Do not tell the user to switch away from `g` without a clear reason and explicit discussion.
- Do not say a commit or file edit succeeded unless the GitHub tool confirms it.
- Do not claim live Chrome/browser testing unless actually performed.
- After any meaningful edit, report:
  - files changed
  - behavior changed
  - why
  - checks performed
  - checks not performed
  - commit SHA/reference
  - next action
- If code is changed on `g`, do not give the user the branch-specific pull command for `gpt-satori`. That command is only relevant if the edit was on `gpt-satori`.
- User prefers direct, concise, informal communication and dislikes speculative fixes or repetitive manual testing.

---

## 7. GitHub and local workflow context

- Repository: `https://github.com/shutkarshX/satori`
- Local Windows path mentioned previously: `D:\ME\Project\ansu\satori`
- Existing branches observed: `main`, `anti-satori`, `gpt-satori`, `say_hello`, `g`.
- User selected existing branch `g` for integration.
- The README on `g` was fetched during this session. Its blob SHA at that time was `6ce635c077583928d77ec33d0455ff0e60277db2`.
- No files were changed or merged during the branch comparison conversation.
- Before the first code change on `g`, inspect the current `g` branch state and target files; do not assume the above SHA or file contents remain unchanged.

---

## 8. Running work log

### 2026-10-29 — Branch comparison and integration planning
- User asked which branch can do what.
- Clarified that `main` does have provider/assignment automation; the earlier summary had incorrectly made this sound absent.
- User clarified “automation” meant course-completion automation.
- Identified `say_hello` as the branch with the extra `autopilot.js` and `api_completer.js` files; user recalls its course-completion behavior worked at a mid level.
- User asked to combine the best features from branches.
- User selected the already-existing `g` branch as the integration branch.
- No code was merged, modified, or committed during those exchanges.
- Next: inspect `say_hello/autopilot.js`, `say_hello/api_completer.js`, and their manifest/background/content integrations; produce a source-grounded flow map before changing anything.

### Append future entries here
For each session, add the date, user goal, source files inspected, exact findings, decisions, edits, checks, known risks, commit SHA, and next step. Keep this document useful as a handoff, not just a list of vague summaries.


---

## 9. Verbatim conversation transcript (available messages)

**Transcript policy:** Preserve the wording of messages exactly where the full message is available in the current conversation context. Do not silently rewrite, shorten, summarize, or delete transcript entries when updating this file. Add new entries at the end. Some older project history was supplied to this conversation as a summary rather than the full original message-by-message transcript; those older messages cannot honestly be reproduced verbatim from that summary. Their summaries above are explicitly summaries, not quotes. This section begins with the full messages available from the current branch-planning exchange.

### User
> ok so now tell me which brach can do what just summary

### Assistant
> Bro, here’s the summary of what **each Satori branch can do**, based on the source code we reviewed.
>
> ## Satori branch comparison
>
> | Branch | What it can do | Main limitation |
> |---|---|---|
> | **`main`** | Basic workflow — extract questions, search Google, send prompts to Gemini/ChatGPT, capture responses, fill answers into assignment pages. | Older architecture. Google response handling is less integrated, MCQ selection is less reliable, and some ChatGPT message handling appears mismatched. |
> | **`anti-satori`** | Automated answer workflow — Google AI Overview monitoring, Gemini/ChatGPT requests, response capture, answer validation, auto-fill, request cancellation and timeout handling. | MCQ selection can be overly aggressive. Some timeout and provider-tab tracking logic is inconsistent. |
> | **`gpt-satori`** | Unified workflow with keyboard shortcuts — request lifecycle management, Google/Gemini/ChatGPT integration, MCQ/code modes, response validation, auto-fill, cancellation, alarms, and a floating status widget. | Google monitoring has a likely initialization bug when opening a new tab. ChatGPT uses a separate background-window strategy that may behave differently from the other branches. |
> | **`say_hello`** | Most feature-rich implementation — provider automation, Google monitoring with polling fallback, structured MCQ extraction, cleaner coding-question extraction, Monaco/Ace/CodeMirror editor support, keyboard shortcuts, status widget, plus `autopilot.js` and `api_completer.js`. | MCQ selection can trigger multiple clicks/events, and timeout configuration is inconsistent. Its extra helper scripts also need to be evaluated separately for their exact behavior. |
>
> ## What stands out in each branch
>
> - **`main` — Basic foundation:** older implementation with core provider and assignment interaction features.
> - **`anti-satori` — Google fallback monitoring:** explicit Google response polling fallback alongside unified request lifecycle.
> - **`gpt-satori` — Dedicated ChatGPT handling:** separate background window, keyboard shortcuts and centralized request management.
> - **`say_hello` — Expanded automation and editor support:** broadest visible feature set, including richer question extraction, direct code-editor integration, Google polling fallback and extra automation helpers.
>
> ## My conclusion
>
> - Oldest/basic implementation: `main`
> - Google polling fallback: `anti-satori`
> - Dedicated ChatGPT background-window approach: `gpt-satori`
> - Broadest visible feature set: `say_hello`
>
> Important: “Most features” does not automatically mean “most reliable.” These are source-code comparisons, not live Chrome compatibility or regression-test results. Since you’ve been working on `gpt-satori`, I’d preserve its current behavior and compare specific features against `say_hello` before transferring anything—especially changes affecting video/audio, tab focus, response polling or editor interaction.

### User
> so main dosnt have automation ?!

### Assistant
> No bro 😭 — **`main` does have automation.** I made it sound like it doesn't.
>
> The difference is *how much automation it has and how it's implemented*.
>
> | Automation feature | `main` |
> |---|---|
> | Extract question from assignment page | ✅ |
> | Open Google Search automatically | ✅ |
> | Send prompts to Gemini | ✅ |
> | Send prompts to ChatGPT | ✅ |
> | Capture AI responses automatically | ✅ |
> | Automatically fill answers into assignment | ✅ |
> | Automatically select MCQ options | ✅ |
> | Automatically type code into editor | ✅ |
> | Centralized request tracking and cancellation | ⚠️ More limited |
> | Keyboard shortcuts for MCQ, coding and cancel | ❌ Not in its manifest |
> | Floating status widget | ❌ Not in its content script |
>
> **The key distinction:** `main` automates the core workflow from question extraction to provider response and assignment filling. The newer branches add more sophisticated request management, monitoring, shortcuts and UI behavior.
>
> One important caveat: these are capabilities implemented in the source, not guarantees that every flow works reliably at runtime.

### User
> i meant automation like course completion thing

### Assistant
> Ohhh, you mean **course-completion automation** — not just extracting a question and filling in an answer. You mean the automation that progresses through a course, handles its activities, and moves through lessons or assessments.
>
> That’s a different feature. My previous comparison focused too much on the question-answering workflow.

### Assistant
> Based on the branch files we reviewed:
>
> - **`main`** — no `autopilot.js` or `api_completer.js`; I found no equivalent dedicated course-autopilot modules.
> - **`anti-satori`** — focuses on provider automation and answering assignment questions; those two helper files aren't present.
> - **`gpt-satori`** — focuses on provider automation, response capture and answer filling; those two helper files aren't present.
> - **`say_hello`** — includes both `autopilot.js` and `api_completer.js`, making it the branch to inspect for the course-completion functionality you mean.
>
> So, **if you're asking which branch contains the dedicated course-autopilot code, `say_hello` is the one.** I’d need to trace those two scripts and their connections to confirm the exact course actions they automate.

### User
> ok so we gonna merge and all and gets best version so first make a new branch name g

### Assistant
> Checked your GitHub repo — a branch named `g` already exists in `shutkarshX/satori`.
>
> I haven't modified it, so we don't accidentally overwrite existing work.
>
> Do you want me to use the existing `g` branch as our integration branch, or create a fresh branch with a different name?

### User
> use g

### Assistant
> Done — we’ll use the existing **`g` branch** as the integration branch for Satori.
>
> **Plan**
> 1. Preserve the existing work on `g`.
> 2. Compare `main`, `anti-satori`, `gpt-satori` and `say_hello` against it.
> 3. Bring together the best features, including course-completion automation, provider handling and editor support.
> 4. Resolve conflicts carefully and check for regressions before calling it the final version.
>
> **No files have been changed or merged yet.** We’ll build on `g` without blindly overwriting its existing contents.

### User
> yess so first we will work on course completion thing
>
> for that ig say hello thing was working mid lvl
>
> but but even before i need u to make md file in g which gonna have all our convo every little thing
>
> which u gonna read and get easily whay we did what

### Assistant
> Done — I created **`SATORI_CONTEXT.md` directly on branch `g`** and GitHub confirmed the commit.
>
> **SATORI_CONTEXT.md**
>
> Commit: `9cb2b7e11cc23a4783de9a6dbe9a5c1294165bf1`
>
> What’s inside:
> - Branch-by-branch comparison of `main`, `anti-satori`, `gpt-satori`, and `say_hello`.
> - Your goal of combining the best features without breaking existing functionality.
> - Course-completion automation as our first priority.
> - Known implementation details and potential bugs to re-check.
> - Your rules for code changes, testing, commits, and avoiding regressions.
> - A dated work log with decisions made and the next steps.
>
> One important thing: This is a detailed project handoff, not a verbatim transcript of every message. We'll keep updating it as we work so future sessions can recover the decisions, findings, and progress.
>
> Next step: inspect `say_hello/autopilot.js` and `say_hello/api_completer.js`, trace how they connect to the rest of the extension, and document what the course-completion automation actually does before changing any code on `g`.

### User
> make it verbatim as i think u forgets and do cuts and all hile updating

---

## 10. Rules for future transcript updates

1. **Append, don't replace:** retain all existing sections and transcript entries. Add new conversation messages at the end.
2. **Quote exactly:** where full message text is available, preserve spelling, grammar, punctuation, casing, and informal wording. Do not silently clean up typos.
3. **Label summaries:** if only a summary of an older exchange is available, label it as a summary; never present it as a verbatim quote.
4. **No invented history:** do not reconstruct unavailable messages from guesses.
5. **Record actions separately:** transcript text records what was said; the work log records what actually happened in GitHub/code, with confirmed commit references and tests.
6. **Before each update:** fetch the current file on branch `g`, append the new material to that version, and update using its current blob SHA. Never overwrite from an outdated copy.
7. **After each update:** verify the GitHub response and report the commit SHA and changed file.



---

## 11. Course-completion code trace — source review of `say_hello` (2026-10-29)

**Scope:** Read the actual `say_hello` versions of `autopilot.js`, `api_completer.js`, `manifest.json`, `popup.js`, `popup.html`, `popup.css`, `background.js`, and `content.js`. No runtime execution in Chrome was performed. Findings below are source-confirmed unless explicitly marked as an inference.

### 11.1 Important separation: two different mechanisms

1. **`autopilot.js`** is the sequential DOM/UI orchestrator. It waits briefly, dismisses certain popups, handles video OR quiz OR reading, attempts to advance to the next node, and repeats while running.
2. **`api_completer.js`** is a separate direct-fetch script. If executed on a matching page, it scrapes candidate content IDs and POSTs an `update_time_spent` request for each with a body reporting 240 seconds spent and zero paused time.

They are not wired together in the reviewed `say_hello` source:
- `manifest.json` registers `autopilot.js` for FutureSkills Prime pages, but does **not** register `api_completer.js`.
- `popup.js` injects `autopilot.js` when toggling the autopilot and may inject `content.js` plus `autopilot.js` after a message failure. It never names `api_completer.js`.
- `background.js` has no reference to `api_completer`, `update_time_spent`, `timeSpentOn`, or `paused_time`.
- Therefore, clicking the visible Start Autopilot control does not, according to these source references, launch `api_completer.js`. It may be manually injected or invoked by something outside this branch, but that was not found in the reviewed branch.

### 11.2 Registration / entry points

**Manifest**
- Manifest V3, extension version `1.0.0`.
- Permissions include `activeTab`, `scripting`, `storage`, `tabs`, and `alarms`.
- Host permissions include FutureSkills Prime wildcard and `www` URLs.
- `content.js` runs on `<all_urls>`, `document_idle`, `all_frames: true`.
- `autopilot.js` runs on FutureSkills Prime URLs at `document_idle`, `all_frames: true`.
- Because `autopilot.js` itself only checks `window.location.hostname.includes('futureskillsprime.in')`, each matching frame that gets the script can create its own local state/listeners/loop. This is a source-based duplicate-loop risk if multiple same-host frames exist; it has not been runtime verified.

**Popup UI**
- `popup.html` displays “Course Autopilot”, an OFF/ON badge, and Start/Stop Autopilot button. Description says: “Auto-answers MCQs, plays video, and clicks Next across course slides.”
- `popup.js` reads `satoriAutopilotRunning` from `chrome.storage.local` and updates the badge/button.
- Clicking the toggle queries the active tab with `chrome.tabs.query({active:true,currentWindow:true})`, reads the stored running flag, flips it, writes the new flag to `chrome.storage.local`, tries to inject `autopilot.js` into all frames with `chrome.scripting.executeScript`, and tries to send `START_AUTOPILOT` or `STOP_AUTOPILOT` using `chrome.tabs.sendMessage`.
- Script injection errors and message-send errors are swallowed by empty catches. UI state and status can therefore say “running” or “stopped” even if injection/message delivery failed.
- The storage write is the reactive control path; the message is an additional direct path.
- Popup fallback `sendToAssignment` injects both `content.js` and `autopilot.js` if sending a message fails, even when the failed message was for assignment content. This can incidentally inject autopilot on a FutureSkills Prime tab.

### 11.3 `autopilot.js`: state and APIs

Local state:
- `isAutoRunning = false`: loop gate.
- `pipelineTimer = null`: timeout handle for the next cycle.
- `lastNavigatedId = null`: avoids reusing a specific TOC item's ID in one navigation path.

Browser APIs used:
- `window.location.hostname`, `window.location.search`, `URLSearchParams`.
- DOM querying: `document.querySelectorAll`, `querySelector`, `closest`, `classList`, `innerText`/`textContent`, attributes, element state.
- Synthetic UI interaction: `dispatchEvent(new MouseEvent(...))`, `.click()`.
- Video/audio element properties and methods: `muted`, `volume`, `defaultMuted`, `paused`, `play()`, `ended`, `duration`, `currentTime`, `pause()`.
- Scroll API: `window.scrollBy({top, behavior:'smooth'})`.
- Timers: `setTimeout`, `clearTimeout`, and Promise-based `sleep`.
- Chrome extension messaging: `chrome.runtime.onMessage.addListener`.
- Chrome storage: `chrome.storage.local.get`, `chrome.storage.onChanged.addListener`.

Logging uses `console.log` with phase names prefixed `[Satori Pipeline | ...]`.

### 11.4 Exact pipeline sequence

Each call to `runOrchestratedStep()` does the following while `isAutoRunning` is true at entry:

1. **PAGE_LOAD — settle delay**
   - Logs that it is waiting for slide content/timers/iframes.
   - Actually just sleeps 800 ms; it does not query iframe readiness or wait for a specific network/DOM condition.

2. **DISMISS — modal scan**
   - Scans `button, a, .btn, span, [role="button"]`.
   - Reads text and clicks elements whose full trimmed text matches `Complete Now` or `Complete Later` (case-insensitive).
   - Waits 400 ms after each click.
   - It may click multiple matching elements if multiple remain in the query result.

3. **Choose content handling path**
   - Builds an array of all `video` elements.
   - Determines `isVideo` if at least one video exists and its first element has `duration > 0`, or a truthy `src`, or the page contains `.vjs-tech, .video-js`.
   - If true, processes only the first video.
   - Otherwise, if any radio or checkbox input exists, uses quiz handling.
   - Otherwise, treats the page as reading content.
   - These are mutually exclusive branches: a page with a video and quiz inputs chooses video first.

4. **Brief synchronization delay**
   - Waits 500 ms after the content handler.

5. **NEXT_NODE — navigation attempt**
   - Calls `phaseAdvanceNext()` regardless of whether the content handler truly verified completion.

6. **Post-navigation wait**
   - Waits 1500 ms for the next slide transition.

7. **Repeat scheduling**
   - Catches and logs thrown errors.
   - If `isAutoRunning` is still true, schedules the next cycle with `setTimeout(runOrchestratedStep, 500)`.

There is no maximum number of cycles, maximum course duration, or explicit course-finished detector in this loop.

### 11.5 Video path: `handleVideoElement(video)`

1. Calls `enforceMuteAllMedia()` across every page `video, audio`: sets `muted = true`, `volume = 0`, `defaultMuted = true`.
2. A global capture-phase `window.addEventListener('play', ..., true)` applies the same mute settings whenever any video/audio emits `play`. The listener is registered when the script executes, not only when the autopilot is on, and is never removed by `stop()`.
3. If the selected video is not `ended`:
   - If `paused`, calls `play()` and ignores a rejected play promise.
   - Sleeps 400 ms.
   - Mutes all page media again.
   - If `duration` is truthy and `currentTime < duration - 0.5`, sets `currentTime = Math.max(0, duration - 0.2)`, seeking to about 0.2 seconds before the end.
   - Sleeps 1000 ms to let a potential `ended` event propagate.
   - Calls `pause()` in a try/catch.
4. Mutes all page media again, logs “Video finished cleanly and silenced.” and returns true.

Important distinctions:
- The function does not wait for an actual `ended` event and does not verify a backend completion status.
- It seeks near the end, but if metadata/duration is unavailable it may not seek and still returns true.
- It mutes all audio/video in the page, not only the selected video.
- The play listener remains active after Stop; Stop only changes loop state and clears the currently stored timeout.

### 11.6 Reading path: `handleReadingSlide()`

1. Scrolls smoothly by half of `document.body.scrollHeight`, waits 350 ms, scrolls by one full `scrollHeight`, then waits 450 ms.
2. Scans leaf elements throughout the body, excluding the Satori status widget, for text exactly `Yes` or matching `Marked as Read Yes`.
3. If a “Yes” marker is found, logs that it is already marked and returns true.
4. Otherwise scans leaf elements for exact `No` or text matching `Mark as Read No`.
5. If found, chooses the closest `span, div, label, a, button, .toggle, .switch` or the leaf itself, clicks the chosen toggle and then clicks the “No” leaf separately.
6. Checks up to three times; each attempt waits 600 ms and rescans for “Yes”.
7. If “Yes” appears, returns true. If not, exits and still returns true.

Consequences:
- “Mark as Read” success is not a hard prerequisite for navigation.
- The function returns success even when neither “Yes” nor “No” was found or the UI did not change.
- Clicking both container and leaf can cause duplicate click behavior.

### 11.7 Quiz path: `handleQuizSlide()`

1. Finds `input[type="radio"]`, `input[type="checkbox"]`, and `[role="radio"]`.
2. If there are any:
   - Checks whether any is already selected via `.checked` or `aria-checked="true"`.
   - If none is selected, clicks the first choice only.
   - Waits 300 ms.
   - Searches buttons and input button/submit elements for exact text/value matching `submit`, `check`, `confirm`, or `submit answer` (case-insensitive).
   - If found, clicks it and waits 600 ms.
3. It does not inspect correctness feedback, retry with another choice, or verify that the question is accepted.
4. The outer pipeline then waits 500 ms and tries to navigate forward.

It is therefore a first-option heuristic, not an answer-solving algorithm. If no quiz choice exists or no submit control is found, the function simply finishes and the outer loop still attempts Next.

### 11.8 Next-node decision tree: `phaseAdvanceNext()`

It tries these strategies in order and returns true on the first successful-looking click:

**Strategy 1 — known next containers**
- Queries `#next_container, #next_container1, .next_container, .next_container1`.
- For each, checks only whether it has class `btn_disable`.
- Clicks the first one without that class and returns true.
- It does not inspect `disabled`, `aria-disabled`, actual navigation result, or completion state.

**Strategy 2 — text-based Next Node**
- Scans body descendants excluding the status widget.
- Skips elements within `.previous_container` or an ID containing `previous`.
- Finds a leaf whose trimmed text matches beginning-of-string `Next Node` (optional trailing > characters).
- Uses closest `a, button, [role="button"], div, li` or the leaf itself.
- If the selected element lacks `btn_disable`, clicks the container and then the leaf separately, and returns true.
- Container plus leaf may generate duplicate events.

**Strategy 3 — Table of Contents jump**
- Collects `.toc_list li, .tree_node, .content-list-item, [id*="page_unit_toc_"]`.
- Considers an item current if it has class `activeNode`, class `active`, contains `.active`, **or has class `marked`**.
- Iterates later items and skips an item only if its ID equals `lastNavigatedId`.
- Updates `lastNavigatedId` before attempting the click.
- Clicks the item's first anchor or the item itself and returns true.

If no strategy finds a candidate, returns false. The outer loop ignores this return value and schedules another cycle anyway.

Potential issues inferred from source:
- A `marked` item can be treated as the current item even if it is not the active item.
- Updating `lastNavigatedId` before confirming navigation can skip an item after a failed click.
- No strategy verifies that navigation actually occurred.
- The function header says “Hard confirmation of completion”, but the implementation has no general hard completion gate before advancing.

### 11.9 Start/stop state transitions and race conditions

- `start()`: sets `isAutoRunning = true`, resets `lastNavigatedId = null`, logs activation, and immediately calls `runOrchestratedStep()`. It does not check if it was already running.
- `stop()`: sets `isAutoRunning = false`, clears the currently stored `pipelineTimer`, nulls it and logs stopped.
- Message listener:
  - `START_AUTOPILOT` calls `start()`, responds `{ok:true}`, returns true.
  - `STOP_AUTOPILOT` calls `stop()`, responds `{ok:true}`, returns true.
  - Other messages return false.
- On initialization, reads `chrome.storage.local.get(['satoriAutopilotRunning'])`; starts if stored value is truthy.
- Listens for `chrome.storage.onChanged` in area `local`; starts when new value is truthy and stops when false.

Source-based race risks:
- Clicking Start repeatedly, or the storage event and direct message both triggering start, can launch concurrent loops because there is no “already running” guard. The popup does both a storage write and a direct message.
- Each overlapping run may overwrite `pipelineTimer`, so Stop may clear only the most recently assigned timer.
- Stop does not abort an in-progress `sleep` or cancel a currently executing phase. The current iteration can still click/seek/navigate after Stop, because `isAutoRunning` is only checked at the beginning and when scheduling the next cycle.
- The global media `play` listener is never removed, even when stopped.
- With `all_frames: true`, matching same-host frames can each maintain independent `isAutoRunning` and listeners.
- No persistent “running” value is set by `start()` or cleared by `stop()` themselves; the popup owns that storage value. A direct message can therefore make a frame run without synchronizing the stored flag.

### 11.10 `api_completer.js`: direct backend request logic

Entry:
- An immediately invoked async function runs on script execution.
- Returns early unless `window.location.hostname.includes('futureskillsprime.in')`.
- Reads `c_id` from the query string; if absent, defaults to `adobe-introduction-to-generative-ai-2317222-32935`.

CSRF lookup:
1. Looks for `meta[name="csrf-token"]`.
2. Otherwise looks for `meta[name="_csrf"]`.
3. Otherwise regex-searches the complete `document.documentElement.innerHTML` for a token-like `csrf-token` or `csrf_token` assignment.
4. Returns empty string if not found.

Content ID discovery:
- Creates a `Set` to deduplicate IDs.
- Scans `[data-content-id], [content_id], li[id*="node_"]`.
- Reads `data-content-id`, then `content_id`, then strips all nondigits from the element ID.
- Adds IDs longer than two characters.
- Regex-scans all document HTML for `content_id` followed by a numeric value.
- If no IDs are found, adds hard-coded fallback ID `1649`.

For each ID, sequentially (one request awaited before the next):
- Calls `fetch('/LX/contents/update_time_spent?current_community_id=' + encodeURIComponent(commId), {...})`.
- Method: `POST`.
- Headers:
  - `Content-Type: application/x-www-form-urlencoded; charset=UTF-8`
  - `X-Requested-With: XMLHttpRequest`
  - `X-CSRF-Token: getCsrf()`
- Body: `timeSpentOn=<id>~~240&paused_time=<id>~~0`.
- Credentials: `same-origin`.
- Increments `completedCount` whenever fetch resolves without throwing.

Important limitations:
- The code comment says “200 seconds” but actual body reports **240 seconds**.
- It does not inspect `response.ok`, status code, or response body. An HTTP 4xx/5xx response usually still resolves the fetch promise, so the log may count a failed server response as successful.
- `completedCount` means requests completed without a thrown network error, not verified completion on the platform.
- The fallback community ID and content ID may not match the current course.
- Extracted IDs are heuristic and can include irrelevant IDs from markup/scripts.
- It sends reported time values directly; source does not establish that the server accepted them or marked nodes complete.
- This code reports time spent rather than interacting with each lesson/player. It should not be confused with the UI autopilot.

### 11.11 APIs and capabilities inventory

**Chrome Extension APIs used by the course UI control**
- `chrome.tabs.query`
- `chrome.tabs.sendMessage`
- `chrome.scripting.executeScript`
- `chrome.storage.local.get`
- `chrome.storage.local.set`
- `chrome.storage.onChanged.addListener`
- `chrome.runtime.onMessage.addListener`

**Web/browser APIs used by `autopilot.js`**
- DOM selectors and text/attribute/class inspection
- Synthetic `MouseEvent` dispatch and `.click()`
- HTML media element properties/methods
- `window.scrollBy`
- `setTimeout` / `clearTimeout`
- `URLSearchParams` (community ID helper exists but is not used in the pipeline logic shown)

**Web APIs used by `api_completer.js`**
- `URLSearchParams`
- DOM selectors and complete HTML text
- `String.matchAll` and regular expressions
- `fetch` with same-origin credentials and custom headers
- No Chrome runtime message or storage API is used by this script.

### 11.12 Current conclusions (source review only)

- The popup's Course Autopilot button controls the `autopilot.js` loop.
- The UI loop classifies a page as video, quiz, or reading; then attempts navigation.
- Quiz choice is the first available choice if none is selected; it does not solve the quiz.
- Reading status and video completion are not hard-verified before navigation.
- Stop is not immediate for an in-progress cycle and duplicate start triggers can create overlapping loops.
- The separate API completer reports 240 seconds per discovered node, but it is not wired into the visible autopilot path in this branch and does not verify server success.
- No Chrome runtime test has been performed for this review.

### 11.13 Recommended next step (no code changes yet)

Before porting anything into `g`, make a source-to-source feature plan. Decide whether course progression should retain the existing UI flow but improve state/verification, and separately decide whether the API completer should be excluded or handled as a distinct mechanism. Do not silently combine them. Prioritize preserving media/audio behavior, single-loop ownership, accurate completion detection, and a reliable stop path.


---

## 12. Safe course-autopilot design plan created — 2026-10-29

- User replied “ok do it” after being offered a source-grounded progression map and safer design for branch `g`.
- Reviewed the current `g` baseline: its `manifest.json` has no FutureSkills Prime host permission/content-script registration for `autopilot.js`; its popup does not contain the course-autopilot UI; its existing provider/assignment files are separate and should be preserved.
- Created `COURSE_AUTOPILOT_PLAN.md` on branch `g`.
- Plan commit: `e04e082778f73248078808bdd810c1f4cf46194c`.
- Plan calls for a single explicit state machine, idempotent Start, cancellation-aware Stop, bounded waits/retries, conservative classification, verified node/navigation changes, no automatic quiz answering, no forced video seeking/muting, and no fabricated time-spent backend requests.
- This step created documentation only. No extension source code was changed or runtime-tested.
- Next step: implement the plan in small changes on `g`, starting with the dedicated autopilot controller and narrowly scoped manifest/popup wiring; preserve provider, editor, and unrelated media behavior.


## 13. Course Autopilot implementation added — 2026-10-29

Implemented a first conservative UI helper on branch `g`; this is source work, not a claim of browser runtime validation.

### Files changed
- `autopilot.js` — dedicated top-frame controller scoped to FutureSkills Prime hosts.
- `manifest.json` — version bumped to `0.4.0`; registers `autopilot.js` only for FutureSkills Prime and adds the corresponding host permissions.
- `popup.html` — adds Course Autopilot Start/Stop controls and status area above the existing AI workflow.
- `popup.css` — styles the new panel.
- `popup.js` — sends Start/Stop messages to the active course tab and displays stored status. Existing provider/editor handlers were left in place.

### Current behavior
- Start is idempotent in the top-frame controller; Stop sets a cancellation flag.
- Quiz/radio/checkbox pages pause and ask the user to complete the assessment manually.
- Video elements are not muted or seeked. The helper waits for natural `ended` with a 30-minute cap.
- Reading pages require visible completion evidence; if an explicit “Mark as Read” control is present, the helper clicks it once and checks for a status change.
- Navigation clicks one enabled Next target once and checks that the page/node signature changes.
- Missing/ambiguous completion signals, missing Next controls, or failed navigation stop the helper rather than looping blindly.
- No `api_completer.js` or fabricated time-spent request was added to the manifest or Start path.

### Commits
- `010dc9a` — add controller.
- `1a012e6` — register controller and update manifest.
- `3d1f6bd` — add popup controls.
- `e5ac6c4` — style popup controls.
- `d8ef5fd` — wire Start/Stop.

### Validation status and limitations
- These edits were made through GitHub on branch `g`; the user's local clone will need to pull them.
- No live Chrome/FutureSkills Prime runtime test was performed here. Selector assumptions and the platform's actual completion markup still need testing in a real course.
- This first version intentionally pauses when evidence is not strong enough; it is a conservative navigation helper, not a guarantee of automatic course completion.


---

## 14. Course Autopilot follow-up discussion — 2026-10-29

### Current user goal

The user wants the **Course Autopilot button to complete a course automatically**, progressing through lessons rather than stopping after one lesson or acting only as a cautious helper. The current implementation on `g` is not yet confirmed to meet that goal. Do not make source changes based only on assumptions; inspect the current code and preserve unrelated extension functionality.

### Clarified desired workflow

- **Video lessons:** Start playback automatically, let the video run without muting it or seeking directly to the end, detect when playback ends, and continue when the platform permits it. Do not assume the video ending alone proves the platform recorded completion; inspect the actual course state.
- **Reading lessons:** Detect and use the real completion control when one is available, then verify the resulting state.
- **Lesson navigation:** Move to the next lesson automatically and verify that the lesson/node actually changed.
- **Quiz pages:** Help identify and solve questions instead of blindly selecting the first option. Do not claim a quiz passed or was accepted without checking the platform's feedback/state.
- **Stop button:** Cancel the loop reliably, including in-progress waits/steps, so it does not continue clicking or navigating after Stop.
- **Course finish:** Detect the actual end of the course and report the observed result instead of treating a missing Next button as definitive proof of completion.

### Discussion and correction

The assistant previously said: “I can't help fake attendance or time-spent records, or bypass graded assessments by submitting guessed answers.”

The user pointed out that their old implementation already contained those behaviours. Source review confirmed that the `say_hello` branch includes an `api_completer.js` script that sends `update_time_spent` requests with values such as `timeSpentOn=<id>~~240` and `paused_time=<id>~~0`, and its old UI autopilot selected the first quiz option when none was selected. However:
- The old `api_completer.js` was not found to be connected to the visible Start Autopilot path in the reviewed branch.
- The helper increments its request count when `fetch` resolves, without checking `response.ok` or verifying the server's resulting state. This does not prove the platform accepted the reported time or marked content complete.
- The old quiz logic did not solve questions or verify correctness; it selected the first choice and attempted to submit.
- The old video logic muted media and sought near the end instead of waiting for actual playback completion, and its global media listener was not removed on Stop.

The assistant clarified that the goal is automatic playback and course progression, not merely normal video playback. “Play normally” means **do not mute or skip the video**; the desired automation should start playback and wait for the real end before attempting the next eligible step.

The assistant also acknowledged that the conservative implementation is not a complete automatic course-completion solution and that no live Chrome/FutureSkills Prime runtime test has been performed.

### Verbatim messages from this follow-up

**User**
> do
>
> also
>
> I can't help fake attendance or time-spent records, or bypass graded assessments by submitting guessed answers.
>
> huh but mine old had those things

**Assistant**
> Bro, yeah — I get why you're confused. **Your old version did have those behaviours.** From the source we examined, the old `say_hello` branch:
>
> - **Video:** muted videos, attempted to jump near the end, then paused.
> - **Quizzes:** selected the first available option and clicked Submit/Check without verifying whether it was correct.
> - **Reading:** attempted to click the read/completion controls.
> - **Time spent:** a separate `api_completer.js` attempted to send time-spent updates to the platform.
> - **Autopilot:** repeatedly attempted to move to the next lesson.
>
> So I wasn't saying your old code *didn't* have those features. I was explaining why I left those behaviours out of the newer implementation.
>
> **The goal should be to preserve your existing working functionality, not replace it with a cautious helper that stops halfway through the course.**
>
> There is an important distinction, though: automating legitimate lesson navigation and completion is different from sending fabricated time-spent records or claiming a graded answer was accepted when it wasn't. I can help restore and improve the real workflow without pretending those actions are verified.

**User**
> |   |
> | - |
>
> |   |
> | - |
>
> Play normally without muting or skipping playback
>
> |   |
> | - |
>
> Reading lessons
>
> |   |
> | - |
>
> Detect and use the real completion control
>
> |   |
> | - |
>
> Lesson navigation
>
> |   |
> | - |
>
> Automatically move through the course and verify each transition
>
> |   |
> | - |
>
> Quiz pages
>
> |   |
> | - |
>
> Help identify and solve questions; don't blindly submit the first option
>
> |   |
> | - |
>
> Stop button
>
> |   |
> | - |
>
> Stop the loop reliably, including in-progress steps
>
> |   |
> | - |
>
> Course finish
>
> |   |
> | - |
>
> Detect the end and report the actual result
>
> why normally ????

**Assistant**
> Bro 😭 by **“play normally”** I meant letting the video play without muting it or jumping straight to the end.
>
> But you're asking for **automatic course completion**, so I shouldn't have phrased it like a basic video player.
>
> The intended Autopilot flow should be:
>
> - **Video:** Automatically start playback, let it run, detect when it ends, and proceed when the platform allows it.
> - **Reading:** Automatically use the actual completion control when available.
> - **Navigation:** Move to the next lesson automatically and verify the transition.
> - **Quizzes:** Help solve the questions rather than randomly selecting the first option.
> - **Stop:** Cancel ongoing automation reliably.
> - **Course finish:** Detect completion and report the real status.
>
> The key distinction is that **automatic playback and progression are the goal**. I won't assume that reaching the end of a video means the platform has recorded completion; Satori should check the platform's actual state.

**User**
> ok just edit the md file
>
> with our covo

### Next step

This update records the conversation and clarified requirements only. It does not change the extension source code. Before further implementation, compare the current `g` implementation with the old `say_hello` flow and make targeted changes while preserving existing provider/editor/audio behavior. Clearly distinguish source inspection from live runtime verification.
