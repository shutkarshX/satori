# Satori

Satori is a practice-only Chrome extension for reading assignment questions, sending them to a selected AI provider in a reusable background tab, capturing the provider response, and placing the reviewed result into the assignment page. Final review and submission remain manual.

## Providers

- **Google AI Mode** — searches Google and reads the available AI result.
- **Gemini** — reuses a Gemini tab and watches for the provider's response.
- **ChatGPT** — reuses a ChatGPT conversation, submits the prompt automatically, and captures the new assistant response.

Provider DOM handling stays inside each provider adapter. The background service worker handles request state, tab orchestration, validation, storage, and assignment autofill.

## Install

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Choose **Load unpacked**.
4. Select the local `satori` folder containing `manifest.json`.
5. Reload the extension after code changes.
6. Reload the assignment page after installing or updating the extension.

## Use

1. Choose **MCQ** or **Coding**.
2. Choose Google, Gemini, or ChatGPT.
3. Click **Read current question** or select the question text manually.
4. Add optional instructions if needed.
5. Ask the selected provider.
6. Review the captured response.
7. If Satori places an answer/code into the assignment, review it before submitting.
8. Submit the assignment manually.

## Design principles

- Reuse provider tabs instead of opening a new AI tab for every question.
- Keep the assignment tab active while AI work happens in the background.
- Keep Google, Gemini, and ChatGPT DOM strategies provider-specific.
- Treat request IDs and response ownership as first-class state.
- Never treat arbitrary ChatGPT prose as a coding solution.
- Prefer failing clearly over confidently selecting an ambiguous MCQ option.
- Keep final review and submission manual.

## Limitations

Provider websites change their DOM frequently, so selectors and response extraction may need maintenance.

Google AI results are not guaranteed for every query, account, region, or session.

Some assignment editors, embedded frames, and rich UI controls may reject programmatic input.

Image-only questions are not OCR'd automatically.

Authentication, CAPTCHA, and final submission remain user-controlled.

This extension is intended for practice/learning. Use it only where AI assistance and browser automation are allowed.
