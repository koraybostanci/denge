// Plan v2: slots, targets and rules, and buildPlan, which works out a plan's meals from its food table.
// Meal values are never typed by hand; they are computed from the plan's per-100 g table (the shipped one is js/default-plan.js).

// Number and date formatting for the whole app
import { LOCALE, T, t } from './i18n.js';
export { LOCALE }; // follows the interface language (a live binding)

const round1 = (x) => Math.round(x * 10) / 10;

// A plan as stored ({ id, name, foods, meals: [{ id, slot, name, ingredients: [[food, grams, measure?]] }] }) with each meal's
// macros and items worked out from the food table. An ingredient whose food is not in the table is left out.
export function buildPlan(raw) {
  const foods = raw.foods || {};
  const meals = (raw.meals || []).map((m) => {
    const ingredients = m.ingredients.filter(([k]) => has(foods, k));
    const s = [0, 0, 0, 0, 0];
    for (const [k, g] of ingredients) foods[k].v.forEach((v, i) => { s[i] += (v * g) / 100; });
    return {
      ...m, ingredients,
      kcal: Math.round(s[0]), p: round1(s[1]), c: round1(s[2]), f: round1(s[3]), fib: round1(s[4]),
      items: ingredients.map(([k, g, measure]) => ({
        n: foods[k].name, g, measure: measure || '',
        kcal: Math.round((foods[k].v[0] * g) / 100),
        p: round1((foods[k].v[1] * g) / 100),
      })),
    };
  });
  return { id: raw.id, name: raw.name, foods, meals };
}

// Own keys only: a lookup with text from outside must not find "constructor" or "__proto__"
export const has = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);

export const SLOTS = [
  { id: 'lunch', name: T('Lunch'), time: '12:00' },
  { id: 'snack1', name: T('Snack 1'), time: '14:30' },
  { id: 'snack2', name: T('Snack 2'), time: '16:00' },
  { id: 'dinner', name: T('Dinner'), time: '18:00' },
  { id: 'late', name: T('Late'), time: '20:00' },
];
export const SLOT_NAME = {
  morning: T('Morning'), lunch: T('Lunch'), snack1: T('Snack 1'), snack2: T('Snack 2'),
  dinner: T('Dinner'), late: T('Late'), workout: T('Workout'),
};

export function slotByTime(d) {
  const h = d.getHours() + d.getMinutes() / 60;
  if (h < 10.5) return 'morning';
  if (h < 13.75) return 'lunch';
  if (h < 15.5) return 'snack1';
  if (h < 17.25) return 'snack2';
  if (h < 20) return 'dinner';
  return 'late';
}

// One-tap items that count against the weekly flex budget
export const FLEX = [
  { id: 'F-BEER33', name: T('Beer 0.33 l'), kcal: 140, p: 1, c: 11, f: 0, fib: 0, flags: ['alcohol'] },
  { id: 'F-BEER50', name: T('Beer 0.5 l'), kcal: 215, p: 2, c: 17, f: 0, fib: 0, flags: ['alcohol'] },
];

// The default of the Minimum kcal setting: daily calories are never set or advised below it, and a day under it does not count as on plan
export const KCAL_MIN_DAY = 1500;
export const DEFAULTS = {
  startDate: '2026-10-05',
  startKg: 87,
  targetDate: '2026-12-31',
  targetKg: 78,
  kcalRest: 1550,
  kcalTrain: 1750,
  kcalMinDay: KCAL_MIN_DAY,
  protein: 135,
  proteinMin: 120,
  fiber: 30,
  steps: 8000,
  water: 2500,
  model: 'claude-haiku-4-5-20251001',
};

// Numbers that the rules text, the checks and the screens must agree on
export const SMALL_TREAT_KCAL = 250; // a flex entry up to this size (or any alcohol) is a "small" treat, not the weekly flexible dinner
const num = (x) => x.toLocaleString(LOCALE);

// The process rules, with the calorie floor as set (the Plan tab passes the saved one; RULES.process uses the default)
export const processRules = (kcalMinDay) => [
  t('Weigh in every morning under the same conditions. Read the 7-day average, not a single day.'),
  t('If the average sits more than 0.7 kg above the line two weeks in a row: cut 100 kcal or add 2,000 steps.'),
  t('Do not go below {kcal} kcal.', { kcal: num(kcalMinDay) }),
  t('On reaching {kg} kg, raise calories to maintenance gradually over 2 to 3 weeks.', { kg: DEFAULTS.targetKg }),
];

// Each group is built when it is read, so the text and the numbers follow the language (and a prompt can ask for them in English)
export const RULES = {
  get daily() {
    return [
      t('At least 2 to 2.5 litres of water a day.'),
      t('{steps} steps a day. With a desk job this is the cheapest part of the deficit.', { steps: num(DEFAULTS.steps) }),
      t('Meat, chicken and fish are weighed raw.'),
      t('Cooking and salad oil is measured: 1 tsp of olive oil is about 45 kcal.'),
      t('Nuts are raw and unsalted, 20 to 25 g, and weighed. Walnuts, almonds, hazelnuts and peanuts follow the same rule.'),
      t('Two portions of fruit a day. Total calories decide the outcome, not the fruit itself.'),
      t('If you add potato to the salad, skip the bread that day. Boiled and cooled potato keeps you full longer.'),
      t('After 20:00, herbal tea. If you are very hungry or short on protein, 150 g of plain skyr.'),
    ];
  },
  get weekly() {
    return [
      t('One flexible dinner (eating out or off plan), around 700 kcal.'),
      t('One beer (0.33 l) or one small dessert up to {kcal} kcal. No crisps, peanuts or fried food with it.', { kcal: SMALL_TREAT_KCAL }),
    ];
  },
  get off() {
    return [
      t('Sugary drinks: cola, soda, fruit juice.'),
      t('Deep-fried food, including fries.'),
      t('Crisps and salted, roasted nuts.'),
      t('Pastries: simit, poğaça, börek, croissant, pretzel.'),
      t('White bread, toast bread, lavash.'),
    ];
  },
  get training() {
    return [
      t('Three workouts a week: spinning, or kettlebell (swing, halo) plus core.'),
      t('At least two fixed kettlebell days. Resistance training is what protects muscle in a deficit.'),
      t('Workout days are {kcal} kcal: add a banana before and 150 g of skyr after.', { kcal: num(DEFAULTS.kcalTrain) }),
    ];
  },
  get process() {
    return processRules(DEFAULTS.kcalMinDay);
  },
  get rotation() {
    return [
      [t('Monday'), t('Chicken and oven vegetables')],
      [t('Tuesday'), t('Salmon and oven vegetables')],
      [t('Wednesday'), t('Lentils and chicken')],
      [t('Thursday'), t('Meatballs and salad')],
      [t('Friday'), t('Red meat and oven vegetables')],
      [t('Saturday'), t('Salmon or the flexible dinner')],
      [t('Sunday'), t('Lentils and chicken')],
    ];
  },
};

// ——— Date and target-line helpers ———
export const dayKey = (d) => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
};
export const parseDay = (s) => {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d, 12, 0, 0);
};
export const addDays = (s, n) => {
  const d = parseDay(s);
  d.setDate(d.getDate() + n);
  return dayKey(d);
};
export const diffDays = (a, b) => Math.round((parseDay(b) - parseDay(a)) / 86400000);
// HH:MM of a Date or a timestamp
export const hhmm = (t) => {
  const d = new Date(t);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

// Value of the target line on a given day (start weight before the start, target weight after the end)
export function targetAt(day, s) {
  const total = diffDays(s.startDate, s.targetDate);
  const t = Math.min(Math.max(diffDays(s.startDate, day), 0), total);
  return s.startKg + ((s.targetKg - s.startKg) * t) / total;
}

// Short plan summary appended to each analysis request (one line per meal to save tokens)
const SHORT = {
  egg: 'egg', cheese: 'white cheese', salad: 'salad', olives: 'olives', bread: 'whole-wheat bread',
  oliveOil: 'olive oil', potato: 'boiled potato', tuna: 'tuna', skyr: 'skyr', muesli: 'muesli',
  soyFlakes: 'soy flakes', banana: 'banana', berries: 'berries', peach: 'peach', walnuts: 'walnuts',
  crispbread: 'crispbread', hummus: 'hummus', rawVeg: 'raw vegetables', kefir: 'kefir or ayran',
  almonds: 'almonds', cottage: 'cottage cheese', chicken: 'chicken breast', mince: 'meatballs',
  beef: 'red meat', salmon: 'salmon', ovenVeg: 'oven vegetables', bulgur: 'bulgur', lentils: 'lentils',
};
// A food you add needs no entry in SHORT: it goes by its own name
const short = (plan, k) => (has(SHORT, k) ? SHORT[k] : has(plan.foods, k) ? plan.foods[k].name : k);
// The foods the plan is built from, for requests that only need the gist of it
export const planFoods = (plan) => Array.from(new Set(Object.keys(plan.foods).map((k) => short(plan, k)))).join(', ');
export function planDigest(plan) {
  return plan.meals.map((m) => `${m.id}: ${m.ingredients.map(([k, g]) => `${short(plan, k)} ${g}g`).join(', ')} = ${m.kcal} kcal, ${Math.round(m.p)}p`).join('\n');
}
