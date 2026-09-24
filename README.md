# Satori

A local Chrome extension for practice assignments. It reads selectable question text, sends a prepared prompt to the Gemini website (no Gemini API), shows Gemini's latest response in a Chrome side panel, and can type reviewed text into the assignment editor when clipboard paste is blocked. It does not submit answers.

## Install or update in Chrome

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Choose **Load unpacked**.
4. Select your local `satori` folder—the folder containing `manifest.json`.
5. If it was already installed, click **Reload** on the extension card.
6. Reload the practice assignment page and any open Gemini tab.

## Use

1. Click inside the assignment answer editor first if you plan to use the typing feature.
2. Open the extension from the Chrome toolbar.
3. Choose **MCQ** or **Coding**.
4. Click **Read current question**. If the page contains unrelated text, select only the question before clicking it.
5. Optionally add language or format instructions.
6. Click **Ask Gemini & show result**. The extension reuses an existing Gemini tab when possible, fills the Gemini input, and clicks Send. Gemini's response appears in the Chrome side panel.
7. Review Gemini's response. Put the reviewed answer/code into the extension's **Reviewed answer/code** box.
8. Return to the assignment tab, click the target editor if needed, open the extension, and click **Type into focused assignment editor**.
9. Review the inserted text and submit manually.

## Limitations

- The assignment page must permit the extension to run; Chrome internal pages cannot be read.
- Page layouts vary. If automatic extraction finds too much text, select the question manually first.
- Some rich editors and embedded iframes may not accept programmatic input.
- Image questions are not OCR'd in this first version.
- Gemini login, CAPTCHA, and submission are left to the user.

This extension is intended for practice/learning. Use it only where AI assistance and browser automation are allowed.
