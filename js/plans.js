// Plan, meal and food data operations. Pure: no DOM, no storage, and no input is changed. Each function takes the plans array
// (the user plans; the default plan is built in and never in it) and returns { plans, ... } or { error } with a T-marked message for td().
import { DEFAULT_PLAN, DEFAULT_PLAN_ID, PLAN_LIMITS, copyPlan, has } from './plan.js';
import { T, parseNum } from './i18n.js';

export const SLOT_IDS = ['lunch', 'snack1', 'snack2', 'dinner', 'late', 'workout'];
const NAME_MAX = 60; // a meal or plan name
const FOOD_NAME_MAX = 40; // a food name reaches the model prompt, which caps it at the same length
const MEASURE_MAX = 30;
const MEAL_ID = /^[A-Za-z][\w-]{0,19}$/; // entries store planId sliced to 20 characters
const FOOD_KEY = /^[A-Za-z][\w-]{0,29}$/;

// db.js (where uid lives) imports core.js, so this module keeps its own copy
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const round1 = (x) => Math.round(x * 10) / 10;
// One line of typed text: control characters (newlines too) become spaces, runs of spaces collapse
const oneLine = (s) => String(s ?? '').replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ').replace(/\s+/g, ' ').trim();
// A key from outside must not find "constructor" or "__proto__"
const goodKey = (re, k) => typeof k === 'string' && re.test(k) && !(k in Object.prototype);
const findIdx = (plans, id) => plans.findIndex((p) => p.id === id);
const swap = (plans, i, plan) => plans.map((p, j) => (j === i ? plan : p));
const fresh = (taken, make) => { let id; do id = make(); while (taken.includes(id)); return id; };

// The plan for an id, or the default plan when there is none (a deleted plan, a bad backup), and the id that is really in use
export function resolvePlan(plans, id) {
  const plan = plans.find((p) => p.id === id);
  return plan ? { plan, id: plan.id } : { plan: DEFAULT_PLAN, id: DEFAULT_PLAN_ID };
}

// A deep copy of basePlan under a new id; a blank name becomes "My plan"
export function newPlanFrom(plans, basePlan, name) {
  if (plans.length >= PLAN_LIMITS.plans) return { error: T('Too many plans. Delete one first.') };
  const nm = oneLine(name) || T('My plan');
  if (nm.length > NAME_MAX) return { error: T('That name is too long.') };
  const plan = { ...copyPlan(basePlan), id: fresh(plans.map((p) => p.id), () => 'P-' + uid()), name: nm };
  return { plans: [...plans, plan], plan };
}

// Copy-on-edit: a user plan is edited where it is; the default (or a missing plan) is copied to "My plan" first
export function ensureCustom(plans, activeId) {
  const own = plans.find((p) => p.id === activeId);
  if (own) return { plans, plan: own, created: false };
  const r = newPlanFrom(plans, resolvePlan(plans, activeId).plan);
  return r.error ? r : { ...r, created: true };
}

export function renamePlan(plans, id, name) {
  const i = findIdx(plans, id);
  if (i < 0) return { error: id === DEFAULT_PLAN_ID ? T('The default plan cannot be changed.') : T('That plan was not found.') };
  const nm = oneLine(name);
  if (!nm) return { error: T('Give it a name.') };
  if (nm.length > NAME_MAX) return { error: T('That name is too long.') };
  return { plans: swap(plans, i, { ...plans[i], name: nm }) };
}

// orphaned: meal ids that no remaining plan, and not the default plan, still holds (their photos can go)
export function deletePlan(plans, id) {
  const i = findIdx(plans, id);
  if (i < 0) return { error: id === DEFAULT_PLAN_ID ? T('The default plan cannot be changed.') : T('That plan was not found.') };
  const rest = plans.filter((_, j) => j !== i);
  return { plans: rest, orphaned: orphanedIds(plans[i].meals.map((m) => m.id), rest) };
}
const orphanedIds = (ids, plans) => {
  const kept = new Set([...DEFAULT_PLAN.meals, ...plans.flatMap((p) => p.meals)].map((m) => m.id));
  return ids.filter((id) => !kept.has(id));
};

// draft: { id?, name, slot, ingredients: [[foodKey, grams (a number or typed text), measure?]] }. Returns { meal } or { error }
export function validateMeal(draft, plan) {
  const name = oneLine(draft?.name);
  if (!name) return { error: T('Give the meal a name.') };
  if (name.length > NAME_MAX) return { error: T('That name is too long.') };
  if (!SLOT_IDS.includes(draft.slot)) return { error: T('Pick a slot for the meal.') };
  const rows = draft.ingredients;
  if (!Array.isArray(rows) || !rows.length) return { error: T('Add at least one ingredient.') };
  if (rows.length > PLAN_LIMITS.ingredients) return { error: T('Too many ingredients.') };
  const ingredients = [];
  for (const row of rows) {
    const [key, raw, measure] = Array.isArray(row) ? row : [];
    if (!goodKey(FOOD_KEY, key) || !has(plan.foods, key)) return { error: T('Pick a food for every ingredient.') };
    const grams = typeof raw === 'number' ? raw : parseNum(raw);
    if (!(grams >= 1 && grams <= PLAN_LIMITS.grams)) return { error: T('Grams must be a number from 1 to 5000.') };
    const m = oneLine(measure).slice(0, MEASURE_MAX);
    ingredients.push(m ? [key, round1(grams), m] : [key, round1(grams)]);
  }
  const meal = { id: draft.id, slot: draft.slot, name, ingredients };
  if (draft.id !== undefined && !goodKey(MEAL_ID, draft.id)) return { error: T('That meal was not found.') };
  return { meal };
}

// Saves a meal in a user plan: a draft with the id of a meal in the plan replaces it, one without an id is added with a new id
export function saveMeal(plans, planId, draft) {
  const i = findIdx(plans, planId);
  if (i < 0) return { error: planId === DEFAULT_PLAN_ID ? T('The default plan cannot be changed.') : T('That plan was not found.') };
  const plan = plans[i];
  const v = validateMeal(draft, plan);
  if (v.error) return v;
  const at = draft.id === undefined ? -1 : plan.meals.findIndex((m) => m.id === draft.id);
  if (draft.id !== undefined && at < 0) return { error: T('That meal was not found.') };
  if (at < 0 && plan.meals.length >= PLAN_LIMITS.meals) return { error: T('Too many meals in this plan.') };
  const meal = { ...v.meal, id: at < 0 ? fresh(plan.meals.map((m) => m.id), () => 'U-' + uid()) : draft.id };
  const meals = at < 0 ? [...plan.meals, meal] : plan.meals.map((m, j) => (j === at ? meal : m));
  return { plans: swap(plans, i, { ...copyPlan(plan), meals }), meal };
}

export function deleteMeal(plans, planId, mealId) {
  const i = findIdx(plans, planId);
  if (i < 0) return { error: planId === DEFAULT_PLAN_ID ? T('The default plan cannot be changed.') : T('That plan was not found.') };
  const plan = plans[i];
  if (!plan.meals.some((m) => m.id === mealId)) return { error: T('That meal was not found.') };
  const own = copyPlan(plan);
  const next = { ...own, meals: own.meals.filter((m) => m.id !== mealId) };
  const plansNext = swap(plans, i, next);
  return { plans: plansNext, orphaned: orphanedIds([mealId], plansNext) };
}

// draft: { key?, name, v: [kcal, protein, carbs, fat, fibre] per 100 g, each a number or typed text }. Returns { food: { name, v } } or { error }
export function validateFood(draft) {
  const name = oneLine(draft?.name);
  if (!name) return { error: T('Give the food a name.') };
  if (name.length > FOOD_NAME_MAX) return { error: T('That name is too long.') };
  if (!Array.isArray(draft.v) || draft.v.length !== 5) return { error: T('Enter all five values per 100 g.') };
  const v = draft.v.map((x) => (typeof x === 'number' ? x : parseNum(x)));
  if (v.some((x) => !Number.isFinite(x) || x < 0)) return { error: T('Enter all five values per 100 g.') };
  if (v[0] > PLAN_LIMITS.kcal) return { error: T('Calories per 100 g can be at most 1000.') };
  if (v.slice(1).some((x) => x > PLAN_LIMITS.per100)) return { error: T('Protein, carbs, fat and fibre per 100 g can be at most 100 each.') };
  return { food: { name, v: v.map(round1) } };
}

// Saves a food in a user plan: a draft with the key of a food in the plan replaces it, one without a key is added with a new key
export function saveFood(plans, planId, draft) {
  const i = findIdx(plans, planId);
  if (i < 0) return { error: planId === DEFAULT_PLAN_ID ? T('The default plan cannot be changed.') : T('That plan was not found.') };
  const plan = plans[i];
  const v = validateFood(draft);
  if (v.error) return v;
  const edit = draft.key !== undefined;
  if (edit && (!goodKey(FOOD_KEY, draft.key) || !has(plan.foods, draft.key))) return { error: T('That food was not found.') };
  if (!edit && Object.keys(plan.foods).length >= PLAN_LIMITS.foods) return { error: T('Too many foods in this plan.') };
  const key = edit ? draft.key : fresh(Object.keys(plan.foods), () => 'u' + uid());
  const next = copyPlan(plan);
  next.foods[key] = v.food;
  return { plans: swap(plans, i, next), key };
}

export function deleteFood(plans, planId, key) {
  const i = findIdx(plans, planId);
  if (i < 0) return { error: planId === DEFAULT_PLAN_ID ? T('The default plan cannot be changed.') : T('That plan was not found.') };
  const plan = plans[i];
  if (!has(plan.foods, key)) return { error: T('That food was not found.') };
  if (plan.meals.some((m) => m.ingredients.some(([k]) => k === key))) return { error: T('A meal uses this food. Remove it from the meal first.') };
  const next = copyPlan(plan);
  delete next.foods[key];
  return { plans: swap(plans, i, next) };
}
