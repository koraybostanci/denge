// Plan v2: food table, meal templates, targets and rules.
// Meal values are never typed by hand; they are computed from the per-100 g table below.

// Number and date formatting for the whole app
import { LOCALE, T, t } from './i18n.js';
export { LOCALE }; // follows the interface language (a live binding)

// Per 100 g: [kcal, protein, carbs, fat, fibre]
export const FOODS = {
  egg:        { name: T('Boiled egg'),                               v: [143, 12.6, 0.7, 9.5, 0] },
  cheese:     { name: T('Low-fat white cheese'),                     v: [170, 18, 1, 10.5, 0] },
  salad:      { name: T('Cucumber, tomato, greens'),                 v: [18, 1, 3, 0.2, 1.2] },
  olives:     { name: T('Olives'),                                   v: [145, 1, 1, 15, 3] },
  bread:      { name: T('Whole-wheat or rye bread'),                 v: [215, 8, 38, 2, 7.5] },
  oliveOil:   { name: T('Olive oil'),                                v: [884, 0, 0, 100, 0] },
  potato:     { name: T('Boiled potato (cooled)'),                   v: [77, 2, 17, 0.1, 1.8] },
  tuna:       { name: T('Tuna in water, drained'),                   v: [110, 25, 0, 1, 0] },
  skyr:       { name: T('Plain skyr'),                               v: [63, 11, 4, 0.2, 0] },
  muesli:     { name: T('Unsweetened muesli'),                       v: [360, 11, 60, 6.5, 9] },
  soyFlakes:  { name: T('Soy flakes'),                               v: [400, 40, 6, 20, 16] },
  banana:     { name: T('Banana'),                                   v: [89, 1.1, 20, 0.3, 2.6] },
  berries:    { name: T('Mixed berries'),                            v: [45, 0.9, 7.5, 0.4, 4] },
  peach:      { name: T('Peach (or a handful of cherries or grapes)'), v: [41, 0.9, 9, 0.1, 1.5] },
  walnuts:    { name: T('Walnuts'),                                  v: [670, 15, 7, 65, 6.5] },
  crispbread: { name: T('Crispbread'),                               v: [340, 10, 62, 2, 15] },
  hummus:     { name: T('Hummus'),                                   v: [260, 7, 12, 19, 5] },
  rawVeg:     { name: T('Raw vegetables (pepper, carrot, cucumber)'), v: [28, 1, 5, 0.2, 2] },
  kefir:      { name: T('Kefir or plain ayran'),                     v: [50, 3.4, 4, 1.5, 0] },
  almonds:    { name: T('Raw almonds or hazelnuts'),                 v: [600, 21, 6, 53, 12] },
  cottage:    { name: T('Cottage cheese'),                           v: [98, 12.5, 2.5, 4.3, 0] },
  chicken:    { name: T('Chicken breast (raw weight)'),              v: [110, 23, 0, 1.5, 0] },
  mince:      { name: T('Lean mince, max 10% fat (raw)'),            v: [170, 20, 0, 10, 0] },
  beef:       { name: T('Lean red meat (raw weight)'),               v: [135, 21.5, 0, 5, 0] },
  salmon:     { name: T('Salmon (raw weight)'),                      v: [200, 20, 0, 13.5, 0] },
  ovenVeg:    { name: T('Oven vegetables (a frozen mix is fine)'),   v: [35, 2.2, 5, 0.4, 2.8] },
  bulgur:     { name: T('Cooked bulgur'),                            v: [83, 3.1, 18.6, 0.2, 4.5] },
  lentils:    { name: T('Cooked green lentils or chickpeas'),        v: [116, 9, 20, 0.4, 8] },
};

// ingredients: [food, grams, optional household measure]
const TEMPLATES = [
  // Lunch
  { id: 'L-A', slot: 'lunch', name: T('Egg and cheese plate'),
    ingredients: [['egg', 106, T('2 eggs')], ['cheese', 60], ['salad', 350, T('large bowl')], ['olives', 20, T('5 olives')], ['bread', 45, T('1 slice')], ['oliveOil', 5, T('1 tsp')]] },
  { id: 'L-B', slot: 'lunch', name: T('Potato salad (no bread)'),
    ingredients: [['egg', 106, T('2 eggs')], ['cheese', 60], ['salad', 350, T('large bowl')], ['olives', 20, T('5 olives')], ['potato', 150, T('1 medium')], ['oliveOil', 5, T('1 tsp')]] },
  { id: 'L-C', slot: 'lunch', name: T('Tuna salad'),
    ingredients: [['tuna', 130, T('1 can')], ['egg', 53, T('1 egg')], ['salad', 350, T('large bowl')], ['olives', 20, T('5 olives')], ['bread', 45, T('1 slice')], ['oliveOil', 5, T('1 tsp')]] },
  { id: 'L-D', slot: 'lunch', name: T('Vegetable omelette'),
    ingredients: [['egg', 159, T('3 eggs')], ['cheese', 30], ['salad', 250], ['bread', 45, T('1 slice')], ['oliveOil', 5, T('1 tsp')]] },
  // Snack 1
  { id: 'S1-A', slot: 'snack1', name: T('Skyr bowl with berries'),
    ingredients: [['skyr', 250], ['muesli', 30, T('3 tbsp')], ['soyFlakes', 10, T('1 tbsp')], ['berries', 80, T('1 handful')]] },
  { id: 'S1-B', slot: 'snack1', name: T('Skyr bowl with banana'),
    ingredients: [['skyr', 250], ['muesli', 30, T('3 tbsp')], ['soyFlakes', 10, T('1 tbsp')], ['banana', 60, T('half')]] },
  { id: 'S1-C', slot: 'snack1', name: T('Skyr bowl with peach'),
    ingredients: [['skyr', 250], ['muesli', 30, T('3 tbsp')], ['soyFlakes', 10, T('1 tbsp')], ['peach', 150, T('1 peach')]] },
  // Snack 2
  { id: 'S2-A', slot: 'snack2', name: T('Walnuts and fruit'),
    ingredients: [['walnuts', 20, T('5 walnuts')], ['peach', 150, T('1 portion')]] },
  { id: 'S2-B', slot: 'snack2', name: T('Crispbread and hummus'),
    ingredients: [['crispbread', 20, T('2 slices')], ['hummus', 30, T('2 tbsp')], ['rawVeg', 100]] },
  { id: 'S2-C', slot: 'snack2', name: T('Kefir and almonds'),
    ingredients: [['kefir', 200, T('1 glass')], ['almonds', 15, T('12 almonds')]] },
  { id: 'S2-D', slot: 'snack2', name: T('Cottage cheese and raw vegetables'),
    ingredients: [['cottage', 150], ['rawVeg', 100]] },
  // Dinner
  { id: 'D-A', slot: 'dinner', name: T('Chicken and oven vegetables'),
    ingredients: [['chicken', 200], ['ovenVeg', 350], ['bulgur', 100, T('4 tbsp')], ['oliveOil', 10, T('2 tsp')]] },
  { id: 'D-B', slot: 'dinner', name: T('Meatballs and salad'),
    ingredients: [['mince', 180], ['salad', 350, T('large bowl')], ['bulgur', 100, T('4 tbsp')], ['oliveOil', 5, T('1 tsp')]] },
  { id: 'D-C', slot: 'dinner', name: T('Red meat and oven vegetables'),
    ingredients: [['beef', 200], ['ovenVeg', 350], ['oliveOil', 10, T('2 tsp')]] },
  { id: 'D-D', slot: 'dinner', name: T('Salmon and oven vegetables'),
    ingredients: [['salmon', 150], ['ovenVeg', 350], ['bulgur', 100, T('4 tbsp')], ['oliveOil', 5, T('1 tsp')]] },
  { id: 'D-E', slot: 'dinner', name: T('Lentils and chicken'),
    ingredients: [['lentils', 250], ['chicken', 100], ['salad', 250], ['oliveOil', 5, T('1 tsp')]] },
  // Late (only when very hungry or short on protein)
  { id: 'N-A', slot: 'late', name: T('Plain skyr'),
    ingredients: [['skyr', 150]] },
  // Workout-day extras
  { id: 'T-A', slot: 'workout', name: T('Pre-workout banana'),
    ingredients: [['banana', 120, T('1 banana')]] },
  { id: 'T-B', slot: 'workout', name: T('Post-workout skyr'),
    ingredients: [['skyr', 150]] },
];

const round1 = (x) => Math.round(x * 10) / 10;

export function macros(ingredients) {
  const s = [0, 0, 0, 0, 0];
  for (const [k, g] of ingredients) FOODS[k].v.forEach((v, i) => { s[i] += (v * g) / 100; });
  return { kcal: Math.round(s[0]), p: round1(s[1]), c: round1(s[2]), f: round1(s[3]), fib: round1(s[4]) };
}

export const MEALS = TEMPLATES.map((t) => ({
  ...t,
  ...macros(t.ingredients),
  items: t.ingredients.map(([k, g, measure]) => ({
    n: FOODS[k].name, g, measure: measure || '',
    kcal: Math.round((FOODS[k].v[0] * g) / 100),
    p: round1((FOODS[k].v[1] * g) / 100),
  })),
}));

export const MEAL_BY_ID = Object.fromEntries(MEALS.map((m) => [m.id, m]));
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
const short = (k) => SHORT[k] || FOODS[k].name; // a food you add needs no entry in SHORT
// The foods the plan is built from, for requests that only need the gist of it
export const planFoods = () => Array.from(new Set(Object.keys(FOODS).map(short))).join(', ');
export function planDigest() {
  return MEALS.map((m) => `${m.id}: ${m.ingredients.map(([k, g]) => `${short(k)} ${g}g`).join(', ')} = ${m.kcal} kcal, ${Math.round(m.p)}p`).join('\n');
}
