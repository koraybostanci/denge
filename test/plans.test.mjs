// The stored plans (kv `plans`): the record a save writes, the one validator, load, restore and the plan pictures. `node --test`
// js/app.js needs a browser, so its writePlans, setPlanPhotos, load and restore are tested through the pure functions they call.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanPlan, cleanPlans, plansRecord, activePlan, loadedPlans, sweepPlanPhotos, cleanSettings, cleanPhoto, PLAN_CAPS } from '../js/backup.js';
import seedPlan from '../js/default-plan.js';

const copy = (x) => JSON.parse(JSON.stringify(x));
const SEED = copy(seedPlan);
const mine = () => ({ id: 'P-abc123', name: 'My plan', foods: { ...copy(SEED.foods), u1: { name: 'Oat drink', v: [45, 1, 6.5, 1.5, 0.8] } },
  meals: [...copy(SEED.meals).slice(0, 3), { id: 'U-x1', slot: 'snack2', name: 'Oats', ingredients: [['u1', 250, '1 glass'], ['berries', 80]] }] });

test('writing a user plan stores { active, list: [seed Default, the user plan] }, Default from the seed whatever the caller passes', () => {
  const changedDefault = { ...copy(SEED), name: 'Hacked', meals: [] };
  const r = plansRecord(seedPlan, [changedDefault, mine()], 'P-abc123');
  assert.deepEqual(Object.keys(r), ['active', 'list']);
  assert.equal(r.active, 'P-abc123');
  assert.equal(r.list.length, 2);
  assert.equal(r.list[0], seedPlan);
  assert.deepEqual(r.list[1], mine());
  assert.equal(activePlan(r).id, 'P-abc123');
  // Only Default, or an unknown active id
  assert.deepEqual(plansRecord(seedPlan, [], 'P-abc123'), { active: 'default', list: [seedPlan] });
  assert.equal(plansRecord(seedPlan, [mine()], 'P-nope').active, 'default');
  assert.equal(activePlan({ active: 'P-gone', list: [seedPlan] }), seedPlan);
});

test('a valid user plan passes cleanPlan unchanged', () => {
  const r = cleanPlan(mine());
  assert.equal(r.changed, false);
  assert.deepEqual(r.plan, mine());
  assert.equal(cleanPlan(r.plan).changed, false);
});

test('a save is refused over a cap, with bad grams, a missing food, a repeated meal id or an Object.prototype key', () => {
  const bad = [];
  const p1 = mine(); p1.meals[0].ingredients = Array.from({ length: PLAN_CAPS.ingredients + 1 }, () => ['egg', 10]); bad.push(['13 ingredients', p1]);
  const p2 = mine(); p2.meals[0].ingredients[0][1] = 0; bad.push(['0 g', p2]);
  const p3 = mine(); p3.meals[0].ingredients[0][1] = 5001; bad.push(['5,001 g', p3]);
  const p4 = mine(); p4.meals[0].ingredients.push(['gone', 50]); bad.push(['missing food', p4]);
  const p5 = mine(); p5.meals.push({ ...p5.meals[0] }); bad.push(['repeated meal id', p5]);
  const p6 = mine(); p6.foods.constructor = { name: 'Odd', v: [1, 1, 1, 1, 1] }; bad.push(['constructor food', p6]);
  const p7 = mine(); p7.meals[0].id = 'constructor'; bad.push(['constructor meal', p7]);
  const p8 = mine(); p8.foods.u1.v[0] = 1001; bad.push(['kcal over 1,000', p8]);
  const p9 = mine(); p9.foods.u1.v[1] = 101; bad.push(['protein over 100', p9]);
  const p10 = mine(); p10.meals[0].name = 'x'.repeat(61); bad.push(['long name', p10]);
  const p11 = mine(); p11.meals[0].ingredients[0][2] = 'x'.repeat(31); bad.push(['long measure', p11]);
  const p12 = mine(); p12.meals[0].slot = 'morning'; bad.push(['slot', p12]);
  const p13 = mine(); p13.meals = Array.from({ length: PLAN_CAPS.meals + 1 }, (_, i) => ({ id: `U-${i}`, slot: 'lunch', name: 'M', ingredients: [['egg', 50]] })); bad.push(['101 meals', p13]);
  const p14 = mine(); for (let i = 0; i < PLAN_CAPS.foods; i++) p14.foods[`u${i}x`] = { name: 'F', v: [1, 1, 1, 1, 1] }; bad.push(['301 foods', p14]);
  for (const [why, p] of bad) {
    assert.equal(cleanPlan(p).changed, true, why);
    assert.equal(plansRecord(seedPlan, [p], p.id), null, why);
  }
  for (const id of ['default', 'constructor', '', 5, 'x']) assert.equal(cleanPlan({ ...mine(), id }).plan, null, String(id));
});

test('a plan from a file is trimmed to the limits instead', () => {
  const p = mine();
  p.meals[0].ingredients.push(['gone', 50]);
  p.meals[1].ingredients[0][1] = 9000;
  p.meals.push({ ...p.meals[0] }, { id: 'U-y', slot: 'brunch', name: 'X', ingredients: [] });
  p.foods.constructor = { name: 'Odd', v: [1, 1, 1, 1, 1] };
  const { plan } = cleanPlan(p);
  assert.equal(plan.meals.length, 4);
  assert.ok(!plan.meals[0].ingredients.some(([k]) => k === 'gone'));
  assert.equal(plan.meals[1].ingredients[0][1], PLAN_CAPS.grams);
  assert.ok(!Object.hasOwn(plan.foods, 'constructor'));
  assert.equal(cleanPlan(plan).changed, false); // what a restore keeps, a save takes as it is
});

test('restore: the first user plan replaces My plan, and active falls back to Default when that plan is not there', () => {
  const other = { ...mine(), id: 'P-other', name: 'Other' };
  const r = cleanPlans({ active: 'P-other', list: [{ id: 'default' }, other, mine()] });
  assert.deepEqual(r.list.map((p) => p.id), ['P-other']);
  assert.equal(r.active, 'P-other');
  assert.equal(plansRecord(seedPlan, r.list, r.active).list[1].name, 'Other');
  assert.equal(cleanPlans({ active: 'P-missing', list: [mine()] }).active, 'default');
  assert.equal(cleanPlans({ list: [mine()] }).active, 'default');
  // plans but no user plan: My plan is removed
  assert.deepEqual(cleanPlans({ active: 'P-abc123', list: [] }), { active: 'default', list: [] });
  assert.deepEqual(cleanPlans(null), { active: 'default', list: [] });
});

test('restore: an older backup without plans leaves the device alone (its app.js path only runs when the file has plans)', async () => {
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');
  assert.match(src, /if \(data\.plans !== undefined\) \{\s*const plans = cleanPlans\(data\.plans\);\s*await writePlans\(plans\.list, plans\.active\);/);
});

test('load: a stored Default that differs from the seed is rewritten; My plan is kept as it is', () => {
  const user = mine();
  const stale = { ...copy(SEED), meals: copy(SEED.meals).slice(1) };
  const r = loadedPlans({ active: 'P-abc123', list: [stale, user] }, SEED);
  assert.equal(r.rewrite, true);
  assert.deepEqual(r.record.list[0], SEED);
  assert.deepEqual(r.record.list[1], user);
  assert.equal(r.record.active, 'P-abc123');
  // As written: nothing to do
  const same = loadedPlans(copy({ active: 'P-abc123', list: [SEED, user] }), SEED);
  assert.equal(same.rewrite, false);
  // Nothing stored yet: the seed is written; an unknown active id becomes Default
  assert.deepEqual(loadedPlans(null, SEED), { record: { active: 'default', list: [SEED] }, rewrite: true });
  assert.equal(loadedPlans({ active: 'P-zzz', list: [SEED] }, SEED).record.active, 'default');
});

test('plan pictures: only meal ids a stored plan holds stay; a photo shared by two meals is kept, an orphan is deleted', () => {
  const record = plansRecord(seedPlan, [mine()], 'P-abc123');
  const prev = { 'L-A': 'p1', 'U-x1': 'p1', 'D-A': 'p2' };
  const next = { 'L-A': 'p1', 'D-A': 'p2', 'X-gone': 'p3', constructor: 'p4' }; // U-x1 removed; a meal no plan has
  const r = sweepPlanPhotos(prev, next, record);
  assert.deepEqual(r.planPhotos, { 'L-A': 'p1', 'D-A': 'p2' });
  assert.deepEqual(r.gone.sort(), ['p3', 'p4']);
  // Replacing a picture deletes the old one
  assert.deepEqual(sweepPlanPhotos({ 'L-A': 'p1' }, { 'L-A': 'p9' }, record).gone, ['p1']);
  // A meal Default dropped loses its picture
  const smaller = plansRecord({ ...SEED, meals: SEED.meals.filter((m) => m.id !== 'D-A') }, [], 'default');
  assert.deepEqual(sweepPlanPhotos(prev, prev, smaller), { planPhotos: { 'L-A': 'p1' }, gone: ['p2'] });
});

test('settings and photos from a file: no Object.prototype meal id, and a cap on the number of plan pictures', () => {
  assert.deepEqual(cleanSettings({ planPhotos: { constructor: 'p1', toString: 'p2', 'L-A': 'p3' } }).planPhotos, { 'L-A': 'p3' });
  const many = Object.fromEntries(Array.from({ length: 500 }, (_, i) => [`M-${i}`, `p${i}`]));
  assert.equal(Object.keys(cleanSettings({ planPhotos: many }).planPhotos).length, 200);
  assert.equal(cleanPhoto({ id: 'p1', b64: btoa('abc'), plan: 'constructor' }).plan, undefined);
});
