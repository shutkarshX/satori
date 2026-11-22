# Sato Quick Assist — Examly & Web Editor Copier / Typer

A lightweight, modular Chrome Extension built from scratch to automatically extract questions, query a background Gemini tab, and type the answer directly into focused Examly code editors or text fields.

## Features
- **Shortcuts**: `Alt + C` solves code, `Alt + F` runs a follow-up, `Alt + M` solves an MCQ, and `Alt + V` pastes clipboard text.
- **Zero API Keys Needed**: Leverages your logged-in Gemini web session in a background tab.
- **Paste-Block Bypass**: Native prototype descriptor setters, synthetic `DataTransfer` paste events, and `execCommand` fallbacks for Monaco Editor, CodeMirror, and standard textareas.
- **Verified workflow states**: The status pill reports extraction, prompt submission, Gemini response progress, insertion, and errors.
- **Modular Code**: Every file strictly maintained within ~40–70 lines.

## How to Install in Chrome
1. Open Google Chrome and go to `chrome://extensions/`.
2. Enable **Developer mode** in the top right.
3. Click **Load unpacked** and select `d:\ME\Projects\sato`.
4. Open a background tab at [https://gemini.google.com](https://gemini.google.com) and ensure you are logged in.
5. On your Examly question page, click inside the answer or code editor box and press **`Alt + C`**.


## Local test page

The included `test/test-sandbox.html` is supported for manual regression checks. In Chrome, enable the extension’s **Allow access to file URLs** option before opening it. Gemini itself is excluded from the editor shortcuts.
