// What the model reads: the day, the coach note and the check, in plain English lines. Text only, a few hundred tokens each.
// Always English, whatever the interface language is (inEnglish), and no DOM, so the tests build them too.
import { inEnglish } from './i18n.js';
import { sanitizeOut, placeWord } from './text.js';
import { SLOT_NAME, parseDay, addDays, diffDays, targetAt, hhmm } from './plan.js';
import { S, today, eff, mealsOf, dayTotals, dayTarget, proteinFloor, avg7, weekFlex, openSlots, mainSlots, mealTimesLine, planRate, dayVerdict, VERDICT, verdictText,
  withDayIndex, weekStart, history, dayStatus, proteinLevel, projection, drinkTally, suppTaken, kcalMinDay, progressRatingHint } from './core.js';

// The day in plain lines: what the model gets to read. Text only, a few hundred tokens.
export const reviewBrief = (day) => inEnglish(() => reviewBriefText(day));
function reviewBriefText(day) {
  const s = S.settings;
  const dd = S.days[day] || {};
  const t = dayTotals(day);
  const v = dayVerdict(day);
  const r = (x) => Math.round(x);
  // The brief is read by the model and stays English whatever the interface language is
  const date = (d) => new Intl.DateTimeFormat('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(parseDay(d));
  const meals = mealsOf(day).sort((a, b) => a.ts - b.ts);
  const lines = [
    `Day: ${date(day)}, ${dd.train ? 'workout day' : 'rest day'}, ${v.live ? `still in progress, now ${hhmm(Date.now())}` : 'finished'}.`,
    `Daily budget and goals: ${v.target} kcal, protein ${s.protein} g (at least ${proteinFloor()}), fibre ${s.fiber} g, ${s.steps} steps, water ${s.water / 1000} l.`,
    `Eaten: ${r(t.kcal)} kcal, protein ${r(t.p)} g, carbs ${r(t.c)} g, fat ${r(t.f)} g, fibre ${r(t.fib)} g.`,
    'Meals:',
  ];
  for (const e of meals) {
    const x = eff(e);
    const m = e.mult || 1;
    const kind = e.planId ? 'plan meal' : e.tier === 'off' ? 'off plan' : e.tier === 'flex' ? 'weekly flex' : 'fits the plan';
    const items = e.planId ? '' : (e.items || []).slice(0, 6).map((i) => `${sanitizeOut(i.n)}${i.g ? ` ${r(i.g * m)} g` : ''} ${r((i.kcal || 0) * m)} kcal`).join('; ');
    lines.push(`- ${hhmm(e.ts)} ${(SLOT_NAME[e.slot] || '').toLowerCase()}: ${sanitizeOut(e.title)}, ${r(x.kcal)} kcal, ${r(x.p)} g protein, ${kind}`
      + `${(e.flags || []).includes('alcohol') ? ', alcohol' : ''}${e.place ? `, ${e.place === 'out' ? 'eaten out' : `at ${placeWord(e.place)}`}` : ''}${items ? ` [${items}]` : ''}`);
  }
  const open = openSlots(day).map((x) => x.name.toLowerCase());
  if (open.length) lines.push(`${v.live ? 'Not eaten yet' : 'Nothing logged for'}: ${open.join(', ')}.`);
  const waiting = S.entries.filter((e) => e.day === day && e.kind === 'meal' && e.status !== 'ok').length;
  if (waiting) lines.push(`${waiting} more ${waiting === 1 ? 'entry is' : 'entries are'} not analysed yet and not counted.`);
  lines.push(`Steps: ${dd.steps ? r(dd.steps) : 'not logged'}. Water: ${dd.water ? `${(dd.water / 1000).toFixed(1)} l` : 'not logged'}. Weigh-in: ${dd.kg ? `${dd.kg} kg` : 'none'}.`);
  const rate = planRate();
  let goal = `Goal: ${s.startKg} kg on ${s.startDate} to ${s.targetKg} kg on ${s.targetDate}, which needs about ${rate.kg.toFixed(2)} kg (${r(rate.kcal / 10) * 10} kcal) a day.`;
  const avg = avg7(day);
  if (day < s.startDate) goal += ' On this day the plan had not started yet.';
  else if (avg) {
    const sched = targetAt(day, s);
    const gap = avg.kg - sched;
    goal += ` Schedule for this day ${sched.toFixed(1)} kg; 7-day average ${avg.kg.toFixed(1)} kg, ${Math.abs(gap) < 0.15 ? 'on the schedule' : `${Math.abs(gap).toFixed(1)} kg ${gap > 0 ? 'above' : 'below'} the schedule`}.`;
  }
  lines.push(goal);
  const f = weekFlex(day);
  lines.push(`This week: beer or small dessert ${f.small} of 1, flexible dinner ${f.meal} of 1, off-plan entries ${f.off}.`);
  lines.push(`App verdict: ${VERDICT[v.level].toLowerCase()}. ${verdictText(v).join(' ')}`);
  return lines.join('\n');
}

// The review's brief, plus what is left of the budget and the goals
export function coachBrief(day) {
  const s = S.settings;
  const t = dayTotals(day);
  const r = (x) => Math.round(x);
  return `${reviewBrief(day)}\nLeft today: ${r(Math.max(0, dayTarget(day) - t.kcal))} kcal, protein ${r(Math.max(0, s.protein - t.p))} g, fibre ${r(Math.max(0, s.fiber - t.fib))} g.`;
}
// What the model needs to judge a choice: where the day stands, the week's allowance, the goal, and the person's note
export const checkBrief = (note) => inEnglish(() => checkBriefText(note));
function checkBriefText(note) {
  const s = S.settings;
  const t = today();
  const now = new Date();
  const tot = dayTotals(t);
  const target = dayTarget(t);
  const r = (x) => Math.round(x);
  const open = openSlots(t).map((x) => x.name.toLowerCase());
  const times = mealTimesLine();
  // Like the review brief, this one is read by the model and stays English (hence 'en-GB' below)
  const lines = [
    `Time ${hhmm(now)} on ${new Intl.DateTimeFormat('en-GB', { weekday: 'long' }).format(now)}, a ${S.days[t] && S.days[t].train ? 'workout' : 'rest'} day.`,
    tot.n
      ? `Today so far: ${r(tot.kcal)} of ${target} kcal eaten, ${r(target - tot.kcal) >= 0 ? `${r(target - tot.kcal)} kcal left` : `${r(tot.kcal - target)} kcal above`}; protein ${r(tot.p)} of ${s.protein} g.${open.length ? ` Not eaten yet: ${open.join(', ')}.` : mainSlots().length ? ' All meals of the day are logged.' : ''}`
      : `Nothing eaten yet today: the whole ${target} kcal and ${s.protein} g of protein are open.${times ? ` The plan's meals: ${times}.` : ''}`,
    `Daily budget and goals: ${s.kcalRest} kcal on rest days, ${s.kcalTrain} on workout days, protein ${s.protein} g, fibre ${s.fiber} g.`,
  ];
  const f = weekFlex(t);
  lines.push(`This week: flexible dinner ${f.meal} of 1 used, beer or small dessert ${f.small} of 1 used, off-plan entries ${f.off}.`);
  const rate = planRate();
  let goal = `Goal: ${s.startKg} kg to ${s.targetKg} kg by ${s.targetDate}, about ${rate.kg.toFixed(2)} kg (${r(rate.kcal / 10) * 10} kcal) a day.`;
  const avg = avg7(t);
  if (avg && t >= s.startDate) {
    const gap = avg.kg - targetAt(t, s);
    goal += ` 7-day average ${avg.kg.toFixed(1)} kg, ${Math.abs(gap) < 0.15 ? 'on the schedule' : `${Math.abs(gap).toFixed(1)} kg ${gap > 0 ? 'above' : 'below'} the schedule`}.`;
  }
  lines.push(goal);
  lines.push(note ? `Note from the person: ${sanitizeOut(note)}` : 'No note from the person.');
  return lines.join('\n');
}

// The whole log in a fixed-size summary for the progress review: facts the app computed, no meals, no stored prose, no supplement names.
// Over BRIEF_MAX characters the oldest weekly rows go first, then the older weigh-ins collapse into one average line a week (the latest stay raw), then the oldest of those go; the goal line and the other fixed lines stay.
export const BRIEF_MAX = 3500;
// Is there anything at all for the review to go on? The same check the brief opens with, kept apart so the tap path can ask once cheaply instead of building the whole summary.
export const hasProgressData = () => S.entries.some((e) => e.kind === 'meal' && e.status === 'ok')
  || Object.values(S.days).some((d) => d && (d.kg || d.steps || d.water || d.coffee || (d.taken && d.taken.length) || d.train));
export const progressBrief = () => inEnglish(() => progressBriefText());
function progressBriefText() {
  const s = S.settings;
  const t = today();
  if (!hasProgressData()) return '';
  return withDayIndex(() => {
    const r = (x) => Math.round(x);
    const f1 = (x) => (Math.round(x * 10) / 10 || 0).toFixed(1); // never "-0.0"
    const f2 = (x) => (Math.round(x * 100) / 100 || 0).toFixed(2);
    const date = (d) => new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }).format(parseDay(d));
    const short = (d) => new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short' }).format(parseDay(d));
    const total = diffDays(s.startDate, s.targetDate);
    const sched = (d) => (total > 0 ? targetAt(d, s) : null);
    const sf = (d) => (total > 0 ? f1(targetAt(d, s)) : 'n/a');
    const rate = planRate();
    const h = history();
    const pr = projection();
    const days = [];
    for (let d = s.startDate; d <= t; d = addDays(d, 1)) days.push(d);
    const ok = S.entries.filter((e) => e.kind === 'meal' && e.status === 'ok');
    const mealDays = new Set(ok.map((e) => e.day)).size;
    const off = ok.filter((e) => e.tier === 'off').length;
    let small = 0;
    let dinners = 0;
    for (let w = weekStart(s.startDate); w <= t; w = addDays(w, 7)) { const fx = weekFlex(w); small += fx.small; dinners += fx.meal; }
    const workouts = days.filter((d) => S.days[d] && S.days[d].train).length;
    const levels = {};
    let judged = 0;
    for (const d of days) {
      const v = dayVerdict(d);
      if (v && !v.live) { levels[v.level] = (levels[v.level] || 0) + 1; judged += 1; }
    }
    const lines = [`Progress review, written on ${date(t)}.`];
    // 1. The goal
    const goalHead = `Goal: ${s.startKg} kg on ${s.startDate} to ${s.targetKg} kg on ${s.targetDate}`;
    lines.push(total > 0
      ? `${goalHead}, which needs about ${f2(rate.kg)} kg a day. Day ${Math.max(0, h.days)} of ${total}. Never go below ${kcalMinDay()} kcal a day.`
      : `${goalHead}, with no planned days between its start and its end. Never go below ${kcalMinDay()} kcal a day.`);
    // The person: only what is set, and never the name; a fixed line like the goal
    const person = [s.age > 0 ? `${s.age} years old` : '', s.gender === 'female' || s.gender === 'male' ? s.gender : ''].filter(Boolean);
    if (person.length) lines.push(`Person: ${person.join(', ')}`);
    // 2. All-time aggregates
    lines.push(`All time: meals logged on ${mealDays} days; ${h.onPlan} days on plan; best run ${h.best} days on plan; ${h.perfect} perfect days; `
      + `flex used: ${small} beer or small dessert, ${dinners} flexible dinner; ${off} off-plan entries; ${workouts} workout days.`);
    lines.push(`Day verdicts of ${judged} finished days: ${Object.keys(VERDICT).filter((k) => levels[k]).map((k) => `${VERDICT[k].toLowerCase()} ${levels[k]}`).join(', ') || 'none'}.`);
    if (pr) lines.push(`Trend over the last 14 days: ${f2(pr.perWeek)} kg a week${pr.eta ? `, reaching the target around ${date(pr.eta)}` : ''}.`);
    // 3. The last 8 finished weeks, oldest first
    const weeks = [];
    for (let i = 8; i >= 1; i--) {
      const ws = addDays(weekStart(t), -7 * i);
      if (addDays(ws, 6) < s.startDate) continue;
      weeks.push(ws);
    }
    const weekRow = (ws) => {
      const ds = Array.from({ length: 7 }, (_, i) => addDays(ws, i)).filter((d) => d >= s.startDate); // days before the start are not plan days
      const n = ds.length;
      const logged = ds.filter((d) => mealsOf(d).length);
      const kcal = logged.length ? r(logged.reduce((a, d) => a + dayTotals(d).kcal, 0) / logged.length) : null;
      const budget = logged.length ? r(logged.reduce((a, d) => a + dayTarget(d), 0) / logged.length) : null;
      const train = ds.filter((d) => S.days[d] && S.days[d].train).length;
      const stepsOn = ds.filter((d) => S.days[d] && S.days[d].steps > 0);
      const fx = weekFlex(ws);
      const kgs = ds.filter((d) => S.days[d] && S.days[d].kg);
      let weigh = '';
      if (kgs.length) {
        const avg = kgs.reduce((a, d) => a + S.days[d].kg, 0) / kgs.length;
        weigh = total > 0 ? `; weigh-ins average ${f1(avg)} kg, ${f1(avg - kgs.reduce((a, d) => a + sched(d), 0) / kgs.length)} kg against the schedule` : `; weigh-ins average ${f1(avg)} kg`;
      }
      return `- ${short(ws)} to ${short(addDays(ws, 6))}: ${kcal === null ? 'no meals logged' : `average ${kcal} kcal on ${logged.length} logged days against a budget of ${budget}`}`
        + `${train ? ` (${train} workout, ${n - train} rest days)` : ''}; on plan ${ds.filter((d) => dayStatus(d) === 'on').length}/${n}; protein minimum ${ds.filter((d) => ['target', 'min'].includes(proteinLevel(d))).length}/${n}`
        + `; steps ${stepsOn.length ? r(stepsOn.reduce((a, d) => a + S.days[d].steps, 0) / stepsOn.length) : 'not logged'}; water ok ${ds.filter((d) => S.days[d] && S.days[d].water >= s.water).length}/${n}`
        + `; flex ${fx.small} small, ${fx.meal} dinner; off-plan ${fx.off}${weigh}.`;
    };
    // 4. Every weigh-in since the start
    const weighed = Object.values(S.days).filter((d) => d.kg && d.day >= s.startDate && d.day <= t).sort((a, b) => (a.day < b.day ? -1 : 1));
    const raw = weighed.map((d) => `${d.day} ${f1(d.kg)} avg ${f1(avg7(d.day).kg)} line ${sf(d.day)}`);
    // The first `old` weigh-ins as one average line per week, then the rest raw
    const thin = (old) => {
      const byWeek = new Map();
      for (const d of weighed.slice(0, old)) { const w = weekStart(d.day); byWeek.set(w, [...(byWeek.get(w) || []), d.kg]); }
      return [...[...byWeek].map(([w, v]) => `week of ${date(w)}: avg ${f1(v.reduce((a, b) => a + b, 0) / v.length)} kg, ${v.length} weigh-ins`), ...raw.slice(old)];
    };
    // 5. The current week
    const ws = weekStart(t);
    const fx = weekFlex(t);
    const sofar = Array.from({ length: diffDays(ws, t) + 1 }, (_, i) => addDays(ws, i));
    const cur = `Current week so far: ${sofar.filter((d) => dayStatus(d) === 'on').length} days on plan, flex used ${fx.small} small and ${fx.meal} dinner, ${fx.off} off-plan entries. This week is still in progress.`;
    // 6. Compliance
    const all = [...weeks, ws];
    const per = (pick) => all.map((w) => {
      const v = Array.from({ length: 7 }, (_, i) => pick(S.days[addDays(w, i)])).filter((x) => x > 0);
      return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
    });
    const list = (a, fmt) => a.map((x) => (x === null ? '-' : fmt(x))).join(', ');
    const comp = [`Coffee a week, oldest first, ending with this week: ${all.map((w) => drinkTally(w).week).join(', ')}.`,
      `Average steps on logged days, by week: ${list(per((d) => d && d.steps), r)}.`,
      `Average water on logged days in litres, by week: ${list(per((d) => d && d.water / 1000), f1)}.`];
    const have = (s.supplements || []).length;
    if (have) {
      const whole = days.reduce((a, d) => a + suppTaken(d).length, 0);
      const last = Array.from({ length: 7 }, (_, i) => suppTaken(addDays(t, -i)).length).reduce((a, b) => a + b, 0);
      comp.push(`Supplements: taken ${whole} over the whole plan, ${last} of ${have * 7} in the last week.`);
    }
    // 7. The adjust rule, worked out here and handed over as given
    const a = avg7(t);
    const b = avg7(addDays(t, -7));
    const adjust = total > 0 && h.days > 14 && a && b && a.n >= 3 && b.n >= 3 && a.kg - sched(t) > 0.7 && b.kg - sched(addDays(t, -7)) > 0.7
      ? `Adjustment rule: the 7-day average has been more than 0.7 kg behind the schedule for two weeks, so the app suggests: cut 100 kcal a day or add 2,000 steps, never below the minimum of ${kcalMinDay()} kcal. Pass this on as given; do not work out other numbers.`
      : 'No automatic adjustment is suggested at this time.';
    // 8. The app's rating and pace
    const tail = [`APP RATING ESTIMATE: ${progressRatingHint()}`];
    if (pr) tail.push(rate.kg > 0 && -pr.perWeek > rate.kg * 7
      ? 'Pace: ahead of the schedule — losing faster than the plan\'s rate; hard to hold.'
      : pr.perWeek > 0
        ? 'Pace: the weight has been going up over the last two weeks.'
        : 'Pace: the pace is within the plan\'s rate.');
    // 9. Two things the numbers cannot show
    tail.push('The budgets shown are the ones in force today; the app does not store earlier budgets.',
      'Plan numbers may have changed during the period; a change in the calories marks a change in the plan, not the person — judge adherence change over the weeks.');
    // The weekly rows are built once: the trimming below re-slices and rebuilds the text several times without re-reading the week.
    const weekLines = weeks.map(weekRow);
    const build = (from, strip) => {
      return [...lines, ...(from < weekLines.length ? [`Weeks, oldest first (budgets are today's):`, ...weekLines.slice(from)] : []),
        'Weigh-ins since the start (day, kg, 7-day average, schedule line):', ...(strip.length ? strip : ['none']), cur, ...comp, adjust, ...tail].join('\n');
    };
    let from = 0;
    let out = build(from, raw);
    while (out.length > BRIEF_MAX && from < weeks.length) out = build(++from, raw);
    // Still over: collapse the oldest weigh-ins, keeping as many recent ones raw as fit (at least the latest)
    let old = 0;
    while (out.length > BRIEF_MAX && old < raw.length - 1) out = build(from, thin(++old));
    // Still over: drop the oldest collapsed lines
    let lines2 = thin(old);
    let drop = 0;
    while (out.length > BRIEF_MAX && drop < lines2.length - 1) out = build(from, lines2.slice(++drop));
    return out;
  });
}
