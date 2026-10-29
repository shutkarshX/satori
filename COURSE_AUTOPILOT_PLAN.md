# Course Autopilot — Safe Integration Plan

**Repository:** `shutkarshX/satori`  
**Target branch:** `g`  
**Reference implementation:** `say_hello`  
**Status:** Design only — no extension source code changed by this plan.  
**Date:** 2026-10-29

## 1. Goal

Port the useful *course navigation and progress-assistance* ideas from `say_hello` into `g` without blindly copying the old implementation or breaking unrelated Satori provider, editor, video, or audio behavior.

The existing `say_hello/autopilot.js` has a useful sequential structure:
1. Wait for the page to settle.
2. Dismiss a narrowly defined course popup.
3. Classify the page as video, quiz, or reading.
4. Perform a content-specific action.
5. Attempt to advance.
6. Repeat.

But its current implementation has significant correctness and regression risks. This plan deliberately does not preserve behavior that only *pretends* a lesson was completed.

## 2. Explicit non-goals

- Do not send fabricated time-spent values to a course backend.
- Do not use `api_completer.js` as part of the autopilot. Its endpoint, ID discovery, and reported time values are not verified, and its log does not verify server acceptance.
- Do not automatically choose the first answer to a quiz or submit assessments without the user's informed action.
- Do not seek a video to its final fraction of a second and treat that as proof of watching/completion.
- Do not mute all page audio/video, or install a global media listener that survives Stop.
- Do not claim a lesson/course completed unless the page exposes a reliable completion signal.
- Do not modify Google/Gemini/ChatGPT provider flows, question extraction, answer typing, or unrelated files as part of this feature.

## 3. Proposed state machine

Use one explicit controller with these conceptual states:

- `STOPPED`: no automation actions are scheduled.
- `STARTING`: verify allowed host/page and initialize one controller.
- `WAITING_FOR_PAGE`: wait for DOM/page transition readiness with a bounded timeout.
- `CLASSIFYING`: classify the current node using visible page evidence.
- `VIDEO_WAIT`: allow the video to play normally; do not mute, seek, or claim completion based only on a timer.
- `READING_REVIEW`: scroll the reading content and, if the platform has an explicit “Mark as Read” control, offer/perform only the ordinary UI action; then verify the platform's displayed status changed.
- `QUIZ_PAUSED`: stop automation and notify the user that a quiz/assessment needs user input. Do not guess an answer.
- `VERIFYING_NODE`: check the platform's visible completion status or other reliable node state.
- `NAVIGATING`: click one verified enabled Next control once.
- `VERIFYING_NAVIGATION`: confirm active node/content/URL changed before beginning another cycle.
- `FINISHED`: no valid next node remains or platform indicates course completion.
- `ERROR_PAUSED`: stop safely after a bounded timeout, ambiguous UI, or repeated failure.

Transitions should be explicit. A handler returning without throwing is not proof that the platform accepted the action.

## 4. Start and Stop contract

### Start
- Only start on the intended FutureSkills Prime host and supported course page.
- Prevent duplicate starts in the same frame/controller.
- Keep one owned timer/loop.
- Do not start both from a storage event and a direct message. Pick one authoritative control path; if retaining both for compatibility, make start idempotent.
- Reflect the real controller state in the popup only after the content script acknowledges it.

### Stop
- Set a cancellation flag immediately.
- Check cancellation after every awaited wait and before each DOM click/navigation action.
- Clear the owned timer.
- Do not let a currently running phase issue further clicks after Stop.
- Do not leave global media listeners or other side effects behind.
- Stop should not modify video/audio state.

### Reload/navigation
- Re-evaluate the new page only after confirming a navigation/active-node change.
- Avoid multiple controllers running in parent and child frames. Prefer a single top-frame controller unless a documented platform requirement proves otherwise.
- Recovering after a page reload should be deliberate and visible; stale storage must not silently start multiple loops.

## 5. Page classification decisions

Priority should be conservative and ambiguity-aware:

1. If a quiz/assessment form is present, enter `QUIZ_PAUSED` rather than auto-selecting or submitting an answer.
2. Else if a visible video player is present, enter `VIDEO_WAIT` and let normal playback occur. Do not force seek or mute.
3. Else if a recognized reading node is present, enter `READING_REVIEW`.
4. Else enter `ERROR_PAUSED` with a diagnostic instead of assuming it is reading content.

If both video and quiz controls are present, do not silently prefer the first video. Treat the page as ambiguous and pause for the user.

## 6. Completion verification

Use the strongest available *visible, platform-generated* signal, for example:
- explicit completed/marked-as-read status associated with the current node;
- a documented enabled Next control after the node status changes;
- a TOC active-node change that corresponds to the current content;
- a course completion banner or status.

Do not use any of these alone as proof unless the UI semantics are established:
- a click returning successfully;
- a video `currentTime` near `duration`;
- a generic class such as `marked` without proving it denotes the current node;
- a timeout expiring;
- an HTTP request resolving without checking its response.

If the page's completion state cannot be verified, pause and show a diagnostic instead of advancing blindly.

## 7. Navigation decision

Try a small, documented set of selectors in order. For each candidate:
- reject hidden, disabled, `aria-disabled`, or `btn_disable` controls;
- click exactly one target (not both parent and child);
- record the current node signature before the click;
- wait with a bounded timeout;
- verify the node signature or active TOC item changed.

If the click did not navigate, do not blindly jump to the next TOC entry. Retry only a small, bounded number of times, then pause with an error.

At the end of the course, if there is no valid next node or a reliable completion banner is present, transition to `FINISHED` and stop.

## 8. Timeouts and retry policy

Initial values should be constants and documented, not scattered magic numbers:
- Page settle: short initial delay followed by readiness checks, with a hard cap.
- UI status change: bounded polling/observer window.
- Navigation confirmation: bounded wait for active-node/content signature change.
- Retry count: small fixed maximum; no infinite click loop.
- Any repeated ambiguity or missing expected control should stop safely.

Exact timing values should be adjusted after inspecting a real, authorized test course. Do not claim timing is validated until tested.

## 9. Logging and diagnostics

Log structured phases such as:
- `START`
- `PAGE_READY`
- `CLASSIFIED`
- `READING_STATUS`
- `QUIZ_PAUSED`
- `VIDEO_WAIT`
- `COMPLETION_VERIFIED`
- `NEXT_CLICKED`
- `NAVIGATION_VERIFIED`
- `FINISHED`
- `STOPPED`
- `ERROR_PAUSED`

Each log should include the reason for the decision and relevant node signature, while avoiding tokens, CSRF values, or private user data.

## 10. API and dependency boundaries

### Chrome extension APIs potentially needed
- `chrome.tabs.query` for the popup to identify the active tab.
- `chrome.tabs.sendMessage` for Start/Stop and status messages.
- `chrome.scripting.executeScript` only if a controlled reinjection fallback is necessary.
- `chrome.storage.local` for user preference/status persistence, not as a second independent loop trigger.
- `chrome.runtime.onMessage` for explicit controller commands/status.

Keep permissions as narrow as the extension architecture allows. Check existing manifest permissions before adding any.

### Page APIs
- DOM selectors and visible text/attributes to identify current content and enabled controls.
- MutationObserver or bounded polling to wait for real page changes.
- Timer APIs with cancellation checks.
- No direct backend completion endpoint in this design.

## 11. Porting plan

1. Inspect current `g` branch and preserve its baseline.
2. Add a dedicated `autopilot.js` based on the safe state machine above.
3. Add the script to `manifest.json` only for the intended course host and a single appropriate frame context.
4. Add the minimum popup controls/status needed; avoid overwriting existing provider UI.
5. Keep `api_completer.js` out of the manifest and normal Start flow.
6. Review every changed line and run static syntax checks where available.
7. Test in an authorized test course with explicit scenarios: reading, video, quiz, navigation, Stop during wait, repeated Start, missing Next, and end of course.
8. Report what was actually tested. Source checks are not browser runtime tests.

## 12. Acceptance checklist

- [ ] One controller only; repeated Start does not create duplicate loops.
- [ ] Stop prevents further actions after the current synchronous step.
- [ ] No automatic global muting or seeking.
- [ ] Quiz pages pause for user input rather than selecting the first option.
- [ ] Reading status is verified before progression.
- [ ] One Next click at most per attempt; no parent-plus-child double click.
- [ ] Navigation is confirmed before processing the next node.
- [ ] Retries and waits are bounded.
- [ ] Course end is detected and the loop stops.
- [ ] No fake time-spent requests or unverified direct completion API.
- [ ] Existing provider, editor, video/audio behavior outside course autopilot remains untouched.
- [ ] All changes and test limits are documented in `SATORI_CONTEXT.md`.

## 13. Current status

This is a design/implementation plan only. It does not mean any source code has been changed or tested. The user said “ok do it” after being offered a source-grounded progression map and a safer design for `g`; the next code-writing step should be to implement this plan in small, reviewable changes after confirming the relevant current files.
