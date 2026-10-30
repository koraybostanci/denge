// A long log must not make the Progress tab crawl: the work for a day used to filter every entry in the log, so a year of
// daily logging took about a second and three years froze the tab. `node --test`
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { S, today, freshSettings, dayTotals, history, progressSig, withDayIndex, mealsOf } from '../js/core.js';
import { renderProgress, renderToday, renderLog } from '../js/views.js';
import { progressBrief, BRIEF_MAX } from '../js/briefs.js';
import { addDays, buildPlan } from '../js/plan.js';
import seedPlan from '../js/default-plan.js';

const T = today();
const day = (o) => addDays(T, o);
// A person who weighs in and logs three meals every day for N days
function longLog(N) {
  S.settings = { ...freshSettings(), startDate: day(-N), startKg: 95, targetDate: day(60), targetKg: 70, kcalRest: 1600, kcalTrain: 1800, protein: 130, proteinMin: 115 };
  S.plans = { active: 'default', list: [seedPlan] }; S.plan = buildPlan(seedPlan);
  S.entries = []; S.days = {};
  for (let o = -N; o <= 0; o++) {
    const d = day(o);
    for (const [slot, h, kcal, p] of [['lunch', 12, 560 + (o % 3) * 40, 38], ['snack1', 14, 200, 15], ['dinner', 18, 640 - (o % 2) * 30, 45]]) S.entries.push({ id: `m${o}${slot}`, day: d, ts: Date.parse(`${d}T${h}:00:00Z`), kind: 'meal', status: 'ok', slot, title: slot, kcal, p, c: 40, f: 15, fib: 5, mult: 1, tier: 'plan', flags: [], items: [] });
    S.days[d] = { day: d, kg: Math.round((95 - 0.03 * (o + N) + Math.sin(o) * 0.3) * 10) / 10, steps: 7000, water: 2200, train: o % 3 === 0 };
  }
  S.badges = null; S.checks = []; S.viewDay = T; S.tab = 'progress';
}
const time = (f) => { const t0 = performance.now(); const v = f(); return [performance.now() - t0, v]; };

test('Progress with 800 days of daily logging renders well within a second (it took about 3 s before)', () => {
  longLog(800);
  const [ms] = time(() => renderProgress());
  assert.ok(ms < 1500, `${Math.round(ms)} ms`); // generous for a slow runner: about 150 ms here
});
test('the cost grows about with the number of days, not with its square: four times the days is not sixteen times the work', () => {
  const run = (N) => { longLog(N); renderProgress(); return Math.min(...[1, 2, 3].map(() => time(() => renderProgress())[0])); };
  const a = run(300); const b = run(1200); // 4 times the days
  assert.ok(b < a * 12 + 30, `${a.toFixed(1)} ms at 300 days, ${b.toFixed(1)} ms at 1200`); // a square would be 16 times; the margin allows for the passes that are still a little more than linear
});
test('the other tabs and the passes underneath stay quick on a long log', () => {
  longLog(1000);
  for (const [name, f, max] of [['Today', () => renderToday(), 300], ['Log', () => renderLog(), 300], ['history', () => history(), 300], ['progressSig', () => progressSig(), 300], ['brief', () => progressBrief(), 800]]) {
    const [ms] = time(f);
    assert.ok(ms < max, `${name}: ${Math.round(ms)} ms`);
  }
});
test('the brief of a long log still fits its cap and keeps the weekly lines and the fixed tail', () => {
  longLog(1000);
  const b = progressBrief();
  assert.ok(b.length <= BRIEF_MAX, String(b.length));
  assert.match(b, /\nweek of \d+ \w+ \d{4}: avg \d+\.\d kg, \d+ weigh-ins/);
  assert.match(b, /APP RATING ESTIMATE: /);
  assert.match(b, /Current week so far:/);
});
test('the day index is let go after a pass: entries logged afterwards are seen', () => {
  longLog(30);
  const before = dayTotals(day(0)).n;
  renderProgress();
  history();
  progressSig();
  S.entries.push({ id: 'late', day: day(0), ts: Date.now(), kind: 'meal', status: 'ok', slot: 'late', title: 'late', kcal: 100, p: 1, c: 1, f: 1, fib: 0, mult: 1, tier: 'plan', flags: [], items: [] });
  assert.equal(dayTotals(day(0)).n, before + 1);
  assert.throws(() => withDayIndex(() => { throw new Error('boom'); }), /boom/);
  assert.equal(mealsOf(day(0)).length, before + 1, 'and also after a pass that threw');
});
