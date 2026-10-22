// The pantry match of the Check page: pantryNames in js/views.js, exported for these tests, and the note it
// renders inside the verdict. `node --test` with the core as plain imports, like test/views-items.test.mjs:
// nothing here needs the DOM.
process.env.TZ = 'UTC';
import { test } from 'node:test';
import assert from 'node:assert/strict';
const core = await import('../js/core.js');
const views = await import('../js/views.js');
const { default: seedPlan } = await import('../js/default-plan.js');
const { buildPlan } = await import('../js/plan.js');
const { S, freshSettings } = core;

S.tab = 'check';
S.sheet = null;
S.settings = freshSettings();
S.plans = { active: 'default', list: [seedPlan] };
S.plan = buildPlan(seedPlan);
S.entries = [];
S.days = {};
S.checks = [];
S.check = { openId: 'c1', photos: [], busy: false, note: '', err: '', status: '' };

let n = 0;
const food = (name, extra = {}) => ({ id: `pf${++n}`, name, v: [59, 10.5, 4, 0.5, 0], ...extra });
const withFoods = (foods, run) => {
  const saved = S.foods;
  S.foods = foods;
  try { return run(); } finally { S.foods = saved; }
};
const options = (...names) => names.map((name, i) => ({ name, rating: 4, fit: i === 0 ? 'good' : 'ok', portion: '250 ml', kcal: 90, p: 2, c: 13, f: 3, fib: 1.6 }));

test('pantryNames: a ≥ 4-character containment in either direction echoes the stored name verbatim', () => {
  // the option's folded name sits inside the stored one; the stored one sits inside the option's ("yogurt" after the fold)
  const oat = food('Oat drink, vanilla flavour');
  const yog = food('Yoğurt');
  const out = withFoods([oat, yog], () => views.pantryNames(options('Oat drink', 'Greek yogurt drink')));
  assert.deepEqual(out, ['Oat drink, vanilla flavour', 'Yoğurt']); // the names as they are stored, verbatim
});

test('pantryNames: options that name nothing stored, and an empty, junk or missing pantry, match nobody', () => {
  assert.deepEqual(withFoods([food('Eker Skyr natural')], () => views.pantryNames(options('Rice pudding', 'Hummus'))), []);
  assert.deepEqual(withFoods([], () => views.pantryNames(options('Eker Skyr natural'))), []);
  assert.deepEqual(withFoods(undefined, () => views.pantryNames(options('Eker Skyr natural'))), []);
  assert.deepEqual(withFoods([food('Eker Skyr natural')], () => views.pantryNames()), []);
});

test('pantryNames: a 1–3 character name never matches, however well it sits inside an option', () => {
  const short = food('Fig');
  const long = food('Banana bread mix');
  assert.deepEqual(withFoods([short, long], () => views.pantryNames(options('Fig butter', 'Banana'))), [long.name]);
});

test('pantryNames: two stored names that fold together are named once, the first stored copy', () => {
  const a = food('Oat Drink');
  const b = food('Oat drink with vanilla');
  const c = food('Oat DRINK');
  assert.deepEqual(withFoods([a, b, c], () => views.pantryNames(options('oat drink barista'))), [a.name]);
});

// ——— The rendered verdict: the note only when a match has a name to show ———
const rec = { id: 'c1', ts: Date.now(), kind: 'product', title: 'Hummus', answer: 'Fine.', note: '', photos: 1, model: 'm', options: options('Hummus dip') };
const check = (foods) => withFoods(foods, () => views.renderCheck());
const NOTE = 'From your pantry:';

test('the verdict shows nothing of the pantry without a match', () => {
  S.checks = [rec];
  S.check.openId = 'c1';
  const html = check([food('Eker Skyr natural')]);
  assert.ok(html.includes('<section class="verdict"'), 'the verdict itself renders (the harness reaches checkResult)');
  assert.ok(!html.includes(NOTE), 'an option that names nothing stored stays quiet');
  assert.ok(!check([]).includes(NOTE));
});

test('the verdict names the matched product in the note, with a link into the Pantry', () => {
  S.checks = [rec];
  S.check.openId = 'c1';
  const html = check([food('Eker Skyr natural'), food('Hummus dip with olive oil')]);
  assert.ok(html.includes(`${NOTE} Hummus dip with olive oil`));
  assert.ok(html.includes('data-act="settings" data-sec="foods"'));
});
