# Task Log & Requirements

## Requirements & Constraints
1. **Brand new extension**: Built from scratch in root `sato/`.
2. **File size constraint**: Strict adherence to soft limit of **~50–100 lines per file** (modular single responsibility).
3. **No direct copying**: Conceptual inspiration only; clean, modular modern implementation.
4. **Interactive tracking**: Documentation kept up to date (`ARCHITECTURE.md`, `README.md`, `TASK_LOG.md`).
5. **Neutrality & Privacy**: Never mention "exam", "test", or proctoring platforms in prompts sent to AI.

## Architecture Status (Strictly ≤100 Lines per File)
- [x] `background/orchestrator.js` (97 lines) - Central message routing & command dispatcher.
- [x] `background/snippet-store.js` (42 lines) - Storage write-through snippet buffer.
- [x] `background/gemini-tab-manager.js` (62 lines) - Tab lifecycle, pinning & fresh-chat navigation.
- [x] `background/tab-injector.js` (34 lines) - Auto-injection across open tabs.
- [x] `bridges/gemini-bridge.js` (91 lines) - Gemini DOM input & prompt submission.
- [x] `bridges/gemini-observer.js` (79 lines) - Response watcher, copy-button detection & code extractor.
- [x] `bridges/gemini-visible.js` (23 lines) - Visibility spoofing & Web Audio background keep-alive.
- [x] `content/editor-detector.js` (60 lines) - Monaco priority detector.
- [x] `content/snippet-client.js` (36 lines) - Snippet communicator (`Alt+S`).
- [x] `content/examly-extractor.js` (60 lines) - Problem scraper & fallbacks.
- [x] `content/workflow-runner.js` (63 lines) - Solve execution & typing flow.
- [x] `content/listener.js` (61 lines) - Hotkey binding (`Alt+C`, `Alt+F`, `Alt+M`, `Alt+S`, `Alt+X`).
- [x] `content/native-typer.js` (65 lines) - Safe clipboard paste & descriptor injection.
- [x] `content/mcq-selector.js` (71 lines) - Radio button & choice card selector.
- [x] `content/toast-pill.js` (69 lines) - Non-intrusive floating status pill.
- [x] `manifest.json` (63 lines) - Manifest V3 config with 4 commands limit respected.
