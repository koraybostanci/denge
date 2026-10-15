// The stored plans (kv `plans`): the record a save writes, the one validator, load, restore and the plan pictures. `node --test`
// js/app.js needs a browser, so its writePlans, setPlanPhotos, load, restore and meal editor saves are tested through the pure
// functions they call (startDraft and dropDraft in js/core.js; readMeal and planFromDraft in js/backup.js), and its food form
// through startFood, doneFood and dropFood (js/core.js) and readFood (js/backup.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { cleanPlan, cleanPlans, plansRecord, activePlan, loadedPlans, sweepPlanPhotos, cleanSettings, cleanPhoto, PLAN_CAPS, readMeal, readFood, planFromDraft, savedPlan } from '../js/backup.js';
import { S, startDraft, dropDraft, canEditPlan, startFood, doneFood, dropFood, foodUses } from '../js/core.js';
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

test('restore: a backup of the earlier build, with plans as a bare list and the active id in settings.activePlan, brings its plan in', () => {
  const other = { ...mine(), id: 'P-other', name: 'Other' };
  const r = cleanPlans([null, 'junk', other, mine()], 'P-other');
  assert.deepEqual(r, { active: 'P-other', list: [other] });
  assert.equal(cleanPlans([mine()], 'P-nope').active, 'default');
  assert.equal(cleanPlans([mine()]).active, 'default');
  const record = plansRecord(seedPlan, r.list, r.active);
  assert.equal(activePlan(record).name, 'Other');
});

test('restore: an older backup without plans leaves the device alone (its app.js path only runs when the file has plans)', async () => {
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');
  assert.match(src, /if \(data\.plans !== undefined\) \{\s*const plans = cleanPlans\(data\.plans, data\.settings && data\.settings\.activePlan\);\s*await writePlans\(plans\.list, plans\.active\);/);
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

test('load: the earlier build\'s bare list of user plans is read as My plan (active from settings.activePlan), so its pictures stay', () => {
  const r = loadedPlans([null, mine()], SEED, 'P-abc123');
  assert.equal(r.rewrite, true);
  assert.deepEqual(r.record, { active: 'P-abc123', list: [SEED, mine()] });
  assert.equal(loadedPlans([mine()], SEED, 'P-other').record.active, 'default');
  assert.equal(loadedPlans([mine()], SEED).record.active, 'default');
  // the sweep after the rewrite keeps the picture of the user plan's meal
  assert.deepEqual(sweepPlanPhotos({ 'U-x1': 'p1' }, { 'U-x1': 'p1' }, r.record), { planPhotos: { 'U-x1': 'p1' }, gone: [] });
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

// ——— The meal editor: S.draft, read for a save, and the plan its one writePlans call stores ———
// What saveDraft in js/app.js passes to writePlans([plan], plan.id): the record plansRecord builds from it
const saveRecord = (meal, opts) => { const plan = planFromDraft(S.draft.plan, meal, { newId: 'P-new01', ...opts }); return plansRecord(seedPlan, [plan], plan.id); };

test('editor: the first save on Default creates My plan with the change and makes it active; Default stays the seed', () => {
  S.plans = { active: 'default', list: [seedPlan] };
  assert.equal(canEditPlan(), true);
  startDraft('L-A');
  assert.notEqual(S.draft.plan, seedPlan); // a deep copy
  S.draft.meal.ingredients[1] = ['cheese', '80'];
  const r = readMeal(S.draft.meal);
  assert.equal(r.valid, true);
  const record = saveRecord(r.meal);
  assert.ok(record);
  assert.equal(record.active, 'P-new01');
  assert.deepEqual(record.list[0], SEED);
  assert.deepEqual(copy(seedPlan), SEED); // nothing wrote into the seed
  const my = record.list[1];
  assert.equal(my.id, 'P-new01');
  assert.equal(my.name, 'My plan');
  assert.deepEqual(my.meals.find((m) => m.id === 'L-A').ingredients[1], ['cheese', 80]);
  assert.deepEqual(my.meals.map((m) => m.id), SEED.meals.map((m) => m.id)); // replaced in place
  assert.deepEqual(my.foods, SEED.foods);
  // A new meal is added at the end
  startDraft(null, 'snack2', 'U-new1');
  assert.deepEqual(S.draft.meal, { id: 'U-new1', slot: 'snack2', name: '', ingredients: [] });
  Object.assign(S.draft.meal, { name: 'Chicken wrap', ingredients: [['chicken', '120'], ['bread', '45', '1 slice']] });
  const added = saveRecord(readMeal(S.draft.meal).meal).list[1];
  assert.deepEqual(added.meals.at(-1), { id: 'U-new1', slot: 'snack2', name: 'Chicken wrap', ingredients: [['chicken', 120], ['bread', 45, '1 slice']] });
  dropDraft();
});

test('editor: on My plan a save keeps its id and name; while Default is active next to My plan nothing can be edited', () => {
  S.plans = { active: 'P-abc123', list: [seedPlan, mine()] };
  assert.equal(canEditPlan(), true);
  startDraft('U-x1');
  S.draft.meal.name = 'Oats and berries';
  const record = saveRecord(readMeal(S.draft.meal).meal);
  assert.equal(record.active, 'P-abc123');
  assert.equal(record.list[1].name, 'My plan');
  assert.equal(record.list[1].meals.find((m) => m.id === 'U-x1').name, 'Oats and berries');
  S.plans = { active: 'default', list: [seedPlan, mine()] };
  assert.equal(canEditPlan(), false);
  dropDraft();
});

test('editor: cancelling drops the draft and writes nothing', () => {
  S.plans = { active: 'P-abc123', list: [seedPlan, mine()] };
  const before = copy(S.plans);
  startDraft('U-x1');
  S.draft.meal.name = 'Changed';
  S.draft.meal.ingredients.push(['egg', '50']);
  S.draft.plan.meals.length = 0;
  dropDraft();
  assert.equal(S.draft, null);
  assert.deepEqual(S.plans, before);
  assert.deepEqual(copy(seedPlan), SEED);
  // closeSheet, which every way of closing the sheet goes through, drops it
  const src = readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');
  assert.match(src, /function closeSheet\(\) \{[^}]*dropDraft\(\);/);
  // and an open draft counts as half-typed for the update check
  assert.match(src, /const working = [^;]*\|\| S\.draft;/);
});

test('editor: a valid save passes cleanPlan unchanged (whole grams, decimal comma); what is wrong blocks it', () => {
  S.plans = { active: 'default', list: [seedPlan] };
  startDraft(null, 'lunch', 'U-r1');
  Object.assign(S.draft.meal, { name: '  Chicken   wrap ', ingredients: [['chicken', '12,5'], ['bread', '0,6', '1 slice'], ['salad', '99.4', ' '], ['egg', 50.5]] });
  const r = readMeal(S.draft.meal);
  assert.equal(r.valid, true);
  assert.deepEqual(r.meal.ingredients, [['chicken', 13], ['bread', 1, '1 slice'], ['salad', 99], ['egg', 51]]);
  assert.equal(r.meal.name, 'Chicken wrap');
  const plan = planFromDraft(S.draft.plan, r.meal, { newId: 'P-r1' });
  const c = cleanPlan(plan);
  assert.equal(c.changed, false);
  assert.deepEqual(c.plan, plan);
  assert.ok(plansRecord(seedPlan, [plan], plan.id));
  // Wrong values are marked; empty ones only block the save
  const check = (meal) => readMeal({ id: 'U-r1', slot: 'lunch', name: 'X', ingredients: [['egg', '50']], ...meal });
  for (const g of ['0', '0,4', '5001', 'abc', '-5', '1e3']) {
    const x = check({ ingredients: [['egg', g]] });
    assert.equal(x.valid, false, g);
    assert.equal(x.bad.rows[0].g, true, g);
  }
  assert.equal(check({ ingredients: [['egg', '5000']] }).valid, true);
  assert.deepEqual([check({ ingredients: [['egg', '']] }).valid, check({ ingredients: [['egg', '']] }).bad.rows[0].g], [false, false]);
  assert.deepEqual([check({ name: ' ' }).valid, check({ name: ' ' }).bad.name], [false, false]);
  assert.equal(check({ name: 'x'.repeat(61) }).bad.name, true);
  assert.equal(check({ ingredients: [] }).valid, false);
  assert.equal(check({ ingredients: Array.from({ length: 13 }, () => ['egg', '10']) }).valid, false);
  assert.equal(check({ ingredients: Array.from({ length: 12 }, () => ['egg', '10']) }).valid, true);
  assert.equal(check({ ingredients: [['egg', '10', 'x'.repeat(31)]] }).bad.rows[0].m, true);
  dropDraft();
});

test('editor: deleting a meal on Default creates My plan without it', () => {
  S.plans = { active: 'default', list: [seedPlan] };
  startDraft('S2-B');
  const record = saveRecord(S.draft.plan.meals.find((m) => m.id === 'S2-B'), { remove: true });
  assert.equal(record.active, 'P-new01');
  assert.deepEqual(record.list[0], SEED);
  assert.deepEqual(record.list[1].meals.map((m) => m.id), SEED.meals.map((m) => m.id).filter((id) => id !== 'S2-B'));
  // The pictures of a meal Default still holds stay
  assert.deepEqual(sweepPlanPhotos({ 'S2-B': 'p1' }, { 'S2-B': 'p1' }, record).planPhotos, { 'S2-B': 'p1' });
  dropDraft();
});

// ——— The food form over the meal editor: Done keeps the food in the draft plan, Back leaves it, nothing is stored before Save ———
test('food form: Done adds a new food to the draft plan and as an ingredient with empty grams; the save stores it', () => {
  S.plans = { active: 'P-abc123', list: [seedPlan, mine()] };
  startDraft('U-x1');
  const form = startFood('uabc123');
  assert.equal(S.draft.food, 'uabc123');
  assert.deepEqual([form.isNew, form.name, form.v], [true, '', ['', '', '', '', '']]);
  assert.equal(readFood(form).valid, false); // empty fields block Done without a mark
  assert.deepEqual(readFood(form).bad, { name: false, v: [false, false, false, false, false] });
  Object.assign(form, { name: ' Oat  milk ', v: ['46,4', '1,04', '6.55', 1.5, '0'] });
  const r = readFood(form);
  assert.equal(r.valid, true);
  assert.deepEqual(r.food, { name: 'Oat milk', v: [46, 1, 6.6, 1.5, 0] });
  assert.equal(doneFood(r.food), 2);
  assert.equal(S.draft.food, 'uabc123'); // the form stays until it is closed, so the editor can be told which food it was
  assert.equal(S.draft.foodForm, form);
  dropFood();
  assert.equal(S.draft.food, undefined);
  assert.equal(S.draft.foodForm, undefined);
  assert.deepEqual(S.draft.plan.foods.uabc123, { name: 'Oat milk', v: [46, 1, 6.6, 1.5, 0] });
  assert.deepEqual(S.draft.meal.ingredients.at(-1), ['uabc123', '']);
  assert.equal(S.plans.list[1].foods.uabc123, undefined); // nothing stored yet
  // The save: the food passes cleanPlan unchanged
  S.draft.meal.ingredients[2][1] = '200';
  const plan = planFromDraft(S.draft.plan, readMeal(S.draft.meal).meal);
  const c = cleanPlan(plan);
  assert.equal(c.changed, false);
  assert.deepEqual(c.plan, plan);
  assert.deepEqual(plansRecord(seedPlan, [plan], plan.id).list[1].foods.uabc123, { name: 'Oat milk', v: [46, 1, 6.6, 1.5, 0] });
  dropDraft();
});

test('food form: editing a food changes it for every meal of the draft; Back leaves it as it was', () => {
  S.plans = { active: 'P-abc123', list: [seedPlan, mine()] };
  startDraft('U-x1');
  const form = startFood('u1');
  assert.deepEqual([form.isNew, form.name, form.v], [false, 'Oat drink', [45, 1, 6.5, 1.5, 0.8]]);
  assert.equal(foodUses('u1'), 1);
  assert.equal(foodUses('egg'), SEED.meals.slice(0, 3).filter((m) => m.ingredients.some((x) => x[0] === 'egg')).length);
  form.v[0] = '50';
  dropFood(); // Back
  assert.deepEqual(S.draft.plan.foods.u1, { name: 'Oat drink', v: [45, 1, 6.5, 1.5, 0.8] });
  const again = startFood('u1');
  again.v = ['50', '1', '6,5', '1,5', '0,8'];
  assert.equal(doneFood(readFood(again).food), -1); // an existing food adds no row
  assert.deepEqual(S.draft.plan.foods.u1, { name: 'Oat drink', v: [50, 1, 6.5, 1.5, 0.8] });
  assert.equal(S.draft.meal.ingredients.length, 2);
  // Cancelling the meal drops the food change too
  const before = copy(S.plans);
  dropDraft();
  assert.deepEqual(S.plans, before);
  assert.deepEqual(S.plans.list[1].foods.u1.v, [45, 1, 6.5, 1.5, 0.8]);
});

test('food form: the AI-fill photos are revoked on Done, on Back and when the meal draft is dropped', () => {
  const revoked = [];
  const orig = URL.revokeObjectURL;
  URL.revokeObjectURL = (u) => revoked.push(u);
  try {
    S.plans = { active: 'P-abc123', list: [seedPlan, mine()] };
    startDraft('U-x1');
    let form = startFood('u1');
    form.photos = [{ url: 'blob:a' }, { url: 'blob:b' }];
    doneFood(readFood(form).food);
    assert.deepEqual(revoked, []); // not yet: Done keeps the form until the editor is back
    dropFood();
    assert.deepEqual(revoked, ['blob:a', 'blob:b']);
    form = startFood('u1');
    form.photos = [{ url: 'blob:c' }];
    dropFood(); // Back
    assert.deepEqual(revoked, ['blob:a', 'blob:b', 'blob:c']);
    form = startFood('unew1');
    form.photos = [{ url: 'blob:d' }];
    dropDraft(); // the sheet closed with the form open
    assert.deepEqual(revoked, ['blob:a', 'blob:b', 'blob:c', 'blob:d']);
    dropDraft(); // no draft: nothing to do
  } finally { URL.revokeObjectURL = orig; }
});

test('food form: Done and Back go back to the editor with the food known; Settings from Add key goes back to the form', () => {
  const src = readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');
  // closeFood reads the key before the form is dropped, and Done does not drop it first
  assert.match(src, /function closeFood\(row\) \{\s*const key = S\.draft\.food;\s*dropFood\(\);/);
  assert.match(src, /if \(r\.valid\) closeFood\(doneFood\(r\.food\)\);/);
  const core = readFileSync(new URL('../js/core.js', import.meta.url), 'utf8');
  assert.doesNotMatch(core.slice(core.indexOf('export function doneFood'), core.indexOf('export function dropFood')), /dropFood\(\)/);
  // Close, Escape and a tap outside go through dismissSheet, which returns from Settings to an open food form
  assert.match(src, /function dismissSheet\(\) \{\s*if \(S\.sheet && S\.sheet\.type === 'settings' && S\.draft && S\.draft\.foodForm\)/);
  assert.match(src, /'close-sheet': \(\) => dismissSheet\(\)/);
  assert.match(src, /ev\.key === 'Escape' && !\$\('#sheet'\)\.hidden\) dismissSheet\(\)/);
  assert.match(src, /el\.dataset\.closeSheet !== undefined\) return dismissSheet\(\)/);
});

test('restoring a backup drops the meal being edited, so saving it cannot write over the restored plans', () => {
  const src = readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');
  const fn = src.slice(src.indexOf('async function importBackup'), src.indexOf('// ——— Loading and rendering'));
  const fail = fn.indexOf('} catch (err) {');
  const end = fn.indexOf('return render();', fail);
  const drop = fn.indexOf('dropDraft();');
  // only after a restore that went through: a file that cannot be read or restored leaves the draft alone
  assert.ok(fail > 0 && end > fail && drop > end, 'dropDraft after the failure path');
  assert.equal(fn.indexOf('dropDraft();', drop + 1), -1);
  assert.ok(drop < fn.indexOf('render();', end + 'return render();'.length), 'dropped before the restored data is shown');
  // with no draft left, closing Settings closes the sheet instead of reopening the food form
  assert.match(src, /function dismissSheet\(\) \{\s*if \(S\.sheet && S\.sheet\.type === 'settings' && S\.draft && S\.draft\.foodForm\)/);
});

test('food form: values out of range or not numbers are marked and block Done', () => {
  const read = (v, name = 'X') => readFood({ name, v });
  assert.equal(read([0, 0, 0, 0, 0]).valid, true);
  assert.equal(read(['1000', '100', '100', '100', '100']).valid, true);
  for (const [i, x] of [[0, '1001'], [0, 'abc'], [0, '-1'], [1, '100,1'], [2, '1e2'], [4, '101']]) {
    const v = ['100', '1', '1', '1', '1'];
    v[i] = x;
    const r = read(v);
    assert.equal(r.valid, false, x);
    assert.equal(r.bad.v[i], true, x);
  }
  assert.deepEqual([read([1, 1, 1, 1, 1], ' ').valid, read([1, 1, 1, 1, 1], ' ').bad.name], [false, false]);
  assert.equal(read([1, 1, 1, 1, 1], 'x'.repeat(61)).bad.name, true);
});

test('a save after a plans write while the editor was open keeps the newer data: only the meal and the foods the draft changed go in', () => {
  S.plans = plansRecord(seedPlan, [mine()], 'P-abc123');
  startDraft('L-A');
  S.draft.meal.name = 'Edited';
  startFood('chicken'); doneFood({ name: 'Firm tofu', v: [120, 13, 2, 7, 1] }); dropFood();
  // meanwhile (a restore) My plan gets another meal and another food value
  const newer = mine();
  newer.meals.push({ id: 'U-y2', slot: 'lunch', name: 'Newer', ingredients: [['egg', 50]] });
  newer.foods.egg = { name: 'Big egg', v: [150, 13, 1, 10, 0] };
  S.plans = plansRecord(seedPlan, [newer], 'P-abc123');
  const plan = savedPlan(S.plans, S.draft, readMeal(S.draft.meal).meal);
  assert.ok(plansRecord(seedPlan, [plan], plan.id));
  assert.equal(plan.id, 'P-abc123');
  assert.ok(plan.meals.some((m) => m.id === 'U-y2'));
  assert.equal(plan.meals.find((m) => m.id === 'L-A').name, 'Edited');
  assert.equal(plan.foods.egg.name, 'Big egg');
  assert.equal(plan.foods.chicken.name, 'Firm tofu');
  assert.equal(S.plans.list[1].meals.find((m) => m.id === 'L-A').name, SEED.meals[0].name); // the stored record is not changed
  // removing takes out only that meal
  assert.deepEqual(savedPlan(S.plans, S.draft, S.draft.meal, { remove: true }).meals.map((m) => m.id), newer.meals.filter((m) => m.id !== 'L-A').map((m) => m.id));
  dropDraft();
});

test('a save is refused when My plan the draft started from is gone, or a draft of Default would meet a user plan', () => {
  S.plans = plansRecord(seedPlan, [mine()], 'P-abc123');
  startDraft('L-A');
  S.plans = plansRecord(seedPlan, [{ ...mine(), id: 'P-other' }], 'P-other'); // a restore replaced it
  assert.equal(savedPlan(S.plans, S.draft, S.draft.meal), null);
  S.plans = plansRecord(seedPlan, [], 'default'); // or My plan was deleted
  assert.equal(savedPlan(S.plans, S.draft, S.draft.meal), null);
  dropDraft();
  startDraft('L-A'); // from Default
  S.draft.meal.name = 'First';
  S.plans = plansRecord(seedPlan, [mine()], 'P-abc123');
  assert.equal(savedPlan(S.plans, S.draft, S.draft.meal, { newId: 'P-new01' }), null);
  // the first save, with Default the only plan, still makes My plan from Default and the change
  S.plans = plansRecord(seedPlan, [], 'default');
  const plan = savedPlan(S.plans, S.draft, S.draft.meal, { newId: 'P-new01' });
  assert.equal(plan.id, 'P-new01');
  assert.equal(plan.meals.find((m) => m.id === 'L-A').name, 'First');
  assert.deepEqual(plan.foods, SEED.foods);
  dropDraft();
});

test('restoring a backup asks first, before the file is read, and the confirmations name the plans', () => {
  const app = readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');
  assert.match(app, /if \(file && window\.confirm\(t\('Restore this backup\?[^']*My plan[^']*'\)\)\) await importBackup\(file\)/);
  assert.match(app, /Clear your log\?[^']*plans \(My plan and Default\)/);
  assert.match(app, /Factory reset: [^']*My plan \(Default comes back\)/);
});
