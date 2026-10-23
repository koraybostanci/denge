// The fixed state and the screens rendered from it, for the English snapshot and the pseudo-locale test.
// What is covered: Today, Log, Check, Progress, Plan, Settings and the entry, number, slot, plan, meal editor, food form, badge and avatar sheets, which are
// string-returning functions of the state S and run in Node as they are. Not covered: anything that needs the DOM
// (attachChart, toasts and the other code in app.js, which reads document and window at import time).
process.env.TZ = 'UTC';
export const NOW = Date.UTC(2026, 9, 14, 12, 0, 0); // 14 Oct 2026, a Wednesday
const RealDate = Date;
globalThis.Date = class extends RealDate {
  constructor(...a) { super(...(a.length ? a : [NOW])); }
  static now() { return NOW; }
};

export const core = await import('../js/core.js');
export const views = await import('../js/views.js');
const { addDays, buildPlan } = await import('../js/plan.js');
const { default: seedPlan } = await import('../js/default-plan.js');
const { S } = core;
export const T = core.today();
export const day = (off) => addDays(T, off);
export const at = (d, h) => RealDate.parse(`${d}T${String(h).padStart(2, '0')}:00:00Z`);
let n = 0;
export const meal = (d, h, slot, title, kcal, p, extra = {}) => ({ id: `m${n++}`, day: d, ts: at(d, h), createdAt: at(d, h), kind: 'meal', status: 'ok', slot, title, kcal, p, c: 30, f: 12, fib: 5, mult: 1, tier: 'plan', flags: [], items: [], ...extra });

// A plan of the person's own: Default's meals without Snack 2, and one meal they added
export const MINE = { id: 'P-mine01', name: 'My plan', foods: seedPlan.foods,
  meals: [...seedPlan.meals.filter((m) => m.slot !== 'snack2'), { id: 'U-oats', slot: 'lunch', name: 'Overnight oats', ingredients: [['muesli', 50], ['skyr', 150]] }] };

// Every goal is set here, since fresh settings carry none
const GOALS = { startDate: '2026-10-05', startKg: 87, targetDate: '2026-12-31', targetKg: 78, kcalRest: 1550, kcalTrain: 1750, protein: 135, proteinMin: 120 };

export function fixture() {
  S.tab = 'today';
  S.viewDay = T;
  S.sheet = null;
  S.calPick = null;
  S.draft = null;
  S.settings = { ...core.freshSettings(), ...GOALS };
  S.plans = { active: 'default', list: [seedPlan] };
  S.plan = buildPlan(seedPlan);
  Object.assign(S.settings, { startDate: day(-9), startKg: 87, targetDate: day(78), targetKg: 78, lastBackup: NOW - 3 * 86400000 });
  S.entries = [];
  S.days = {};
  for (let i = 0; i <= 9; i++) {
    const d = day(-i);
    // Today's breakfast carries items: one from before per-item macros (its macro cells show '–') and one with them, and
    // kcal items do not add up to the entry, so the 'Estimate gap' rest row shows too — all in the entry-sheet snapshot
    S.entries.push(meal(d, 8, 'breakfast', 'Oats with yoghurt', 420, 30, i === 0 ? { items: [{ n: 'Jumbo oats', g: 80, kcal: 300, p: 12 }, { n: 'Greek yoghurt', g: 170, kcal: 100, p: 18, c: 8, f: 0, fib: 0 }] } : {}), meal(d, 13, 'lunch', 'Chicken and rice', 650, 45), meal(d, 19, 'dinner', i % 3 === 0 ? 'Pizza night' : 'Salmon and salad', i % 3 === 0 ? 900 : 560, i % 3 === 0 ? 30 : 40, i % 3 === 0 ? { tier: 'flex' } : {}));
    S.entries.push({ id: `w${i}`, day: d, ts: at(d, 7), createdAt: at(d, 7), kind: 'weight', status: 'ok', kg: 87 - i * -0.1, title: 'Weight' });
    S.days[d] = { day: d, kg: 86.5 + i * 0.1, steps: 6000 + i * 400, water: 1500 + i * 100, train: i % 2 === 0, coffee: i % 4 };
  }
  S.entries.push({ id: 'p1', day: T, ts: at(T, 15), createdAt: at(T, 15), kind: 'meal', status: 'pending', slot: 'snack', title: '', kcal: 0, p: 0, c: 0, f: 0, fib: 0, mult: 1, tier: 'plan', flags: [], items: [] });
  S.checks = [];
  S.progressReviewing.clear();
  S.progressErr.clear();
  S.reviewOpen.delete('progress');
  S.progressReview = null;
  // Earned badges at different finishes; days_on (30) and best_run (7) are above what was seen, so they are new (stored, so they show whatever the fixture log would earn by itself)
  S.badges = { v: 1, told: true, seen: { first_meal: 1, first_weigh: 1, first_on: 1, days_on: 7, best_run: 3, perfect_day: 1, kilos: 1, protein_days: 150 }, av: { stage: 'stage2', face: 'face_smile', acc: 'acc_leaf' }, base: { startKg: 87, targetKg: 78 }, got: {
    first_meal: { 1: day(-9) }, first_weigh: { 1: day(-9) }, first_on: { 1: day(-8) },
    days_on: { 7: day(-2), 30: day(-1) }, best_run: { 3: day(-6), 7: day(-2) }, perfect_day: { 1: day(-7) }, kilos: { 1: day(-3) },
    protein_days: { 10: day(-5), 50: day(-4), 100: day(-3), 150: day(-1) },
  } };
  // A review of the whole plan (its words are among the model-written fixture texts the Turkish test lets stand), written against the plan as it stands (so it renders fresh)
  S.progressReview = { v: 1, sig: core.progressSig(), ts: NOW - 86400000, model: 'm', rating: 'on-track', head: 'Good day', good: ['Fresh and light'], change: ['Cut the sauce'], adjust: 'Fits well' };
}

export function screens() {
  fixture();
  const out = {};
  const add = (name, fn) => { try { out[name] = fn(); } catch (e) { out[name] = `ERROR ${e.message}`; } };
  for (const tab of ['today', 'log', 'check', 'progress', 'plan']) {
    S.tab = tab;
    add(tab, () => ({ today: views.renderToday, log: views.renderLog, check: views.renderCheck, progress: views.renderProgress, plan: views.renderPlan }[tab])());
  }
  S.viewDay = day(-3);
  add('today-past-day', views.renderToday);
  add('log-past-day', views.renderLog);
  S.viewDay = T;
  const kept = [S.entries, S.days];
  // No stored review here either: fixture() seats one, and the empty screens must show it empty
  const review = S.progressReview;
  S.progressReview = null;
  S.entries = [];
  S.days = {};
  add('today-empty', views.renderToday);
  add('log-empty', views.renderLog);
  add('progress-empty', views.renderProgress);
  [S.entries, S.days] = kept;
  S.progressReview = review;
  S.tab = 'progress';
  S.calPick = day(-1);
  add('progress-picked-day', views.renderProgress);
  S.calPick = `week:${core.weekStart(day(-7))}`;
  add('progress-picked-week', views.renderProgress);
  S.calPick = null;
  add('settings', views.renderSettings);
  // A profile: the greeting on Today and the Profile section opened in Settings
  Object.assign(S.settings, { name: 'Ayşe <b>', age: 34, gender: 'female' });
  S.openSetting = 'profile';
  add('settings-profile', views.renderSettings);
  S.openSetting = null;
  const tab = S.tab;
  S.tab = 'today';
  add('today-named', views.renderToday);
  S.tab = tab;
  Object.assign(S.settings, { name: '', age: 0, gender: '' });
  S.settings.provider = 'anthropic';
  S.settings.apiKey = 'k';
  add('settings-anthropic', views.renderSettings);
  const e = S.entries.find((x) => x.kind === 'meal' && x.status === 'ok');
  add('entry-sheet', () => views.renderEntrySheet(e.id));
  for (const kind of ['water', 'steps', 'weight', 'coffee']) add(`num-sheet-${kind}`, () => views.renderNumSheet(kind, T));
  add('slot-sheet', () => views.renderSlotSheet('lunch', T));
  add('plan-sheet', () => views.renderPlanSheet('L-A'));
  add('frame-sheet', () => views.renderFrameSheet('L-A'));
  // The meal editor while only Default exists: a meal of it, and a new meal in Snack 2
  core.startDraft('L-A');
  add('meal-editor', views.renderMealEditor);
  core.startDraft(null, 'snack2', 'U-new01');
  add('meal-editor-new', views.renderMealEditor);
  // The food form over it: a food the meal uses (with "Used in"), a new food, and the same without an API key
  core.startDraft('L-A');
  core.startFood('egg');
  add('food-form', views.renderFoodForm);
  core.startFood('unew01');
  add('food-form-new', views.renderFoodForm);
  const apiKey = S.settings.apiKey;
  S.settings.apiKey = '';
  add('food-form-no-key', views.renderFoodForm);
  S.settings.apiKey = apiKey;
  S.draft = null;
  // With a plan of the person's own: active (Snack 2 has no meals), then Default active while it exists
  S.tab = 'plan';
  S.plans = { active: MINE.id, list: [seedPlan, MINE] };
  S.plan = buildPlan(MINE);
  add('plan-mine', views.renderPlan);
  core.startDraft('U-oats');
  add('meal-editor-mine', views.renderMealEditor);
  S.draft = null;
  S.plans = { active: 'default', list: [seedPlan, MINE] };
  S.plan = buildPlan(seedPlan);
  add('plan-default-mine', views.renderPlan);
  add('plan-sheet-default-mine', () => views.renderPlanSheet('L-A'));
  S.plans = { active: 'default', list: [seedPlan] };
  // A day a little over its budget with nothing else to note: the one note holds a comma, which the English list joins with "and"
  S.entries.find((x) => x.day === day(-1) && x.slot === 'lunch').p += 10;
  S.tab = 'progress';
  S.calPick = day(-1);
  add('progress-picked-margin', views.renderProgress);
  S.calPick = null;
  add('badge-sheet', () => views.renderBadgeSheet('days_on'));
  add('badge-sheet-top', () => views.renderBadgeSheet('protein_days'));
  add('badge-sheet-one-shot', () => views.renderBadgeSheet('first_meal'));
  add('badge-sheet-locked', () => views.renderBadgeSheet('anniversary'));
  add('badge-sheet-kilos', () => views.renderBadgeSheet('kilos'));
  add('avatar-sheet', views.renderAvatarSheet);
  // The review card in its other states: open, the log changed since, a failed request, too few weigh-ins yet, and nothing written yet
  S.tab = 'progress';
  S.reviewOpen.set('progress', true);
  add('progress-review-open', views.renderProgress);
  // While the request is out: the spinner with role="status" over the seated review
  S.progressReviewing.add('progress');
  add('progress-review-busy', views.renderProgress);
  S.progressReviewing.delete('progress');
  S.reviewOpen.delete('progress');
  const rec = S.progressReview;
  S.progressReview = { ...rec, sig: 'old' };
  add('progress-review-refresh', views.renderProgress);
  S.progressReview = rec;
  S.progressErr.set('progress', 'Ordered a small one');
  add('progress-review-failed', views.renderProgress);
  S.progressErr.clear();
  S.progressReview = null;
  add('progress-review-ready', views.renderProgress);
  const kept2 = [S.entries, S.days];
  S.entries = S.entries.filter((x) => x.kind !== 'weight');
  S.days = Object.fromEntries(Object.entries(S.days).map(([d, v]) => [d, { ...v, kg: undefined }]));
  add('progress-review-gated', views.renderProgress);
  [S.entries, S.days] = kept2;
  S.progressReview = rec;
  // The setup screen: empty, then after a failed try (an error under each kind of field, and the plan not chosen)
  S.onboard = null;
  add('onboarding', views.renderOnboarding);
  S.onboard = { name: 'Ayşe <b>', age: '12', gender: 'female', weight: '80', targetKg: '85', targetDate: day(-1), kcalRest: '400', kcalTrain: '300', protein: '30', plan: '', errors: [
    { field: 'name', code: 'too_long' }, { field: 'age', code: 'range' }, { field: 'weight', code: 'range' }, { field: 'targetKg', code: 'not_below_weight' },
    { field: 'targetDate', code: 'not_after_today' }, { field: 'kcalRest', code: 'below_floor' }, { field: 'kcalTrain', code: 'below_rest' }, { field: 'protein', code: 'below_min' }, { field: 'plan', code: 'required' },
  ] };
  add('onboarding-errors', views.renderOnboarding);
  S.onboard = { weight: '', targetKg: '', targetDate: '', kcalRest: '', kcalTrain: '', protein: '', plan: 'blank', errors: [
    { field: 'weight', code: 'required' }, { field: 'targetKg', code: 'required' }, { field: 'targetDate', code: 'required' }, { field: 'targetDate', code: 'invalid' }, { field: 'kcalRest', code: 'range' }, { field: 'protein', code: 'range' }, { field: 'gender', code: 'invalid' },
  ] };
  add('onboarding-required', views.renderOnboarding);
  S.onboard = { name: 'Ayşe', age: '34', gender: 'female', weight: '80', targetKg: '72', targetDate: day(120), kcalRest: '1800', kcalTrain: '2100', protein: '110', plan: 'blank', errors: [], saving: true };
  add('onboarding-saving', views.renderOnboarding);
  S.onboard = null;
  return out;
}
