// The pure plan operations in js/plans.js. Inputs are frozen, so a function that changes its input throws.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_PLAN, DEFAULT_PLAN_ID, PLAN_LIMITS } from '../js/plan.js';
import {
  resolvePlan, newPlanFrom, ensureCustom, renamePlan, deletePlan, validateMeal, saveMeal, deleteMeal, validateFood, saveFood, deleteFood,
} from '../js/plans.js';

const deepFreeze = (o) => { if (o && typeof o === 'object' && !Object.isFrozen(o)) { Object.freeze(o); Object.values(o).forEach(deepFreeze); } return o; };
const mk = (id, extra = {}) => ({
  id, name: id,
  foods: { oats: { name: 'Oats', v: [380, 13, 60, 7, 10] }, milk: { name: 'Milk', v: [50, 3.4, 5, 1.8, 0] } },
  meals: [{ id: 'U-1', slot: 'lunch', name: 'Porridge', ingredients: [['oats', 50, '5 tbsp'], ['milk', 200]] }],
  ...extra,
});
const draft = (extra = {}) => ({ name: 'Snack', slot: 'snack1', ingredients: [['milk', 250]], ...extra });
const many = (n) => Array.from({ length: n }, (_, i) => mk('P-' + i));

test('resolvePlan finds a plan, or falls back to the default', () => {
  const plans = deepFreeze([mk('P-a')]);
  assert.deepEqual(resolvePlan(plans, 'P-a'), { plan: plans[0], id: 'P-a' });
  assert.deepEqual(resolvePlan(plans, 'P-gone'), { plan: DEFAULT_PLAN, id: DEFAULT_PLAN_ID });
  assert.equal(resolvePlan(plans, 'default').plan, DEFAULT_PLAN);
  assert.equal(resolvePlan(plans, '__proto__').id, 'default');
});

test('newPlanFrom copies deeply under a new id and names it', () => {
  const plans = deepFreeze([mk('P-a')]);
  const r = newPlanFrom(plans, plans[0], 'Winter\nplan');
  assert.equal(r.plans.length, 2);
  assert.equal(r.plan.name, 'Winter plan');
  assert.match(r.plan.id, /^P-\w+$/);
  assert.ok(r.plan.id.length <= 30 && r.plan.id !== 'P-a');
  assert.notEqual(r.plan.meals[0], plans[0].meals[0]);
  assert.notEqual(r.plan.meals[0].ingredients[0], plans[0].meals[0].ingredients[0]);
  assert.deepEqual(r.plan.meals, plans[0].meals);
  assert.equal(newPlanFrom([], DEFAULT_PLAN, '  ').plan.name, 'My plan');
  assert.deepEqual(newPlanFrom([], DEFAULT_PLAN).plan.meals, DEFAULT_PLAN.meals);
});

test('newPlanFrom refuses beyond 10 plans and long names', () => {
  assert.equal(newPlanFrom(deepFreeze(many(PLAN_LIMITS.plans - 1)), DEFAULT_PLAN).plans.length, PLAN_LIMITS.plans);
  assert.ok(newPlanFrom(deepFreeze(many(PLAN_LIMITS.plans)), DEFAULT_PLAN).error);
  assert.ok(newPlanFrom([], DEFAULT_PLAN, 'x'.repeat(61)).error);
});

test('ensureCustom keeps a user plan and copies the default', () => {
  const plans = deepFreeze([mk('P-a')]);
  const own = ensureCustom(plans, 'P-a');
  assert.equal(own.created, false);
  assert.equal(own.plans, plans);
  assert.equal(own.plan, plans[0]);
  const copy = ensureCustom(plans, DEFAULT_PLAN_ID);
  assert.equal(copy.created, true);
  assert.equal(copy.plans.length, 2);
  assert.equal(copy.plan.name, 'My plan');
  assert.equal(copy.plan, copy.plans[1]);
  assert.deepEqual(copy.plan.meals, DEFAULT_PLAN.meals);
  assert.notEqual(copy.plan.meals, DEFAULT_PLAN.meals);
  assert.equal(ensureCustom(plans, 'P-gone').created, true); // a missing plan is the default
  assert.ok(ensureCustom(deepFreeze(many(PLAN_LIMITS.plans)), DEFAULT_PLAN_ID).error);
});

test('renamePlan', () => {
  const plans = deepFreeze([mk('P-a'), mk('P-b')]);
  const r = renamePlan(plans, 'P-b', ' New\tname ');
  assert.deepEqual(r.plans.map((p) => p.name), ['P-a', 'New name']);
  assert.equal(r.plans[0], plans[0]);
  assert.ok(renamePlan(plans, 'P-b', ' \n ').error);
  assert.ok(renamePlan(plans, 'P-b', 'x'.repeat(61)).error);
  assert.ok(renamePlan(plans, 'P-gone', 'x').error);
  assert.ok(renamePlan(plans, 'default', 'x').error);
});

test('deletePlan lists the meal ids nothing else holds, and the active plan falls back to the default', () => {
  const a = mk('P-a', { meals: [{ id: 'U-1', slot: 'lunch', name: 'A', ingredients: [['milk', 1]] }, { id: 'U-2', slot: 'lunch', name: 'B', ingredients: [['milk', 1]] }, { id: 'L-A', slot: 'lunch', name: 'C', ingredients: [['milk', 1]] }] });
  const b = mk('P-b', { meals: [{ id: 'U-2', slot: 'lunch', name: 'B', ingredients: [['milk', 1]] }] });
  const plans = deepFreeze([a, b]);
  const r = deletePlan(plans, 'P-a');
  assert.deepEqual(r.plans, [b]);
  assert.deepEqual(r.orphaned, ['U-1']); // U-2 is in P-b, L-A is in the default plan
  assert.deepEqual(resolvePlan(r.plans, 'P-a').id, 'default'); // deleting the active plan
  assert.deepEqual(deletePlan(plans, 'P-b').orphaned, []);
  assert.ok(deletePlan(plans, 'P-gone').error);
  assert.ok(deletePlan(plans, 'default').error);
});

test('validateMeal accepts a good draft and cleans it', () => {
  const plan = deepFreeze(mk('P-a'));
  const r = validateMeal(deepFreeze(draft({ name: ' Milk\nand\r\noats\u0000 ', ingredients: [['milk', '12,5', ' 1\ncup '], ['oats', 30.04], ['milk', '8']] })), plan);
  assert.deepEqual(r.meal.name, 'Milk and oats');
  assert.deepEqual(r.meal.ingredients, [['milk', 12.5, '1 cup'], ['oats', 30], ['milk', 8]]);
  assert.equal(validateMeal(draft({ ingredients: [['milk', '12.5']] }), plan).meal.ingredients[0][1], 12.5);
  for (const slot of ['lunch', 'snack1', 'snack2', 'dinner', 'late', 'workout']) assert.ok(validateMeal(draft({ slot }), plan).meal);
});

test('validateMeal rejects bad drafts', () => {
  const plan = deepFreeze(mk('P-a'));
  const bad = (extra) => assert.ok(validateMeal(draft(extra), plan).error, JSON.stringify(extra));
  bad({ name: '' });
  bad({ name: '\n \t' });
  bad({ name: 'x'.repeat(61) });
  bad({ slot: 'breakfast' });
  bad({ slot: undefined });
  bad({ ingredients: [] });
  bad({ ingredients: 'milk' });
  bad({ ingredients: Array.from({ length: 13 }, () => ['milk', 10]) });
  bad({ ingredients: [['ghost', 10]] });
  bad({ ingredients: [['constructor', 10]] });
  bad({ ingredients: [['__proto__', 10]] });
  bad({ ingredients: [['toString', 10]] });
  for (const g of [0, 0.5, -3, 5001, 'abc', '', '1e3', '12,5,1']) bad({ ingredients: [['milk', g]] });
  bad({ id: '__proto__' });
  bad({ id: 'x'.repeat(21) });
  assert.ok(validateMeal(null, plan).error);
  assert.equal(validateMeal(draft({ ingredients: Array.from({ length: 12 }, () => ['milk', 10]) }), plan).meal.ingredients.length, 12);
  assert.ok(validateMeal(draft({ ingredients: [['milk', 5000]] }), plan).meal);
});

test('saveMeal adds with a new id, replaces by id, and leaves other plans alone', () => {
  const plans = deepFreeze([mk('P-a'), mk('P-b')]);
  const added = saveMeal(plans, 'P-a', draft());
  assert.match(added.meal.id, /^U-\w+$/);
  assert.equal(added.meal.id.length, 16);
  assert.equal(added.plans[0].meals.length, 2);
  assert.equal(added.plans[1], plans[1]);
  assert.deepEqual(added.plans[0].foods, plans[0].foods);
  const edited = saveMeal(added.plans, 'P-a', draft({ id: 'U-1', name: 'Renamed' }));
  assert.deepEqual(edited.plans[0].meals.map((m) => m.name), ['Renamed', 'Snack']);
  assert.equal(edited.meal.id, 'U-1');
  assert.ok(saveMeal(plans, 'P-a', draft({ id: 'U-nope' })).error);
  assert.ok(saveMeal(plans, 'P-a', draft({ name: '' })).error);
  assert.ok(saveMeal(plans, 'P-gone', draft()).error);
  assert.ok(saveMeal(plans, 'default', draft()).error);
  const full = deepFreeze([mk('P-f', { meals: Array.from({ length: PLAN_LIMITS.meals }, (_, i) => ({ id: 'U-' + i, slot: 'lunch', name: 'm', ingredients: [['milk', 1]] })) })]);
  assert.ok(saveMeal(full, 'P-f', draft()).error);
  assert.ok(saveMeal(full, 'P-f', draft({ id: 'U-3' })).meal); // editing is still fine at the cap
});

test('deleteMeal', () => {
  const plans = deepFreeze([mk('P-a'), mk('P-b')]);
  const r = deleteMeal(plans, 'P-a', 'U-1');
  assert.deepEqual(r.plans[0].meals, []);
  assert.deepEqual(r.orphaned, []); // P-b still holds U-1
  assert.deepEqual(deleteMeal(deleteMeal(plans, 'P-b', 'U-1').plans, 'P-a', 'U-1').orphaned, ['U-1']);
  assert.ok(deleteMeal(plans, 'P-a', 'U-9').error);
  assert.ok(deleteMeal(plans, 'P-gone', 'U-1').error);
  assert.ok(deleteMeal(plans, 'default', 'L-A').error);
});

test('validateFood and its per-100 g caps', () => {
  const ok = validateFood(deepFreeze({ name: ' Rice\n', v: ['130', '2,7', 28, '0.3', 0.4] }));
  assert.deepEqual(ok.food, { name: 'Rice', v: [130, 2.7, 28, 0.3, 0.4] });
  assert.ok(validateFood({ name: 'Oil', v: [1000, 100, 100, 100, 100] }).food);
  assert.ok(validateFood({ name: 'Water', v: [0, 0, 0, 0, 0] }).food);
  const bad = (d) => assert.ok(validateFood(d).error, JSON.stringify(d));
  bad({ name: '', v: [1, 1, 1, 1, 1] });
  bad({ name: 'x'.repeat(41), v: [1, 1, 1, 1, 1] });
  bad({ name: 'x', v: [1, 1, 1, 1] });
  bad({ name: 'x', v: 'nope' });
  bad({ name: 'x', v: [1001, 1, 1, 1, 1] });
  for (let i = 1; i < 5; i++) bad({ name: 'x', v: [1, 1, 1, 1, 1].map((n, j) => (j === i ? 100.1 : n)) });
  bad({ name: 'x', v: [-1, 1, 1, 1, 1] });
  bad({ name: 'x', v: ['abc', 1, 1, 1, 1] });
  bad({ name: 'x', v: [NaN, 1, 1, 1, 1] });
  bad(undefined);
});

test('saveFood adds with a new key, replaces by key, and refuses bad input', () => {
  const plans = deepFreeze([mk('P-a')]);
  const added = saveFood(plans, 'P-a', { name: 'Rice', v: [130, 2.7, 28, 0.3, 0.4] });
  assert.match(added.key, /^u\w+$/);
  assert.deepEqual(added.plans[0].foods[added.key], { name: 'Rice', v: [130, 2.7, 28, 0.3, 0.4] });
  assert.equal(Object.keys(added.plans[0].foods).length, 3);
  assert.deepEqual(plans[0].foods.oats.v, [380, 13, 60, 7, 10]);
  const edited = saveFood(plans, 'P-a', { key: 'oats', name: 'Big oats', v: [1, 1, 1, 1, 1] });
  assert.equal(edited.plans[0].foods.oats.name, 'Big oats');
  assert.equal(Object.keys(edited.plans[0].foods).length, 2);
  for (const key of ['ghost', '__proto__', 'constructor', 'toString']) assert.ok(saveFood(plans, 'P-a', { key, name: 'x', v: [1, 1, 1, 1, 1] }).error, key);
  assert.ok(saveFood(plans, 'P-a', { name: '', v: [1, 1, 1, 1, 1] }).error);
  assert.ok(saveFood(plans, 'P-gone', { name: 'x', v: [1, 1, 1, 1, 1] }).error);
  assert.ok(saveFood(plans, 'default', { name: 'x', v: [1, 1, 1, 1, 1] }).error);
  const foods = Object.fromEntries(Array.from({ length: PLAN_LIMITS.foods }, (_, i) => ['f' + i, { name: 'f', v: [1, 1, 1, 1, 1] }]));
  const full = deepFreeze([mk('P-f', { foods, meals: [] })]);
  assert.ok(saveFood(full, 'P-f', { name: 'x', v: [1, 1, 1, 1, 1] }).error);
  assert.ok(saveFood(full, 'P-f', { key: 'f3', name: 'x', v: [1, 1, 1, 1, 1] }).plans);
});

test('deleteFood is refused while a meal uses the food', () => {
  const plans = deepFreeze([mk('P-a')]);
  assert.ok(deleteFood(plans, 'P-a', 'milk').error);
  assert.ok(deleteFood(plans, 'P-a', 'oats').error);
  const gone = deleteFood(deleteMeal(plans, 'P-a', 'U-1').plans, 'P-a', 'milk');
  assert.deepEqual(Object.keys(gone.plans[0].foods), ['oats']);
  assert.ok(deleteFood(plans, 'P-a', 'ghost').error);
  assert.ok(deleteFood(plans, 'P-a', '__proto__').error);
  assert.ok(deleteFood(plans, 'P-gone', 'milk').error);
  assert.ok(deleteFood(plans, 'default', 'egg').error);
});

test('a new meal and a new food from the default plan copy are usable together', () => {
  const copy = ensureCustom(deepFreeze([]), DEFAULT_PLAN_ID);
  const f = saveFood(copy.plans, copy.plan.id, { name: 'Rice', v: [130, 2.7, 28, 0.3, 0.4] });
  const m = saveMeal(f.plans, copy.plan.id, draft({ ingredients: [[f.key, '150']] }));
  assert.ok(m.meal);
  assert.ok(deleteFood(m.plans, copy.plan.id, f.key).error);
});
