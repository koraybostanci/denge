// The calculations in js/core.js: no DOM, no storage, so they run as they are. `node --test`
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  S, BAND, proteinFloor, proteinLevel, dayTarget, weekResult, dayStatus, dayReasons, dayNotes, dayGoals, dayVerdict, latestWeight, avg7, kilosDown, projection, openSlots, suggest, planRate,
  fmtKg, freshSettings, freshCheck, today, SCHEMA_VERSION, VERDICT, verdictText, chartWindow,
  isPerfect, streak, suppTaken, weekStart, parseCount, drinkTally, planSteps, plannedBy, budgetVerdict, budgetMeter, kcalMinDay, reviewSig, reviewState,
  parseLocal, mealById, titleFor, releasePhotos, mealTimesLine, mainSlots,
  progressSig, progressRatingHint, progressGate, progressState, getProgressGen, bumpProgressGen, resetProgressGen,
} from '../js/core.js';
import { checkBrief } from '../js/briefs.js';
import { addDays, diffDays, hhmm, targetAt, planDigest, planFoods, buildPlan, DEFAULTS, KCAL_MIN_DAY } from '../js/plan.js';
import seedPlan from '../js/default-plan.js';
import { readFileSync, readdirSync } from 'node:fs';

const SEED = buildPlan(seedPlan);
S.plan = SEED;
const T = today();
const day = (off) => addDays(T, off);
const reset = () => {
  S.entries = [];
  S.days = {};
  Object.assign(S.settings, { startDate: day(-40), startKg: 86.4, targetDate: day(60), targetKg: 78, kcalRest: 1550, kcalTrain: 1750, protein: 135, proteinMin: 120 });
};
const meal = (d, kcal, p, extra = {}) => S.entries.push({ id: `e${S.entries.length}`, day: d, ts: Date.now(), kind: 'meal', status: 'ok', slot: 'lunch', kcal, p, c: 0, f: 0, fib: 0, mult: 1, tier: 'plan', ...extra });

test('calories decide the day: protein short at 119.6 g misses the protein goal and is noted, but the day is still on plan', () => {
  reset(); meal(day(-1), 1500, 119.6);
  const goal = dayGoals(day(-1)).find((g) => g.id === 'protein').done;
  assert.equal(goal, false);
  assert.equal(dayStatus(day(-1)), 'on');
  assert.equal(dayVerdict(day(-1)).level, 'on');
  assert.ok(dayVerdict(day(-1)).proteinGap > 0);
  assert.deepEqual(dayNotes(day(-1)), ['protein 1 g short of your minimum']);
  assert.deepEqual(dayReasons(day(-1)), []);
});
test('an off-plan entry does not take a day off plan while the calories are in budget', () => {
  reset(); meal(day(-1), 1500, 135, { tier: 'off' });
  assert.equal(dayStatus(day(-1)), 'on');
  assert.deepEqual(dayNotes(day(-1)), ['1 off-plan entry']);
});

test('a protein minimum above the target is capped at the target', () => {
  reset(); S.settings.proteinMin = 140;
  assert.equal(proteinFloor(), 135);
  meal(day(-1), 1500, 135);
  assert.equal(dayStatus(day(-1)), 'on');
});

test('calorie bands decide the verdict level', () => {
  reset(); meal(day(-1), 1550 * 1.16, 135);
  assert.equal(dayVerdict(day(-1)).level, 'back');
  assert.equal(dayStatus(day(-1)), 'far');
  S.entries = []; meal(day(-1), 1550 * 1.12, 135);
  assert.equal(dayVerdict(day(-1)).level, 'over');
  assert.equal(dayStatus(day(-1)), 'over');
  assert.ok(BAND.high < BAND.near);
});

test('a day counts from the minimum (default 1,500, a setting) up to 110% of its budget, on rest and workout days', () => {
  reset();
  const at = (kcal, train) => { S.entries = []; S.days[day(-1)] = train ? { day: day(-1), train: true } : undefined; meal(day(-1), kcal, 135); return dayStatus(day(-1)); };
  assert.equal(KCAL_MIN_DAY, 1500);
  assert.equal(DEFAULTS.kcalMinDay, KCAL_MIN_DAY);
  assert.equal(at(1499), 'under');
  assert.equal(at(1500), 'on');
  assert.equal(at(1550), 'on');
  assert.equal(at(1550 * 1.10), 'on');
  assert.equal(at(1550 * 1.10 + 1), 'over');
  assert.equal(at(1550 * 1.15), 'over');
  assert.equal(at(1550 * 1.15 + 1), 'far');
  assert.equal(at(1750 * 1.10, true), 'on'); // a workout day has its own budget
  assert.equal(at(1750 * 1.10 + 1, true), 'over');
  delete S.days[day(-1)];
});

test('changing the minimum re-judges days already logged, and a saved setting without it uses the default', () => {
  reset(); meal(day(-1), 1300, 135);
  assert.equal(dayStatus(day(-1)), 'under');
  S.settings.kcalMinDay = 1200;
  assert.equal(dayStatus(day(-1)), 'on');
  assert.deepEqual(dayReasons(day(-1)), []);
  S.settings.kcalMinDay = 1400;
  assert.deepEqual(dayReasons(day(-1)), ['100 kcal under the 1,400 minimum']);
  delete S.settings.kcalMinDay;
  assert.equal(kcalMinDay(), 1500);
});

test('a little over the budget still counts, with a note; under the minimum names the minimum', () => {
  reset(); meal(day(-1), 1600, 135);
  assert.equal(dayStatus(day(-1)), 'on');
  assert.deepEqual(dayReasons(day(-1)), []);
  assert.deepEqual(dayNotes(day(-1)), ['50 kcal above the budget, within the 10% margin']);
  S.entries = []; meal(day(-1), 1400, 135);
  assert.equal(dayStatus(day(-1)), 'under');
  assert.deepEqual(dayReasons(day(-1)), ['100 kcal under the 1,500 minimum']);
});

test('protein levels: target, minimum, nearly, short; they never change the day', () => {
  reset();
  const at = (p) => { S.entries = []; meal(day(-1), 1500, p); return [proteinLevel(day(-1)), dayStatus(day(-1))]; };
  assert.deepEqual(at(135), ['target', 'on']);
  assert.deepEqual(at(120), ['min', 'on']);
  assert.deepEqual(at(96), ['near', 'on']);
  assert.deepEqual(at(95), ['short', 'on']);
  S.entries = [];
  assert.equal(proteinLevel(day(-1)), 'none');
});

test('a week is only judged once its Sunday is over, by the days on plan', () => {
  reset();
  const ws = weekStart(day(-14)); // a week that is over
  for (let i = 0; i < 7; i++) meal(addDays(ws, i), i < 5 ? 1500 : 1900, i < 6 ? 130 : 80);
  const r = weekResult(ws);
  assert.equal(r.done, true); assert.equal(r.onPlan, 5); assert.equal(r.proteinDays, 6);
  assert.equal(r.tier.title, 'Steady week');
  const tier = (n) => { S.entries = []; for (let i = 0; i < 7; i++) meal(addDays(ws, i), i < n ? 1500 : 1900, 130); return weekResult(ws).tier.title; };
  assert.equal(tier(7), 'Strong week'); assert.equal(tier(6), 'Solid week'); assert.equal(tier(4), 'Rough patch'); assert.equal(tier(3), 'Rough patch');
  assert.equal(tier(2), 'Time to reset'); assert.equal(tier(0), 'Time to reset');
  const now = weekResult(weekStart(T));
  assert.equal(now.done, false); assert.equal(now.tier, null);
});

test('the verdict wording says budget and plan, never target', () => {
  reset();
  const texts = Object.values(VERDICT);
  for (const kcal of [1550 * 1.16, 1550 * 1.10, 1550 * 0.7, 1550]) {
    S.entries = []; meal(day(-1), kcal, 135);
    texts.push(...verdictText(dayVerdict(day(-1))));
  }
  assert.ok(texts.length > Object.keys(VERDICT).length);
  for (const t of texts) assert.doesNotMatch(t, /target/i);
});

test('a week without weighing keeps the last average, so progress does not reset', () => {
  reset();
  for (const o of [-20, -19, -18]) S.days[day(o)] = { day: day(o), kg: 84 };
  assert.equal(avg7(T), null);
  assert.equal(latestWeight(T).kg, 84);
  assert.equal(kilosDown(T), 2);
});

test('kilos down follow the latest weigh-in, not the average', () => {
  reset();
  for (const [o, kg] of [[-2, 86], [-1, 85], [0, 83.5]]) S.days[day(o)] = { day: day(o), kg };
  assert.equal(avg7(T).kg, (86 + 85 + 83.5) / 3);
  assert.equal(latestWeight(T).kg, 83.5);
  assert.equal(kilosDown(T), 2); // 86.4 kg start; the average, 84.8, would give 1
  assert.equal(latestWeight(day(-1)).kg, 85);
  assert.equal(latestWeight(day(-5)), null);
});

test('no weigh-in at all: no average, no kilos', () => {
  reset();
  assert.equal(latestWeight(T), null);
  assert.equal(kilosDown(T), 0);
});

test('the arrival date follows the fitted line (a steady 0.1 kg a day)', () => {
  reset(); S.settings.targetKg = 80;
  for (let i = 13; i >= 0; i--) S.days[day(-i)] = { day: day(-i), kg: Math.round((85 - 0.1 * (13 - i)) * 100) / 100 };
  assert.equal(projection().eta, day(37)); // 83.7 kg today, 3.7 kg to go
});

test('too few weigh-ins: no projection', () => {
  reset(); S.days[day(0)] = { day: day(0), kg: 85 };
  assert.equal(projection(), null);
});

test('the late snack is suggested only when every planned meal is logged', () => {
  reset();
  assert.deepEqual(openSlots(T).map((s) => s.id), ['lunch', 'snack1', 'snack2', 'dinner']);
  for (const slot of ['lunch', 'snack1', 'snack2', 'dinner']) meal(T, 100, 5, { slot });
  const s = suggest(T);
  assert.equal(s.extra, true);
  assert.equal(s.slot.id, 'late');
});

test('the late snack needs room for the plan\u2019s own late meal, not a fixed 90 kcal', () => {
  const left = (n) => { reset(); for (const slot of ['lunch', 'snack1', 'snack2', 'dinner']) meal(T, 0, 0, { slot }); meal(T, dayTarget(T) - n, 5, { slot: 'dinner' }); };
  try {
    left(90); assert.equal(suggest(T).extra, true); // Default's 95 kcal skyr, unchanged
    left(89); assert.ok(!suggest(T).extra);
    S.plan = buildPlan({ ...seedPlan, meals: [...seedPlan.meals.filter((m) => m.slot !== 'late'), { id: 'N-X', slot: 'late', name: 'Big shake', ingredients: [['skyr', 311]] }] });
    assert.equal(Math.round(S.plan.meals.find((m) => m.id === 'N-X').kcal), 196);
    left(190); assert.ok(!suggest(T).extra);
    left(191); assert.equal(suggest(T).extra, true);
  } finally { S.plan = SEED; }
});

test('weights never print as -0.0', () => {
  assert.equal(fmtKg(-0.028), '0.0');
  assert.equal(fmtKg(-0.4), '-0.4');
  assert.equal(fmtKg(85.44), '85.4');
});

test('hhmm takes a Date or a timestamp', () => {
  assert.equal(hhmm(new Date(2026, 0, 1, 7, 5)), '07:05');
  assert.equal(hhmm(new Date(2026, 0, 1, 7, 5).getTime()), '07:05');
});

test('a seed food renamed in My plan goes by its new name in the digest; one left as it is keeps its short name', () => {
  const plan = buildPlan({ ...seedPlan, foods: { ...seedPlan.foods, chicken: { name: 'Firm tofu', v: [120, 13, 2, 7, 1] } } });
  for (const text of [planDigest(plan), planFoods(plan)]) {
    assert.match(text, /Firm tofu/);
    assert.ok(!/chicken breast/.test(text));
    assert.match(text, /boiled potato/);
  }
  assert.match(planDigest(plan), /D-E: lentils 250g, Firm tofu 100g/);
});

test('a food added to the plan without a short name does not put "undefined" in the model digest', () => {
  const plan = buildPlan({ ...seedPlan, foods: { ...seedPlan.foods, testfood: { name: 'Test food', v: [1, 1, 1, 1, 1] }, constructor: { name: 'Odd key', v: [1, 1, 1, 1, 1] } },
    meals: [{ ...seedPlan.meals[0], ingredients: [...seedPlan.meals[0].ingredients, ['testfood', 10], ['constructor', 5]] }, ...seedPlan.meals.slice(1)] });
  for (const text of [planDigest(plan), planFoods(plan)]) {
    assert.ok(!/undefined|function/.test(text));
    assert.match(text, /Test food/); // its own name stands in for the short one
  }
  assert.ok(!/undefined/.test(planDigest(SEED)));
  assert.equal(planDigest(buildPlan({ id: 'x', name: '', foods: {}, meals: [] })), '');
});

test('buildPlan works out the macros from the food table and skips an ingredient whose food is missing', () => {
  const foods = { a: { name: 'A', v: [100, 10, 20, 5, 2] } };
  const plan = buildPlan({ id: 'p', name: 'P', foods, meals: [{ id: 'M-1', slot: 'lunch', name: 'M', ingredients: [['a', 150, '1 cup'], ['gone', 100], ['toString', 50]] }] });
  const m = plan.meals[0];
  assert.deepEqual([m.kcal, m.p, m.c, m.f, m.fib], [150, 15, 30, 7.5, 3]);
  assert.deepEqual(m.items, [{ n: 'A', g: 150, measure: '1 cup', kcal: 150, p: 15, c: 30, f: 7.5, fib: 3 }]);
  assert.deepEqual(m.ingredients, [['a', 150, '1 cup']]);
  assert.equal(SEED.meals.find((x) => x.id === 'L-A').kcal, 487); // the shipped plan's numbers are unchanged
});

test('typed text matches only the meals of the active plan', () => {
  assert.equal(parseLocal('Egg and cheese plate').meal.id, 'L-A');
  assert.equal(mealById('L-A').name, 'Egg and cheese plate');
  assert.equal(mealById('constructor'), undefined);
  S.plan = buildPlan({ id: 'mine', name: 'Mine', foods: seedPlan.foods, meals: [{ id: 'X-1', slot: 'lunch', name: 'Big salad', ingredients: [['salad', 400]] }] });
  try {
    assert.equal(parseLocal('Egg and cheese plate'), null);
    assert.equal(parseLocal('l-a'), null);
    assert.equal(mealById('L-A'), undefined);
    assert.equal(parseLocal('big salad').meal.id, 'X-1');
    assert.equal(parseLocal('x-1').meal.id, 'X-1');
  } finally { S.plan = SEED; }
});

test('a plan with an empty slot and no late meal: suggestions and the pace skip what the plan does not have', () => {
  reset();
  const meals = seedPlan.meals.filter((m) => m.slot !== 'snack2' && m.slot !== 'late');
  S.plan = buildPlan({ ...seedPlan, meals });
  try {
    assert.deepEqual(openSlots(T).map((s) => s.id), ['lunch', 'snack1', 'dinner']);
    const s = suggest(T);
    assert.equal(s.slot.id, 'lunch');
    assert.ok(Number.isFinite(s.rem) && s.meal);
    assert.deepEqual(planSteps(1550).map((x) => x.id), ['lunch', 'snack1', 'dinner']);
    assert.ok(Math.abs(planSteps(1550).reduce((a, x) => a + x.kcal, 0) - 1550) < 1e-6);
    for (const slot of ['lunch', 'snack1', 'dinner']) meal(T, 100, 5, { slot });
    const after = suggest(T); // every planned meal logged, protein short, and no late meal to offer
    assert.equal(after.meal, null);
    assert.ok(!after.extra);
    S.plan = buildPlan({ id: 'empty', name: '', foods: {}, meals: [] });
    reset();
    assert.deepEqual(openSlots(T), []);
    assert.deepEqual(planSteps(1550), []);
    assert.equal(plannedBy(1550, 20), 0);
    assert.equal(suggest(T).meal, null);
  } finally { S.plan = SEED; }
});

test('a plan with no main meals is not "done": no done state in suggest, no "all meals logged" in the brief; Default unchanged', () => {
  reset();
  try {
    for (const meals of [[], seedPlan.meals.filter((m) => m.slot === 'late')]) {
      S.plan = buildPlan({ ...seedPlan, meals });
      reset();
      assert.equal(suggest(T).noMain, true);
      assert.equal(mealTimesLine(), '');
      assert.ok(!/All meals/.test(checkBrief('')));
      meal(T, 100, 5, { slot: 'late' });
      assert.ok(!/All meals/.test(checkBrief('')));
    }
    S.plan = SEED;
    reset();
    assert.ok(!suggest(T).noMain);
    assert.equal(mealTimesLine(), mainSlots().map((x) => `${x.name.toLowerCase()} ${x.time}`).join(', '));
    assert.match(mealTimesLine(), /^lunch \S+, snack 1 \S+/);
    for (const slot of ['lunch', 'snack1', 'snack2', 'dinner']) meal(T, 100, 5, { slot });
    assert.match(checkBrief(''), /All meals of the day are logged\./);
  } finally { S.plan = SEED; }
});

test('a slot the plan has no meal for adds nothing to the reserve for the next meal', () => {
  reset();
  // A plan whose dinner slot is empty but whose lunch is: the reserve stays a number, so a fitting meal is found
  S.plan = buildPlan({ ...seedPlan, meals: seedPlan.meals.filter((m) => m.slot === 'lunch' || m.slot === 'snack1') });
  try {
    const s = suggest(T);
    assert.equal(s.slot.id, 'lunch');
    assert.equal(s.tight, false);
  } finally { S.plan = SEED; }
});

test('only js/app.js imports the shipped plan; everything else reads S.plan', () => {
  const dir = new URL('../js/', import.meta.url);
  const importers = readdirSync(dir).filter((f) => f.endsWith('.js') && /default-plan\.js['"]/.test(readFileSync(new URL(f, dir), 'utf8')));
  assert.deepEqual(importers, ['app.js']);
});

test('fresh settings are those of a new install, as new objects each time', () => {
  const a = freshSettings();
  const b = freshSettings();
  assert.equal(a.schema, SCHEMA_VERSION);
  assert.equal(a.apiKey, '');
  assert.equal(a.hideStart, false);
  assert.deepEqual(a.places, []);
  a.places.push({ name: 'x' }); a.favorites.push({ id: 'f' }); a.usage.calls = 9;
  assert.deepEqual([b.places, b.favorites, b.usage.calls], [[], [], 0]); // nothing shared between resets
  const c = freshCheck();
  c.photos.push(1);
  assert.deepEqual(freshCheck().photos, []);
});

test('the weight chart spans 7 or 14 days with its date ticks inside and in order; anything unknown is two weeks', () => {
  reset();
  for (const [range, days] of [['week', 6], ['weeks', 13], ['bogus', 13], [undefined, 13]]) {
    const w = chartWindow(range, T, S.settings, '');
    assert.equal(w.x1, T);
    assert.equal(diffDays(w.x0, w.x1), days);
    const ds = w.ticks.map(([d]) => d);
    assert.ok(ds.every((d) => d >= w.x0 && d <= w.x1));
    assert.deepEqual(ds, ds.slice().sort().filter((d, i, a) => d !== a[i - 1]));
    assert.equal(w.ticks[0][1], 'start');
    assert.equal(w.ticks[w.ticks.length - 1][1], 'end');
  }
  assert.deepEqual(chartWindow('week', T, S.settings, '').ticks.map(([d]) => diffDays(T, d)), [-6, -4, -2, 0]);
  assert.deepEqual(chartWindow('weeks', T, S.settings, '').ticks.map(([d]) => diffDays(T, d)), [-13, -6, 0]);
});

test('the whole-plan chart starts at the plan, or a little before it when weigh-ins came earlier', () => {
  reset();
  const s = S.settings;
  const w = (first) => chartWindow('whole', T, s, first);
  assert.equal(w('').x0, s.startDate);
  assert.equal(w(addDays(s.startDate, 3)).x0, s.startDate); // a weigh-in after the start changes nothing
  assert.equal(w(addDays(s.startDate, -10)).x0, addDays(s.startDate, -10));
  assert.equal(w(addDays(s.startDate, -30)).x0, addDays(s.startDate, -21));
  assert.equal(w('').x1, s.targetDate);
  assert.equal(w('').ticks, null);
});

test('"coffee", "a beer", "2 coffees" and "beer 3" are counts; a beer size, words after it or a second number are not', () => {
  assert.deepEqual(parseCount('coffee'), { key: 'coffee', n: 1 });
  assert.deepEqual(parseCount('a beer'), { key: 'beer', n: 1 });
  assert.deepEqual(parseCount('2 coffees'), { key: 'coffee', n: 2 });
  assert.deepEqual(parseCount('beer 3'), { key: 'beer', n: 3 });
  assert.deepEqual(parseCount('2 beers'), { key: 'beer', n: 2 });
  for (const t of ['beer 0.33 l', 'beer 0.5 l', 'coffee with milk', '2 coffee 3', '20 beers', '0 coffees']) assert.equal(parseCount(t), null, t);
});

test('coffee is counted for the day, its Monday-to-Sunday week and the week before', () => {
  reset();
  const W = weekStart(T);
  for (const [d, n] of [[W, 2], [addDays(W, 6), 1], [addDays(W, -1), 4], [addDays(W, -7), 1], [addDays(W, -8), 9]]) S.days[d] = { day: d, coffee: n };
  S.days[addDays(W, 1)] = { day: addDays(W, 1), water: 500 }; // no coffee field
  assert.deepEqual(drinkTally(W), { today: 2, week: 3, prev: 5 });
  assert.deepEqual(drinkTally(addDays(W, 1)), { today: 0, week: 3, prev: 5 });
  assert.deepEqual(drinkTally(addDays(W, -1)), { today: 4, week: 5, prev: 9 });
});

test('coffee and beer never touch the goals, the perfect day, the status or the open meals', () => {
  reset();
  const d = day(-1);
  S.days[d] = { day: d, kg: 85, steps: 9000, water: 3000 };
  meal(d, 1500, 135);
  const before = { perfect: isPerfect(d), status: dayStatus(d), open: openSlots(d).map((s) => s.id) };
  assert.equal(before.perfect, true);
  S.days[d].coffee = 6;
  assert.equal(dayGoals(d).length, 5);
  assert.equal(isPerfect(d), before.perfect);
  assert.equal(dayStatus(d), before.status);
  meal(d, 215, 2, { src: 'flex', tier: 'flex', slot: 'late', flags: ['alcohol'] });
  assert.equal(dayGoals(d).length, 5);
  assert.deepEqual(openSlots(d).map((s) => s.id), before.open); // a beer in the late slot closes no planned meal
});

test('the plan spends the budget over four meal times, from lunch at 12:00 to dinner at 18:00', () => {
  const steps = planSteps(1550);
  assert.deepEqual(steps.map((x) => x.at), [12, 14.5, 16, 18]);
  assert.ok(!steps.some((x) => x.id === 'late'));
  assert.ok(Math.abs(steps.reduce((a, x) => a + x.kcal, 0) - 1550) < 1e-6);
  assert.ok(Math.abs(planSteps(1750).reduce((a, x) => a + x.kcal, 0) - 1750) < 1e-6);
});

test('what the plan has spent by an hour starts at lunch, never falls and ends at the budget', () => {
  assert.equal(plannedBy(1550, 11.99), 0);
  assert.ok(Math.abs(plannedBy(1550, 12) - planSteps(1550)[0].kcal) < 1e-6);
  let last = 0;
  for (let h = 6; h <= 24; h += 0.25) { const v = plannedBy(1550, h); assert.ok(v >= last); last = v; }
  assert.ok(Math.abs(plannedBy(1550, 18) - 1550) < 1e-6);
  assert.ok(Math.abs(plannedBy(1550, 24) - 1550) < 1e-6);
});

test('the budget verdict today: no pill before the plan starts, then the plan\'s pace, then the budget', () => {
  const target = 1550;
  assert.equal(budgetVerdict({ target, eaten: 300, planned: 0 }).text, '');
  assert.equal(budgetVerdict({ target, eaten: 0, planned: 500 }).text, 'Nothing eaten yet');
  assert.deepEqual(budgetVerdict({ target, eaten: 500, planned: 500 }), { level: '', tone: 'good', text: 'On plan pace' });
  const fast = budgetVerdict({ target, eaten: 650, planned: 500 });
  assert.equal(fast.tone, 'warn'); assert.match(fast.text, /^150 above plan pace$/);
  const slow = budgetVerdict({ target, eaten: 250, planned: 500 });
  assert.equal(slow.tone, 'calm'); assert.match(slow.text, /^250 under plan pace$/);
  assert.deepEqual(budgetVerdict({ target, eaten: target * 1.05, planned: target }), { level: '', tone: 'good', text: 'Budget used' });
  const over = budgetVerdict({ target, eaten: target * 1.12, planned: target });
  assert.equal(over.level, 'over'); assert.equal(over.tone, 'warn');
  const back = budgetVerdict({ target, eaten: target * 1.20, planned: target });
  assert.equal(back.level, 'back'); assert.equal(back.tone, 'warn');
});

test('a budget used before the plan has spent it is "used early", never a tick', () => {
  const target = 1550;
  assert.deepEqual(budgetVerdict({ target, eaten: target, planned: target - 0.5 }), { level: '', tone: 'good', text: 'Budget used' });
  assert.deepEqual(budgetVerdict({ target, eaten: target + 1, planned: 486 }), { level: '', tone: 'warn', text: 'Budget used early' });
  assert.deepEqual(budgetVerdict({ target, eaten: target + 1, planned: 0 }), { level: '', tone: 'warn', text: 'Budget used early' });
  assert.deepEqual(budgetVerdict({ target, eaten: target, planned: 486 }), { level: '', tone: 'warn', text: 'Budget used early' });
});

test('the budget verdict on a past day says how it ended, without praising an under-logged day', () => {
  const target = 1550;
  const at = (eaten) => budgetVerdict({ target, eaten, planned: null });
  assert.deepEqual(at(0), { level: '', tone: 'calm', text: 'Nothing logged' });
  assert.equal(at(target * 0.5).tone, 'calm'); assert.match(at(target * 0.5).text, /^Ended .+ under$/);
  assert.equal(at(target * 0.98).tone, 'good');
  assert.equal(at(target + 10).text, 'Ended on budget');
  assert.equal(at(target - 10).text, 'Ended on budget');
});

test('the budget verdict and the day verdict agree on over and well over', () => {
  for (const share of [1.12, 1.20]) {
    reset(); meal(day(-1), 1550 * share, 135);
    assert.equal(budgetVerdict({ target: 1550, eaten: 1550 * share, planned: null }).level, dayVerdict(day(-1)).level);
  }
  for (const [target, kcal] of [[1500, 1500 + 105.3], [1550, 1550 + 108.5], [1550, 1550 + 232.5]]) {
    reset(); S.settings.kcalRest = target; meal(day(-1), kcal, 135);
    const level = dayVerdict(day(-1)).level;
    assert.equal(budgetVerdict({ target, eaten: kcal, planned: null }).level, level === 'over' || level === 'back' ? level : '');
  }
});

test('the budget meter is as wide as the budget, or what was eaten when that is more; the plan tick sits inside it', () => {
  assert.deepEqual(budgetMeter({ target: 1550, eaten: 775, planned: null }), { eat: 0.5, cap: 1, plan: null });
  const over = budgetMeter({ target: 1500, eaten: 1800, planned: null });
  assert.equal(over.eat, 1); assert.ok(Math.abs(over.cap - 1500 / 1800) < 1e-9);
  assert.equal(budgetMeter({ target: 1550, eaten: 500, planned: 0 }).plan, null);
  assert.equal(budgetMeter({ target: 1550, eaten: 500, planned: 1549.5 }).plan, null);
  assert.equal(budgetMeter({ target: 1550, eaten: 500, planned: 620 }).plan, 620 / 1550);
});

test('supplements taken: only ids still in the list count', () => {
  reset();
  S.settings.supplements = [{ id: 's1', name: 'D', dose: '' }, { id: 's2', name: 'B12', dose: '' }];
  S.days[T] = { day: T, taken: ['s1', 'removed'] };
  assert.deepEqual(suppTaken(T), ['s1']);
  assert.deepEqual(suppTaken(day(-1)), []);
});

test('today is "open" until it is on plan; a finished day keeps its colour; the reasons name the calories, the notes the rest', () => {
  reset(); meal(T, 600, 40);
  assert.equal(dayStatus(T), 'open');
  meal(day(-1), 1500, 119.6);
  assert.equal(dayStatus(day(-1)), 'on'); // protein is a note, not a verdict
  assert.deepEqual(dayReasons(day(-1)), []);
  S.entries = []; meal(T, 1500, 130);
  assert.equal(dayStatus(T), 'on');
  assert.deepEqual(dayReasons(T), []);
  S.entries = []; meal(T, 1550 * 1.3, 130);
  assert.equal(dayStatus(T), 'far');
});

test('a day that is still open does not break or inflate the run; the reasons and notes are kept apart', () => {
  reset();
  for (const o of [-3, -2, -1]) meal(day(o), 1500, 130);
  meal(T, 600, 40); // today, still being eaten
  assert.equal(dayStatus(T), 'open');
  assert.equal(streak(), 3); // today waits; the three days before it stand
  S.entries = [];
  meal(day(-1), 1750, 100, { tier: 'off' }); // 113% of the budget, protein short, one off-plan entry
  assert.equal(dayStatus(day(-1)), 'over');
  assert.deepEqual(dayReasons(day(-1)), ['200 kcal above the budget']);
  assert.deepEqual(dayNotes(day(-1)), ['protein 20 g short of your minimum', '1 off-plan entry']);
  S.entries = []; meal(day(-1), 700, 60);
  assert.equal(dayStatus(day(-1)), 'under');
  S.entries = []; meal(T, 1750, 135); // 113% today: judged, not open
  assert.equal(dayStatus(T), 'over');
});

test('a review goes stale when the minimum changes', () => {
  reset(); meal(day(-1), 1450, 135);
  S.days[day(-1)] = { day: day(-1), review: { sig: reviewSig(day(-1)), live: false } };
  assert.equal(reviewState(day(-1)), 'fresh');
  S.settings.kcalMinDay = 1400;
  assert.equal(reviewState(day(-1)), 'stale');
  delete S.days[day(-1)];
});

test('the typed coffee and beer shortcuts win over a plan meal with the same name', () => {
  S.plan = buildPlan({ id: 'mine', name: 'Mine', foods: seedPlan.foods, meals: [{ id: 'X-1', slot: 'snack1', name: 'Coffee', ingredients: [['salad', 100]] }, { id: 'X-2', slot: 'lunch', name: 'Big salad', ingredients: [['salad', 400]] }] });
  try {
    assert.deepEqual(parseLocal('coffee'), { type: 'count', key: 'coffee', n: 1 });
    assert.equal(parseLocal('big salad').type, 'plan');
    assert.equal(parseLocal('x-1').meal.id, 'X-1');
  } finally { S.plan = SEED; }
});

test('a favourite or extra named like the counter wins over it; only a plan meal yields to the counter', () => {
  const saved = S.settings.favorites;
  S.settings.favorites = [{ id: 'f1', name: 'Coffee' }];
  try {
    assert.equal(parseLocal('coffee').type, 'favorite');
    S.settings.favorites = [];
    assert.deepEqual(parseLocal('coffee'), { type: 'count', key: 'coffee', n: 1 });
    assert.equal(parseLocal('Beer 0.5 l').type, 'flex');
  } finally { S.settings.favorites = saved; }
});

test('releasePhotos revokes every photo URL of a form, and a missing form is nothing', () => {
  const revoked = [];
  const orig = URL.revokeObjectURL;
  URL.revokeObjectURL = (u) => revoked.push(u);
  try {
    releasePhotos(undefined);
    releasePhotos({ photos: [{ url: 'a' }, { url: 'b' }] });
    assert.deepEqual(revoked, ['a', 'b']);
    assert.match(readFileSync(new URL('../js/app.js', import.meta.url), 'utf8'), /releasePhotos\(form\)/);
  } finally { URL.revokeObjectURL = orig; }
});

test('titleFor: a plan kind gives only its tk, the other kinds a title and tk', () => {
  const p = titleFor('plan', { id: 'L-A' });
  assert.equal(p.tk.kind, 'plan');
  assert.equal(p.tk.params.id, 'L-A');
  assert.equal(p.title, undefined);
  assert.deepEqual(p, { tk: { kind: 'plan', params: { id: 'L-A' } } }); // what logMeal and analyzeEntry spread into the entry
  const src = readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');
  assert.equal((src.match(/kind: 'plan'/g) || []).length, 0); // no hand-built copies
  for (const [kind, params] of [['weight', { kg: 82.5 }], ['steps', { steps: 8200 }], ['photo', {}]]) {
    const r = titleFor(kind, params);
    assert.equal(r.tk.kind, kind);
    assert.ok(r.title);
  }
});

// ——— The review of the whole log ———
const wi = (off, kg) => { S.days[day(off)] = { ...(S.days[day(off)] || {}), day: day(off), kg }; };
test('progressSig is the same on every call and moves only with goals, plan, weigh-ins and meal days in fives', () => {
  reset(); wi(-3, 85); meal(day(-1), 1500, 130);
  const base = progressSig();
  assert.equal(progressSig(), base);
  const changed = [
    () => wi(0, 84.5), // weigh-in added
    () => { S.days[day(-3)].kg = 84.9; }, // kg changed
    () => { S.settings.protein += 1; }, // goal field
    () => { S.settings.kcalRest += 100; }, // the budgets the brief tells
    () => { S.settings.kcalTrain += 100; },
    () => { S.plan = { ...S.plan, meals: S.plan.meals.slice(1) }; }, // plan digest
    () => { for (let i = 2; i < 6; i++) meal(day(-i - 1), 1500, 130); }, // meal days cross a 5-boundary
  ];
  for (const f of changed) { reset(); wi(-3, 85); meal(day(-1), 1500, 130); S.plan = SEED; f(); assert.notEqual(progressSig(), base); }
  S.plan = SEED;
});
test('progressSig ignores water, coffee and supplement ticks, an entry edit that changes no meal day, and S.rev', () => {
  reset(); wi(-3, 85); meal(day(-1), 1500, 130);
  const base = progressSig();
  S.days[day(-1)] = { day: day(-1), water: 3, coffee: 2, taken: ['a'] };
  assert.equal(progressSig(), base);
  S.entries[0].ts += 1000; S.entries[0].title = 'Edited';
  assert.equal(progressSig(), base);
  S.entries[0].kcal = 2100; S.entries[0].tier = 'off'; // the day still counts as a verdict and a meal day
  assert.equal(progressSig(), base);
  S.rev++;
  assert.equal(progressSig(), base);
});
test('progressSig is equal after a restart with the same log', () => {
  reset(); wi(-3, 85); meal(day(-1), 1500, 130);
  const a = progressSig();
  const saved = JSON.parse(JSON.stringify({ e: S.entries, d: S.days }));
  S.entries = saved.e; S.days = saved.d;
  assert.equal(progressSig(), a);
});
test('progressRatingHint: too early with fewer than 3 weigh-ins, a short span or no average, even past day 14', () => {
  reset(); assert.equal(progressRatingHint(), 'too-early');
  wi(0, 85); wi(-3, 85.2);
  assert.equal(progressRatingHint(), 'too-early');
  wi(-5, 85.4); // three weigh-ins but a 5-day span
  assert.equal(progressRatingHint(), 'too-early');
});
test('progressRatingHint: a 14-day window that passes the count and span gates still needs two weigh-ins in an average', () => {
  reset(); // three weigh-ins over 12 days, but today's 7-day window holds the single reading of today
  wi(0, 85); wi(-10, 85.5); wi(-12, 86);
  assert.equal(progressRatingHint(), 'too-early');
});
test('progressRatingHint: single weigh-ins per window never read as stuck, as the old n=1 arms did', () => {
  reset();
  const t0 = targetAt(day(0), S.settings);
  wi(0, t0 + 4); wi(-7, targetAt(day(-7), S.settings) + 4); wi(-12, t0 + 5); // both arms above the gap on one reading each
  assert.equal(progressRatingHint(), 'too-early');
});
test('progressRatingHint: a single weigh-in three weeks ago is not a flat trend, two per window is enough', () => {
  reset();
  const t0 = targetAt(day(0), S.settings);
  for (const o of [0, -2, -4, -6]) wi(o, t0 + 0.3);
  for (const o of [-7, -9, -11, -13]) wi(o, t0 + 0.9);
  wi(-21, t0 + 0.4); // one reading in the old window: the flat arm stays off
  assert.equal(progressRatingHint(), 'a-bit-behind');
});
test('progressRatingHint: a twice-a-week weigher still gets a band', () => {
  reset();
  const t0 = targetAt(day(0), S.settings);
  for (const [o, kg] of [[0, t0 + 0.25], [-3, t0 + 0.35], [-7, t0 + 0.75], [-10, t0 + 0.85]]) wi(o, kg);
  assert.equal(avg7(day(0)).n, 2, 'two readings in the 7-day average');
  assert.equal(progressRatingHint(), 'a-bit-behind');
});
test('progressRatingHint: at the target but losing far faster than the plan reads on-track, not great', () => {
  reset();
  for (const [o, kg] of [[0, 77.0], [-2, 77.5], [-4, 78.0], [-6, 78.5], [-8, 79.5], [-10, 80.5], [-12, 81.5], [-13, 82.0]]) wi(o, kg);
  assert.ok(-projection().perWeek > planRate().kg * 7, 'the overshoot the check looks for');
  assert.equal(progressRatingHint(), 'on-track');
});
test('progressRatingHint: the 0.2 kg band, stuck as in adjustNotice, flat weight and target reached', () => {
  const setup = (a, b) => { reset(); S.settings.startDate = day(-40); for (const o of [0, -2, -4, -6]) wi(o, a); for (const o of [-7, -9, -11, -13]) wi(o, b); };
  const tgt = (o) => targetAt(day(o), S.settings);
  setup(0, 0); const t0 = tgt(0);
  setup(t0 + 0.19, t0 + 0.19 + 0.5); assert.equal(progressRatingHint(), 'on-track');
  setup(t0 + 0.2, t0 + 0.2 + 0.5); assert.equal(progressRatingHint(), 'a-bit-behind');
  // stuck: both averages more than 0.7 kg above their own schedule (the week before is exactly 4-day samples of b)
  setup(t0 + 0.8, tgt(-7) + 0.8); assert.equal(progressRatingHint(), 'stuck');
  setup(t0 + 0.8, tgt(-7) + 0.69); assert.notEqual(progressRatingHint(), 'stuck');
  // flat: the average three weeks ago is less than 0.15 kg above today's
  setup(t0 + 0.3, t0 + 0.9); for (const o of [-21, -22, -23]) wi(o, t0 + 0.3 + 0.1);
  assert.equal(progressRatingHint(), 'stuck');
  setup(S.settings.targetKg - 0.1, S.settings.targetKg + 0.5); assert.equal(progressRatingHint(), 'great');
});
test('progressGate: none before day 7, gated until 14 days or 3 weigh-ins in the average', () => {
  reset();
  S.settings.startDate = day(-6); assert.equal(progressGate(), 'none');
  S.settings.startDate = day(-7); assert.equal(progressGate(), 'gated');
  S.settings.startDate = day(-14); assert.equal(progressGate(), 'ready');
  S.settings.startDate = day(-7); wi(0, 85); wi(-2, 85); assert.equal(progressGate(), 'gated');
  wi(-4, 85); assert.equal(progressGate(), 'ready');
});
test('progressState: none, refresh by a changed log or by age, else fresh', () => {
  reset(); wi(0, 85);
  S.progressReview = null; assert.equal(progressState(), 'none');
  S.progressReview = { sig: progressSig(), ts: Date.now() }; assert.equal(progressState(), 'fresh');
  wi(-2, 84); assert.equal(progressState(), 'refresh');
  S.progressReview = { sig: progressSig(), ts: Date.now() - 14 * 86400000 }; assert.equal(progressState(), 'refresh');
  S.progressReview = { sig: progressSig(), ts: Date.now() - 14 * 86400000 + 60000 }; assert.equal(progressState(), 'fresh');
  S.progressReview = { sig: progressSig() }; assert.equal(progressState(), 'refresh'); // no ts
  S.progressReview = { sig: progressSig(), ts: NaN }; assert.equal(progressState(), 'refresh');
  S.progressReview = { sig: progressSig(), ts: Date.now() + 3600000 }; assert.equal(progressState(), 'refresh'); // in the future
  S.progressReview = null;
});

test('progressGen accessors: bump increments, reset sets 0', () => {
  resetProgressGen(); assert.equal(getProgressGen(), 0);
  bumpProgressGen(); bumpProgressGen(); assert.equal(getProgressGen(), 2);
  resetProgressGen(); assert.equal(getProgressGen(), 0);
});
