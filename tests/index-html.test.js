// Smoke test: confirm the inline JS in index.html parses cleanly.
// Catches typos / syntax errors without spinning up a browser.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('index.html inline JS parses', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  const re = /<script\b[^>]*>([\s\S]*?)<\/script>/g;
  let m, code = '';
  while ((m = re.exec(html)) !== null) code += m[1] + ';\n';
  assert.doesNotThrow(() => new Function(code));
});
