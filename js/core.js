// State, and the calculations on it. No DOM and no storage, so the maths loads on its own (in node, for tests).
import { t, tn, T, td, foldKey, parseNum, inEnglish } from './i18n.js';
import { PARSE_TR } from './parse-tr.js';
import { buildPlan, SLOTS, FLEX, DEFAULTS, LOCALE, has, dayKey, parseDay, addDays, diffDays, SMALL_TREAT_KCAL, planDigest, targetAt } from './plan.js';

export const APP_VERSION = '59'; // bump together with VERSION in sw.js
export const SCHEMA_VERSION = 2; // version of the stored data and of the backup file
// The app's internal id. It names the database, the caches, the backup files' marker and the SQL export's tables, and
// never follows the app's name (Pickle), so a rename touches only what people see and never the data.
export const APP_ID = 'weightplan';

// ——— State ———
// The settings of an app that has just been installed (new objects each time, so a reset never shares them)
// Personal goals (dates, weights, calories, protein) are not part of it: setup asks for them, or a restore or an older install brings them
export const PERSONAL = ['startDate', 'startKg', 'targetDate', 'targetKg', 'kcalRest', 'kcalTrain', 'protein', 'proteinMin'];
export const freshSettings = () => ({
  ...Object.fromEntries(Object.entries(DEFAULTS).filter(([k]) => !PERSONAL.includes(k))), schema: SCHEMA_VERSION,
  provider: 'openai', oaBase: 'https://generativelanguage.googleapis.com/v1beta/openai', oaModel: 'gemini-3.5-flash', oaKey: '', apiKey: '',
  name: '', age: 0, gender: '', clientId: '', onboarded: false,
  useLocation: false, places: [], favorites: [], supplements: [], hideStart: false, autoReview: true, lang: 'en',
  usage: { in: 0, out: 0, calls: 0, usd: 0 }, lastBackup: 0,
});
// What the Check screen is holding while a check is put together; its photos live in memory only
export const freshCheck = () => ({ photos: [], note: '', busy: false, status: '', err: '', openId: null });

export const S = {
  tab: 'today',
  settings: freshSettings(),
  entries: [],
  days: {},
  saveWarning: false, // the startup upgrade of the settings could not be written: a banner with Retry shows until a save succeeds
  rev: 0, // moves on every save, load, clear and restore: what a cached result of the log is keyed on
  badgeIntro: 0, // badges taken in from the history, told once on the Progress tab
  viewDay: dayKey(new Date()),
  busy: new Set(),
  retry: new Map(), // status note shown while an analysis is retrying
  reviewing: new Set(), // days whose review is being written
  reviewErr: new Map(), // day → why the last review failed
  coaching: new Set(), // days whose quick note is being written
  coachErr: new Map(), // day → why the last quick note failed
  progressReview: null, // the review of the whole log as stored (kv `progressReview`); null until one is written or restored
  progressReviewing: new Set(), // holds one constant key while that review is being written
  progressErr: new Map(), // constant key → why the last progress review failed
  reviewOpen: new Map(), // day → whether its review is expanded, once the person has toggled it
  check: freshCheck(), // the check being put together
  checks: [], // earlier verdicts, newest first, without photos
  foods: [], // the pantry (kv `foods`, see js/backup.js): branded foods eaten often, values per 100 g
  badges: null, // earned badges as stored (kv `badges`, see js/badges.js); null until something is logged
  urls: new Map(),
  persisted: null,
  storage: null,
  calPick: null,
  chartRange: 'weeks', // the weight chart: 'week' (7 days), 'weeks' (14) or 'whole' (the plan)
  sheet: null, // open bottom sheet: {type:'settings'|'entry'|'num'|'slot'|'plan'|'plan-edit'|'plan-frame', ...}
  suppEdit: '', // id of the supplement being edited in Settings
  openSetting: '', // expanded section in Settings
  plans: null, // the stored plans (kv `plans`: { active, list: [Default, My plan] }), set on load
  plan: buildPlan({ id: 'default', name: '', foods: {}, meals: [] }), // the active plan, built (js/app.js sets it on load)
  onboard: null, // the setup form while it is shown: what was typed, the choice of plan and the errors of the last try (js/views.js renderOnboarding); null otherwise
  draft: null, // the meal being edited: { plan: a copy of the active stored plan, meal, food?, foodForm? }; nothing is stored until it is saved
};
let progressGen = 0; // moves when the log is wiped, so a progress review that lands after it is dropped
export const getProgressGen = () => progressGen;
export const bumpProgressGen = () => { progressGen++; }; // js/app.js bumps it when the log is wiped
export const resetProgressGen = () => { progressGen = 0; };

// Plan meals can be changed while Default is the only plan (a save creates My plan) and while My plan is active,
// not while Default is active and My plan exists
export const hasMyPlan = () => !!(S.plans && S.plans.list.length > 1);
export const onDefault = () => !S.plans || S.plans.active === 'default';
export const canEditPlan = () => !(hasMyPlan() && onDefault());
// A deep copy of plain data (numbers, strings, arrays, objects); JSON rather than structuredClone, so a value it would reject is not newly refused
export const clone = (x) => JSON.parse(JSON.stringify(x));
// Opens the meal editor's draft on a deep copy of the active stored plan: the meal with that id, or a new one (newId) in slot.
// base keeps the foods as they were, so a save can tell which ones the draft added or changed.
export function startDraft(id, slot, newId) {
  const plan = clone(S.plans.list.find((p) => p.id === S.plans.active) || S.plans.list[0]);
  const meal = plan.meals.find((m) => m.id === id);
  S.draft = { plan, meal: meal ? clone(meal) : { id: newId, slot, name: '', ingredients: [] }, base: clone(plan.foods) };
  S.draft.orig = draftKey(S.draft);
  return S.draft;
}
// What an editor name field shows: the stored name through td() while the draft still holds it (a seed name shows translated),
// else the draft text as typed, so a typed 'Banana' is not turned into 'Muz' by a redraw
export const shownName = (draft, stored) => (draft === stored ? td(draft) : draft);
// Closing or cancelling the editor: the draft goes and nothing is written (an open food form's photos are let go too)
export function dropDraft() { if (S.draft) dropFood(); S.draft = null; }
// Whether the editor's meal or plan differs from what startDraft cloned (grams count as typed text, as syncDraft leaves them)
const draftKey = (d) => JSON.stringify({ meal: { ...d.meal, ingredients: d.meal.ingredients.map((r) => [r[0], String(r[1]), ...r.slice(2)]) }, plan: d.plan });
export function draftChanged() { return !!S.draft && draftKey(S.draft) !== S.draft.orig; }

// ——— The food form, over the meal editor: S.draft.food is the key of the food being edited (a new one is not in the foods
// yet) and S.draft.foodForm what the form holds: the name, the five values per 100 g (numbers, or text as typed), the photos
// for the AI fill (in memory only) and its state
export function startFood(key) {
  const f = Object.hasOwn(S.draft.plan.foods, key) ? S.draft.plan.foods[key] : null;
  S.draft.food = key;
  S.draft.foodForm = { isNew: !f, name: f ? f.name : '', v: f ? [...f.v] : ['', '', '', '', ''], photos: [], busy: false, note: '', err: '' };
  S.draft.foodForm.orig = foodFormKey(S.draft.foodForm);
  return S.draft.foodForm;
}
// What the form holds that a Back would lose: the name, the values as typed text and how many photos are waiting for the AI fill
const foodFormKey = (form) => JSON.stringify([form.name, form.v.map((x) => { const s = String(x).trim(); const n = parseNum(s); return s === '' || Number.isNaN(n) ? s : String(n); }), form.photos.length]); // numbers by value: 12.6 and "12,6" are the same
// Whether the food form differs from what startFood opened it with (an AI fill changes the fields, so it counts)
export const foodFormChanged = (form) => !!form && foodFormKey(form) !== form.orig;
// How many meals of the draft use a food: the draft plan's other meals and the meal being edited as it is now
export const foodUses = (key) => [...S.draft.plan.meals.filter((m) => m.id !== S.draft.meal.id), S.draft.meal]
  .filter((m) => m.ingredients.some((row) => row[0] === key)).length;
// Done: the food (read by readFood) goes into the draft plan's foods; a new one also becomes an ingredient of the draft meal,
// with empty grams. Returns the index of that row, or -1. The form stays open until dropFood, which Back calls alone: it
// leaves the foods as they were.
export function doneFood(food) {
  const d = S.draft;
  const key = d.food;
  const isNew = d.foodForm.isNew;
  d.plan.foods[key] = { name: food.name, v: [...food.v] };
  if (!isNew) return -1;
  d.meal.ingredients.push([key, '']);
  return d.meal.ingredients.length - 1;
}
// Lets go of the object URLs of a form's photos (held in memory only); no form is nothing to release
export function releasePhotos(form) { if (form) form.photos.forEach((p) => URL.revokeObjectURL(p.url)); }
// The form goes, and the object URLs of its photos (held in memory only) are revoked
export function dropFood() {
  releasePhotos(S.draft.foodForm);
  delete S.draft.food; delete S.draft.foodForm;
}

// A meal of the active plan by its id, or undefined (a search of the list, so text from outside cannot find "constructor")
export const mealById = (id) => S.plan.meals.find((m) => m.id === id);
// The main meal times (not the late snack) that the active plan has a meal for, in order
export const mainSlots = () => SLOTS.filter((s) => s.id !== 'late' && S.plan.meals.some((m) => m.slot === s.id));
// "lunch 12:30, dinner 19:00" for the main meals of the plan, or '' when it has none
export const mealTimesLine = () => mainSlots().map((x) => `${x.name.toLowerCase()} ${x.time}`).join(', ');

// Call configuration for the selected provider
export function aiCfg() {
  const s = S.settings;
  return s.provider === 'openai'
    ? { provider: 'openai', key: s.oaKey, model: s.oaModel, base: s.oaBase }
    : { provider: 'anthropic', key: s.apiKey, model: s.model };
}
export const hasKey = () => { const c = aiCfg(); return !!c.key && (c.provider !== 'openai' || (!!c.base && !!c.model)); };
export const today = () => dayKey(new Date());

// ——— Calculations ———
// Missing kcal and macros are treated as 0, so entry totals are always numbers: an entry with no stored c/f/fib counts "0 g" in the totals instead of an unknown
export const eff = (e) => {
  const m = e.mult || 1;
  return { kcal: (e.kcal || 0) * m, p: (e.p || 0) * m, c: (e.c || 0) * m, f: (e.f || 0) * m, fib: (e.fib || 0) * m };
};

// Thresholds for the entry-sheet rest row: a column shows its rest only when the display-rounded absolute residual
// reaches them (|rest| ≥ REST_KCAL for kcal, |rest| ≥ REST_MACROS for each macro), so sub-threshold noise from
// rounding stays hidden in either direction (negative rests count too, when items overshoot the total)
export const REST_KCAL = 5;
export const REST_MACROS = 2;

// The unexplained residue between an entry's displayed totals and its per-item rows, as { kcal, p, c, f, fib }:
// per key = Math.round(eff(e)[k]) − Σ per item Math.round(i[k] * (e.mult || 1)), both sides display-rounded so the
// printed rest cell exactly reconciles the printed cells for the numeric cells (a key absent on an item prints as
// '–' instead of a number, yet counts as 0 in the sum, so '–' columns do not reconcile numerically). An item key
// that is absent or stored-0 counts as 0 (an entry with no stored c/f/fib and items without macros still
// reconciles). Pure and read-only: e and e.items are never touched, and an entry whose items are missing (or not
// an array) rests on its full totals.
export function itemRests(e) {
  const mult = e.mult || 1; // the totals (via eff(e)) and the item cells always scale by the same e.mult
  const ef = eff(e);
  const r = { kcal: Math.round(ef.kcal), p: Math.round(ef.p), c: Math.round(ef.c), f: Math.round(ef.f), fib: Math.round(ef.fib) };
  const list = Array.isArray(e.items) ? e.items : [];
  for (const i of list)
    for (const k of ['kcal', 'p', 'c', 'f', 'fib']) r[k] -= Math.round((i[k] || 0) * mult);
  return r;
}

// What the edit sheet's kcal and macro fields write back on Save, as a {kcal, p, c, f, fib} patch ({ conf: 1, planId: '',
// edited: true } added when kcal itself was changed), or {} when nothing changes. Pure: app.js reads the fields and spreads the
// patch into the entry. The fields show whole kcal/grams at the entry's portion (eff), so a value that rounds to what is already
// on screen is not stored again: the stored single-portion precision survives an untouched save (1.2 in a sheet that shows 1 at
// half portions stays 1.2, and protein joins macros in that guard). An edited value is stored single-portion, divided by the
// portion, kcal to a whole number and the macros to 0.1. A blank, non-finite or negative field keeps the stored value.
export function macroEdits(e, v = {}) {
  const n = (x) => (Number.isFinite(x) && x >= 0 ? x : NaN);
  const cur = eff(e);
  const kcal = n(v.kcal);
  const patch = {};
  if (Number.isFinite(kcal) && Math.round(kcal) !== Math.round(cur.kcal)) {
    patch.kcal = Math.round(kcal / (e.mult || 1)); patch.conf = 1; patch.planId = ''; patch.edited = true;
  }
  for (const k of ['p', 'c', 'f', 'fib']) {
    const x = n(v[k]);
    if (Number.isFinite(x) && Math.round(x) !== Math.round(cur[k])) patch[k] = Math.round((x / (e.mult || 1)) * 10) / 10;
  }
  return patch;
}
let dayIndex = null; // day → entries, set only while withDayIndex runs
export const mealsOf = (day) => (dayIndex ? dayIndex.get(day) || [] : S.entries).filter((e) => e.day === day && e.kind === 'meal' && e.status === 'ok');
// Runs fn with the entries bucketed by day, so a pass over many days does not filter the whole log for each one. fn must not be async.
export function withDayIndex(fn) {
  if (dayIndex) return fn();
  dayIndex = new Map();
  try {
    for (const e of S.entries) { const b = dayIndex.get(e.day); if (b) b.push(e); else dayIndex.set(e.day, [e]); }
    return fn();
  } finally { dayIndex = null; }
}
export function dayTotals(day) {
  const t = { kcal: 0, p: 0, c: 0, f: 0, fib: 0, n: 0 };
  for (const e of mealsOf(day)) {
    const v = eff(e);
    t.kcal += v.kcal; t.p += v.p; t.c += v.c; t.f += v.f; t.fib += v.fib; t.n += 1;
  }
  return t;
}
export const dayTarget = (day) => ((S.days[day] && S.days[day].train) ? S.settings.kcalTrain : S.settings.kcalRest);

// Where a day's calories sit against its target: up to `high` still counts as on plan (the part above the budget is shown),
// above `near` is clearly over; `partial` is the share below which too little is logged to judge a day. The lower limit is kcalMinDay().
export const BAND = { partial: 0.6, high: 1.10, near: 1.15 };
// The calories a day has to reach to count, and the lowest budget that can be set; settings saved before it existed use the default
export const kcalMinDay = () => S.settings.kcalMinDay > 0 ? S.settings.kcalMinDay : DEFAULTS.kcalMinDay;
// The protein a day has to reach: the minimum, but never more than the target itself
export const proteinFloor = () => Math.min(S.settings.proteinMin || S.settings.protein, S.settings.protein);

// 'on' = from the minimum to the budget plus its margin, 'over' = above that, 'far' = well above, 'under' = below the minimum,
// 'none' = nothing logged, 'open' = today, still being eaten, so not judged yet
export function dayStatus(day) {
  const t = dayTotals(day);
  if (!t.n) return 'none';
  const target = dayTarget(day);
  const on = t.kcal >= kcalMinDay() && t.kcal <= target * BAND.high; // the calories decide the day; protein and the rest are notes
  if (day === today() && !on && t.kcal <= target * BAND.high) return 'open';
  if (on) return 'on';
  if (t.kcal < kcalMinDay()) return 'under';
  return t.kcal <= target * BAND.near ? 'over' : 'far';
}
// What kept a day from being on plan: only the calories, in a few words; empty for a day that was
export function dayReasons(day) {
  const tot = dayTotals(day);
  if (!tot.n) return [];
  const target = dayTarget(day);
  if (tot.kcal > target * BAND.high) return [t('{kcal} kcal above the budget', { kcal: fmtInt(tot.kcal - target) })];
  if (tot.kcal < kcalMinDay()) return [t('{kcal} kcal under the {min} minimum', { kcal: fmtInt(kcalMinDay() - tot.kcal), min: fmtInt(kcalMinDay()) })];
  return [];
}
// How well protein went: 'target' = the target reached, 'min' = the minimum reached, 'near' = within 80% of the minimum,
// 'short' = less, 'none' = nothing logged
export function proteinLevel(day) {
  const t = dayTotals(day);
  if (!t.n) return 'none';
  return t.p >= S.settings.protein ? 'target' : t.p >= proteinFloor() ? 'min' : t.p >= proteinFloor() * 0.8 ? 'near' : 'short';
}
// The smaller things worth a mention, which never change how a day counts
export function dayNotes(day) {
  const tot = dayTotals(day);
  if (!tot.n) return [];
  const out = [];
  const target = dayTarget(day);
  if (tot.kcal > target + 0.5 && tot.kcal <= target * BAND.high) out.push(t('{kcal} kcal above the budget, within the {pct}% margin', { kcal: fmtInt(tot.kcal - target), pct: Math.round((BAND.high - 1) * 100) }));
  const gap = Math.ceil(proteinFloor() - tot.p - 1e-6);
  if (gap > 0) out.push(t('protein {gap} g short of your minimum', { gap }));
  const off = mealsOf(day).filter((e) => e.tier === 'off').length;
  if (off) out.push(tn('{n} off-plan entry|{n} off-plan entries', off));
  return out;
}

// The five things a day can get right. Calories count once enough is logged and the total is within budget.
export function dayGoals(day) {
  const dd = S.days[day] || {};
  const tot = dayTotals(day);
  const target = dayTarget(day);
  const s = S.settings;
  return [
    { id: 'weigh', name: t('Weigh-in'), done: !!dd.kg },
    { id: 'kcal', name: t('Calories'), done: tot.n > 0 && tot.kcal >= kcalMinDay() && tot.kcal <= target * BAND.high },
    { id: 'protein', name: t('Protein'), done: tot.p >= proteinFloor() },
    { id: 'steps', name: t('Steps'), done: (dd.steps || 0) >= s.steps },
    { id: 'water', name: t('Water'), done: (dd.water || 0) >= s.water },
  ];
}
export const isPerfect = (day) => dayGoals(day).every((g) => g.done);

// Whole kilos lost since the start, by the latest weigh-in
export function kilosDown(day = today()) {
  const a = latestWeight(day);
  if (!a || day < S.settings.startDate) return 0;
  return Math.max(0, Math.floor(S.settings.startKg - a.kg + 1e-6));
}

// Looking back over the plan so far: days on plan, the longest run, perfect days
export function history() {
  const s = S.settings;
  const t = today();
  let onPlan = 0;
  let best = 0;
  let run = 0;
  let perfect = 0;
  for (let d = s.startDate; d <= t; d = addDays(d, 1)) {
    const st = dayStatus(d);
    if (st === 'on') { onPlan += 1; run += 1; best = Math.max(best, run); } else if (d !== t) run = 0;
    if (isPerfect(d)) perfect += 1;
  }
  return { onPlan, best, perfect, days: Math.max(0, diffDays(s.startDate, t) + 1) };
}

// How a finished Monday-to-Sunday week went, by the days on plan; `done` is false until the Sunday is over
export const WEEK_TIERS = [
  { min: 7, icon: 'star', tone: 'strong', title: T('Strong week'), text: T('Every day on plan. Beautifully steady.') },
  { min: 6, icon: 'sprout', tone: 'solid', title: T('Solid week'), text: T('Only one day off. Growing nicely.') },
  { min: 5, icon: 'steady', tone: 'steady', title: T('Steady week'), text: T('Most days on plan. A good rhythm to build on.') },
  { min: 3, icon: 'caution', tone: 'caution', title: T('Rough patch'), text: T('Less than half of the week landed. Look at which days slipped and plan those first. Next week is a fresh start.') },
  { min: 0, icon: 'reset', tone: 'reset', title: T('Time to reset'), text: T('Few days on plan this week. One day at a time, begin again on Monday.') },
];
export function weekResult(ws) {
  let onPlan = 0;
  let proteinDays = 0;
  for (let i = 0; i < 7; i++) {
    const d = addDays(ws, i);
    if (dayStatus(d) === 'on') onPlan += 1;
    if (['target', 'min'].includes(proteinLevel(d))) proteinDays += 1;
  }
  const done = addDays(ws, 6) < today();
  const tier = done ? WEEK_TIERS.find((x) => onPlan >= x.min) : null;
  return { done, onPlan, proteinDays, tier };
}

export function avg7(day) {
  let s = 0;
  let n = 0;
  for (let i = 0; i < 7; i++) {
    const d = S.days[addDays(day, -i)];
    if (d && d.kg) { s += d.kg; n += 1; }
  }
  return n ? { kg: s / n, n } : null;
}
// The latest recorded weigh-in on or before the day, shaped like an average of one
export function latestWeight(day = today()) {
  const last = weightSeries().filter((d) => d.day <= day).pop();
  return last ? { kg: last.kg, n: 1, day: last.day } : null;
}

// The weight a remaining goal is judged from: the latest weigh-in on or before the day, or the
// fallback (the plan's start weight by default) before the first weigh-in.
export function currentWeight(day = today(), fallback = S.settings.startKg) {
  return latestWeight(day)?.kg ?? fallback;
}

export function weightSeries() {
  return Object.values(S.days).filter((d) => d.kg).sort((a, b) => (a.day < b.day ? -1 : 1));
}

// Slope over the last 14 days (kg/day) and the projected arrival at the target
export function projection() {
  const w = weightSeries().filter((d) => diffDays(d.day, today()) <= 14);
  if (w.length < 4 || diffDays(w[0].day, w[w.length - 1].day) < 6) return null;
  const xs = w.map((d) => diffDays(w[0].day, d.day));
  const ys = w.map((d) => d.kg);
  const mx = xs.reduce((a, b) => a + b, 0) / xs.length;
  const my = ys.reduce((a, b) => a + b, 0) / ys.length;
  let num = 0;
  let den = 0;
  xs.forEach((x, i) => { num += (x - mx) * (ys[i] - my); den += (x - mx) ** 2; });
  const slope = den ? num / den : 0;
  // Where the fitted line stands today; the 7-day average lags it by about three days on a steady loss
  const now = my + slope * (diffDays(w[0].day, today()) - mx);
  const out = { slope, perWeek: slope * 7, now }; // now: where the fitted line stands today
  if (slope < -0.005) {
    const daysLeft = Math.ceil((now - S.settings.targetKg) / -slope - 1e-6); // the 1e-6 keeps float noise from adding a day
    out.eta = daysLeft > 0 && daysLeft < 730 ? addDays(today(), daysLeft) : null;
    if (daysLeft <= 0) out.eta = today();
  }
  return out;
}

// The days the weight chart spans and where its date ticks go. range: 'week', 'weeks' or 'whole'; firstDay: the first weigh-in, or ''
export function chartWindow(range, t, s, firstDay) {
  if (range === 'whole') {
    let x0 = s.startDate;
    if (firstDay && firstDay < x0) x0 = diffDays(firstDay, s.startDate) > 21 ? addDays(s.startDate, -21) : firstDay;
    return { x0, x1: s.targetDate, ticks: null };
  }
  const week = range === 'week';
  const x0 = addDays(t, week ? -6 : -13);
  const at = (i, anchor) => [addDays(x0, i), anchor];
  return { x0, x1: t, ticks: week ? [at(0, 'start'), at(2, 'middle'), at(4, 'middle'), at(6, 'end')] : [at(0, 'start'), at(7, 'middle'), at(13, 'end')] };
}

export function weekStart(day) {
  const d = parseDay(day);
  return addDays(day, -((d.getDay() + 6) % 7));
}
export function weekFlex(day) {
  const ws = weekStart(day);
  const we = addDays(ws, 6);
  const r = { small: 0, meal: 0, off: 0 };
  for (const e of S.entries) {
    if (e.kind !== 'meal' || e.status !== 'ok' || e.day < ws || e.day > we) continue;
    if (e.tier === 'off') r.off += 1;
    else if (e.tier === 'flex') {
      if ((e.flags || []).includes('alcohol') || eff(e).kcal <= SMALL_TREAT_KCAL) r.small += 1;
      else r.meal += 1;
    }
  }
  return r;
}

// Coffee is counted, with no goal; a typed beer is logged as the Beer 0.5 l extra
export const COUNT_MAX = 30; // a day's coffee tally is never above this, typed, tapped or restored
// English and Turkish words together (the Turkish are in js/parse-tr.js), so typing works in either language
const COFFEE = ['coffee', ...PARSE_TR.coffee];
const BEER = ['beer', ...PARSE_TR.beer];
const plural = (en, tr) => [`(?:${en.join('|')})s?`, ...tr].join('|'); // "s" only after an English word
// "coffee", "a beer", "2 coffees", "beer 3", "2 kahve". "Beer 0.33 l" has a decimal, so it never matches (it is a planned extra)
const COUNT_RE = new RegExp(`^(?:(\\d{1,2}|an?|one|${PARSE_TR.one.join('|')})\\s+)?(${plural(['coffee'], PARSE_TR.coffee)}|${plural(['beer'], PARSE_TR.beer)})(?:\\s+(\\d{1,2}))?$`);
export function parseCount(text) {
  const m = COUNT_RE.exec(foldKey(text).trim());
  if (!m || (m[1] && m[3])) return null;
  const lead = m[1] && /^\d/.test(m[1]) ? Number(m[1]) : 1;
  const n = m[3] ? Number(m[3]) : lead;
  if (n < 1 || n > 12) return null;
  return { key: COFFEE.some((w) => m[2].startsWith(w)) ? 'coffee' : 'beer', n };
}
// Text that can be resolved on the device, without spending tokens. Typed words are folded (capitals and Turkish letters), and the
// keywords are the English and the Turkish together, whatever the interface language is.
const norm = (s) => foldKey(s).replace(/\s+/g, ' ').trim();
const P = PARSE_TR;
const NUM = '(\\d+(?:[.,]\\d+)?)';
const WEIGHT_RE = new RegExp(`^(?:weight|kg|${P.weight.join('|')})?\\s*(\\d{2,3}(?:[.,]\\d{1,2})?)\\s*(?:kg|${P.weight.join('|')})?$`);
const STEPS_RE = new RegExp(`^(\\d{1,2}[.,\\s]?\\d{3}|\\d{3,5})\\s*(?:steps?|${P.steps.join('|')})$`);
const UNITS = `ml|l|litres?|liters?|glass(?:es)?|${[...P.glass, ...P.litre].join('|')}`;
const WATER_RE = new RegExp(`^(?:water|${P.water.join('|')})\\s*${NUM}\\s*(${UNITS})?$`);
const WATER_TR_RE = new RegExp(`^${NUM}\\s*(${UNITS})?\\s*(?:${P.water.join('|')})$`); // "2 bardak su": the amount comes first
const TRAIN_RE = new RegExp(`^(workout|training|spinning|kettlebell|gym|${P.workout.join('|')})( day| done|${P.workoutEnd.map((w) => ` ${w}`).join('|')})?$`);
export function parseLocal(text) {
  const t = norm(text);
  let m = WEIGHT_RE.exec(t);
  if (m) {
    const kg = parseNum(m[1]);
    if (kg >= 50 && kg <= 160) return { type: 'weight', kg: Math.round(kg * 10) / 10 };
  }
  m = STEPS_RE.exec(t);
  if (m) return { type: 'steps', steps: parseInt(m[1].replace(/[.,\s]/g, ''), 10) }; // a dot or a comma inside is a thousands mark here, in both languages
  m = WATER_RE.exec(t) || WATER_TR_RE.exec(t);
  if (m) {
    const v = parseNum(m[1]);
    const unit = m[2] || (v <= 10 ? 'glass' : 'ml');
    const ml = unit === 'ml' ? v : unit.startsWith('glass') || P.glass.includes(unit) ? v * 250 : v * 1000;
    return { type: 'water', ml: Math.round(ml) };
  }
  if (TRAIN_RE.test(t)) return { type: 'train' };
  const flex = FLEX.find((x) => norm(x.name) === t || norm(td(x.name)) === t);
  if (flex) return { type: 'flex', flex };
  const favorite = (S.settings.favorites || []).find((x) => norm(x.name) === t);
  if (favorite) return { type: 'favorite', favorite };
  const c = parseCount(t); // after the extras and favourites, but before the plan meals: a plan meal called "Coffee" does not take the typed shortcut
  if (c) return { type: 'count', ...c };
  const meal = S.plan.meals.find((x) => norm(x.id) === t || norm(x.name) === t || norm(td(x.name)) === t); // the English name or the one on the screen
  if (meal) return { type: 'plan', meal };
  return null;
}
// A day's coffee count and the totals for the Monday-to-Sunday week of `day` and the week before
export function drinkTally(day) {
  const on = (from, to) => Object.entries(S.days).reduce((a, [d, r]) => a + (d >= from && d <= to ? (r && Number.isFinite(r.coffee) ? r.coffee : 0) : 0), 0);
  const ws = weekStart(day);
  return { today: on(day, day), week: on(ws, addDays(ws, 6)), prev: on(addDays(ws, -7), addDays(ws, -1)) };
}

export function streak() {
  let n = 0;
  let d = today();
  const first = dayStatus(d);
  if (first !== 'on') d = addDays(d, -1); // today is not over yet
  for (let i = 0; i < 400; i++) {
    const st = dayStatus(d);
    if (st === 'on') { n += 1; d = addDays(d, -1); } else break;
  }
  return n;
}

// The planned meals of the day not logged yet, in order (the late snack is only for when you are hungry)
export function openSlots(day) {
  const logged = new Set(mealsOf(day).map((e) => e.slot));
  return mainSlots().filter((s) => !logged.has(s.id));
}

export function suggest(day) {
  const tot = dayTotals(day);
  const rem = dayTarget(day) - tot.kcal;
  const remP = S.settings.protein - tot.p;
  const open = openSlots(day);
  if (!open.length) {
    const noMain = !mainSlots().length; // a plan without main meals is not "done": no meal was ever planned
    const late = S.plan.meals.find((m) => m.slot === 'late');
    if (late && remP > 12 && rem >= late.kcal - 5) return { rem, remP, meal: late, slot: SLOTS.find((s) => s.id === 'late'), extra: true, noMain };
    return { rem, remP, meal: null, noMain };
  }
  const next = open[0];
  const minKcal = (id) => { const k = S.plan.meals.filter((m) => m.slot === id).map((m) => m.kcal); return k.length ? Math.min(...k) : 0; };
  const reserve = open.slice(1).reduce((a, s) => a + minKcal(s.id), 0);
  const options = S.plan.meals.filter((m) => m.slot === next.id);
  const fit = options.filter((m) => m.kcal <= rem - reserve + 40);
  const pool = fit.length ? fit : options.slice().sort((a, b) => a.kcal - b.kcal).slice(0, 1);
  const meal = pool.slice().sort((a, b) => b.p - a.p)[0];
  return { rem, remP, meal, slot: next, tight: !fit.length };
}

// ——— The day against the plan ———
const KCAL_PER_KG = 7700; // roughly a kilo of body fat
// What the schedule asks of one day, in kg and in kcal
export function planRate() {
  const s = S.settings;
  const days = diffDays(s.startDate, s.targetDate);
  const kg = days > 0 ? Math.max(0, (s.startKg - s.targetKg) / days) : 0;
  return { kg, kcal: kg * KCAL_PER_KG };
}

// How a day compares with the plan and what it did to the schedule. Worked out on the device, no model involved.
// level: 'open' (today, still within budget), 'thin' (too little logged to judge), 'on',
// 'under', 'over' (slightly) or 'back' (clearly over)
export function dayVerdict(day) {
  const t = dayTotals(day);
  if (!t.n) return null;
  const s = S.settings;
  const target = dayTarget(day);
  const delta = Math.round(t.kcal - target);
  const live = day === today();
  const proteinGap = Math.max(0, Math.ceil(proteinFloor() - t.p - 1e-6)); // rounded up: any shortfall is a missed goal, as the goal ring says
  const off = mealsOf(day).filter((e) => e.tier === 'off').length;
  let level;
  if (delta > target * (BAND.near - 1)) level = 'back';
  else if (delta > target * (BAND.high - 1)) level = 'over';
  else if (live) level = 'open';
  else if (t.kcal < target * BAND.partial) level = 'thin';
  else if (t.kcal < kcalMinDay()) level = 'under';
  else level = 'on';
  const rate = planRate();
  return { level, live, target, kcal: t.kcal, delta, kg: delta / KCAL_PER_KG, share: rate.kcal > 0 ? delta / rate.kcal : 0, proteinGap, off };
}
export const VERDICT = {
  open: T('In progress'), thin: T('Not much logged'), on: T('In line'),
  under: T('Under budget'), over: T('A little above'), back: T('A bigger day'),
};
// The verdict in sentences: calories against the target, what a surplus costs on the schedule, protein, off-plan entries
export function verdictText(v) {
  const out = [];
  const kcal = fmtInt(Math.abs(v.delta));
  const judged = v.level !== 'thin' && v.level !== 'open';
  if (v.level === 'thin') out.push(t('Only {kcal} kcal logged, not enough to judge the day yet.', { kcal: fmtInt(v.kcal) }));
  else if (v.level === 'open') out.push(v.delta < -25 ? t('{kcal} kcal left for today.', { kcal }) : t('The budget for today is used up.'));
  else if (v.delta > 25) {
    // Whole sentences, so a language can order the parts its own way: the cost on the schedule is told in kg, then in days or a share of the day's loss
    const kg = v.kg >= 0.005 ? v.kg.toLocaleString(LOCALE, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '';
    if (!kg) out.push(t('{kcal} kcal above budget. One day does not change the trend.', { kcal }));
    else if (v.share <= 0) out.push(t('{kcal} kcal above budget: about {kg} kg. One day does not change the trend.', { kcal, kg }));
    else if (v.share >= 1.5) out.push(t('{kcal} kcal above budget: about {kg} kg, {days} days of the schedule. One day does not change the trend.', { kcal, kg, days: v.share.toLocaleString(LOCALE, { maximumFractionDigits: 1 }) }));
    else if (v.share >= 0.95) out.push(t('{kcal} kcal above budget: about {kg} kg, all of what the day was meant to lose. One day does not change the trend.', { kcal, kg }));
    else out.push(t('{kcal} kcal above budget: about {kg} kg, {pct}% of what the day was meant to lose. One day does not change the trend.', { kcal, kg, pct: Math.round(v.share * 100) }));
  } else if (v.delta < -25) out.push(v.level === 'under' ? t('{kcal} kcal under budget; check that everything is logged.', { kcal }) : t('{kcal} kcal under budget.', { kcal }));
  else out.push(t('On budget.'));
  if (judged && v.proteinGap > 0) out.push(t('Protein {gap} g short of your minimum.', { gap: v.proteinGap }));
  if (v.off) out.push(tn('{n} off-plan entry.|{n} off-plan entries.', v.off));
  return out;
}

// ——— The day's calories as one budget ———
export const PACE = { fast: 1.25, slow: 0.7 }; // eaten / planned-by-now: above fast is ahead of the plan, below slow behind it
// What the plan has spent at each meal time: each main slot spends the average of its options, scaled so the day ends at its budget
export function planSteps(target) {
  const steps = mainSlots().map((x) => {
    const options = S.plan.meals.filter((m) => m.slot === x.id);
    const [h, m] = x.time.split(':').map(Number);
    return { id: x.id, name: x.name, time: x.time, at: h + m / 60, kcal: options.reduce((a, o) => a + o.kcal, 0) / (options.length || 1) };
  });
  const scale = target / (steps.reduce((a, x) => a + x.kcal, 0) || 1);
  steps.forEach((x) => { x.kcal *= scale; });
  return steps;
}
export const plannedBy = (target, hour) => planSteps(target).filter((x) => x.at <= hour).reduce((a, x) => a + x.kcal, 0);
// The day's calories against its budget and, for a day in progress (planned = kcal the plan has spent by now), against the plan's pace.
// planned === null means a finished day. → { level: '' | 'over' | 'back', tone: 'good' | 'warn' | 'calm', text }
export function budgetVerdict({ target, eaten: kcal, planned }) {
  const eaten = Math.round(kcal); // as dayVerdict rounds it
  const rem = target - eaten;
  const n = (x) => fmtInt(Math.abs(x));
  const past = planned == null;
  const level = rem < -target * (BAND.near - 1) ? 'back' : rem < -target * (BAND.high - 1) ? 'over' : '';
  if (level) return { level, tone: 'warn', text: past ? t('Ended {n} above', { n: n(rem) }) : level === 'back' ? t('Well above budget') : t('A little above budget') };
  if (past) {
    if (!eaten) return { level, tone: 'calm', text: t('Nothing logged') };
    const text = Math.abs(rem) <= 25 ? t('Ended on budget') : rem > 0 ? t('Ended {n} under', { n: n(rem) }) : t('Ended {n} above', { n: n(rem) });
    return { level, tone: eaten < kcalMinDay() ? 'calm' : 'good', text };
  }
  if (rem <= 0) return planned >= target - 1 ? { level, tone: 'good', text: t('Budget used') } : { level, tone: 'warn', text: t('Budget used early') }; // within the slack still counts as on target, once the plan has spent it too
  if (!planned) return { level, tone: 'calm', text: '' };
  if (!eaten) return { level, tone: 'calm', text: t('Nothing eaten yet') };
  const rate = eaten / planned;
  if (rate > PACE.fast) return { level, tone: 'warn', text: t('{n} above plan pace', { n: n(eaten - planned) }) };
  if (rate < PACE.slow) return { level, tone: 'calm', text: t('{n} under plan pace', { n: n(eaten - planned) }) };
  return { level, tone: 'good', text: t('On plan pace') };
}
// Where the bar's marks sit, as shares of its width: the width is the budget, or what was eaten when that is more
export function budgetMeter({ target, eaten, planned }) {
  const D = Math.max(target, eaten) || 1;
  return { eat: eaten / D, cap: target / D, plan: planned > 0 && planned < target - 1 ? planned / D : null };
}

// A review belongs to the log it was written for: it goes stale when the day's meals or the minimum change, or when it was written before the day ended
export const reviewSig = (day) => `${dayTarget(day)}|${kcalMinDay()}|${mealsOf(day).map((e) => `${e.id}:${Math.round(eff(e).kcal)}`).sort().join(',')}`;
export function reviewState(day) {
  const r = S.days[day] && S.days[day].review;
  if (!r) return 'none';
  return r.sig !== reviewSig(day) || (r.live && day !== today()) ? 'stale' : 'fresh';
}

// The quick note on the day so far goes stale when the day's meals change
export function coachState(day) {
  const c = S.days[day] && S.days[day].coach;
  if (!c) return 'none';
  return c.sig === reviewSig(day) && day === today() ? 'fresh' : 'stale';
}

// ——— The review of the whole log ———
const djb2 = (str) => { let h = 5381; for (let i = 0; i < str.length; i++) h = (Math.imul(h, 33) + str.charCodeAt(i)) | 0; return (h >>> 0).toString(36); };
// What the progress review was written for: the goals, the plan, the weigh-ins and, in steps of five, the days with meals.
// Water, coffee and supplement ticks, edits to an entry (its kcal or tier only move the day's verdict, not that it has one) and S.rev leave it as it is.
export function progressSig() {
  const s = S.settings;
  const w = weightSeries();
  const last = w[w.length - 1];
  const mealDays = new Set(S.entries.filter((e) => e.kind === 'meal' && e.status === 'ok').map((e) => e.day)).size;
  let verdictDays = 0;
  for (let d = s.startDate; d <= today(); d = addDays(d, 1)) if (dayVerdict(d)) verdictDays += 1;
  return djb2(JSON.stringify([
    ['startDate', 'targetDate', 'startKg', 'targetKg', 'kcalRest', 'kcalTrain', 'kcalMinDay', 'protein', 'fiber', 'steps', 'water'].map((k) => s[k]),
    planDigest(S.plan), last ? weekStart(last.day) : '', w.length, last ? Math.round(last.kg * 10) / 10 : '', Math.floor(mealDays / 5), verdictDays,
    ...(s.age > 0 || s.gender === 'female' || s.gender === 'male' ? [[s.age > 0 ? s.age : 0, s.gender === 'female' || s.gender === 'male' ? s.gender : '']] : []), // only what the brief sends (age, female/male); an unset profile keeps the old hash
  ]));
}

// The bands of the on-device rating: weigh-ins needed in the last 14 days and the days they span, the average's distance from the
// schedule (kg) that is a bit behind, and the loss over three weeks (kg) below which the weight counts as flat. Two weigh-ins make
// today's average, three make each arm of the two-weeks-behind check and two the flat one, so a fluke reading never drives a band.
export const RATING_MIN_WEIGHINS = 3;
export const RATING_MIN_SPAN = 10;
export const RATING_BEHIND = 0.2;
export const RATING_STUCK_GAP = 0.7; // as in the Progress tab's advice to adjust
export const RATING_FLAT = 0.15;
// 'great', 'on-track', 'a-bit-behind', 'stuck' or 'too-early'; the model may agree or disagree, this is the fallback
export function progressRatingHint() {
  const s = S.settings;
  const t = today();
  const w = weightSeries().filter((d) => diffDays(d.day, t) <= 14);
  const a = avg7(t);
  if (w.length < RATING_MIN_WEIGHINS || diffDays(w[0].day, w[w.length - 1].day) < RATING_MIN_SPAN || !a || a.n < 2) return 'too-early'; // one fluke reading is not an average
  if (a.kg <= s.targetKg) {
    // At the target already, but losing faster than the plan asks is overshoot, not "great"
    const pr = projection();
    return pr && -pr.perWeek > planRate().kg * 7 ? 'on-track' : 'great';
  }
  const wk = addDays(t, -7);
  const b = avg7(wk);
  const f = avg7(addDays(t, -21));
  // The n floors are exactly the bar the brief's adjust rule and the Progress tab's notice use, so the hint never disagrees with them
  if ((b && a.n >= 3 && b.n >= 3 && a.kg - targetAt(t, s) > RATING_STUCK_GAP && b.kg - targetAt(wk, s) > RATING_STUCK_GAP) || (f && f.n >= 2 && f.kg - a.kg < RATING_FLAT)) return 'stuck';
  return a.kg - targetAt(t, s) >= RATING_BEHIND ? 'a-bit-behind' : 'on-track';
}
// 'none' before the first week is over, 'gated' until there are 14 days or 7 with a week's weigh-ins, then 'ready'
export function progressGate() {
  const days = diffDays(S.settings.startDate, today());
  if (days < 7) return 'none';
  return days >= 14 || (avg7(today()) || { n: 0 }).n >= 3 ? 'ready' : 'gated';
}
// 'none' = not written yet, 'refresh' = the log changed since or it is over 14 days old or has no valid past time, else 'fresh'
export function progressState() {
  const r = S.progressReview;
  if (!r) return 'none';
  const age = Date.now() - r.ts;
  return r.sig !== progressSig() || !Number.isFinite(r.ts) || age < 0 || age >= 14 * 86400000 ? 'refresh' : 'fresh';
}

// ——— Formatting ———
export const fmtKg = (kg) => (Math.round(kg * 10) / 10 || 0).toLocaleString(LOCALE, { minimumFractionDigits: 1, maximumFractionDigits: 1 }); // `|| 0`: never "-0.0"
export const fmtInt = (n) => Math.round(n).toLocaleString(LOCALE);

// ——— Generated entry titles ———
// An entry made by the app keeps its English `title` (the canonical text: backups, the SQL export, favourites and the model read it) and,
// next to it, `tk: { kind, params }`, from which the screen builds the title in the interface language. Older entries have no `tk`.
// A plan or flex meal (`tk` kind 'plan') stores the meal's name as its title and shows that, never the plan's current name.
const TITLES = {
  weight: (p) => t('Weight {kg} kg', { kg: fmtKg(p.kg) }),
  steps: (p) => t('{steps} steps', { steps: fmtInt(p.steps) }),
  photo: () => t('Photo'),
};
// What each kind needs in its params to give a sensible title
const numIn = (v, lo, hi) => typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi;
const TK_VALID = {
  weight: (p) => numIn(p.kg, 20, 400),
  steps: (p) => numIn(p.steps, 0, 200000),
  photo: () => true,
  plan: (p) => typeof p.id === 'string',
};
export const tkValid = (tk) => !!tk && typeof tk === 'object' && has(TK_VALID, tk.kind) && !!tk.params && typeof tk.params === 'object' && TK_VALID[tk.kind](tk.params);
export const TK_KINDS = Object.keys(TK_VALID);
// The title of an entry in the interface language; the stored title when there is no known `tk`
export function titleOf(e) {
  const k = e.tk;
  // A plan or flex meal (and an older plan entry without a valid tk) shows the name it was logged with, so editing or switching
  // the plan never changes a past entry; a default meal's English name still shows in the interface language.
  // A valid tk comes first: an entry re-estimated as a weigh-in or steps keeps its old planId.
  if (tkValid(k)) {
    if (k.kind === 'plan') return typeof e.title === 'string' ? td(e.title) : e.title;
    return TITLES[k.kind](k.params) || e.title;
  }
  if (typeof e.planId === 'string' && e.planId) return typeof e.title === 'string' ? td(e.title) : e.title;
  return e.title;
}
// { title, tk } for a new generated entry: the English title, built with English formats whatever the language is
export function titleFor(kind, params) {
  if (kind === 'plan') return { tk: { kind, params } }; // no generated title: the caller sets the meal's name as the title
  const title = inEnglish(() => TITLES[kind](params));
  return title ? { title, tk: { kind, params } } : { title: '' };
}

export const SUPP_MAX = 12; // supplements in the list
// The supplements taken on a day, as ids of supplements that are still in the list
export const suppTaken = (day) => {
  const have = new Set((S.settings.supplements || []).map((x) => x.id));
  return ((S.days[day] && S.days[day].taken) || []).filter((id) => have.has(id));
};

export const CHECK_MAX = 4; // photos per check
export const checkReady = () => !S.check.busy && (S.check.photos.length > 0 || S.check.note.trim().length > 2);
