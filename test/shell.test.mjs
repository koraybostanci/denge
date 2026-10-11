// The service worker caches the app shell. A js file missing from SHELL breaks offline start; a listed file that does not exist fails the install.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { APP_VERSION } from '../js/core.js';

const root = new URL('../', import.meta.url);
const sw = readFileSync(new URL('sw.js', root), 'utf8');
const SHELL = [...sw.match(/const SHELL = \[([\s\S]*?)\];/)[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);

test('every js file is in the service worker SHELL', () => {
  const files = readdirSync(new URL('js/', root)).filter((f) => f.endsWith('.js'));
  assert.ok(files.length > 10);
  const missing = files.filter((f) => !SHELL.includes(`js/${f}`));
  assert.deepEqual(missing, [], `not in SHELL: ${missing.join(', ')}`);
});

test('every SHELL file exists', () => {
  const gone = SHELL.filter((f) => f !== './' && !existsSync(new URL(f, root)));
  assert.deepEqual(gone, []);
});

test('the service worker VERSION follows APP_VERSION', () => {
  assert.equal(sw.match(/const VERSION = '([^']+)'/)[1], `weightplan-v${APP_VERSION}`);
});
