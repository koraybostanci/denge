// The data and logic layer of the language work: what the model reads stays English, generated titles (tk), typed Turkish keywords. `node --test`
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import tr from '../js/tr.js';
import { setLang, getLang, inEnglish } from '../js/i18n.js';
import {
  S, today, dayVerdict, verdictText, dayNotes, dayReasons, dayGoals, budgetVerdict, VERDICT, WEEK_TIERS, titleOf, titleFor, TK_KINDS, parseLocal, parseCount, fmtInt,
} from '../js/core.js';
import { addDays, planDigest, planFoods, RULES, buildPlan } from '../js/plan.js';
import seedPlan from '../js/default-plan.js';
import { reviewBrief, coachBrief, checkBrief } from '../js/briefs.js';
import { AI_ERRORS, AI_ERROR_LABEL } from '../js/ai.js';
import { cleanEntry } from '../js/backup.js';
import { buildSql } from '../js/export.js';

const ORIGINAL_TR = { ...tr };
const added = [];
const addTr = (k, v) => { tr[k] = v; added.push(k); };
afterEach(async () => {
  added.length = 0;
  for (const k of Object.keys(tr)) delete tr[k];
  Object.assign(tr, ORIGINAL_TR); // the tests add and replace entries; the table goes back to what tr.js holds
  await setLang('en');
});

S.plan = buildPlan(seedPlan);
const T = today();
const day = (off) => addDays(T, off);
const meal = (d, kcal, p, extra = {}) => S.entries.push({ id: `e${S.entries.length}`, day: d, ts: Date.now(), kind: 'meal', status: 'ok', slot: 'lunch', title: 'Egg', kcal, p, c: 0, f: 0, fib: 0, mult: 1, tier: 'plan', ...extra });
const setup = () => {
  S.entries = [];
  S.days = {};
  Object.assign(S.settings, { startDate: day(-40), startKg: 86.4, targetDate: day(60), targetKg: 78, kcalRest: 1550, kcalTrain: 1750, protein: 135, proteinMin: 120 });
  meal(day(-1), 2000, 90, { tier: 'off', title: '8,200 steps', tk: { kind: 'steps', params: { steps: 8200 } } });
  S.days[day(-1)] = { day: day(-1), kg: 83.2, steps: 8200 };
};
// Entries for Turkish strings that would show up in the briefs if they were not forced to English
const leakTr = () => {
  for (const k of ['In progress', 'A little above', 'A bigger day', 'Lunch', 'Dinner', 'Protein {gap} g short of your minimum.', '{n} off-plan entry.|{n} off-plan entries.',
    '{kcal} kcal above budget: about {kg} kg, {pct}% of what the day was meant to lose. One day does not change the trend.',
    '{kcal} kcal above budget: about {kg} kg, {days} days of the schedule. One day does not change the trend.',
    '{kcal} kcal above budget: about {kg} kg. One day does not change the trend.', '{kcal} kcal left for today.', '{kcal} kcal above budget. One day does not change the trend.',
    'Monday', 'Chicken and oven vegetables', 'Boiled egg', 'One flexible dinner (eating out or off plan), around 700 kcal.']) addTr(k, `TR[${k}]`);
};

test('the briefs and the plan digest are byte-identical in Turkish and English', async () => {
  setup();
  const before = { review: reviewBrief(day(-1)), coach: coachBrief(day(-1)), check: checkBrief('a note'), digest: planDigest(S.plan), foods: planFoods(S.plan), weekly: RULES.weekly.join(' ') };
  assert.match(before.review, /App verdict: /);
  assert.match(before.review, /kcal above budget/);
  leakTr();
  await setLang('tr');
  // Without the English path the Turkish would show up: this proves the test can fail
  assert.match(verdictText(dayVerdict(day(-1))).join(' '), /TR\[/);
  assert.match(RULES.weekly.join(' '), /TR\[/); // the rules text is translated for the screen ...
  assert.equal(inEnglish(() => RULES.weekly.join(' ')), before.weekly); // ... and English for a prompt
  assert.equal(reviewBrief(day(-1)), before.review);
  assert.equal(coachBrief(day(-1)), before.coach);
  assert.equal(checkBrief('a note'), before.check);
  assert.equal(planDigest(S.plan), before.digest);
  assert.equal(planFoods(S.plan), before.foods);
  assert.equal(getLang(), 'tr'); // and the language is back after the English call
  assert.equal(fmtInt(8200), (8200).toLocaleString('tr-TR'));
  assert.doesNotMatch(reviewBrief(day(-1)), /TR\[/);
});

test('verdict and note text are whole sentences that a Turkish entry can replace', async () => {
  setup();
  const v = dayVerdict(day(-1));
  const en = verdictText(v);
  assert.equal(dayNotes(day(-1)).length, 2);
  assert.deepEqual(dayNotes(day(-1)).slice(-1), ['1 off-plan entry']);
  assert.equal(dayReasons(day(-1))[0], `${fmtInt(450)} kcal above the budget`);
  assert.equal(dayGoals(day(-1))[0].name, 'Weigh-in');
  assert.match(en.at(-1), /^1 off-plan entry\.$/);
  await setLang('tr');
  addTr('{n} off-plan entry.|{n} off-plan entries.', '{n} plan dışı kayıt.');
  addTr('Weigh-in', 'Tartı');
  addTr('Ended {n} above', '{n} üstünde bitti');
  assert.equal(verdictText(v).at(-1), '1 plan dışı kayıt.');
  assert.equal(dayGoals(day(-1))[0].name, 'Tartı');
  assert.equal(budgetVerdict({ target: 1500, eaten: 1000, planned: null }).text, `Bütçenin ${fmtInt(500)} altında bitti`); // the entry that was not replaced is the one tr.js holds
  assert.equal(budgetVerdict({ target: 1500, eaten: 1800, planned: null }).text, `${fmtInt(300)} üstünde bitti`);
  assert.equal(VERDICT.on, 'In line'); // tables hold the English; the screen translates with td()
  assert.equal(WEEK_TIERS[0].title, 'Strong week');
});

test('generated titles: the English title stays, titleOf translates from tk', async () => {
  const w = titleFor('weight', { kg: 82.5 });
  assert.deepEqual(w, { title: 'Weight 82.5 kg', tk: { kind: 'weight', params: { kg: 82.5 } } });
  assert.equal(titleFor('steps', { steps: 8200 }).title, '8,200 steps'); // English formats whatever the language is
  assert.equal(titleFor('photo', {}).title, 'Photo');
  assert.equal(titleFor('plan', { id: 'L-A' }).title, 'Egg and cheese plate');
  assert.equal(titleFor('plan', { id: 'F-BEER50' }).title, 'Beer 0.5 l');
  assert.deepEqual(TK_KINDS, ['weight', 'steps', 'photo', 'plan']);
  const steps = { title: '8,200 steps', tk: { kind: 'steps', params: { steps: 8200 } } };
  assert.equal(titleOf(steps), '8,200 steps');
  assert.equal(titleOf({ title: 'Oats' }), 'Oats'); // older entries and typed ones
  assert.equal(titleOf({ title: 'Egg and cheese plate', planId: 'L-A' }), 'Egg and cheese plate'); // an older plan entry without tk, in English
  assert.equal(titleOf({ title: 'My own name', planId: 'L-A' }), 'My own name'); // renamed by the person: kept
  assert.equal(titleOf({ title: 'X', tk: { kind: 'nope', params: {} } }), 'X');
  assert.equal(titleOf({ title: 'X', tk: { kind: 'plan', params: { id: 'gone' } } }), 'X');
  for (const tk of [{ kind: 'steps', params: {} }, { kind: 'steps', params: { id: 'x' } }, { kind: 'weight', params: { kg: 'abc' } }, { kind: 'weight', params: { kg: -5 } }, { kind: 'plan', params: { id: 5 } }]) assert.equal(titleOf({ title: 'Kept', tk }), 'Kept');
  await setLang('tr');
  addTr('{steps} steps', '{steps} adım');
  addTr('Weight {kg} kg', 'Kilo {kg} kg');
  addTr('Egg and cheese plate', 'Yumurta ve peynir tabağı');
  assert.equal(titleOf(steps), `${(8200).toLocaleString('tr-TR')} adım`);
  assert.equal(titleOf(w), 'Kilo 82,5 kg');
  assert.equal(titleOf({ title: 'Egg and cheese plate', tk: { kind: 'plan', params: { id: 'L-A' } } }), 'Yumurta ve peynir tabağı');
  assert.equal(titleOf({ title: 'Egg and cheese plate', planId: 'L-A' }), 'Yumurta ve peynir tabağı'); // older entry without tk
  assert.equal(titleOf({ title: 'My own name', planId: 'L-A' }), 'My own name');
  assert.equal(titleFor('steps', { steps: 8200 }).title, '8,200 steps'); // the stored title is English in any language
});

test('backup: tk is kept when valid, dropped when not, and old entries still import', () => {
  const base = { id: 'abc123', ts: 1759300000000, day: '2026-10-01', kind: 'steps', status: 'ok', title: '8,200 steps', steps: 8200 };
  const tk = { kind: 'steps', params: { steps: 8200 } };
  assert.deepEqual(cleanEntry({ ...base, tk }).tk, tk);
  assert.equal('tk' in cleanEntry(base), false); // an older backup
  const meal = cleanEntry({ ...base, kind: 'meal', tk: { kind: 'plan', params: { id: 'L-A' } } });
  assert.deepEqual(meal.tk, { kind: 'plan', params: { id: 'L-A' } });
  const bad = [
    null, 5, 'steps', [], {}, { kind: 'steps' }, { kind: 'evil', params: {} }, { kind: 'steps', params: [] }, { kind: 'steps', params: null },
    { kind: 'steps', params: { steps: NaN } }, { kind: 'steps', params: { steps: Infinity } }, { kind: 'steps', params: { steps: 1e12 } },
    { kind: 'steps', params: { steps: {} } }, { kind: 'steps', params: { other: 1 } }, { kind: 'plan', params: { id: 'x'.repeat(41) } },
    { kind: 'steps', params: {} }, { kind: 'steps', params: { id: 'x' } }, { kind: 'weight', params: { kg: 'abc' } }, { kind: 'weight', params: { kg: -5 } }, { kind: 'weight', params: { kg: 19 } },
    { kind: 'steps', params: { steps: -1 } }, { kind: 'plan', params: { id: 5 } },
    JSON.parse('{"kind":"steps","params":{"__proto__":1}}'), { kind: 'constructor', params: {} },
  ];
  for (const b of bad) {
    const c = cleanEntry({ ...base, tk: b });
    assert.ok(c, JSON.stringify(b)); // the entry is kept
    assert.equal('tk' in c, false, JSON.stringify(b));
    assert.equal(c.title, '8,200 steps');
  }
  // A round trip through JSON keeps it as is
  const e = { ...base, ...titleFor('steps', { steps: 8200 }) };
  assert.deepEqual(cleanEntry(JSON.parse(JSON.stringify(e))).tk, e.tk);
});

test('the SQL export uses the English title and ignores tk', () => {
  const e = { id: 'm1', ts: Date.UTC(2026, 9, 1, 12), day: '2026-10-01', kind: 'meal', status: 'ok', src: 'plan', slot: 'lunch', planId: 'L-A', title: 'Egg and cheese plate', kcal: 500, p: 30, c: 5, f: 20, fib: 2, mult: 1, tier: 'plan', flags: [], items: [], photoIds: [] };
  const run = (x) => buildSql({ settings: S.settings, entries: [x], days: [], appVersion: 't', now: new Date(0) }).sql;
  const withTk = run({ ...e, tk: { kind: 'plan', params: { id: 'L-A' } } });
  assert.equal(withTk, run(e));
  assert.match(withTk, /Egg and cheese plate/);
  assert.doesNotMatch(withTk, /"kind"/);
});

test('typed entries: English as before', () => {
  S.entries = [];
  S.settings.favorites = [];
  assert.deepEqual(parseLocal('82.5'), { type: 'weight', kg: 82.5 });
  assert.deepEqual(parseLocal('weight 82,5 kg'), { type: 'weight', kg: 82.5 });
  assert.deepEqual(parseLocal('kg 82'), { type: 'weight', kg: 82 });
  assert.equal(parseLocal('30'), null);
  assert.deepEqual(parseLocal('8,200 steps'), { type: 'steps', steps: 8200 });
  assert.deepEqual(parseLocal('8200 step'), { type: 'steps', steps: 8200 });
  assert.deepEqual(parseLocal('water 2'), { type: 'water', ml: 500 });
  assert.deepEqual(parseLocal('water 500'), { type: 'water', ml: 500 });
  assert.deepEqual(parseLocal('Water 1.5 l'), { type: 'water', ml: 1500 });
  assert.deepEqual(parseLocal('water 2 glasses'), { type: 'water', ml: 500 });
  assert.deepEqual(parseLocal('water 0,5 litre'), { type: 'water', ml: 500 });
  for (const w of ['workout', 'Training', 'gym done', 'kettlebell day', 'spinning']) assert.deepEqual(parseLocal(w), { type: 'train' }, w);
  assert.equal(parseLocal('workout tomorrow'), null);
  assert.equal(parseLocal('Egg and cheese plate').meal.id, 'L-A');
  assert.equal(parseLocal('l-a').meal.id, 'L-A');
  assert.equal(parseLocal('beer 0.5 l').flex.id, 'F-BEER50');
  assert.deepEqual(parseLocal('2 coffees'), { type: 'count', key: 'coffee', n: 2 });
  assert.equal(parseLocal('a plate of pasta'), null);
});

test('typed entries: the plan and extra names shown in Turkish are found, and the English still are', async () => {
  S.entries = [];
  S.settings.favorites = [];
  await setLang('tr');
  assert.equal(parseLocal('Yumurta ve peynir tabağı').meal.id, 'L-A');
  assert.equal(parseLocal('yumurta ve peynir tabagi').meal.id, 'L-A');
  assert.equal(parseLocal('Bira 0,5 l').flex.id, 'F-BEER50');
  assert.equal(parseLocal('Egg and cheese plate').meal.id, 'L-A');
  assert.equal(parseLocal('beer 0.5 l').flex.id, 'F-BEER50');
  await setLang('en');
  assert.equal(parseLocal('Yumurta ve peynir tabağı'), null); // the Turkish name is not a plan name while the screen is English
});

test('typed entries: Turkish words work in either interface language', async () => {
  S.entries = [];
  S.settings.favorites = [{ id: 'f1', name: 'Çorba', kcal: 100, p: 5, c: 10, f: 2, fib: 1 }];
  const check = () => {
    assert.deepEqual(parseLocal('2 bardak su'), { type: 'water', ml: 500 });
    assert.deepEqual(parseLocal('su 2 bardak'), { type: 'water', ml: 500 });
    assert.deepEqual(parseLocal('1,5 litre su'), { type: 'water', ml: 1500 });
    assert.deepEqual(parseLocal('500 ml su'), { type: 'water', ml: 500 });
    assert.deepEqual(parseLocal('8200 adim'), { type: 'steps', steps: 8200 });
    assert.deepEqual(parseLocal('8.200 adım'), { type: 'steps', steps: 8200 });
    assert.deepEqual(parseLocal('8,200 adım'), { type: 'steps', steps: 8200 });
    assert.deepEqual(parseLocal('ADIM'), null);
    assert.deepEqual(parseLocal('8200 ADIM'), { type: 'steps', steps: 8200 });
    assert.deepEqual(parseLocal('8200 ADİM'), { type: 'steps', steps: 8200 });
    assert.deepEqual(parseLocal('antrenman yaptım'), { type: 'train' });
    assert.deepEqual(parseLocal('Antrenman'), { type: 'train' });
    assert.deepEqual(parseLocal('SPOR'), { type: 'train' });
    assert.deepEqual(parseLocal('spor günü'), { type: 'train' });
    assert.deepEqual(parseLocal('kilo 82,5'), { type: 'weight', kg: 82.5 });
    assert.deepEqual(parseLocal('82,5 kilo'), { type: 'weight', kg: 82.5 });
    assert.deepEqual(parseLocal('bir kahve'), { type: 'count', key: 'coffee', n: 1 });
    assert.equal(parseLocal('kahves'), null);
    assert.deepEqual(parseLocal('KAHVE'), { type: 'count', key: 'coffee', n: 1 });
    assert.deepEqual(parseLocal('2 kahve'), { type: 'count', key: 'coffee', n: 2 });
    assert.deepEqual(parseLocal('bira 3'), { type: 'count', key: 'beer', n: 3 });
    assert.deepEqual(parseLocal('BİRA'), { type: 'count', key: 'beer', n: 1 });
    assert.equal(parseLocal('çorba').favorite.id, 'f1'); // folded on both sides
    assert.equal(parseLocal('2 bardak'), null);
    assert.equal(parseLocal('antrenman yarın'), null);
  };
  check(); // an English interface
  await setLang('tr');
  check();
  assert.deepEqual(parseCount('Kahve'), { key: 'coffee', n: 1 });
  assert.equal(parseCount('bira 0.5'), null);
});

test('AI error labels are the first sentence in lower case, as the code made them before', () => {
  assert.deepEqual(Object.keys(AI_ERROR_LABEL), Object.keys(AI_ERRORS));
  for (const k of Object.keys(AI_ERRORS)) assert.equal(AI_ERROR_LABEL[k], AI_ERRORS[k].split('.')[0].toLowerCase(), k);
  assert.equal(AI_ERRORS.no_key, 'No API key. Add one in Settings.');
});

test('plan tables keep stable English ids and names', () => {
  assert.equal(S.plan.meals[0].id, 'L-A');
  assert.equal(S.plan.meals[0].name, 'Egg and cheese plate');
  assert.equal(S.plan.meals[0].items[0].n, 'Boiled egg');
  assert.equal(S.plan.meals[0].items[0].measure, '2 eggs');
  assert.equal(RULES.daily[1], '8,000 steps a day. With a desk job this is the cheapest part of the deficit.');
  assert.equal(RULES.rotation[0][0], 'Monday');
});
