// What the model reads: the day, the coach note and the check, in plain English lines. Text only, a few hundred tokens each.
// Always English, whatever the interface language is (inEnglish), and no DOM, so the tests build them too.
import { inEnglish } from './i18n.js';
import { SLOT_NAME, parseDay, targetAt, hhmm } from './plan.js';
import { S, today, eff, mealsOf, dayTotals, dayTarget, proteinFloor, avg7, weekFlex, openSlots, mainSlots, mealTimesLine, planRate, dayVerdict, VERDICT, verdictText } from './core.js';

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
    const items = e.planId ? '' : (e.items || []).slice(0, 6).map((i) => `${i.n}${i.g ? ` ${r(i.g * m)} g` : ''} ${r((i.kcal || 0) * m)} kcal`).join('; ');
    lines.push(`- ${hhmm(e.ts)} ${(SLOT_NAME[e.slot] || '').toLowerCase()}: ${e.title}, ${r(x.kcal)} kcal, ${r(x.p)} g protein, ${kind}`
      + `${(e.flags || []).includes('alcohol') ? ', alcohol' : ''}${e.place ? `, ${e.place === 'out' ? 'eaten out' : `at ${e.place}`}` : ''}${items ? ` [${items}]` : ''}`);
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
  lines.push(note ? `Note from the person: ${note}` : 'No note from the person.');
  return lines.join('\n');
}
