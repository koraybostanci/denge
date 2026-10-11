// The fixed state and the screens rendered from it, for the English snapshot and the pseudo-locale test.
// What is covered: Today, Log, Check, Progress, Plan, Settings and the entry, number, slot, plan, badge and avatar sheets, which are
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
const { addDays } = await import('../js/plan.js');
const { S } = core;
export const T = core.today();
export const day = (off) => addDays(T, off);
export const at = (d, h) => RealDate.parse(`${d}T${String(h).padStart(2, '0')}:00:00Z`);
let n = 0;
export const meal = (d, h, slot, title, kcal, p, extra = {}) => ({ id: `m${n++}`, day: d, ts: at(d, h), createdAt: at(d, h), kind: 'meal', status: 'ok', slot, title, kcal, p, c: 30, f: 12, fib: 5, mult: 1, tier: 'plan', flags: [], items: [], ...extra });

export function fixture() {
  S.tab = 'today';
  S.viewDay = T;
  S.sheet = null;
  S.calPick = null;
  S.settings = core.freshSettings();
  Object.assign(S.settings, { startDate: day(-9), startKg: 87, targetDate: day(78), targetKg: 78, lastBackup: NOW - 3 * 86400000 });
  S.entries = [];
  S.days = {};
  for (let i = 0; i <= 9; i++) {
    const d = day(-i);
    S.entries.push(meal(d, 8, 'breakfast', 'Oats with yoghurt', 420, 30), meal(d, 13, 'lunch', 'Chicken and rice', 650, 45), meal(d, 19, 'dinner', i % 3 === 0 ? 'Pizza night' : 'Salmon and salad', i % 3 === 0 ? 900 : 560, i % 3 === 0 ? 30 : 40, i % 3 === 0 ? { tier: 'flex' } : {}));
    S.entries.push({ id: `w${i}`, day: d, ts: at(d, 7), createdAt: at(d, 7), kind: 'weight', status: 'ok', kg: 87 - i * -0.1, title: 'Weight' });
    S.days[d] = { day: d, kg: 86.5 + i * 0.1, steps: 6000 + i * 400, water: 1500 + i * 100, train: i % 2 === 0, coffee: i % 4 };
  }
  S.entries.push({ id: 'p1', day: T, ts: at(T, 15), createdAt: at(T, 15), kind: 'meal', status: 'pending', slot: 'snack', title: '', kcal: 0, p: 0, c: 0, f: 0, fib: 0, mult: 1, tier: 'plan', flags: [], items: [] });
  S.checks = [];
  // Earned badges at different finishes; days_on (30) and best_run (7) are above what was seen, so they are new (stored, so they show whatever the fixture log would earn by itself)
  S.badges = { v: 1, told: true, seen: { first_meal: 1, first_weigh: 1, first_on: 1, days_on: 7, best_run: 3, perfect_day: 1, kilos: 1, protein_days: 150 }, av: { stage: 'stage2', face: 'face_smile', acc: 'acc_leaf' }, base: { startKg: 87, targetKg: 78 }, got: {
    first_meal: { 1: day(-9) }, first_weigh: { 1: day(-9) }, first_on: { 1: day(-8) },
    days_on: { 7: day(-2), 30: day(-1) }, best_run: { 3: day(-6), 7: day(-2) }, perfect_day: { 1: day(-7) }, kilos: { 1: day(-3) },
    protein_days: { 10: day(-5), 50: day(-4), 100: day(-3), 150: day(-1) },
  } };
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
  S.entries = [];
  S.days = {};
  add('today-empty', views.renderToday);
  add('log-empty', views.renderLog);
  add('progress-empty', views.renderProgress);
  [S.entries, S.days] = kept;
  S.tab = 'progress';
  S.calPick = day(-1);
  add('progress-picked-day', views.renderProgress);
  S.calPick = `week:${core.weekStart(day(-7))}`;
  add('progress-picked-week', views.renderProgress);
  S.calPick = null;
  add('settings', views.renderSettings);
  S.settings.provider = 'anthropic';
  S.settings.apiKey = 'k';
  add('settings-anthropic', views.renderSettings);
  const e = S.entries.find((x) => x.kind === 'meal' && x.status === 'ok');
  add('entry-sheet', () => views.renderEntrySheet(e.id));
  for (const kind of ['water', 'steps', 'weight', 'coffee']) add(`num-sheet-${kind}`, () => views.renderNumSheet(kind, T));
  add('slot-sheet', () => views.renderSlotSheet('lunch', T));
  add('plan-sheet', () => views.renderPlanSheet('L-A'));
  add('frame-sheet', () => views.renderFrameSheet('L-A'));
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
  return out;
}
