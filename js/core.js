// State, and the calculations on it. No DOM and no storage, so the maths loads on its own (in node, for tests).
import { t, tn, T, td, foldKey, parseNum, inEnglish } from './i18n.js';
import { PARSE_TR } from './parse-tr.js';
import { MEALS, MEAL_BY_ID, SLOTS, FLEX, DEFAULTS, LOCALE, has, dayKey, parseDay, addDays, diffDays, SMALL_TREAT_KCAL } from './plan.js';

export const APP_VERSION = '45'; // bump together with VERSION in sw.js
export const SCHEMA_VERSION = 2; // version of the stored data and of the backup file
// The app's internal id. It names the database, the caches, the backup files' marker and the SQL export's tables, and
// never follows the app's name (Pickle), so a rename touches only what people see and never the data.
export const APP_ID = 'weightplan';

// ——— State ———
// The settings of an app that has just been installed (new objects each time, so a reset never shares them)
export const freshSettings = () => ({
  ...DEFAULTS, schema: SCHEMA_VERSION,
  provider: 'openai', oaBase: 'https://generativelanguage.googleapis.com/v1beta/openai', oaModel: 'gemini-3.5-flash', oaKey: '', apiKey: '',
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
  rev: 0, // moves on every save, load, clear and restore: what a cached result of the log is keyed on
  badgeIntro: 0, // badges taken in from the history, told once on the Progress tab
  viewDay: dayKey(new Date()),
  busy: new Set(),
  retry: new Map(), // status note shown while an analysis is retrying
  reviewing: new Set(), // days whose review is being written
  reviewErr: new Map(), // day → why the last review failed
  coaching: new Set(), // days whose quick note is being written
  coachErr: new Map(), // day → why the last quick note failed
  reviewOpen: new Map(), // day → whether its review is expanded, once the person has toggled it
  check: freshCheck(), // the check being put together
  checks: [], // earlier verdicts, newest first, without photos
  badges: null, // earned badges as stored (kv `badges`, see js/badges.js); null until something is logged
  urls: new Map(),
  persisted: null,
  storage: null,
  calPick: null,
  chartRange: 'weeks', // the weight chart: 'week' (7 days), 'weeks' (14) or 'whole' (the plan)
  sheet: null, // open bottom sheet: {type:'settings'|'entry'|'num'|'slot'|'plan'|'plan-frame', ...}
  suppEdit: '', // id of the supplement being edited in Settings
  openSetting: '', // expanded section in Settings
};


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
export const eff = (e) => {
  const m = e.mult || 1;
  return { kcal: (e.kcal || 0) * m, p: (e.p || 0) * m, c: (e.c || 0) * m, f: (e.f || 0) * m, fib: (e.fib || 0) * m };
};
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
  const meal = MEALS.find((x) => norm(x.id) === t || norm(x.name) === t || norm(td(x.name)) === t); // the English name or the one on the screen
  if (meal) return { type: 'plan', meal };
  const flex = FLEX.find((x) => norm(x.name) === t || norm(td(x.name)) === t);
  if (flex) return { type: 'flex', flex };
  const favorite = (S.settings.favorites || []).find((x) => norm(x.name) === t);
  if (favorite) return { type: 'favorite', favorite };
  const c = parseCount(t);
  if (c) return { type: 'count', ...c };
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
  return SLOTS.filter((s) => s.id !== 'late' && !logged.has(s.id));
}

export function suggest(day) {
  const tot = dayTotals(day);
  const rem = dayTarget(day) - tot.kcal;
  const remP = S.settings.protein - tot.p;
  const open = openSlots(day);
  if (!open.length) {
    if (remP > 12 && rem >= 90) return { rem, remP, meal: MEAL_BY_ID['N-A'], slot: SLOTS.find((s) => s.id === 'late'), extra: true };
    return { rem, remP, meal: null };
  }
  const next = open[0];
  const minKcal = (id) => Math.min(...MEALS.filter((m) => m.slot === id).map((m) => m.kcal));
  const reserve = open.slice(1).reduce((a, s) => a + minKcal(s.id), 0);
  const options = MEALS.filter((m) => m.slot === next.id);
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
  const steps = SLOTS.filter((x) => x.id !== 'late').map((x) => {
    const options = MEALS.filter((m) => m.slot === x.id);
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

// ——— Formatting ———
export const fmtKg = (kg) => (Math.round(kg * 10) / 10 || 0).toLocaleString(LOCALE, { minimumFractionDigits: 1, maximumFractionDigits: 1 }); // `|| 0`: never "-0.0"
export const fmtInt = (n) => Math.round(n).toLocaleString(LOCALE);

// ——— Generated entry titles ———
// An entry made by the app keeps its English `title` (the canonical text: backups, the SQL export, favourites and the model read it) and,
// next to it, `tk: { kind, params }`, from which the screen builds the title in the interface language. Older entries have no `tk`.
const planItem = (id) => (has(MEAL_BY_ID, id) ? MEAL_BY_ID[id] : FLEX.find((f) => f.id === id));
const planName = (id) => { const x = planItem(id); return x ? td(x.name) : null; };
const TITLES = {
  weight: (p) => t('Weight {kg} kg', { kg: fmtKg(p.kg) }),
  steps: (p) => t('{steps} steps', { steps: fmtInt(p.steps) }),
  photo: () => t('Photo'),
  plan: (p) => planName(p.id),
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
export const TK_KINDS = Object.keys(TITLES);
// The title of an entry in the interface language; the stored title when there is no known `tk`
export function titleOf(e) {
  const k = e.tk;
  const text = tkValid(k) ? TITLES[k.kind](k.params) : null;
  if (text) return text;
  // An older plan entry has no tk: when its title is still the plan item's English name, show that name in the interface language
  const item = typeof e.planId === 'string' ? planItem(e.planId) : null;
  return item && item.name === e.title ? td(item.name) : e.title;
}
// { title, tk } for a new generated entry: the English title, built with English formats whatever the language is
export function titleFor(kind, params) {
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
