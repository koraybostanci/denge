// The screens in js/views.js against the language work: no English literal left outside t()/tn()/T()/td(), every screen
// renders only translated text in a marker-prefixed pseudo Turkish, and the language control in Settings. `node --test`
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { setLang, t } from '../js/i18n.js';
import tr from '../js/tr.js';
import { MODELS, PRESETS } from '../js/ai.js';
import { extract, literals } from './extract.mjs';
import { screens, fixture, core, views, day, at, meal, MINE, T as TODAY } from './screens.mjs';
import { progressBrief } from '../js/briefs.js';

const { S } = core;
const VIEWS = readFileSync(new URL('../js/views.js', import.meta.url), 'utf8');
const lineOf = (src, i) => src.slice(0, i).split('\n').length;

// ——— Reverse lint: English text in views.js that is not inside t() / tn() / T() ———
// Words that are not English text to be translated: units, brand names, the two language names
// (standalone and svg are a media query and a selector in the code, not text)
const ALLOW_WORDS = new Set(['kg', 'kcal', 'mg', 'ml', 'pickle', 'claude', 'english', 'türkçe', 'standalone', 'svg']);
// Lone lower-case words that are code: Intl options, element and event names, the screen and section ids, the values of the code's own states, attribute
// words (` disabled`). Words that only appear in a comparison (`=== 'week'`) need no entry. Anything else, say `[x, 'weigh-in']` or `ok ? 'kg' : 'steps'`, is flagged.
const CODE_WORDS = new Set(['numeric', 'long', 'short', 'future', 'before', 'over', 'top', 'more', 'morning', 'late', 'workout', 'true', 'false', 'decimal', 'start', 'middle',
  'hidden', 'visible', 'span', 'pointermove', 'pointerdown', 'pointerleave', 'conjunction', 'going', 'target', 'min', 'near', 'disabled', 'selected', 'checked', 'open',
  'visibility', 'language', 'analysis', 'targets', 'backup', 'location', 'favorites', 'supplements', 'version', 'reset', 'day', 'week:', 'earned',
  'progress', 'on-track', 'a-bit-behind', 'too-early']);
// A class name or a piece of one, or an action name: is-done, cal-d, day-${st}, pill-good, log-plan, plan-meal
const CLASS_NAME = /^(?:is|pill|day|cal|log|way|plan)-[a-z0-9\0-]*$/;
// An attribute whose value a person reads
const TEXT_ATTR = /\s(?:aria-label|title|placeholder|alt)="([^"]*)"/g;
// The English-looking words of a piece of text: 3 letters or more, not a unit or brand, not part of a name like is-done, a:b or a/b
function englishWords(text, plain) {
  const words = [...text.replace(/&#?\w+;/g, ' ').matchAll(/[A-Za-z][A-Za-z’']*/g)].filter((m) => {
    const w = m[0];
    const before = text[m.index - 1] || '';
    const after = text[m.index + w.length] || '';
    const joined = plain ? /[_:/.=#]/ : /[-_:/.=#]/; // in a plain string a dash does not make a word code: that is for CODE_WORDS and CLASS_NAME
    return w.length >= 3 && !ALLOW_WORDS.has(w.toLowerCase()) && !joined.test(before) && !(plain ? /[_:/=#]/ : /[-_:/=#]/).test(after);
  }).map((m) => m[0]);
  // A plain string is code, not text, when it is a lone word from CODE_WORDS or a list of those and class names ('numeric', 'cal-d cal-out', 'day day-${st}')
  if (plain && text.trim() && text.trim().split(/\s+/).every((w) => CODE_WORDS.has(w) || CLASS_NAME.test(w))) return [];
  return words;
}
// Text nodes and readable attribute values of an HTML string (holes already turned into \0)
function htmlTexts(html) {
  const found = [...html.matchAll(TEXT_ATTR)].map((m) => m[1]);
  return found.concat(html.replace(/<[^>]*>?/g, '\n').split('\n'));
}

function fragmentTexts(text) {
  const values = [...text.matchAll(/([\w-]+)="([^"]*)"/g)];
  if (!values.length) return [text];
  const readable = values.filter((m) => /^(?:aria-label|title|placeholder|alt)$/.test(m[1])).map((m) => m[2]);
  return readable.concat(text.replace(/[\w-]+="[^"]*"/g, ' '));
}

// What is wrong in a source: the literals with English text that no t()/tn()/T() call holds
export function lint(src) {
  const bad = [];
  for (const lit of literals(src)) {
    const before = src.slice(0, lit.start);
    if (/(?<![\w$.])(?:tn|t|T)\(\s*$/.test(before) || /\$id:\s*$/.test(before)) continue; // wrapped, or an id override
    if (/^[a-z]+$/.test(lit.text) && /(?:===|!==|==|!=)\s*$/.test(before)) continue; // compared with: a state name
    if (lit.quote !== '`' && /^[.#][\w-]|^\(display-mode:/.test(lit.text)) continue; // a selector or a media query
    if (/(?:^|\n)import [^\n]*$/.test(before)) continue; // an import path
    if (/\/\/ i18n-ok\b/.test(src.slice(lit.start, src.indexOf('\n', lit.start)))) continue; // a line marked as English on purpose
    const html = lit.text.includes('<');
    // Without tags the text may be a piece of an attribute (` aria-current="date"`): only the attributes a person reads count, by their value
    const words = html ? htmlTexts(lit.text).flatMap((x) => englishWords(x, false)) : fragmentTexts(lit.text).flatMap((x) => englishWords(x, lit.quote !== '`' || x === lit.text));
    if (words.length) bad.push(`views.js:${lineOf(src, lit.start)} ${JSON.stringify(words.join(' '))} in ${JSON.stringify(lit.text.slice(0, 70))}`);
  }
  return bad;
}

test('reverse lint: no English literal in views.js outside t(), tn() and T()', () => {
  assert.deepEqual(lint(VIEWS), []);
});

test('reverse lint: it flags unwrapped text and lets wrapped text, code names and units through', () => {
  assert.equal(lint("const a = 'Hello there';").length, 1);
  assert.equal(lint('const a = `<b>Save now</b>`;').length, 1);
  assert.equal(lint('const a = `<button aria-label="Close it">x</button>`;').length, 1);
  assert.equal(lint("const a = 'on plan';").length, 1);
  assert.equal(lint("rows.push([x, 'weigh-in']);").length, 1);
  assert.equal(lint("const a = isKg ? 'kg' : 'steps';").length, 1);
  assert.deepEqual(lint("if (e.kind === 'steps' && x !== 'week') ok(day, 'top');"), []);
  assert.equal(lint('const a = `<p>${x ? `Inner words` : \'\'}</p>`;').length, 1);
  assert.deepEqual(lint("const a = t('Hello there'); const b = tn('{n} day|{n} days', n); const c = T('Mo'); const d = t('x', { $id: 'menu.open' });"), []);
  assert.deepEqual(lint('const a = `<li class="day day-${st} is-done" data-act="goto-day">${t(\'Open\')} ${n} kg ${y} kcal</li>`; const b = \'cal-d cal-out\'; const c = \'numeric\'; const d = x / 2 / y; const e = /, ([^,]*)$/;'), []);
  assert.deepEqual(lint('const a = `${t("Wrapped")} <svg viewBox="0 0 24 24"><path d="M4 7.5h9"/></svg>`;'), []);
});

// ——— Pseudo-locale: every string of the code in a marked "Turkish", every screen rendered in it ———
const MARK_OPEN = '⟦';
const MARK_CLOSE = '⟧';
// Only the fixed text is marked; the {placeholders} stay outside the markers, so a value that was not translated
// (a T-table word without td(), an English word passed as a param) shows up as unmarked text
const marked = (s) => s.split(/(\{\w+\})/).map((x, i) => (i % 2 || !x ? x : `${MARK_OPEN}${x}${MARK_CLOSE}`)).join('');
// Built from the extractor, so it follows the code: each t / tn / T literal and id of the code, its fixed parts wrapped in marker pairs.
// (All of js/, not only views.js: the plan, rule and verdict texts that views.js shows come from plan.js and core.js.)
function pseudoTable() {
  const table = {};
  for (const f of extract().found) if (f.fn !== 'data-t' && !f.file.endsWith('.html')) table[f.key] = f.fn === 'tn' ? f.text.split('|').map(marked).join('|') : marked(f.text);
  return table;
}

const ORIGINAL_TR = { ...tr };
const added = [];
afterEach(async () => {
  added.length = 0;
  for (const k of Object.keys(tr)) delete tr[k];
  Object.assign(tr, ORIGINAL_TR); // the tests add and replace entries; the table goes back to what tr.js holds
  await setLang('en');
});
async function pseudoOn() {
  const table = pseudoTable();
  Object.assign(tr, table);
  added.push(...Object.keys(table));
  await setLang('tr');
}

// What is allowed to stay as it is in the pseudo-locale, and why:
const EXCEPT = {
  // Text the person typed, or the model wrote, in the fixtures (shown as written; user data is never translated)
  data: ['Oats with yoghurt', 'Jumbo oats', 'Greek yoghurt', 'Overnight oats', 'Chicken and rice', 'Pizza night', 'Salmon and salad', 'Weight', 'Is it fried?', 'Good day', 'Skyr was the best', 'Cut the sauce', 'Dinner out', 'Burger', 'Ordered a small one', 'Lunch menu', 'Fresh and light', 'Fish and salad', 'Almond milk', 'Magnesium', 'Vitamin D', 'Fits well', 'one plate', 'one', '8,200 steps', 'Home', 'home', 'Ayşe', 'Language / Dil', PRESETS[0].model],
  // Names from ai.js that are not marked with T() yet (the models and providers of the Settings sheet): brand names with a few English words
  models: [...Object.values(MODELS).map((m) => m.name), ...PRESETS.map((p) => p.name), ...Object.values(MODELS).map((m) => m.name.split(' (')[0]), ...PRESETS.map((p) => p.name.split(' (')[0])],
  // Words that are not English text: units, brand names, the two language names, and the host part of a placeholder
  words: ['kg', 'kcal', 'mg', 'ml', 'Pickle', 'Claude', 'English', 'Türkçe', 'https', 'sk', 'ant'],
};
// The names Intl gives for the dates in Turkish (months, weekdays, long and short): the date formats follow the language by themselves
const INTL = new Set();
for (let m = 0; m < 12; m++) for (const month of ['long', 'short']) INTL.add(new Intl.DateTimeFormat('tr-TR', { month, timeZone: 'UTC' }).format(new Date(Date.UTC(2026, m, 15))));
INTL.add('ve'); // the "and" of a list in Turkish: Intl.ListFormat writes it
for (let d = 1; d <= 7; d++) for (const weekday of ['long', 'short']) INTL.add(new Intl.DateTimeFormat('tr-TR', { weekday, timeZone: 'UTC' }).format(new Date(Date.UTC(2026, 9, 11 + d))));
const decode = (s) => s.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

// The visible text of one rendered screen that is not translated: [] when every word is inside a marker pair or an exception
export function untranslated(html) {
  let rest = html;
  for (let prev = ''; prev !== rest;) { prev = rest; rest = rest.replace(/⟦[^⟦⟧]*⟧/g, ''); } // innermost pairs first
  const problems = [];
  if (/[⟦⟧]/.test(rest)) problems.push('unbalanced marker');
  let texts = htmlTexts(rest).map(decode);
  const drop = [...EXCEPT.data, ...EXCEPT.models].sort((a, b) => b.length - a.length);
  texts = texts.map((x) => drop.reduce((acc, d) => acc.split(d).join(' '), x));
  for (const text of texts) {
    for (const m of text.matchAll(/\p{L}[\p{L}'’]*/gu)) {
      const w = m[0];
      if (w.length < 2 || EXCEPT.words.includes(w) || INTL.has(w) || INTL.has(w.replace(/[’']$/, ''))) continue;
      problems.push(`${JSON.stringify(w)} in ${JSON.stringify(text.trim().slice(0, 80))}`);
    }
  }
  return problems;
}

// More state than the snapshot fixture holds, so the review, the question, the check and the error paths render too
function extras() {
  fixture();
  const out = {};
  const add = (name, fn) => { try { out[name] = fn(); } catch (e) { out[name] = `ERROR ${e.stack}`; } };
  const s = S.settings;
  s.supplements = [{ id: 's1', name: 'Magnesium', dose: '400 mg' }];
  s.favorites = [{ id: 'f1', name: 'Burger', kcal: 700 }];
  s.places = [{ name: 'Home' }];
  s.useLocation = true;
  s.lastBackup = null;
  s.usage = { in: 1200, out: 300, calls: 1, usd: 0.02 };
  s.planPhotos = { 'L-A': 'p1' };
  S.persisted = false;
  S.storage = { usage: 5e6 };
  S.days[TODAY].coach = { note: 'Skyr was the best', ts: at(TODAY, 15), sig: 'x' };
  S.days[day(-1)].review = { head: 'Good day', good: ['Cut the sauce'], cut: ['Dinner out'], next: 'Ordered a small one', ts: at(day(-1), 22), sig: 'old' };
  S.entries.push(meal(day(-1), 20, 'dinner', 'Burger', 900, 40, { tier: 'off', src: 'photo', conf: 0.4, q: 'Is it fried?', place: 'home', timeSrc: 'exif', photoIds: ['a', 'b'], text: 'Fresh and light', items: [{ n: 'Burger', g: 200, kcal: 500 }], mult: 1.5, edited: true }));
  S.entries.push(meal(day(-1), 21, 'late', 'Almond milk', 100, 3, { src: 'text', place: 'out', timeSrc: 'manual' }));
  S.entries.push({ id: 'pe', day: T0(), ts: at(T0(), 9), createdAt: at(T0(), 9), kind: 'meal', status: 'error', slot: 'lunch', title: 'Lunch menu', src: 'photo', kcal: 0, p: 0, c: 0, f: 0, fib: 0, mult: 1, flags: [], items: [] });
  S.entries.push({ id: 'ps', day: T0(), ts: at(T0(), 10), createdAt: at(T0(), 10), kind: 'steps', status: 'ok', title: '8,200 steps', steps: 8200, timeSrc: 'file' });
  S.entries.push({ id: 'pw', day: T0(), ts: at(T0(), 11), createdAt: at(T0(), 11), kind: 'weight', status: 'ok', title: 'Weight 86 kg', kg: 86, tk: { kind: 'weight', params: { kg: 86 } } });
  S.entries.push({ id: 'pp', day: T0(), ts: at(T0(), 12), createdAt: at(T0(), 12), kind: 'meal', status: 'pending', slot: 'snack1', title: 'Fish and salad', src: 'text', kcal: 0, p: 0, c: 0, f: 0, fib: 0, mult: 1, flags: [], items: [] });
  const burger = S.entries.find((e) => e.title === 'Burger');
  S.checks = [{ id: 'c1', ts: at(TODAY, 12), kind: 'menu', title: 'Lunch menu', answer: 'Fits well', note: 'Fresh and light', photos: 2, options: [{ name: 'Fish and salad', fit: 'good', rating: 4, kcal: 450, p: 40, portion: 'one plate', why: 'Fresh and light', tip: 'Cut the sauce', facts: 'Almond milk' }, { name: 'Burger', fit: 'avoid', rating: 2, kcal: 900, p: 40, portion: 'one', why: 'Skyr was the best', tip: 'Cut the sauce' }] }, { id: 'c2', ts: at(day(-3), 12), kind: 'product', title: '', answer: 'Fits well', options: [] }];
  S.check.openId = 'c1';
  S.check.photos = [{ id: 'k1', url: 'blob:x' }];
  S.check.note = 'Fresh and light';
  S.tab = 'check';
  add('check-open', views.renderCheck);
  S.check.openId = 'c2';
  S.check.busy = true;
  S.check.status = 'Skyr was the best';
  add('check-busy', views.renderCheck);
  S.check.busy = false;
  S.check.openId = null;
  S.check.photos = [];
  S.check.note = '';
  add('check-closed', views.renderCheck);
  S.tab = 'log';
  S.reviewOpen.set(day(-1), true);
  add('log-reviewed', views.renderLog);
  S.tab = 'today';
  add('today-more', views.renderToday);
  S.viewDay = day(-1);
  add('today-reviewed-day', views.renderToday);
  S.viewDay = TODAY;
  S.tab = 'progress';
  for (const d of [day(-1), day(-3), day(-6)]) { S.calPick = d; add(`progress-pick-${d}`, views.renderProgress); }
  S.calPick = null;
  S.settings.provider = 'openai';
  S.settings.oaBase = PRESETS[0].base;
  S.settings.oaKey = 'k';
  add('settings-gemini', () => views.renderSettings());
  S.suppEdit = 's1';
  add('settings-supp-edit', views.renderSettings);
  for (const id of ['pe', 'ps', 'pw', 'pp', burger.id]) add(`entry-${id}`, () => views.renderEntrySheet(id));
  S.settings.planPhotos = {};
  add('plan-sheet-nophoto', () => views.renderPlanSheet('D-A'));
  add('slot-sheet-workout', () => views.renderSlotSheet('workout', TODAY));
  add('slot-sheet-late', () => views.renderSlotSheet('late', TODAY));
  add('slot-sheet-past', () => views.renderSlotSheet('lunch', day(-2)));
  add('num-sheet-past', () => views.renderNumSheet('kg', day(-2)));
  return out;
}
function T0() { return TODAY; }

test('the pseudo-locale marks every string of the code, and the check can fail', async () => {
  const table = pseudoTable();
  assert.ok(Object.keys(table).length > 500, 'the extractor found the strings of the code');
  assert.ok(Object.keys(table).some((k) => k === 'Settings'));
  assert.deepEqual(untranslated('<p>Hello <b>world</b></p>').length, 2);
  assert.deepEqual(untranslated('<p>⟦Hello <b>1</b> world⟧ 12 kg</p>'), []);
  assert.deepEqual(untranslated('<button aria-label="⟦Close⟧" title="Open now">⟦x⟧</button>').length, 2);
  assert.deepEqual(untranslated('<p>Çarşamba 14 Ekim</p>'), []);
});

test('pseudo-locale: every screen shows only translated text in Turkish mode', async () => {
  const all = { ...screens(), ...extras() };
  const english = { ...all };
  await pseudoOn();
  const problems = [];
  const rendered = { ...screens(), ...extras() };
  for (const [name, html] of Object.entries(rendered)) {
    if (html.startsWith('ERROR')) { problems.push(`${name}: ${html.split('\n')[0]}`); continue; }
    if (name in english && html === english[name] && /[A-Za-z]{3}/.test(html.replace(/<[^>]*>/g, ''))) problems.push(`${name}: rendered the same as English`);
    for (const p of untranslated(html)) problems.push(`${name}: ${p}`);
  }
  assert.deepEqual(problems, []);
  assert.ok(Object.keys(rendered).length > 40, 'the screens ran');
});

// ——— The language control in Settings ———
test('Settings: the language control is the first section', () => {
  fixture();
  const html = views.renderSettings();
  assert.equal(html.includes('data-act="lang"'), true);
  assert.ok(html.indexOf('data-sec="language"') > -1 && html.indexOf('data-sec="language"') < html.indexOf('data-sec="analysis"'));
});

test('Today: the greeting shows with a name (escaped) and not without', () => {
  fixture();
  assert.doesNotMatch(views.renderToday(), /Hello,/);
  S.settings.name = 'Ayşe <b>';
  const html = views.renderToday();
  assert.match(html, /<p class="sub">Hello, Ayşe &lt;b&gt;<\/p>/);
  assert.doesNotMatch(html, /Ayşe <b>/);
  S.viewDay = day(-1);
  assert.doesNotMatch(views.renderToday(), /Hello,/); // a past day has no greeting
});

test('Settings: the Profile section follows the language section and holds the three fields', () => {
  fixture();
  S.settings.name = 'Ayşe'; S.settings.age = 34; S.settings.gender = 'male';
  const html = views.renderSettings();
  assert.ok(html.indexOf('data-sec="language"') < html.indexOf('data-sec="profile"') && html.indexOf('data-sec="profile"') < html.indexOf('data-sec="analysis"'));
  assert.match(html, /id="set-name"[^>]*value="Ayşe"/);
  assert.match(html, /id="set-age"[^>]*value="34"/);
  assert.match(html, /<option value="male" selected>Male<\/option>/);
  assert.match(html, /data-act="save-profile"/);
});

test('Settings: the control is a labelled group of two buttons with the language names, the chosen one pressed', async () => {
  fixture();
  const seg = (html) => html.match(/<div class="seg" role="group" aria-label="([^"]*)">([\s\S]*?)<\/div>/);
  for (const lang of ['en', 'tr']) {
    S.settings.lang = lang;
    await setLang(lang); // the control shows the language on the screen, which a rebuilt sheet reads
    const html = views.renderSettings();
    const m = html.match(/<div class="seg" role="group" aria-label="([^"]*)">([\s\S]*?)<\/div>/);
    assert.ok(m, 'a labelled group');
    assert.equal(m[1], t('Language')); // the label follows the language, the buttons do not
    const buttons = [...m[2].matchAll(/<button type="button" lang="(\w+)" data-act="lang" data-lang="(\w+)" aria-pressed="(\w+)">([^<]*)<\/button>/g)].map((b) => b.slice(1));
    assert.deepEqual(buttons, [['en', 'en', String(lang === 'en'), 'English'], ['tr', 'tr', String(lang === 'tr'), 'Türkçe']]);
    assert.match(html, new RegExp(`<small>${lang === 'tr' ? 'Türkçe' : 'English'}</small>`)); // the heading shows the current language
  }
  // The two names and the control stay as they are in a translated sheet, while the label and the note follow the language
  await pseudoOn();
  const html = views.renderSettings();
  assert.match(html, />English<\/button>/);
  assert.match(html, />Türkçe<\/button>/);
  const m = seg(html);
  assert.equal(m[1], '⟦Language⟧');
  assert.match(html, /<summary><span>Language \/ Dil<\/span>/);
  assert.deepEqual(untranslated(html), []);
});

test('Settings: the buttons use what the lang action in app.js reads', () => {
  const app = readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');
  assert.match(app, /'lang': async \(el\) => \{[^]*?el\.dataset\.lang === 'tr' \? 'tr' : 'en'/);
});

// ——— The badge sheet: every badge, in both languages, with its {n} filled ———
test('badge sheet: no placeholder is left on screen for any badge, in English or Turkish', async () => {
  const { BY_ID, CATALOG } = await import('../js/badges.js');
  for (const lang of ['en', 'tr']) {
    await setLang(lang);
    fixture();
    for (const b of CATALOG) {
      const html = views.renderBadgeSheet(b.id);
      assert.ok(html.includes('id="sheet-title"'), b.id);
      assert.doesNotMatch(html, /[{}]/, `${lang} ${b.id}`);
    }
    S.tab = 'progress';
    assert.doesNotMatch(views.renderProgress(), /\{\w+\}/, `${lang} progress`);
    if (lang === 'tr') assert.match(views.renderBadgeSheet('days_on'), /Toplam planda geçen gün: \d+/);
    else assert.match(views.renderBadgeSheet('days_on'), /Days on plan in total: \d+/);
  }
  assert.equal(views.renderBadgeSheet('nope'), '');
  assert.equal(views.renderBadgeSheet('constructor'), '');
  assert.ok(BY_ID.days_on);
});

test('Today: a meal time the active plan has no meal for is not listed, unless something is logged in it', async () => {
  const { buildPlan } = await import('../js/plan.js');
  const { default: seedPlan } = await import('../js/default-plan.js');
  fixture();
  assert.match(views.renderToday(), /Snack 2/);
  S.plan = buildPlan({ ...seedPlan, meals: seedPlan.meals.filter((m) => m.slot !== 'snack2') });
  const html = views.renderToday();
  assert.doesNotMatch(html, /Snack 2/);
  assert.match(html, /<small>2 of 3<\/small>/);
  S.entries.push(meal(TODAY, 16, 'snack2', 'Apple', 80, 0));
  assert.match(views.renderToday(), /Snack 2/); // a logged meal is never hidden
  fixture();
});

test('Today: the workout toggle label and the late-meal line follow the active plan', async () => {
  const { buildPlan } = await import('../js/plan.js');
  const { default: seedPlan } = await import('../js/default-plan.js');
  fixture();
  assert.match(views.renderToday(), /aria-label="Workout day: budget [\d,]+ kcal, banana and skyr added"/);
  S.plan = buildPlan({ ...seedPlan, meals: seedPlan.meals.map((m) => (m.slot === 'late' ? { ...m, name: 'Warm milk' } : m)) });
  S.plans = { active: 'P-x', list: [seedPlan, { id: 'P-x', name: 'My plan' }] };
  try { assert.doesNotMatch(views.renderToday(), /banana and skyr added/); } finally { S.plans = { active: 'default', list: [seedPlan] }; S.plan = buildPlan(seedPlan); fixture(); }
});

test('Plan: the switch, Delete My plan, the empty slot and what only Default shows', async () => {
  const { buildPlan } = await import('../js/plan.js');
  const { default: seedPlan } = await import('../js/default-plan.js');
  fixture();
  S.tab = 'plan';
  const only = views.renderPlan(); // (a) only Default
  S.plans = { active: MINE.id, list: [seedPlan, MINE] };
  S.plan = buildPlan(MINE);
  const mine = views.renderPlan(); // (b) My plan active, Snack 2 empty
  const slotWorkout = views.renderSlotSheet('workout', TODAY);
  const mineSheet = views.renderPlanSheet('L-A');
  S.plans = { active: 'default', list: [seedPlan, MINE] };
  S.plan = buildPlan(seedPlan);
  const both = views.renderPlan(); // (c) Default active while My plan exists
  const defSheet = views.renderPlanSheet('L-A');
  const sw = /class="seg plan-switch"/;
  assert.doesNotMatch(only, sw);
  assert.match(mine, sw);
  assert.match(both, sw);
  assert.match(mine, /data-id="P-mine01" aria-pressed="true">My plan</);
  assert.match(both, /data-id="default" aria-pressed="true">Default</);
  const del = /data-act="plan-delete"/;
  assert.doesNotMatch(only, del);
  assert.match(mine, del);
  assert.doesNotMatch(both, del);
  assert.ok(mine.indexOf('data-act="plan-delete"') < mine.indexOf('class="plan-rules"'));
  const empty = /class="plan-empty">No meals here; Today won’t suggest one.</;
  assert.match(mine, empty);
  assert.doesNotMatch(only, empty);
  // Rows open the plan meal sheet; the notes and the dinner rotation show only on Default
  assert.match(only, /<li class="meal"><button type="button" class="meal-main" data-act="plan-meal" data-id="L-A">/);
  assert.doesNotMatch(only, /plan-card|plan-row/);
  for (const x of ['The first meal of the day.', 'Herbal tea by default.', 'Dinner rotation']) {
    assert.ok(only.includes(x) && both.includes(x), x);
    assert.ok(!mine.includes(x), x);
  }
  assert.doesNotMatch(slotWorkout, /Banana before, skyr after/); // the Today hints describe Default's meals
  assert.match(views.renderSlotSheet('workout', TODAY), /Banana before, skyr after/);
  // The read-only note: only on Default while My plan exists
  const note = 'Built in, can’t be changed. Switch to My plan to change it.';
  assert.ok(defSheet.includes(note));
  assert.ok(!mineSheet.includes(note));
  fixture();
  assert.ok(!views.renderPlanSheet('L-A').includes(note));
});

test('Plan: Edit meal, + Add meal and the meal editor, by which plans exist', async () => {
  const { buildPlan } = await import('../js/plan.js');
  const { default: seedPlan } = await import('../js/default-plan.js');
  const { PLAN_CAPS } = await import('../js/backup.js');
  fixture();
  S.tab = 'plan';
  const edit = /data-act="plan-meal-edit"/;
  const add = /data-act="plan-meal-add" data-slot="lunch"/;
  const sub = 'Tap a meal to see or change it.';
  // (a) only Default: Edit meal under Log for today, + Add meal on every slot heading, the new subtitle
  const only = views.renderPlan();
  const onlySheet = views.renderPlanSheet('L-A');
  assert.match(onlySheet, edit);
  assert.ok(onlySheet.indexOf('data-act="log-plan-today"') < onlySheet.indexOf('data-act="plan-meal-edit"'));
  assert.equal((only.match(/data-act="plan-meal-add"/g) || []).length, 6);
  assert.match(only, add);
  assert.ok(only.includes(sub));
  // Editor on a meal of Default: Save to My plan with its note, Delete meal
  core.startDraft('L-A');
  const ed = views.renderMealEditor();
  assert.match(ed, /<h2 id="sheet-title">Egg and cheese plate<\/h2>/);
  assert.match(ed, /data-act="plan-meal-save">Save to My plan</);
  assert.ok(ed.includes('Default stays as it is. Saving creates My plan with this change, and the app uses My plan from then on.'));
  assert.ok(ed.includes('Changes apply from now on. Meals you already logged keep their numbers.'));
  assert.match(ed, /data-act="plan-meal-delete"/);
  assert.match(ed, /<b>487<\/b> kcal/);
  assert.match(ed, /<option value="\+new">New food…<\/option>\s*<\/select>/);
  assert.equal((ed.match(/class="ing"/g) || []).length, 6);
  // A new meal: its title names the slot, Save waits for a name and an ingredient, no Delete
  core.startDraft(null, 'workout', 'U-n1');
  const nw = views.renderMealEditor();
  assert.match(nw, /<h2 id="sheet-title">New meal · Workout-day extras<\/h2>/);
  assert.match(nw, /placeholder="e.g. Chicken wrap"/);
  assert.match(nw, /data-act="plan-meal-save" disabled>/);
  assert.doesNotMatch(nw, /data-act="plan-meal-delete"/);
  // Typed values: a wrong one is marked, and at 12 ingredients the food picker is off
  Object.assign(S.draft.meal, { name: 'Wrap', ingredients: [['egg', '0'], ['bread', '45']] });
  const marked = views.renderMealEditor();
  assert.match(marked, /id="md-g-0"[^>]*aria-invalid="true"/);
  assert.doesNotMatch(marked, /id="md-g-1"[^>]*aria-invalid/);
  assert.match(marked, /data-act="plan-meal-save" disabled>/);
  S.draft.meal.ingredients = Array.from({ length: PLAN_CAPS.ingredients }, () => ['egg', '10']);
  const full = views.renderMealEditor();
  assert.match(full, /<select id="md-add" class="ing-add" aria-label="Add ingredient" disabled>/);
  assert.match(full, /data-act="plan-meal-save">Save to My plan</);
  // (b) My plan active: plain Save, no note
  S.plans = { active: MINE.id, list: [seedPlan, MINE] };
  S.plan = buildPlan(MINE);
  assert.match(views.renderPlan(), add);
  assert.ok(views.renderPlan().includes(sub)); // editable (My plan active): the edit hint
  assert.match(views.renderPlanSheet('U-oats'), edit);
  core.startDraft('U-oats');
  const mineEd = views.renderMealEditor();
  assert.match(mineEd, /data-act="plan-meal-save">Save</);
  assert.ok(!mineEd.includes('Default stays as it is.'));
  // + Add meal is gone at the meal cap
  S.plan = { ...S.plan, meals: Array.from({ length: PLAN_CAPS.meals }, (_, i) => ({ ...S.plan.meals[0], id: `U-${i}` })) };
  assert.doesNotMatch(views.renderPlan(), /plan-meal-add/);
  // (c) Default active while My plan exists: no Edit, no + Add
  S.plans = { active: 'default', list: [seedPlan, MINE] };
  S.plan = buildPlan(seedPlan);
  assert.doesNotMatch(views.renderPlan(), /plan-meal-add/);
  assert.doesNotMatch(views.renderPlanSheet('L-A'), edit);
  fixture();
});

test('meal editor in Turkish: its text, names and measures through td(), the stored English kept in data-orig', async () => {
  fixture();
  await setLang('tr');
  core.startDraft('L-A');
  const ed = views.renderMealEditor();
  assert.ok(ed.includes('value="Yumurta ve peynir tabağı" data-orig="Egg and cheese plate"'));
  assert.ok(ed.includes('value="2 yumurta" data-orig="2 eggs"'));
  assert.ok(ed.includes('>Haşlanmış yumurta</button>'));
  for (const s of ['Planım’a kaydet', 'Öğünü sil', 'Malzeme ekle', 'Yeni yiyecek…', 'Ölçü (isteğe bağlı)', 'Değişiklikler bundan sonrası için geçerli.', 'Varsayılan olduğu gibi kalır.']) assert.ok(ed.includes(s), s);
  core.startDraft(null, 'snack2', 'U-n1');
  assert.match(views.renderMealEditor(), /Yeni öğün · 2\. ara öğün/);
  S.tab = 'plan';
  assert.ok(views.renderPlan().includes('Görmek ya da değiştirmek için bir öğüne dokun.'));
  assert.ok(views.renderPlan().includes('Öğün ekle'));
  assert.ok(views.renderPlanSheet('L-A').includes('Öğünü düzenle'));
  fixture();
});

test('food form: a food of the meal with "Used in", a new food, the AI fill states and the no-key link', () => {
  fixture();
  Object.assign(S.settings, { provider: 'anthropic', apiKey: 'k' });
  core.startDraft('L-A');
  core.startFood('egg');
  const ed = views.renderFoodForm();
  assert.match(ed, /<h2 id="sheet-title">Boiled egg<\/h2>/);
  assert.ok(ed.includes('value="Boiled egg" data-orig="Boiled egg"'));
  assert.ok(ed.includes('Used in 4 meals. Changes apply to all of them.'));
  assert.match(ed, /id="fd-v-1" type="text" inputmode="decimal" autocomplete="off" value="12.6"/);
  assert.match(ed, /data-act="plan-food-ai">Fill in with AI</);
  assert.match(ed, /data-act="plan-food-done">Done</);
  // Used once: the singular; a value out of range is marked and turns Done off
  S.draft.plan.meals = S.draft.plan.meals.filter((m) => m.id === 'L-A');
  S.draft.foodForm.v[0] = '1200';
  const one = views.renderFoodForm();
  assert.ok(one.includes('Used in 1 meal. Changes apply to it.'));
  assert.match(one, /id="fd-v-0"[^>]*aria-invalid="true"/);
  assert.doesNotMatch(one, /id="fd-v-1"[^>]*aria-invalid/);
  assert.match(one, /data-act="plan-food-done" disabled>/);
  // While the AI reads: spinner and Reading…, fields and Done off, Back on
  Object.assign(S.draft.foodForm, { v: [143, 12.6, 0.7, 9.5, 0], busy: true });
  const busy = views.renderFoodForm();
  assert.match(busy, /data-act="plan-food-ai" disabled><span class="spin" aria-hidden="true"><\/span>Reading…</);
  assert.match(busy, /id="fd-name"[^>]*disabled>/);
  assert.equal((busy.match(/id="fd-v-\d"[^>]*disabled>/g) || []).length, 5);
  assert.match(busy, /data-act="plan-food-done" disabled>/);
  assert.match(busy, /data-act="plan-food-back">Back</);
  // The result and a failure
  Object.assign(S.draft.foodForm, { busy: false, note: 'Filled in by AI. Check the values.' });
  assert.match(views.renderFoodForm(), /<p class="note" role="status">Filled in by AI\. Check the values\.<\/p>/);
  S.draft.foodForm.err = 'Couldn’t read values. Try the nutrition label, or type them.';
  assert.match(views.renderFoodForm(), /role="alert">Couldn’t read values/);
  // A new food: no "Used in", the AI button waits for a name or a photo
  core.startFood('unew1');
  const nw = views.renderFoodForm();
  assert.match(nw, /<h2 id="sheet-title">New food<\/h2>/);
  assert.ok(!nw.includes('Used in'));
  assert.match(nw, /data-act="plan-food-ai" disabled>/);
  assert.match(nw, /data-act="plan-food-done" disabled>/);
  S.draft.foodForm.photos = [{ url: 'blob:x' }];
  assert.match(views.renderFoodForm(), /data-act="plan-food-ai">/);
  assert.match(views.renderFoodForm(), /aria-label="Change the photo"><img src="blob:x" alt=""><\/button>/);
  // No key: the square and the button give way to the link to Settings → Photo and text analysis
  S.settings.apiKey = '';
  const nokey = views.renderFoodForm();
  assert.doesNotMatch(nokey, /plan-food-photo|plan-food-ai/);
  assert.match(nokey, /<p>Add an API key to fill this in from a photo\.<\/p><button type="button" class="link" data-act="settings" data-sec="analysis">Add key<\/button>/);
  // The editor's "New food…" option is gone at the foods cap
  S.draft.meal.ingredients = [];
  S.draft.plan.foods = Object.fromEntries(Array.from({ length: 300 }, (_, i) => [`f${i}`, { name: `F${i}`, v: [1, 1, 1, 1, 1] }]));
  assert.ok(!views.renderMealEditor().includes('value="+new"'));
  fixture();
});

test('food form in Turkish: its text, the name through td() with the stored English kept, decimals with a comma', async () => {
  fixture();
  await setLang('tr');
  Object.assign(S.settings, { provider: 'anthropic', apiKey: 'k' });
  core.startDraft('L-A');
  core.startFood('egg');
  const ed = views.renderFoodForm();
  assert.ok(ed.includes('value="Haşlanmış yumurta" data-orig="Boiled egg"'));
  assert.ok(ed.includes('value="12,6"'));
  for (const s of ['Geri', 'Yapay zekâyla doldur', 'Kullanıldığı öğün sayısı: 4. Değişiklikler her birine uygulanır.', '100 g için değerler', 'Karbonhidrat (g)', 'Yağ (g)', 'Lif (g)', 'Tamam', 'Etiketin ya da yiyeceğin fotoğrafını ekle', 'En iyi sonucu besin değeri tablosunun fotoğrafı verir.']) assert.ok(ed.includes(s), s);
  S.draft.foodForm.busy = true;
  assert.ok(views.renderFoodForm().includes('Okunuyor…'));
  core.startFood('unew1');
  S.settings.apiKey = '';
  const nokey = views.renderFoodForm();
  for (const s of ['Yeni yiyecek<', 'Bunu bir fotoğraftan doldurmak için bir API anahtarı ekle.', 'Anahtar ekle']) assert.ok(nokey.includes(s), s);
  for (const s of ['Filled in by AI. Check the values.', 'Couldn’t read values. Try the nutrition label, or type them.', 'Filling in the values failed. {detail}']) assert.ok(tr[s], s);
  fixture();
});

test('Today: the coach line lowercases the late meal with the locale (Turkish I and İ), the default text unchanged', async () => {
  const { buildPlan } = await import('../js/plan.js');
  const { default: seedPlan } = await import('../js/default-plan.js');
  const line = async (lang, name) => {
    fixture();
    S.plan = buildPlan(seedPlan);
    S.plan.meals = S.plan.meals.filter((m) => m.slot === 'late').slice(0, 1);
    S.plan.meals[0].name = name;
    S.entries = [meal(TODAY, 8, 'breakfast', 'Oats', 300, 10)]; // no main slot is open and something is logged: the late meal is the suggestion
    S.settings.protein = 500;
    S.settings.startDate = day(-1);
    S.days[TODAY] = { day: TODAY };
    await setLang(lang);
    const html = views.renderToday();
    const m = html.match(/<p class="coach-line">(?:<b>[^<]*<\/b>)?[^<]*/);
    return m && m[0];
  };
  const en = await line('en', 'Işık yoghurt');
  assert.match(en, /g of işık yoghurt closes/); // English lowercases I to i
  const tr1 = await line('tr', 'Işık yoğurt');
  assert.ok(tr1.includes('ışık yoğurt'), tr1);
  const tr2 = await line('tr', 'İçli köfte');
  assert.ok(tr2.includes('içli köfte'), tr2);
});

test('Plan: the subtitle follows canEditPlan, not hasMyPlan', async () => {
  const src = readFileSync(new URL('../js/views.js', import.meta.url), 'utf8');
  assert.match(src, /!canEditPlan\(\) \? t\('Tap a meal for its ingredients, and to add a photo of your own plate\.'\) : t\('Tap a meal to see or change it\.'\)/);
});

test('Progress: the review card is absent before day 7', () => {
  fixture();
  S.tab = 'progress';
  S.settings.startDate = day(-6);
  assert.equal(views.renderProgress().includes('progress-ai'), false);
  S.settings.startDate = day(-7);
  assert.equal(views.renderProgress().includes('progress-ai'), true);
});

test('Progress: the collapsed review line stays within 60 characters in Turkish, for the longest label and date', async () => {
  fixture();
  S.tab = 'progress';
  await setLang('tr');
  let longest = 0;
  for (const rating of ['great', 'on-track', 'a-bit-behind', 'stuck', 'too-early']) {
    for (let m = 0; m < 12; m++) {
      for (const d of [1, 28]) {
        S.progressReview = { ...S.progressReview, rating, ts: Date.UTC(2026, m, d, 12) };
        const sum = views.renderProgress().match(/<details class="review-ai progress-ai"[^>]*>\s*<summary>([\s\S]*?)<\/summary>/)[1];
        longest = Math.max(longest, sum.replace(/<[^>]*>/g, '').length);
      }
    }
  }
  assert.ok(longest > 30 && longest <= 60, `longest ${longest}`);
});

test('Progress: model-written words with markup are escaped in the review card', () => {
  fixture();
  S.tab = 'progress';
  S.progressReview = { ...S.progressReview, head: '<b>bold</b>', adjust: '<img src=x onerror=alert(1)>' };
  S.reviewOpen.set('progress', true);
  const html = views.renderProgress();
  assert.doesNotMatch(html, /<b>bold|<img src=x/); // nothing from the model renders as markup
  assert.match(html, /<p><b>&lt;b&gt;bold&lt;\/b&gt;<\/b><\/p>/);
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
});

test('Progress: a rating-less review shows no tag, and the disclosure counts characters up, not down', () => {
  fixture();
  S.tab = 'progress';
  const rec = S.progressReview;
  S.progressReview = { ...rec, rating: '' };
  let sum = views.renderProgress().match(/<details class="review-ai progress-ai"[^>]*>\s*<summary>([\s\S]*?)<\/summary>/)[1];
  assert.match(sum, /^How has it gone so far\?$/); // no hint of today next to a rating-less old review
  S.progressReview = null;
  const html = views.renderProgress();
  const n = Number(html.match(/This sends about (\d+) thousand characters/)[1]);
  assert.equal(n, Math.ceil(progressBrief().length / 1000)); // ceil never understates the disclosure
});
