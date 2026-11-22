# Architecture & Module Map

This file tracks all active modules in `sato`. Every module strictly adheres to a single responsibility and maintains a soft limit of **50–100 lines per file**.

| File Path | Responsibility | Line Count | Status |
|---|---|:---:|---|
| `manifest.json` | Extension config, permissions, hotkeys `Alt+C`, `Alt+F`, `Alt+M` | 63 | Clean |
| `background/orchestrator.js` | Central solve router & hotkey message dispatcher | 97 | Clean |
| `background/snippet-store.js` | Multi-frame snippet buffer with `chrome.storage.session` write-through | 42 | Clean |
| `background/gemini-tab-manager.js` | Tab lifecycle, pinning, auto-discard prevention & fresh chat reset | 62 | Clean |
| `background/tab-injector.js` | Auto-injects scripts into all open tabs on startup/reload | 34 | Clean |
| `bridges/gemini-bridge.js` | In-tab Gemini driver: input population & prompt dispatch | 91 | Clean |
| `bridges/gemini-observer.js` | Response watcher: streaming lines, copy-button & quiet detection | 79 | Clean |
| `bridges/gemini-visible.js` | Visibility spoofing & inaudible Web Audio keep-alive | 23 | Clean |
| `content/editor-detector.js` | Targets Monaco/CodeMirror code editor over non-editor elements | 60 | Clean |
| `content/snippet-client.js` | Client-side snippet accumulation (`Alt+S`) & clear messenger | 36 | Clean |
| `content/examly-extractor.js` | Problem statement scraper & DOM selector scanner | 60 | Clean |
| `content/workflow-runner.js` | Executes code & MCQ workflows with status toast updates | 63 | Clean |
| `content/listener.js` | Hotkey listener (`Alt+C`, `Alt+F`, `Alt+M`, `Alt+S`, `Alt+X`) | 61 | Clean |
| `content/native-typer.js` | Safe synthetic clipboard paste & property descriptor setter | 65 | Clean |
| `content/mcq-selector.js` | Radio button & ARIA choice card click dispatcher | 71 | Clean |
| `content/toast-pill.js` | Real-time floating status pill | 69 | Clean |
| `popup/` (`html`, `js`, `css`) | Minimal status preview & config popup | ~30 each | Clean |
