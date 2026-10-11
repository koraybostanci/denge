// The calculations in js/core.js: no DOM, no storage, so they run as they are. `node --test`
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  S, BAND, proteinFloor, proteinLevel, weekResult, dayStatus, dayReasons, dayNotes, dayGoals, dayVerdict, latestWeight, avg7, kilosDown, projection, openSlots, suggest,
  fmtKg, freshSettings, freshCheck, today, SCHEMA_VERSION, VERDICT, verdictText, chartWindow,
  isPerfect, streak, suppTaken, weekStart, parseCount, drinkTally, planSteps, plannedBy, budgetVerdict, budgetMeter, kcalMinDay, reviewSig, reviewState,
} from '../js/core.js';
import { addDays, diffDays, hhmm, planDigest, planFoods, FOODS, MEALS, DEFAULTS, KCAL_MIN_DAY } from '../js/plan.js';

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

test('weights never print as -0.0', () => {
  assert.equal(fmtKg(-0.028), '0.0');
  assert.equal(fmtKg(-0.4), '-0.4');
  assert.equal(fmtKg(85.44), '85.4');
});

test('hhmm takes a Date or a timestamp', () => {
  assert.equal(hhmm(new Date(2026, 0, 1, 7, 5)), '07:05');
  assert.equal(hhmm(new Date(2026, 0, 1, 7, 5).getTime()), '07:05');
});

test('a food added to the plan without a short name does not put "undefined" in the model digest', () => {
  FOODS.testfood = { name: 'Test food', v: [1, 1, 1, 1, 1] };
  MEALS[0].ingredients.push(['testfood', 10]);
  try {
    assert.ok(!/undefined/.test(planDigest()));
    assert.ok(!/undefined/.test(planFoods()));
  } finally {
    MEALS[0].ingredients.pop();
    delete FOODS.testfood;
  }
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
