// First-run setup: validation, the settings it produces and the upgrade of old settings (js/onboarding.js). `node --test`
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MAX_LOSS_PER_WEEK, weeklyLoss, tooFast, goalPaceError, newClientId, parseNumberInput, GOAL_KEYS, validateProfile, validateOnboarding, settingsFromOnboarding, blankPlan, needsOnboarding, upgradeSettings } from '../js/onboarding.js';
import { freshSettings } from '../js/core.js';
import { DEFAULTS } from '../js/plan.js';
import { cleanSettings } from '../js/backup.js';

const TODAY = '2026-10-23';
const ok = { weight: 90, targetKg: 80, targetDate: '2027-01-31', kcalRest: 1600, kcalTrain: 1800, protein: 130 };
const codes = (input) => validateOnboarding({ ...ok, ...input }, TODAY).errors.map((e) => `${e.field}:${e.code}`);

test('newClientId is a v4 uuid, unique, with and without randomUUID', () => {
  const re = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
  const ids = new Set(Array.from({ length: 50 }, newClientId));
  assert.equal(ids.size, 50);
  for (const id of ids) assert.match(id, re);
  const real = globalThis.crypto;
  const fake = { getRandomValues: (b) => real.getRandomValues(b) };
  Object.defineProperty(globalThis, 'crypto', { value: fake, configurable: true });
  try {
    const a = newClientId(); const b = newClientId();
    assert.match(a, re); assert.notEqual(a, b);
  } finally { Object.defineProperty(globalThis, 'crypto', { value: real, configurable: true }); }
});

test('valid input passes and is cleaned', () => {
  const r = validateOnboarding({ ...ok, name: '  Ayşe\u0007 ', age: '34', gender: 'female' }, TODAY);
  assert.equal(r.ok, true);
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.value, { ...ok, weight: 90, name: 'Ayşe', age: 34, gender: 'female' });
  const bare = validateOnboarding(ok, TODAY);
  assert.equal(bare.ok, true);
  assert.deepEqual([bare.value.name, bare.value.age, bare.value.gender], ['', 0, '']);
});

test('comma decimals as strings are read', () => {
  const r = validateOnboarding({ ...ok, weight: '90,5', targetKg: '80,5', kcalRest: '1600', kcalTrain: '1800', protein: '130' }, TODAY);
  assert.equal(r.ok, true);
  assert.deepEqual([r.value.weight, r.value.targetKg], [90.5, 80.5]);
});

test('weights: required, 30 to 300, the goal below the start', () => {
  assert.deepEqual(codes({ weight: '' }), ['weight:required']);
  assert.deepEqual(codes({ weight: 29 }), ['weight:range']);
  assert.deepEqual(codes({ weight: 301, targetKg: 80 }), ['weight:range']);
  assert.deepEqual(codes({ targetKg: 29 }), ['targetKg:range']);
  assert.deepEqual(codes({ targetKg: 90 }), ['targetKg:not_below_weight']);
  assert.deepEqual(codes({ targetKg: 95 }), ['targetKg:not_below_weight']);
  assert.deepEqual(codes({ weight: 30, targetKg: 30 }), ['targetKg:not_below_weight']);
  assert.deepEqual(codes({ weight: 300, targetKg: 30, targetDate: '2030-01-01' }), []);
});

test('target date: a real day after today', () => {
  assert.deepEqual(codes({ targetDate: '' }), ['targetDate:required']);
  assert.deepEqual(codes({ targetDate: '31/01/2027' }), ['targetDate:invalid']);
  assert.deepEqual(codes({ targetDate: '2027-02-30' }), ['targetDate:invalid']);
  assert.deepEqual(codes({ targetDate: '2027-13-45' }), ['targetDate:invalid']);
  assert.deepEqual(codes({ targetDate: TODAY }), ['targetDate:not_after_today']);
  assert.deepEqual(codes({ targetDate: '2026-10-22' }), ['targetDate:not_after_today']);
  assert.deepEqual(codes({ targetKg: 89.8, targetDate: '2026-10-24' }), []);
});

test('calories and protein: floor 500, training not below rest, protein from 50', () => {
  assert.deepEqual(codes({ kcalRest: 499, kcalTrain: 499 }), ['kcalRest:below_floor', 'kcalTrain:below_floor']);
  assert.deepEqual(codes({ kcalRest: 500, kcalTrain: 500 }), []);
  assert.deepEqual(codes({ kcalTrain: 1599 }), ['kcalTrain:below_rest']);
  assert.deepEqual(codes({ kcalRest: '', }), ['kcalRest:required']);
  assert.deepEqual(codes({ kcalRest: 7000, kcalTrain: 7000 }), ['kcalRest:range', 'kcalTrain:range']);
  assert.deepEqual(codes({ protein: 49 }), ['protein:below_min']);
  assert.deepEqual(codes({ protein: 50 }), []);
  assert.deepEqual(codes({ protein: '' }), ['protein:required']);
});

test('name, age and gender are optional and checked when given', () => {
  assert.deepEqual(codes({ name: 'x'.repeat(40) }), []);
  assert.deepEqual(codes({ name: 'x'.repeat(41) }), ['name:too_long']);
  assert.deepEqual(codes({ name: 7 }), ['name:invalid']);
  assert.equal(validateOnboarding({ ...ok, name: ' \n\t ' }, TODAY).value.name, '');
  assert.equal(validateOnboarding({ ...ok, name: 'A\u0007B \n  C' }, TODAY).value.name, 'A B C'); // as a restore cleans it
  assert.deepEqual(codes({ name: 'x'.repeat(39) + '\u0001' + 'y' }), ['name:too_long']);
  assert.deepEqual(codes({ age: '' }), []);
  assert.deepEqual(codes({ age: 18 }), []);
  assert.deepEqual(codes({ age: '120' }), []);
  assert.deepEqual(codes({ age: 17 }), ['age:range']);
  assert.deepEqual(codes({ age: 121 }), ['age:range']);
  assert.deepEqual(codes({ age: '34.5' }), ['age:range']);
  assert.deepEqual(codes({ age: 'abc' }), ['age:range']);
  for (const g of ['female', 'male', 'other', 'none', '']) assert.deepEqual(codes({ gender: g }), []);
  assert.deepEqual(codes({ gender: 'x' }), ['gender:invalid']);
  assert.equal(validateOnboarding(null, TODAY).ok, false);
});

test('settingsFromOnboarding builds the goals from the validated value', () => {
  const { value } = validateOnboarding({ ...ok, name: 'Ayşe', age: 34, gender: 'female' }, TODAY);
  assert.deepEqual(settingsFromOnboarding(value, TODAY, 'cid'), {
    startDate: TODAY, startKg: 90, targetKg: 80, targetDate: '2027-01-31', kcalRest: 1600, kcalTrain: 1800, protein: 130, proteinMin: 116, kcalMinDay: 1500,
    name: 'Ayşe', age: 34, gender: 'female', clientId: 'cid', onboarded: true,
  });
});

test('blankPlan is an empty My plan', () => {
  assert.deepEqual(blankPlan('abc'), { id: 'P-abc', name: 'My plan', foods: {}, meals: [] });
});

test('needsOnboarding only for an install with no goals and no data', () => {
  assert.equal(needsOnboarding(undefined, false), true);
  assert.equal(needsOnboarding(null, undefined), true);
  assert.equal(needsOnboarding({}, false), true);
  assert.equal(needsOnboarding({ startKg: 'x' }, false), true);
  assert.equal(needsOnboarding({ startKg: 87 }, false), false);
  assert.equal(needsOnboarding(undefined, true), false);
  assert.equal(needsOnboarding({}, true), false);
});

test('upgradeSettings fills missing goals, keeps the rest, assigns an id once', () => {
  const d = DEFAULTS;
  const up = upgradeSettings({ startKg: 95, targetKg: NaN, kcalRest: 1400, lang: 'tr', protein: null }, 'new-id');
  assert.equal(up.startKg, 95);
  assert.equal(up.kcalRest, 1400);
  assert.equal(up.lang, 'tr');
  assert.equal(up.targetKg, d.targetKg);
  assert.equal(up.protein, d.protein);
  for (const k of ['startDate', 'targetDate', 'kcalTrain', 'proteinMin']) assert.equal(up[k], d[k]);
  assert.equal(up.clientId, 'new-id');
  assert.equal(up.onboarded, true);
  assert.equal(upgradeSettings({ clientId: 'old' }, 'new-id').clientId, 'old');
  const stored = { startKg: 80 };
  upgradeSettings(stored, 'x');
  assert.deepEqual(stored, { startKg: 80 });
});

test('settingsFromOnboarding keeps the daily floor at or below the budget', () => {
  const base = { weight: 90, targetKg: 80, targetDate: '2027-01-01', kcalTrain: 2000, protein: 150 };
  assert.equal(settingsFromOnboarding({ ...base, kcalRest: 1200 }, '2026-01-01', 'c').kcalMinDay, 1200);
  assert.equal(settingsFromOnboarding({ ...base, kcalRest: 1800 }, '2026-01-01', 'c').kcalMinDay, 1500);
  const s = settingsFromOnboarding({ ...base, kcalRest: 1200 }, '2026-01-01', 'c');
  assert.equal(cleanSettings({ ...freshSettings(), ...s }).kcalMinDay, 1200);
});

test('validateProfile: the same checks as the setup, for Settings', () => {
  const codes2 = (input) => validateProfile(input).errors.map((e) => `${e.field}:${e.code}`);
  assert.deepEqual(validateProfile({ name: ' Ayşe\n', age: '34', gender: 'female' }), { ok: true, errors: [], value: { name: 'Ayşe', age: 34, gender: 'female' } });
  assert.deepEqual(validateProfile({}).value, { name: '', age: 0, gender: '' });
  assert.deepEqual(validateProfile(null).value, { name: '', age: 0, gender: '' });
  assert.deepEqual(codes2({ name: 'x'.repeat(41) }), ['name:too_long']);
  assert.deepEqual(codes2({ age: '17' }), ['age:range']);
  assert.deepEqual(codes2({ age: 'abc' }), ['age:range']);
  assert.deepEqual(codes2({ gender: 'x' }), ['gender:invalid']);
  assert.deepEqual(codes2({ name: 'x'.repeat(41), age: '1', gender: 'x' }), ['name:too_long', 'age:range', 'gender:invalid']);
});

test('parseNumberInput is strict', () => {
  for (const [s, n, i] of [['85', 85], ['85.4', 85.4], [' 85,4 ', 85.4], ['1,550', 1.55], ['1,550', 1550, true], ['1.550', 1550, true], ['1 550', 1550, true], ['12 345 678', 12345678, true], ['1550', 1550, true], ['1.5', 1.5, true]]) {
    assert.equal(parseNumberInput(s, i), n, `${s} ${i}`);
  }
  for (const [s, i] of [['85kg'], ['85.4.2'], ['1e2'], ['0x10'], ['Infinity'], ['-5'], ['.5'], ['5.'], [''], ['1 550', false], ['1,55,0', true], [null], [{}]]) {
    assert.ok(Number.isNaN(parseNumberInput(s, i)), `${s} ${i}`);
  }
  assert.equal(parseNumberInput(7), 7);
  assert.ok(Number.isNaN(parseNumberInput(Infinity)));
});

test('validateOnboarding reports text that is not a number as invalid, empty as required', () => {
  assert.deepEqual(codes({ weight: '1e2' }), ['weight:invalid']);
  assert.deepEqual(codes({ weight: '0x10' }), ['weight:invalid']);
  assert.deepEqual(codes({ targetKg: 'Infinity' }), ['targetKg:invalid']);
  assert.deepEqual(codes({ kcalRest: '85kg' }), ['kcalRest:invalid']);
  assert.deepEqual(codes({ protein: 'abc' }), ['protein:invalid']);
  assert.deepEqual(codes({ weight: '' }).includes('weight:required'), true);
  assert.deepEqual(codes({ kcalTrain: '' }), ['kcalTrain:required']);
});

test('validateOnboarding accepts age 0 as unset', () => {
  const r = validateOnboarding({ ...ok, age: 0 }, TODAY);
  assert.equal(r.ok, true);
  assert.equal(r.value.age, 0);
});

test('GOAL_KEYS is the one list of goal settings', () => {
  assert.equal(GOAL_KEYS.length, 8);
  assert.ok(GOAL_KEYS.includes('startKg') && GOAL_KEYS.includes('proteinMin'));
});

test('newClientId falls back to Math.random without crypto', () => {
  const saved = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
  Object.defineProperty(globalThis, 'crypto', { value: undefined, configurable: true });
  try { assert.match(newClientId(), /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/); }
  finally { if (saved) Object.defineProperty(globalThis, 'crypto', saved); else delete globalThis.crypto; }
});

test('validateOnboarding reports a bad today as an invalid targetDate', () => {
  for (const bad of [undefined, 'x', '2026-02-30']) {
    assert.deepEqual(validateOnboarding(ok, bad).errors, [{ field: 'targetDate', code: 'invalid' }]);
  }
});

test('pace: at most MAX_LOSS_PER_WEEK kg a week', () => {
  assert.equal(MAX_LOSS_PER_WEEK, 2);
  assert.deepEqual(codes({ weight: 90, targetKg: 76, targetDate: '2026-10-30' }), ['targetDate:too_fast']); // 14 kg in a week
  assert.deepEqual(codes({ weight: 90, targetKg: 88, targetDate: '2026-10-30' }), []); // exactly 2 kg in 7 days
  assert.deepEqual(codes({ weight: 90.3, targetKg: 88.3, targetDate: '2026-10-30' }), []); // 2.0000000000000142 before rounding
  assert.deepEqual(codes({ weight: 90.3, targetKg: 88.2, targetDate: '2026-10-30' }), ['targetDate:too_fast']);
  assert.deepEqual(codes({ weight: 90, targetKg: 87.9, targetDate: '2026-10-30' }), ['targetDate:too_fast']);
  assert.deepEqual(codes({ weight: 90, targetKg: 75, targetDate: '2026-10-24' }), ['targetDate:too_fast']); // 15 kg by tomorrow
  assert.deepEqual(codes({ weight: 90, targetKg: 95, targetDate: '2026-10-24' }), ['targetKg:not_below_weight']); // no pace error on top of another
});

test('weeklyLoss and tooFast', () => {
  assert.equal(weeklyLoss(90, 88, '2026-10-23', '2026-10-30'), 2);
  assert.equal(weeklyLoss(90.3, 88.3, '2026-10-23', '2026-10-30'), 2); // rounded to 0.1 kg
  assert.equal(weeklyLoss(90, 80, '2026-10-23', '2026-10-23'), Infinity);
  assert.ok(Number.isNaN(weeklyLoss(90, 80, '2026-10-23', 'x')));
  assert.ok(Number.isNaN(weeklyLoss(NaN, 80, '2026-10-23', '2026-11-23')));
  assert.equal(tooFast(90, 88, '2026-10-23', '2026-10-30'), false);
  assert.equal(tooFast(90, 87.9, '2026-10-23', '2026-10-30'), true);
  assert.equal(tooFast(90, 80, '2026-10-23', '2026-10-23'), true);
  assert.equal(tooFast(NaN, 80, '2026-10-23', '2026-11-23'), false);
  assert.equal(tooFast(87, 78, '2026-10-05', '2026-12-31'), false); // the default goals
});

test('goalPaceError judges a changed goal from the current weight and today', () => {
  const stored = { startDate: '2026-01-01', startKg: 100, targetDate: '2026-12-31', targetKg: 80 };
  const err = (patch, kg, weighed = true) => goalPaceError(stored, { ...stored, ...patch }, kg, '2026-10-23', weighed);
  assert.equal(err({}, 90), false); // unchanged
  assert.equal(err({ targetDate: '2026-11-06' }, 90), true); // late edit: 10 kg in 2 weeks
  assert.equal(err({ targetDate: '2027-02-01' }, 90), false);
  assert.equal(err({ targetDate: '2026-10-22' }, 90), true); // past date, still above goal
  assert.equal(err({ targetKg: 70 }, 90), true);
  const over = { ...stored, targetDate: '2026-11-06' }; // stored plan already past the limit
  assert.equal(goalPaceError(over, { ...over }, 90, '2026-10-23', true), false);
  assert.equal(goalPaceError(over, { ...over, startDate: '2026-02-01' }, 90, '2026-10-23', true), false);
  assert.equal(goalPaceError(over, { ...over, startKg: 99 }, 90, '2026-10-23', true), false); // weigh-in present
  assert.equal(goalPaceError(over, { ...over, startKg: 99 }, 99, '2026-10-23', false), true); // no weigh-in: start is the current weight
  assert.equal(goalPaceError(over, { ...over, startDate: '2026-02-01' }, 100, '2026-10-23', false), false);
});

test('a pace error puts the focus on the goal date, where its message is shown', async () => {
  const { onboardFocusId } = await import('../js/views.js');
  assert.equal(onboardFocusId([{ field: 'targetDate', code: 'too_fast' }]), 'ob-date');
  assert.equal(onboardFocusId([{ field: 'weight', code: 'range' }, { field: 'targetDate', code: 'too_fast' }]), 'ob-weight');
});
