const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const pollerSource = fs.readFileSync(path.join(__dirname, '..', 'background', 'response-poller.js'), 'utf8');

test('detects text added to an existing empty model response node and emits progress', async () => {
  let now = 1000;
  let calls = 0;
  let answerText = '';
  const progress = [];
  const document = {
    querySelectorAll(selector) {
      if (/model-response|message-content|data-message-author-role|model-response-text/.test(selector)) {
        return [{ innerText: answerText, textContent: answerText, querySelector: () => null }];
      }
      return [];
    },
    querySelector: () => null
  };
  const chrome = {
    scripting: {
      executeScript: async ({ func }) => {
        calls += 1;
        if (calls === 3) answerText = 'function answer() {\n  return 42;\n}';
        return [{ result: func() }];
      }
    },
    tabs: { sendMessage: (_tabId, message) => { progress.push(message); return Promise.resolve(); } }
  };
  const clock = { now: () => now };
  const fastSetTimeout = (callback, delay) => { now += delay; callback(); return 1; };
  const context = { self: {}, chrome, document, setTimeout: fastSetTimeout, Date: clock, Array, Boolean, RegExp, String, Promise };
  vm.runInNewContext(pollerSource, context, { filename: 'response-poller.js' });

  const result = await context.self.satoResponsePoller.poll(7, 1, '', 'code', 9, 'run-regression');
  assert.match(result, /return 42/);
  assert.ok(progress.some((message) => message.payload?.status === 'streaming'));
  assert.ok(calls >= 8, 'the stable-response delay should avoid an early partial return');
});
