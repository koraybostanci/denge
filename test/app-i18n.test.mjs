// The app shell against the language work: index.html's static text, the example chips, and the messages js/app.js shows. `node --test`
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { setLang, applyStatic } from '../js/i18n.js';
import tr from '../js/tr.js';
import { S, parseLocal } from '../js/core.js';
import { buildPlan } from '../js/plan.js';
import seedPlan from '../js/default-plan.js';
import { extract, literals } from './extract.mjs';

const APP = readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');
const HTML = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

const ORIGINAL_TR = { ...tr };
const added = [];
afterEach(async () => {
  added.length = 0;
  for (const k of Object.keys(tr)) delete tr[k];
  Object.assign(tr, ORIGINAL_TR); // the tests add and replace entries; the table goes back to what tr.js holds
  await setLang('en');
});

// ——— index.html: static text ———
// A stand-in for the document, built from the tags of index.html that carry data-t attributes
const TARGET = { 'data-t-aria': 'aria-label', 'data-t-placeholder': 'placeholder', 'data-t-fill': 'data-fill', 'data-t-content': 'content' };
function fakeDoc() {
  const els = [];
  for (const m of HTML.matchAll(/<([a-z][\w-]*)((?:\s+[\w-]+(?:="[^"]*")?)*)\s*\/?>([^<]*)/g)) {
    const attrs = new Map([...m[2].matchAll(/([\w-]+)(?:="([^"]*)")?/g)].map((a) => [a[1], a[2] ?? '']));
    if (![...attrs.keys()].some((k) => k.startsWith('data-t'))) continue;
    els.push({ tag: m[1], attrs, original: m[3], textContent: m[3], getAttribute: (k) => attrs.get(k) ?? null, setAttribute: (k, v) => attrs.set(k, v) });
  }
  return { els, documentElement: { lang: '' }, querySelectorAll: (sel) => els.filter((e) => e.attrs.has(sel.slice(1, -1))) };
}

test('index.html: the English markup is the key of every data-t attribute', () => {
  const doc = fakeDoc();
  assert.ok(doc.els.length > 10);
  for (const e of doc.els) {
    if (e.attrs.has('data-t')) assert.equal(e.attrs.get('data-t'), e.original, `text of <${e.tag}>`);
    for (const [from, to] of Object.entries(TARGET)) if (e.attrs.has(from)) assert.equal(e.attrs.get(from), e.attrs.get(to), `${to} of <${e.tag}>`);
  }
});

test('index.html: all visible text, labels and placeholders are marked for translation', () => {
  const body = HTML.slice(HTML.indexOf('<body>')).replace(/<!--[\s\S]*?-->/g, '').replace(/<(script|svg)[\s\S]*?<\/\1>/g, '');
  const missing = [];
  for (const m of body.matchAll(/<([a-z][^>]*)>([^<]*)/g)) {
    const [, tag, text] = m;
    if (text.trim() && !/\bdata-t=/.test(tag)) missing.push(`text "${text.trim()}"`);
    for (const a of tag.matchAll(/\b(aria-label|placeholder|title|alt)="([^"]*)"/g)) if (!new RegExp(`data-t-${a[1] === 'aria-label' ? 'aria' : a[1]}="`).test(tag)) missing.push(`${a[1]} "${a[2]}"`);
  }
  assert.deepEqual(missing, []);
  assert.match(HTML, /data-t-content="Pickle: good things take time\./);
});

test('applyStatic: English leaves the page as it is; a language puts its text in place and Turkish falls back for what is missing', async () => {
  const doc = fakeDoc();
  const before = JSON.stringify(doc.els.map((e) => [e.textContent, [...e.attrs]]));
  applyStatic(doc);
  assert.equal(doc.documentElement.lang, 'en');
  assert.equal(JSON.stringify(doc.els.map((e) => [e.textContent, [...e.attrs]])), before);
  const keys = [...new Set(extract().found.filter((f) => f.fn === 'data-t').map((f) => f.key))];
  await setLang('tr');
  for (const k of keys) if (!(k in tr)) { tr[k] = `⟦${k}⟧`; added.push(k); }
  applyStatic(doc);
  assert.equal(doc.documentElement.lang, 'tr');
  for (const e of doc.els) {
    if (e.attrs.has('data-t')) assert.equal(e.textContent, tr[e.attrs.get('data-t')]);
    for (const [from, to] of Object.entries(TARGET)) if (e.attrs.has(from)) assert.equal(e.attrs.get(to), tr[e.attrs.get(from)], `${to} of <${e.tag}>`);
  }
  await setLang('en');
  applyStatic(doc);
  assert.equal(JSON.stringify(doc.els.map((e) => [e.textContent, [...e.attrs]])), before, 'back to English');
  assert.doesNotThrow(() => applyStatic(null));
});

test('the example chips: each Turkish phrase is understood by the parser the way the English one is', async () => {
  const fills = extract().found.filter((f) => f.fn === 'data-t' && f.file.endsWith('.html')).map((f) => f.key);
  const chips = [...HTML.matchAll(/data-t-fill="([^"]*)"/g)].map((m) => m[1]);
  assert.ok(chips.length >= 6 && chips.every((c) => fills.includes(c)));
  S.plan = buildPlan(seedPlan); // a chip can name a plan meal
  await setLang('tr');
  for (const en of chips) {
    assert.ok(en in tr, `tr.js has a phrase for the chip "${en}"`);
    const a = parseLocal(en);
    const b = parseLocal(tr[en]);
    assert.deepEqual(b && b.type, a && a.type, `"${tr[en]}" is read as "${en}" is`);
    if (a) assert.deepEqual(Object.entries(b).filter(([k]) => k !== 'meal'), Object.entries(a).filter(([k]) => k !== 'meal'), tr[en]);
  }
});

// ——— js/app.js: the messages ———
// Line by line: from a place where text reaches the person (a toast, a text or HTML assignment, an error, a confirm or prompt, a button label)
// to the end of the line, minus what t() / tn() / td() / T() hold (and the codes given to modelFailure()), HTML tags, and names compared with ===. What is left may not hold an English word. A line can be marked `// i18n-ok: why`.
const SINK = /toast\(|\.textContent\s*=|\.innerHTML\s*=|\berr:|\.err\s*=|\bfailure\s*=|\bconfirm\(|\bprompt\(|\blabel:/;
const DIRECT = /(?:\breturn\s+|=>\s*)(?=['"`])/g; // a function that returns a plain string: only the string itself counts
const WRAP = /(?<![\w$.])(?:tn|td|t|T|modelFailure)\(/g; // modelFailure(err, 'check') takes codes and returns the translated message
function stripWrapped(text) {
  for (let m; (m = new RegExp(WRAP.source).exec(text));) {
    let depth = 0;
    let i = m.index + m[0].length - 1;
    for (; i < text.length; i++) {
      const c = text[i];
      if (c === "'" || c === '"' || c === '`') { for (i++; i < text.length && text[i] !== c; i++) if (text[i] === '\\') i++; continue; }
      if (c === '(') depth++;
      if (c === ')' && --depth === 0) break;
    }
    text = text.slice(0, m.index) + text.slice(i + 1);
  }
  return text;
}
const UNITS = new Set(['kg', 'kcal', 'ml']);
export function lintApp(src) {
  const bad = [];
  const lines = src.split('\n');
  lines.forEach((line, n) => {
    if (/\/\/ i18n-ok\b/.test(line)) return;
    const m = SINK.exec(line);
    const direct = [...line.matchAll(DIRECT)].map((d) => d.index + d[0].length);
    if (!m && !direct.length) return;
    let rest = line.slice(m ? Math.min(m.index, ...direct) : Math.min(...direct));
    if (/toast\(\s*$/.test(rest) && lines[n + 1] !== undefined && !/\/\/ i18n-ok\b/.test(lines[n + 1])) rest += lines[n + 1]; // a toast( with its message on the next line
    rest = stripWrapped(rest);
    for (const lit of literals(rest)) {
      if (/(?:===|!==)\s*$/.test(rest.slice(0, lit.start))) continue; // compared with: a name in the code
      const words = (lit.text.replace(/<[^>]*>/g, ' ').match(/[A-Za-z][A-Za-z’']{2,}/g) || []).filter((w) => !UNITS.has(w));
      if (words.length) bad.push(`app.js:${n + 1} ${JSON.stringify(words.join(' '))} in ${JSON.stringify(line.trim().slice(0, 80))}`);
    }
  });
  // toast(name) where the name is a constant holding a plain string
  for (const m of src.matchAll(/\btoast\((\w+)[,)]/g)) {
    const decl = new RegExp(`\\b(?:const|let)\\s+${m[1]}\\s*=\\s*['"\`]([^'"\`]*)`).exec(src);
    if (decl && /[A-Za-z]{3}/.test(decl[1])) bad.push(`app.js:${src.slice(0, m.index).split('\n').length} toast(${m[1]}) holds the plain text ${JSON.stringify(decl[1])}`);
  }
  return bad;
}

test('reverse lint: every message in app.js goes through t(), tn() or td()', () => {
  assert.deepEqual(lintApp(APP), []);
});

test('reverse lint for app.js: it flags unwrapped messages and lets wrapped ones, units and marked lines through', () => {
  assert.equal(lintApp("toast('Entry deleted');").length, 1);
  assert.equal(lintApp('toast(`Saved ${x}`);').length, 1);
  assert.equal(lintApp("out.textContent = 'Checking…';").length, 1);
  assert.equal(lintApp("x.err = a ? t('Fine') : 'Failed.';").length, 1);
  assert.equal(lintApp("if (!ok) return window.confirm('Sure?');").length, 1);
  assert.equal(lintApp("toast(t('Fine'), { label: 'Undo', fn });").length, 1);
  assert.deepEqual(lintApp("toast(t('Entry {x} deleted', { x: t('inner') })); out.textContent = `${a} ${tn('{n} day|{n} days', n)}`;"), []);
  assert.deepEqual(lintApp("toast(t('Weight {kg}', { kg })); out.textContent = `${n} kg`; el.textContent = msg;"), []);
  assert.deepEqual(lintApp("toast('Raw words'); // i18n-ok: shown as the provider wrote it"), []);
  assert.deepEqual(lintApp("const kind = 'Plain code string';"), []);
  // return statements, arrow-function bodies, a message on the line after toast(, and a constant given to toast
  assert.equal(lintApp("function f() { return 'The model sent nothing usable.'; }").length, 1);
  assert.deepEqual(lintApp("function f() { return t('The model sent nothing usable.'); }"), []);
  assert.equal(lintApp("const NO_KEY = { review: () => 'Add an API key.' };").length, 1);
  assert.deepEqual(lintApp("const NO_KEY = { review: () => t('Add an API key.') };"), []);
  assert.equal(lintApp("toast(\n  'Saved it');").length, 1);
  assert.deepEqual(lintApp("toast(\n  t('Saved it'));"), []);
  assert.equal(lintApp("const m = 'Saved it';\ntoast(m);").length, 1);
  assert.deepEqual(lintApp("const m = t('Saved it');\ntoast(m);"), []);
});

test('app.js: the messages it shows use keys the extraction sees', () => {
  const keys = new Set(extract().found.filter((f) => f.file === 'js/app.js').map((f) => f.key));
  for (const k of ['{name} logged', 'Entry deleted', 'reset.word', 'Log cleared', 'Could not load that language. Try again when you are online.']) assert.ok(keys.has(k), k);
  assert.ok(keys.size > 100);
});
