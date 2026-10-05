# Satori

Satori is a practice-only Chrome extension that reads the current assignment page, sends the full page context to one selected AI provider, validates the returned result against the assignment UI, and places the result into the page. Final review and submission remain manual.

## Workflow

Choose the AI provider once in the popup. Then use the keyboard shortcuts on the assignment page:

- **Alt+Shift+M** — solve the current page as an MCQ.
- **Alt+Shift+C** — solve the current page as a coding problem.
- **Alt+Shift+X** — cancel the current request.

Chrome lets these shortcuts be changed from `chrome://extensions/shortcuts`.

Satori intentionally sends the **full visible page text** to the AI. It does not try to build a universal question parser first. The AI is responsible for understanding the question, options, problem statement, language, and relevant context.

A small draggable status widget appears on the assignment page while a request is running:

- **◉ ~Ns** — processing, with an approximate estimate.
- **✓ DONE** — the result was successfully applied.
- **× ERROR** — the request or assignment action failed.
- **– CANCELLED** — the request was stopped by the user.

Every request also has a durable two-minute timeout.

Click the widget for the current status detail.

## Providers

- **Google AI Mode** — searches Google and reads the available AI result.
- **Gemini** — reuses a Gemini tab and watches for the provider's response.
- **ChatGPT** — reuses a ChatGPT conversation, submits the prompt automatically, and captures the new assistant response.

Provider DOM handling stays inside each provider adapter. The background service worker handles request state, tab orchestration, the shared provider-result contract, validation, storage, and assignment actions.

## Result contract

Provider-specific extraction ends at a small common result object.

MCQ:

```js
{
  provider: "chatgpt",
  requestId: "abc123",
  type: "mcq",
  answer: {
    letter: "B",
    text: "Queue",
    raw: "..."
  },
  raw: "..."
}
```

Coding:

```js
{
  provider: "chatgpt",
  requestId: "abc123",
  type: "coding",
  language: null,
  code: "...",
  raw: "..."
}
```

The provider may use completely different DOM and response logic internally. The rest of Satori only depends on this normalized result.

## MCQ safety

Satori treats the AI result as a decision to validate, not as an instruction to blindly click.

For MCQs, the assignment page supplies the actual selectable options. Satori compares the returned answer text with those options and uses the returned option letter as a second identity signal when available.

If the answer text matches multiple options, or the AI's text and letter point to different options, Satori refuses to select anything and reports the conflict.

## Request lifecycle

Requests are tracked as a sequence of states:

```text
CREATED
  ↓
SUBMITTED
  ↓
PROCESSING
  ↓
ANSWER_FOUND
  ↓
VALIDATING
  ↓
DONE
```

Failures are surfaced instead of silently selecting or filling something uncertain.

## Install

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Choose **Load unpacked**.
4. Select the local `satori` folder containing `manifest.json`.
5. Reload the extension after code changes.
6. Reload the assignment page after installing or updating the extension.

## Design principles

- Let the AI understand messy full-page assignment content.
- Keep Google, Gemini, and ChatGPT DOM strategies provider-specific.
- Reuse provider tabs instead of opening a new AI tab for every request.
- Keep the assignment tab active while AI work happens in the background.
- Keep request IDs and response ownership explicit.
- Never treat arbitrary ChatGPT prose as a coding solution.
- Validate an MCQ before changing the assignment UI.
- Fail clearly instead of confidently selecting an ambiguous option.
- Keep final review and submission manual.

## Limitations

Provider websites change their DOM frequently, so selectors and response extraction may need maintenance.

Google AI results are not guaranteed for every query, account, region, or session.

Some assignment editors, embedded frames, and rich UI controls may reject programmatic input.

Image-only questions are not OCR'd automatically.

Authentication, CAPTCHA, and final submission remain user-controlled.

This extension is intended for practice/learning. Use it only where AI assistance and browser automation are allowed.
