'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'js/app.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'css/style.css'), 'utf8');

test('chat lifts the composer by keyboard inset in both windowed and fullscreen layouts', () => {
  assert.match(app, /setupKeyboardInset/);
  assert.match(app, /--keyboard-inset/);
  assert.match(css, /calc\(var\(--mobile-nav-h\) \+ var\(--keyboard-inset, 0px\)\)/);
});
