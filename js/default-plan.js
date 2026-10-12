// The plan the app ships with: the seed of the read-only "Default" plan. Only js/app.js imports it; everything else reads
// the active plan from S.plan (built with buildPlan in js/plan.js).
import { T } from './i18n.js';

// Per 100 g: [kcal, protein, carbs, fat, fibre]
const foods = {
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
const meals = [
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

export default { id: 'default', name: T('Default'), foods, meals };
