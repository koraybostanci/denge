// applyPlan swaps the plan in use inside FOODS, MEALS and MEAL_BY_ID, which stay the same objects. `node --test`
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  FOODS, MEALS, MEAL_BY_ID, DEFAULT_PLAN, DEFAULT_PLAN_ID, DEFAULT_FOODS, DEFAULT_TEMPLATES, PLAN_LIMITS, ACTIVE_ID,
  applyPlan, copyPlan, isDefaultActive, macros, planDigest, planFoods,
} from '../js/plan.js';
import * as plan from '../js/plan.js';
import { entrySystem, checkSystem } from '../js/ai.js';

afterEach(() => applyPlan(DEFAULT_PLAN));

const custom = () => ({
  id: 'P-test', name: 'Mine',
  foods: { oats: { name: 'Oats', v: [380, 13, 60, 7, 10] }, milk: { name: 'Milk', v: [50, 3.4, 5, 1.8, 0] } },
  meals: [
    { id: 'U-1', slot: 'lunch', name: 'Porridge', ingredients: [['oats', 50, '5 tbsp'], ['milk', 200], ['ghost', 30]] },
    { id: 'U-2', slot: 'dinner', name: 'Milk', ingredients: [['milk', 250]] },
  ],
});

test('the default plan is the one in use at start', () => {
  assert.equal(ACTIVE_ID, DEFAULT_PLAN_ID);
  assert.equal(plan.ACTIVE_ID, 'default');
  assert.ok(isDefaultActive());
  assert.equal(MEALS.length, DEFAULT_TEMPLATES.length);
  assert.equal(Object.keys(FOODS).length, Object.keys(DEFAULT_FOODS).length);
  assert.equal(MEAL_BY_ID['L-A'], MEALS[0]);
  assert.ok(PLAN_LIMITS.meals > 0);
});

test('applyPlan changes the same objects and applyPlan(DEFAULT_PLAN) restores them exactly', () => {
  const before = structuredClone({ FOODS, MEALS, MEAL_BY_ID });
  const refs = [FOODS, MEALS, MEAL_BY_ID];
  applyPlan(custom());
  assert.deepEqual([FOODS, MEALS, MEAL_BY_ID], refs);
  assert.ok(refs[0] === FOODS && refs[1] === MEALS && refs[2] === MEAL_BY_ID);
  assert.deepEqual(Object.keys(FOODS), ['oats', 'milk']);
  assert.deepEqual(MEALS.map((m) => m.id), ['U-1', 'U-2']);
  assert.deepEqual(Object.keys(MEAL_BY_ID), ['U-1', 'U-2']);
  assert.equal(MEAL_BY_ID['L-A'], undefined);
  assert.equal(plan.ACTIVE_ID, 'P-test');
  assert.ok(!isDefaultActive());
  applyPlan(DEFAULT_PLAN);
  assert.deepEqual({ FOODS, MEALS, MEAL_BY_ID }, before);
  assert.ok(isDefaultActive());
});

test('an ingredient whose food is missing is dropped, and the numbers follow the rest', () => {
  applyPlan(custom());
  const m = MEAL_BY_ID['U-1'];
  assert.deepEqual(m.ingredients, [['oats', 50, '5 tbsp'], ['milk', 200]]);
  assert.equal(m.items.length, 2);
  assert.equal(m.kcal, Math.round(380 * 0.5 + 50 * 2));
  assert.deepEqual(m.items[0], { n: 'Oats', g: 50, measure: '5 tbsp', kcal: 190, p: 6.5 });
  assert.equal(m.items[1].measure, '');
});

test('macros skips unknown foods and names that only exist on Object.prototype', () => {
  assert.deepEqual(macros([['nope', 100], ['constructor', 100], ['__proto__', 5]]), { kcal: 0, p: 0, c: 0, f: 0, fib: 0 });
  assert.equal(macros([['egg', 100], ['nope', 100]]).kcal, 143);
});

test('the active plan is a copy: changing MEALS never changes the plan', () => {
  const p = custom();
  const snap = structuredClone(p);
  applyPlan(p);
  MEALS[0].ingredients.push(['milk', 1]);
  MEALS[0].ingredients[0][1] = 999;
  FOODS.oats.v[0] = 1;
  FOODS.extra = { name: 'X', v: [1, 1, 1, 1, 1] };
  assert.deepEqual(p, snap);
  applyPlan(DEFAULT_PLAN);
  MEALS[0].ingredients.push(['egg', 1]);
  FOODS.egg.v[0] = 1;
  assert.equal(DEFAULT_TEMPLATES[0].ingredients.length, 6);
  assert.equal(DEFAULT_FOODS.egg.v[0], 143);
});

test('copyPlan shares nothing with its source', () => {
  const c = copyPlan(DEFAULT_PLAN);
  assert.deepEqual(c, DEFAULT_PLAN);
  c.meals[0].ingredients[0][1] = 1;
  c.foods.egg.v[0] = 1;
  c.meals.pop();
  assert.equal(DEFAULT_PLAN.meals[0].ingredients[0][1], 106);
  assert.equal(DEFAULT_FOODS.egg.v[0], 143);
  assert.equal(DEFAULT_PLAN.meals.length, DEFAULT_TEMPLATES.length);
});

test('an empty plan leaves empty tables and an empty digest', () => {
  applyPlan({ id: 'P-empty', name: 'Empty', foods: {}, meals: [] });
  assert.equal(MEALS.length, 0);
  assert.deepEqual(Object.keys(FOODS), []);
  assert.equal(planDigest(), '');
  assert.equal(planFoods(), '');
});

// sha256 of the prompts at HEAD before the plan became swappable (3027 and 2972 characters)
const sha = (s) => createHash('sha256').update(s).digest('hex');
test('the English prompts for the default plan are byte-identical to before', () => {
  const e = entrySystem();
  const c = checkSystem();
  assert.equal(e.length, 3027);
  assert.equal(c.length, 2972);
  assert.equal(sha(e), '23d6973249b399fba2438a2280b9fd320b40bb7a0045c9aa62cf5883afa90b78');
  assert.equal(sha(c), '5d940e0f94e89cb927e6f3f70b5eb97e68d5ec04547a4ccf0d13c09345fc9dc2');
});

test('the prompts are built per request: a custom plan changes them and the default brings them back', () => {
  const e0 = entrySystem();
  const c0 = checkSystem();
  applyPlan(custom());
  assert.notEqual(entrySystem(), e0);
  assert.notEqual(checkSystem(), c0);
  assert.ok(entrySystem().includes('U-1: Oats 50g, Milk 200g'));
  assert.ok(checkSystem().includes('The plan is built from: Oats, Milk.'));
  assert.ok(!entrySystem().includes('L-A:'));
  applyPlan(DEFAULT_PLAN);
  assert.equal(entrySystem(), e0);
  assert.equal(checkSystem(), c0);
});
