import {
  S, today, eff, dayTotals, dayTarget, dayStatus, dayReasons, dayNotes, avg7, latestWeight, weightSeries, projection,
  weekStart, weekFlex, weekResult, proteinLevel, streak, suggest, hasKey, APP_VERSION, dayGoals, isPerfect, history, planRate,
  dayVerdict, verdictText, reviewState, coachState, VERDICT, checkReady, BAND, proteinFloor, CHECK_MAX, fmtInt, fmtKg, chartWindow, drinkTally,
  plannedBy, planSteps, budgetVerdict, budgetMeter, suppTaken, titleOf, kcalMinDay,
} from './core.js';
import { MODELS, PRESETS, ZEN_FREE } from './ai.js';
import { BY_ID, GROUP_NAME, FINISH_NAME, PART_NAME, SLOT_TITLE, cachedContext, cellOf, collection, stepRows, unlockSummary, wornAv, avatarChoices } from './badges.js';
import { badgeSvg, avatarSvg } from './badge-art.js';
import { dateFmt, td, t, tn, T, lc, getLang } from './i18n.js';
import { MEALS, SLOTS, SLOT_NAME, FLEX, RULES, LOCALE, processRules, parseDay, addDays, diffDays, targetAt, dayKey, hhmm } from './plan.js';

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const n0 = fmtInt;
const n1 = fmtKg;
// Formatters follow the interface language: each is built on first use and dropped when the language changes
const lazyDate = (opts) => ({ format: (d) => dateFmt(opts).format(d) });
const dLong = lazyDate({ day: 'numeric', month: 'long', weekday: 'long' });
const dShort = lazyDate({ day: 'numeric', month: 'long' });
const dTiny = lazyDate({ day: 'numeric', month: 'short' });
const dFull = lazyDate({ day: 'numeric', month: 'short', year: 'numeric' });
const dWeekday = lazyDate({ weekday: 'long' });
const dMonth = lazyDate({ month: 'short' });
const dMonthYear = lazyDate({ month: 'long', year: 'numeric' });
const dWd = lazyDate({ weekday: 'short', day: 'numeric' });
const lower = (s) => lc(s.charAt(0)) + s.slice(1);
const WEEKDAYS = [T('Mo'), T('Tu'), T('We'), T('Th'), T('Fr'), T('Sa'), T('Su')];

const ICON = {
  settings: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7.5h9M17 7.5h3M4 16.5h3M11 16.5h9"/><circle cx="15" cy="7.5" r="2"/><circle cx="9" cy="16.5" r="2"/></svg>',
  prev: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m14.5 6-6 6 6 6"/></svg>',
  next: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9.5 6 6 6-6 6"/></svg>',
  camera: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 8.5A2.5 2.5 0 0 1 6.5 6h1.2l1-1.6A1.5 1.5 0 0 1 10 3.7h4a1.5 1.5 0 0 1 1.3.7l1 1.6h1.2A2.5 2.5 0 0 1 20 8.5v8A2.5 2.5 0 0 1 17.5 19h-11A2.5 2.5 0 0 1 4 16.5z"/><circle cx="12" cy="12.4" r="3.4"/></svg>',
};
ICON.close = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m7 7 10 10M17 7 7 17"/></svg>';
const CHECK = '<svg class="tick" viewBox="0 0 16 16" aria-hidden="true"><path d="m3.5 8.5 3 3 6-7"/></svg>';
const ALERT = '<svg class="tick" viewBox="0 0 16 16" aria-hidden="true"><path d="M8 3.5v5.5M8 12v.5"/></svg>';
const CLOCK = '<svg class="clock" viewBox="0 0 16 16" aria-hidden="true"><path d="M8 4v4.5l2.5 1.5"/></svg>';
const PLATE = '<svg viewBox="0 0 48 48" aria-hidden="true"><circle cx="24" cy="24" r="17"/><circle cx="24" cy="24" r="10.5"/></svg>';
const partName = (p) => td(PART_NAME[p]);
const avatarLabel = (av) => [t('Your pickle'), partName(av.stage), partName(av.face), partName(av.acc)].join(', ');
const avatarButton = () => { const av = wornAv(S.badges); return `<button type="button" class="icon-btn av-btn" id="btn-avatar" data-act="avatar" aria-label="${avatarLabel(av)}"><span aria-hidden="true">${avatarSvg(av, { size: 34, label: avatarLabel(av) })}</span></button>`; };
const settingsButton = () => `<button type="button" class="icon-btn" data-act="settings" aria-label="${t('Settings')}">${ICON.settings}</button>`;

// Where the weight stands against the schedule, in plain words
function progressSummary() {
  const s = S.settings;
  const tod = today();
  const a = latestWeight(tod);
  const target = targetAt(tod, s);
  const left = diffDays(tod, s.targetDate);
  const toStart = diffDays(tod, s.startDate);
  const started = toStart <= 0;
  const pace = planRate().kg * 7;
  const endDate = dShort.format(parseDay(s.targetDate));
  const toLose = `${n1(Math.max(0, (a ? a.kg : s.startKg) - s.targetKg))} kg`;
  const plan = t('{toLose} to lose by {date}, about {pace} kg a week.', { toLose, date: dTiny.format(parseDay(s.targetDate)), pace: n1(pace) });
  let head; // the status, a few words
  let line; // the numbers behind it, one sentence
  let tag; // the status in two or three words, for the weight tile
  if (!started) {
    head = toStart === 1 ? t('Starts tomorrow') : toStart <= 7 ? t('Starts {day}', { day: dWeekday.format(parseDay(s.startDate)) }) : t('Starts {date}', { date: dShort.format(parseDay(s.startDate)) });
    line = plan;
    tag = head;
  } else if (!a) {
    head = t('No weigh-in yet');
    line = plan;
    tag = t('{toLose} to lose', { toLose });
  } else {
    const diff = a.kg - target;
    const change = s.startKg - a.kg;
    const moved = t('{kg} kg {dir}', { kg: n1(Math.abs(change)), dir: change < -0.05 ? t('up') : t('down') });
    if (a.kg <= s.targetKg) {
      head = t('You reached {kg} kg', { kg: s.targetKg });
      line = t('{moved} since {date}.', { moved, date: dShort.format(parseDay(s.startDate)) });
      tag = t('Goal reached');
    } else {
      if (left <= 0) head = t('{kg} kg from the goal', { kg: n1(a.kg - s.targetKg) });
      else if (Math.abs(diff) <= 0.2) head = t('On schedule');
      else if (diff < 0) head = t('{kg} kg ahead of schedule', { kg: n1(-diff) });
      else head = t('{kg} kg behind schedule', { kg: n1(diff) });
      line = left > 0 ? t('{moved}, {toLose} to go, {days} left.', { moved, toLose, days: tn('{n} day|{n} days', left) }) : t('{moved}, {toLose} to go.', { moved, toLose });
      tag = left <= 0 ? t('{toLose} to go', { toLose }) : Math.abs(diff) <= 0.2 ? t('On schedule') : diff < 0 ? t('{kg} kg ahead', { kg: n1(Math.abs(diff)) }) : t('{kg} kg behind', { kg: n1(Math.abs(diff)) });
    }
  }
  return { head, line, tag, a, target, started };
}

const kgLabel = (kg) => (Number.isInteger(kg) ? String(kg) : n1(kg));
// The kilos between the start weight and the target: one per whole kilo down, then the target itself
function kiloMarks() {
  const s = S.settings;
  const span = s.startKg - s.targetKg;
  const marks = [];
  for (let k = 1; k <= span + 1e-6; k++) marks.push(Math.round((s.startKg - k) * 10) / 10);
  if (span > 0 && (!marks.length || marks[marks.length - 1] - s.targetKg > 1e-6)) marks.push(s.targetKg);
  return marks;
}

// The beam, on Progress: a graduated scale from the start weight to the target. The teal part is the
// distance covered, the brass block is you (your latest weigh-in), the small mark is where your line is today.
function beam(a, target, started) {
  const s = S.settings;
  const span = s.startKg - s.targetKg;
  if (!(span > 0)) return '';
  const pct = (kg) => (Math.min(100, Math.max(0, ((s.startKg - kg) / span) * 100))).toFixed(2);
  const marks = [s.startKg, ...kiloMarks()];
  // Before the plan starts nothing is counted yet: the brass weight waits at the start
  const lost = a && started ? s.startKg - a.kg : 0;
  const you = pct(s.startKg - lost);
  const bar = `<span class="beam" aria-hidden="true"><span class="beam-bar"><i style="width:${you}%"></i></span>`
    + `<span class="beam-ticks">${marks.map((kg) => `<b style="left:${pct(kg)}%"></b>`).join('')}</span>`
    + `${started ? `<u style="left:${pct(target)}%"></u>` : ''}${a ? `<em style="left:${you}%"></em>` : ''}</span>`;
  const next = marks.find((kg, i) => i > 0 && s.startKg - kg > lost + 1e-6);
  // The start and the target are always labelled; the kilos in between at the smallest regular step (every kilo,
  // every second, …) whose labels clear each other on the narrowest phone (about 250 px of beam, 7 px a character)
  const ext = (kg, i) => {
    const x = (pct(kg) / 100) * 250;
    const w = kgLabel(kg).length * 7;
    return i === 0 ? [x, x + w] : i === marks.length - 1 ? [x - w, x] : [x - w / 2, x + w / 2];
  };
  const last = marks.length - 1;
  const begin = ext(marks[0], 0)[1] + 4;
  const stop = ext(marks[last], last)[0] - 4;
  const pick = (step) => marks.map((kg, i) => i === 0 || i === last || (i % step === 0 && ext(kg, i)[0] >= begin && ext(kg, i)[1] <= stop));
  const fits = (keep) => {
    let edge = -Infinity;
    for (let i = 0; i < marks.length; i++) {
      if (!keep[i]) continue;
      const [l, r] = ext(marks[i], i);
      if (l < edge) return false;
      edge = r + 4;
    }
    return true;
  };
  const shown = [1, 2, 5, 10].map(pick).find(fits) || pick(Infinity);
  const labels = marks.map((kg, i) => (!shown[i] ? ''
    : `<span class="${i && s.startKg - kg <= lost + 1e-6 ? 'is-got' : kg === next ? 'is-next' : i === last ? 'is-goal' : ''}" style="left:${pct(kg)}%">${esc(kgLabel(kg))}</span>`)).join('');
  return `${bar}<span class="beam-labels" aria-hidden="true">${labels}</span>`;
}

const STATUS_LABEL = { on: T('on plan'), open: T('in progress'), over: T('over the budget'), far: T('well over the budget'), under: T('under the minimum'), none: T('nothing logged'), future: T('still to come'), before: T('before the plan started') };

// ——— Week strip: the seven days of the week as tokens. The colour is how the day went; tap one to open it. ———
function weekStrip(day) {
  const tod = today();
  const ws = weekStart(day);
  const tokens = WEEKDAYS.map((letter, i) => {
    const d = addDays(ws, i);
    // Days before the plan started only count if something was logged on them
    const raw = d > tod ? 'future' : dayStatus(d);
    const st = raw === 'none' && d < S.settings.startDate ? 'before' : raw;
    const perfect = d <= tod && isPerfect(d);
    const cls = `day day-${st}${perfect ? ' is-perfect' : ''}${d === tod ? ' is-today' : ''}${d === day ? ' is-selected' : ''}`;
    const label = perfect ? t('{date}: all goals done', { date: dLong.format(parseDay(d)) }) : t('{date}: {status}', { date: dLong.format(parseDay(d)), status: td(STATUS_LABEL[st]) });
    return `<li><button type="button" class="${cls}" data-act="goto-day" data-day="${d}" aria-label="${esc(label)}"${d === day ? ' aria-current="date"' : ''}${d > tod ? ' disabled' : ''}><span>${td(letter)}</span><b>${parseDay(d).getDate()}</b></button></li>`;
  }).join('');
  const goals = dayGoals(day);
  const done = goals.filter((g) => g.done).length;
  const run = streak();
  const left = run > 0 ? `<span>${t('<b>{days}</b> on plan in a row', { days: tn('{n} day|{n} days', run) })}</span>` : `<span>${t('A day on plan starts a new run')}</span>`;
  const count = done === goals.length ? t('All five goals') : day === tod ? t('{done} of {total} goals so far', { done, total: goals.length }) : t('{done} of {total} goals', { done, total: goals.length });
  return `<nav class="week" aria-label="${t('Days of the week')}">
    <button type="button" class="week-nav" data-act="week-prev" aria-label="${t('Previous week')}">${ICON.prev}</button>
    <ol>${tokens}</ol>
    <button type="button" class="week-nav" data-act="week-next" aria-label="${t('Next week')}"${addDays(ws, 7) > tod ? ' disabled' : ''}>${ICON.next}</button>
  </nav>
  <p class="week-note">${left}<span class="goal-count${done === goals.length ? ' is-done' : ''}" title="${esc(goals.map((g) => t('{goal}: {state}', { goal: g.name, state: g.done ? t('done') : t('open') })).join(', '))}">${count}</span></p>`;
}

// ——— The day's calories as one budget: what is left, how far the day has got, and where the plan would have it by now ———
function budgetTile(day) {
  const isToday = day === today();
  const target = dayTarget(day);
  const eaten = Math.round(dayTotals(day).kcal);
  const rem = target - eaten;
  const now = new Date();
  const planned = isToday ? plannedBy(target, now.getHours() + now.getMinutes() / 60) : null;
  const v = budgetVerdict({ target, eaten, planned });
  const m = budgetMeter({ target, eaten, planned });
  const pct = (x) => `${(x * 100).toFixed(1)}%`;
  const due = planned != null && planned >= target - 1;
  const ref = planned == null ? '' : due ? t('All planned meals are due') : planned > 0 ? t('Plan by now <b>{kcal}</b>', { kcal: n0(planned) }) : planSteps(target)[0] ? t('Plan starts at {time}', { time: planSteps(target)[0].time }) : '';
  const big = !isToday ? [n0(eaten), t('kcal eaten of {target}', { target: n0(target) })] : rem >= 0 ? [n0(rem), t('kcal left of {target}', { target: n0(target) })] : [n0(-rem), t('kcal above budget')];
  const sums = { eaten: n0(eaten), target: n0(target) };
  const label = (!isToday ? t('Calorie budget: {eaten} of {target} kcal eaten.', sums) : rem >= 0 ? t('Calorie budget: {eaten} of {target} kcal eaten, {n} left.', { ...sums, n: n0(rem) }) : t('Calorie budget: {eaten} of {target} kcal eaten, {n} above.', { ...sums, n: n0(-rem) }))
    + `${planned > 0 && !due ? ` ${t('The plan has {n} by now.', { n: n0(planned) })}` : ''}${planned === 0 && ref ? ` ${ref}.` : ''}${v.text ? ` ${v.text}.` : ''}`;
  const icon = v.tone === 'good' ? CHECK : v.tone === 'calm' ? '' : ALERT;
  return `<div class="tile tile-budget${v.level ? ` is-${v.level === 'back' ? 'way-over' : 'over'}` : ''}" role="group" aria-label="${esc(label)}">
    <span class="tile-top"><span>${t('Calorie budget')}</span>${v.text ? `<i class="pill${v.tone === 'calm' ? '' : ` pill-${v.tone}`}">${icon}${esc(v.text)}</i>` : ''}</span>
    <p class="budget-big"><b>${big[0]}</b><span>${big[1]}</span></p>
    <span class="meter" style="--eat:${pct(m.eat)};--cap:${pct(m.cap)}${m.plan == null ? '' : `;--plan:${pct(m.plan)}`}" aria-hidden="true"><i class="meter-fill"></i>${eaten > target ? '<i class="meter-spill"></i>' : ''}${m.plan == null ? '' : '<i class="meter-plan"></i>'}</span>
    <p class="budget-key"><span><i class="key-eat"></i>${t('<b>{kcal}</b> eaten', { kcal: n0(eaten) })}</span>${ref ? `<span>${m.plan == null ? '' : '<i class="key-plan"></i>'}${ref}</span>` : ''}</p>
  </div>`;
}

// ——— The day at a glance: the calorie budget with weight and protein beside it. Steps and water, which fill up
// over the day, come after the meals in one row with coffee (counted, no goal). ———
function bento(day, part) {
  const s = S.settings;
  const isToday = day === today();
  const dd = S.days[day] || {};
  const tot = dayTotals(day);
  const top = (name, done, hint = '') => `<span class="tile-top"><span>${name}</span>${done ? CHECK : ''}${hint ? `<em>${hint}</em>` : ''}</span>`;
  const note = (text) => `<span class="tile-note">${esc(text)}</span>`;

  let weight;
  if (isToday) {
    const p = progressSummary();
    const value = dd.kg ? n1(dd.kg) : p.a ? n1(p.a.kg) : '–';
    // Today's weigh-in, then the 7-day average beside where you stand: "avg 85.2 · on schedule"
    const avg = avg7(day);
    const status = dd.kg && avg && p.started ? t('avg {kg} · {status}', { kg: n1(avg.kg), status: lower(p.tag) }) : p.tag;
    const action = dd.kg ? t('Today’s weigh-in {kg} kg. Change', { kg: n1(dd.kg) }) : t('Enter today’s weigh-in');
    weight = `<button type="button" class="tile${dd.kg ? ' is-done' : ''}" data-act="num" data-kind="kg" aria-label="${esc(t('Weight. {head}. {line} {action}', { head: p.head, line: p.line, action }))}">
      ${top(t('Weight'), !!dd.kg, dd.kg ? '' : t('tap to weigh in'))}
      <span class="tile-val"><b>${value}</b>${value === '–' ? '' : ' kg'}</span>
      ${note(status)}
    </button>`;
  } else {
    weight = `<button type="button" class="tile${dd.kg ? ' is-done' : ''}" data-act="num" data-kind="kg" aria-label="${dd.kg ? t('Weigh-in on this day: {kg} kg. Change', { kg: n1(dd.kg) }) : t('Weigh-in on this day: none. Add')}">
      ${top(t('Weight'), !!dd.kg, dd.kg ? '' : t('tap to add'))}
      <span class="tile-val"><b>${dd.kg ? n1(dd.kg) : '–'}</b>${dd.kg ? ' kg' : ''}</span>
    </button>`;
  }

  const pDone = tot.p >= proteinFloor();
  const steps = dd.steps || 0;
  const stepsDone = steps >= s.steps;
  const water = dd.water || 0;
  const waterDone = water >= s.water;
  const litres = (ml) => (ml / 1000).toLocaleString(LOCALE, { maximumFractionDigits: 2 });
  const glasses = Math.max(1, Math.min(12, Math.round(s.water / 250)));
  const full = Math.min(glasses, Math.floor(water / 250));
  const pct = (v, of) => Math.min(100, (v / of) * 100).toFixed(1);
  const pLeft = Math.max(1, Math.ceil(s.protein - tot.p - 1e-6)); // only shown while the goal is open
  const glassesLeft = Math.max(0, Math.ceil((s.water - water) / 250));
  // Coffee: the day's count and the week's, never a goal, so never ticked
  const thisWeek = weekStart(day) === weekStart(today());
  const cups = drinkTally(day);
  const cupUnit = tn('cup|cups', cups.today);
  const cupsToday = tn('{n} cup|{n} cups', cups.today);
  const coffeeLabel = isToday ? t('Coffee: {cups} today, {n} this week. Add one', { cups: cupsToday, n: cups.week })
    : thisWeek ? t('Coffee: {cups} on this day, {n} this week. Add one', { cups: cupsToday, n: cups.week })
      : t('Coffee: {cups} on this day, {n} that week. Add one', { cups: cupsToday, n: cups.week });
  if (part === 'top') return `<section class="bento" aria-label="${t('The day at a glance')}">
    ${budgetTile(day)}
    ${weight}
    <div class="tile${pDone ? ' is-done' : ''}" role="group" aria-label="${t('Protein: {p} of {goal} g', { p: n0(tot.p), goal: n0(s.protein) })}">
      ${top(t('Protein'), pDone)}
      <span class="tile-val"><b>${n0(tot.p)}</b> / ${n0(s.protein)} g</span>
      <span class="bar" style="--v:${pct(tot.p, s.protein)}%"><i></i></span>
      ${note(pDone ? t('Enough for today') : t('{n} g to go', { n: n0(pLeft) }))}
    </div>
  </section>`;
  return `<section class="bento bento-more" aria-label="${t('Steps, water and coffee')}">
    <button type="button" class="tile${stepsDone ? ' is-done' : ''}" data-act="num" data-kind="steps" aria-label="${steps ? t('Steps: {n} of {goal}. Enter', { n: n0(steps), goal: n0(s.steps) }) : t('Steps: none of {goal}. Enter', { goal: n0(s.steps) })}">
      ${top(t('Steps'), stepsDone)}
      <span class="tile-val"><b>${steps ? n0(steps) : '–'}</b> / ${n0(s.steps)}</span>
      <span class="bar" style="--v:${pct(steps, s.steps)}%"><i></i></span>
      ${note(stepsDone ? t('Goal reached') : t('{n} to go', { n: n0(s.steps - steps) }))}
    </button>
    <div class="tile tile-water${waterDone ? ' is-done' : ''}">
      <button type="button" class="tile-main" data-act="water" data-v="250" aria-label="${t('Water: {n} of {goal} litres. Add a glass', { n: litres(water), goal: litres(s.water) })}">
        ${top(t('Water'), waterDone)}
        <span class="tile-val"><b>${litres(water)}</b> / ${litres(s.water)} l</span>
        <span class="glasses" aria-hidden="true">${Array.from({ length: glasses }, (_, i) => `<i class="${i < full ? 'on' : ''}"></i>`).join('')}</span>
        ${note(waterDone ? t('Goal reached') : tn('{n} glass to go|{n} glasses to go', glassesLeft))}
      </button>
      <button type="button" class="tile-minus" data-act="water" data-v="-250" aria-label="${t('Remove a glass of water')}"${water ? '' : ' disabled'}>−</button>
    </div>
    <div class="tile tile-count">
      <button type="button" class="tile-main" data-act="coffee" data-v="1" aria-label="${esc(coffeeLabel)}">
        ${top(t('Coffee'), false)}
        <span class="tile-val"><b>${cups.today}</b> ${cupUnit}</span>
        ${note(thisWeek ? (cups.prev ? t('{n} this week, {prev} last week', { n: cups.week, prev: cups.prev }) : t('{n} this week', { n: cups.week })) : t('{n} that week', { n: cups.week }))}
      </button>
      <button type="button" class="tile-minus" data-act="coffee" data-v="-1" aria-label="${t('Remove one coffee')}"${cups.today ? '' : ' disabled'}>−</button>
    </div>
  </section>`;
}

function entryState(e) {
  return S.busy.has(e.id) ? (S.retry.get(e.id) || t('Analysing')) : e.status === 'error' ? t('Analysis failed') : t('Waiting for analysis');
}
const multLabel = (m) => ({ 0.5: '½', 1.5: '1½', 2: '2' }[m] || String(m));

const chip = (m, act = 'log-plan') => `<button type="button" class="chip" data-act="${act}" data-id="${m.id}">${esc(td(m.name))} <span>${m.kcal}</span></button>`;

// Which slots a day shows, and what the plan offers in each
function daySlots(day) {
  const dd = S.days[day] || {};
  const all = S.entries.filter((e) => e.day === day && e.kind === 'meal');
  const has = (id) => all.some((e) => e.slot === id);
  const isToday = day === today();
  const list = [];
  if (has('morning')) list.push({ id: 'morning', name: td(SLOT_NAME.morning), time: '' });
  SLOTS.filter((x) => x.id !== 'late').forEach((x) => list.push({ id: x.id, name: td(x.name), time: x.time }));
  if (dd.train || has('workout')) list.push({ id: 'workout', name: t('Workout extras'), time: '', hint: t('Banana before, skyr after') });
  // The late slot only shows once it matters: in the evening, when something is in it, or when skyr would close a protein gap
  const sg = suggest(day);
  if (has('late') || (isToday && (new Date().getHours() >= 19 || sg.extra))) list.push({ id: 'late', name: lateName(), time: SLOTS.find((x) => x.id === 'late').time, hint: t('Herbal tea; skyr if very hungry') });
  return { list, all, sg, isToday };
}
const lateName = () => t('After {time}', { time: SLOTS.find((x) => x.id === 'late').time });
const slotOptions = (id, entries) => {
  const logged = new Set(entries.map((e) => e.planId));
  return MEALS.filter((x) => x.slot === id && !(id === 'workout' && logged.has(x.id)));
};

// The day's meals as one short list: what is logged, what is next (with a one-tap suggestion), what is still open.
// Tapping an open meal brings up its options in a sheet.
function dayList(day) {
  const dd = S.days[day] || {};
  const { list, all, sg, isToday } = daySlots(day);
  const over = sg.rem < -50;
  const nextId = isToday && !over && sg.meal && sg.slot ? sg.slot.id : '';
  const now = new Date();
  const minutesNow = now.getHours() * 60 + now.getMinutes();
  const rows = [];
  let done = 0;
  const main = SLOTS.filter((x) => x.id !== 'late').length;
  for (const sl of list) {
    const entries = all.filter((e) => e.slot === sl.id).sort((x, y) => x.ts - y.ts);
    if (entries.some((e) => e.status === 'ok') && SLOTS.some((x) => x.id === sl.id && x.id !== 'late')) done += 1;
    for (const e of entries) {
      const ok = e.status === 'ok';
      const v = eff(e);
      rows.push(`<li class="meal ${ok ? 'is-done' : 'is-pending'}"><button type="button" class="meal-main" data-act="open-entry" data-id="${esc(e.id)}">
        <i class="meal-mark" aria-hidden="true">${ok ? CHECK : ''}</i>
        <span class="meal-text"><b><span class="sr-only">${ok ? t('Done:') : t('Waiting:')} </span>${sl.name}<small>${hhmm(e.ts)}</small></b><span>${esc(titleOf(e))}${ok && e.mult && e.mult !== 1 ? ` ×${multLabel(e.mult)}` : ''}</span></span>
        <span class="meal-kcal">${ok ? `<b>${n0(v.kcal)}</b><span class="sr-only"> kcal</span>` : esc(entryState(e))}</span>
      </button></li>`);
    }
    const options = slotOptions(sl.id, entries);
    const isNext = sl.id === nextId && (!entries.length || !!sg.extra);
    if (isNext) {
      const [h, m] = (sl.time || '0:0').split(':').map(Number);
      const late = !sg.extra && sl.time && minutesNow > h * 60 + m + 120;
      rows.push(`<li class="meal is-next"><button type="button" class="meal-main" data-act="slot" data-slot="${sl.id}" aria-label="${esc(t('{slot}: other options', { slot: sl.name }))}">
        <i class="meal-mark" aria-hidden="true">${CLOCK}</i>
        <span class="meal-text"><b><span class="sr-only">${t('Next:')} </span>${sl.name}<small>${late ? t('not logged yet') : sl.time}</small></b><span>${esc(!sg.extra && sg.tight ? t('{meal}, {kcal} kcal, the lightest option', { meal: td(sg.meal.name), kcal: sg.meal.kcal }) : t('{meal}, {kcal} kcal', { meal: td(sg.meal.name), kcal: sg.meal.kcal }))}</span></span>
      </button><button type="button" class="btn btn-primary meal-log" data-act="log-plan" data-id="${sg.meal.id}" aria-label="${esc(t('Log {meal}', { meal: td(sg.meal.name) }))}">${t('Log', { $id: 'meal.log' })}</button></li>`);
    } else if ((!entries.length || sl.id === 'workout') && options.length) {
      rows.push(`<li class="meal"><button type="button" class="meal-main" data-act="slot" data-slot="${sl.id}" aria-label="${esc(t('{slot}: choose a meal', { slot: sl.name }))}">
        <i class="meal-mark" aria-hidden="true"></i>
        <span class="meal-text"><b>${sl.name}<small>${sl.time}</small></b>${sl.hint ? `<span>${sl.hint}</span>` : ''}</span>
        <span class="meal-add" aria-hidden="true">+</span>
      </button></li>`);
    }
  }
  return `<section class="meals">
    <div class="meals-head"><h2>${isToday ? t('Today’s meals') : t('Meals')}<small>${t('{n} of {total}', { n: done, total: main })}</small></h2>
      <button type="button" class="toggle" role="switch" aria-checked="${dd.train ? 'true' : 'false'}" data-act="train" data-v="${dd.train ? 0 : 1}" aria-label="${t('Workout day: budget {kcal} kcal, banana and skyr added', { kcal: n0(S.settings.kcalTrain) })}"><i aria-hidden="true"></i>${t('Workout day')}</button>
    </div>
    <ul class="meal-list">${rows.join('')}</ul></section>`;
}

// The options for one meal, in a bottom sheet
export function renderSlotSheet(slotId, day) {
  const { list, all, sg, isToday } = daySlots(day);
  const sl = list.find((x) => x.id === slotId) || { id: slotId, name: SLOT_NAME[slotId] ? td(SLOT_NAME[slotId]) : t('Meal'), time: '' };
  const options = slotOptions(slotId, all.filter((e) => e.slot === slotId));
  const suggested = sg.meal && sg.slot && sg.slot.id === slotId ? sg.meal.id : '';
  const ordered = options.slice().sort((a, b) => (a.id === suggested ? -1 : b.id === suggested ? 1 : 0));
  const pics = S.settings.planPhotos || {};
  const anyPic = options.some((m) => pics[m.id]); // thumbnails only when there is at least one to show
  const thumb = (m) => (!anyPic ? '' : pics[m.id] ? `<span class="meal-thumb"><img data-photo="${esc(pics[m.id])}" alt=""></span>` : `<span class="meal-thumb is-empty">${PLATE}</span>`);
  return `
  <header class="sheet-top"><h2 id="sheet-title">${sl.name}</h2><button type="button" class="btn" data-act="close-sheet">${t('Close')}</button></header>
  <p class="note">${sl.hint ? sl.hint + '. ' : ''}${isToday ? t('Tap what you are having.') : t('Tap what you had.')}</p>
  <ul class="meal-list option-list">${ordered.map((m) => `<li class="meal"><button type="button" class="meal-main" data-act="log-plan" data-id="${m.id}">
      ${thumb(m)}
      <span class="meal-text"><b>${esc(td(m.name))}${m.id === suggested ? `<small>${t('suggested')}</small>` : ''}</b><span>${t('{n} g protein', { n: n0(m.p) })}</span></span>
      <span class="meal-kcal"><b>${m.kcal}</b> kcal</span>
    </button></li>`).join('')}</ul>
  ${isToday ? `<p class="note">${t('Something that is not on the plan:')}</p>
  <div class="actions"><button type="button" class="btn" data-act="slot-camera">${t('Take a photo')}</button><button type="button" class="btn" data-act="compose">${t('Type it')}</button></div>` : ''}`;
}

// The daily supplements: one chip each, tap to tick; the ones not yet taken stay outlined
function suppCard(day) {
  const list = S.settings.supplements || [];
  if (!list.length) return '';
  const taken = new Set(suppTaken(day));
  const n = list.filter((x) => taken.has(x.id)).length;
  return `<section class="supp" aria-label="${t('Supplements')}">
    <div class="supp-head"><h2>${t('Supplements')}</h2><span class="${n === list.length ? 'is-done' : ''}">${t('{n} of {total}', { n, total: list.length })}</span></div>
    <div class="chips">${list.map((x) => `<button type="button" class="chip${taken.has(x.id) ? ' is-on' : ''}" data-act="supp" data-id="${esc(x.id)}" aria-pressed="${taken.has(x.id)}">${taken.has(x.id) ? CHECK : ''}<b>${esc(x.name)}</b>${x.dose ? `<span>${esc(x.dose)}</span>` : ''}</button>`).join('')}</div>
  </section>`;
}

// The week's extras: one small one and one flexible dinner. A weight is whole until it is used.
function treats(day) {
  const f = weekFlex(day);
  const row = (name, used, max) => {
    const state = used > max ? 'is-over' : used >= max ? 'is-used' : '';
    const text = used > max ? t('{n} over', { n: used - max }) : used >= max ? t('Used') : t('{n} left', { n: max - used });
    return `<li class="${state}"><i class="coin" aria-hidden="true"></i><span>${name}</span><b>${text}</b></li>`;
  };
  return `<section class="treats">
    <h2>${t('This week’s extras')}</h2>
    <ul>
      ${row(t('Beer or small dessert'), f.small, 1)}
      ${row(t('Flexible dinner'), f.meal, 1)}
      ${f.off ? `<li class="is-over"><i class="coin" aria-hidden="true"></i><span>${t('Off-plan entries')}</span><b>${f.off}</b></li>` : ''}
    </ul>
    ${day === today() ? `<div class="chips">${FLEX.map((x) => chip(x, 'log-flex')).join('')}</div>` : ''}
  </section>`;
}

// The coach line: one sentence on where today stands and one thing to do next. Calm on a bad day, never
// shaming, never suggesting to eat less than the plan.
const POISE = '<svg class="coach-mark" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 8h18M7 8v2M12 8v3M17 8v2"/><rect x="13" y="11.5" width="6" height="9" rx="1"/></svg>';
function coachLine(day) {
  const s = S.settings;
  if (day < s.startDate) return '';
  const sg = suggest(day);
  const tot = dayTotals(day);
  const target = dayTarget(day);
  const rem = target - tot.kcal;
  let head;
  let line = '';
  let over = false;
  if (rem < -target * (BAND.near - 1)) {
    over = true;
    head = t('A bigger day today.');
    line = t('One day doesn’t change the trend; the weekly average is what counts. Tomorrow is a normal plan day, and there is no need to skip a meal to make up for it.');
  } else if (rem < 0) {
    over = true;
    head = t('A little above today.');
    line = t('That’s fine. Carry on with the plan as usual tomorrow.');
  } else if (!tot.n) {
    head = t('A fresh day.');
    if (sg.meal && sg.slot) line = t('First up: {meal} at {time}.', { meal: td(sg.meal.name), time: sg.slot.time });
  } else if (sg.extra) {
    head = t('Meals done.');
    line = t('Protein is {n} g short; 150 g of plain skyr closes the gap and fits the budget.', { n: n0(sg.remP) });
  } else if (sg.meal && sg.slot) {
    head = t('You’re on track.');
    const meal = td(sg.meal.name);
    const helps = sg.remP > 12 && sg.meal.p >= 15;
    line = sg.slot.time ? (helps ? t('Next: {meal} at {time}, which also helps with protein.', { meal, time: sg.slot.time }) : t('Next: {meal} at {time}.', { meal, time: sg.slot.time }))
      : (helps ? t('Next: {meal}, which also helps with protein.', { meal }) : t('Next: {meal}.', { meal }));
  } else if (sg.remP > 12) {
    head = t('Meals done.');
    line = t('Protein is {n} g short.', { n: n0(sg.remP) });
  } else {
    head = t('All meals in, on budget.');
    line = t('Nicely done.');
  }
  return `<section class="coach${over ? ' is-over' : ''}">${POISE}<div><p class="coach-line"><b>${esc(head)}</b> ${esc(line)}</p>${coachAi(day)}</div></section>`;
}

// The model's quick note on the day so far, under the coach line: asked for, never sent by itself
function coachAi(day) {
  if (day !== today() || !dayTotals(day).n) return '';
  const c = S.days[day] && S.days[day].coach;
  if (!c && !hasKey()) return '';
  const err = S.coachErr.get(day);
  const busy = S.coaching.has(day);
  const ask = (label) => `<button type="button" class="link" data-act="coach-day" data-day="${day}">${label}</button>`;
  const fresh = coachState(day) === 'fresh';
  const open = busy || !!err || S.reviewOpen.get(`coach:${day}`) === true;
  return `<details class="coach-ai" data-day="${day}"${open ? ' open' : ''}>
    <summary><span class="sr-only">${t('AI note')}</span></summary>
    ${busy ? `<p class="review-wait" role="status"><span class="spin" aria-hidden="true"></span>${t('Writing a note…')}</p>` : `${c ? `<p>${esc(c.note)}</p>` : ''}
    ${hasKey() ? `<p class="review-foot">${c && fresh ? t('AI note, {time}.', { time: hhmm(c.ts) }) : ''} ${ask(!c ? t('How am I doing so far?') : fresh ? t('Ask again') : t('Update the note'))}</p>` : ''}
    ${err ? `<p class="note is-error" role="alert">${esc(err)}</p>` : ''}`}
  </details>`;
}

// First use: shows the single next step; disappears when finished or hidden
function startStep() {
  if (S.settings.hideStart) return 0;
  if (!Object.values(S.days).some((d) => d.kg)) return 1;
  if (!S.entries.some((e) => e.kind === 'meal' && e.status === 'ok')) return 2;
  if (!hasKey()) return 3;
  const standalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
  return standalone ? 0 : 4;
}
function startCard() {
  const n = startStep();
  if (!n) return '';
  const step = {
    1: [t('Enter your first weigh-in'), t('Tap the Weight tile below. Progress and forecasts are calculated from your weigh-ins.'), ''],
    2: [t('Log your first meal'), t('Tap “Log” next to the suggested meal under Today’s meals. No key needed.'), ''],
    3: [t('Add a key for photo analysis'), t('Gemini’s free tier is enough. Plan meals work without a key.'), `<button type="button" class="btn btn-primary" data-act="settings" data-sec="analysis">${t('Add key')}</button>`],
    4: [t('Add to Home Screen'), t('Use “Add to Home Screen” in the browser’s Share menu. Data is kept more reliably that way.'), ''],
  }[n];
  return `<section class="start" aria-labelledby="start-title">
    <p class="start-brand"><b>Pickle</b> · ${t('Good things take time')}</p>
    <div class="start-head"><p>${t('Getting started, step {n} of 4', { n })}</p><button type="button" class="link" data-act="hide-start">${n === 4 ? t('Done') : t('Hide')}</button></div>
    <h2 id="start-title">${step[0]}</h2>
    <p class="start-note">${step[1]}</p>
    ${step[2]}
  </section>`;
}

export function renderToday() {
  const day = S.viewDay;
  const isToday = day === today();
  return `
  <header class="top">
    <div>
      <h1>${isToday ? t('Today') : esc(dWeekday.format(parseDay(day)))}</h1>
      <p class="sub">${isToday ? (day >= S.settings.startDate ? t('{date} · day {n}', { date: esc(dLong.format(parseDay(day))), n: diffDays(S.settings.startDate, day) + 1 }) : esc(dLong.format(parseDay(day)))) : `${esc(dShort.format(parseDay(day)))}. <button type="button" class="link link-inline" data-act="day-today">${t('Back to today')}</button>`}</p>
    </div>
    <div class="top-actions">${avatarButton()}${settingsButton()}</div>
  </header>
  ${isToday ? startCard() + coachLine(day) : ''}
  ${weekStrip(day)}
  ${bento(day, 'top')}
  ${dayList(day)}
  ${bento(day, 'more')}
  ${suppCard(day)}
  ${treats(day)}`;
}

// ——— Bottom sheets ———
export function renderNumSheet(kind, day) {
  const dd = S.days[day] || {};
  const isKg = kind === 'kg';
  const cur = isKg ? dd.kg : dd.steps;
  const isToday = day === today();
  const title = isKg
    ? (isToday ? t('Today’s weigh-in') : t('Weigh-in for {date}', { date: esc(dShort.format(parseDay(day))) }))
    : (isToday ? t('Today’s steps') : t('Steps for {date}', { date: esc(dShort.format(parseDay(day))) }));
  return `
  <header class="sheet-top"><h2 id="sheet-title">${title}</h2><button type="button" class="btn" data-act="close-sheet">${t('Cancel')}</button></header>
  <form id="num-form" class="num" data-kind="${kind}" data-day="${day}" autocomplete="off">
    <label for="num-in" class="note">${isKg ? t('Weigh in the morning under the same conditions. A single day fluctuates; the maths uses the 7-day average.') : t('Your daily step count from the phone’s Health app. Goal {goal}.', { goal: n0(S.settings.steps) })}</label>
    <div class="num-row"><input id="num-in" type="text" inputmode="${isKg ? 'decimal' : 'numeric'}" value="${cur ? esc(isKg ? n1(cur) : String(cur)) : ''}" placeholder="${isKg ? n1(S.settings.startKg) : '8000'}" enterkeyhint="done"><span>${isKg ? 'kg' : t('steps')}</span></div>
    <p class="note is-error" id="num-err" role="alert" hidden></p>
    <button type="submit" class="btn btn-primary btn-wide">${t('Save')}</button>
    ${cur ? `<button type="button" class="link link-danger" data-act="num-clear" data-kind="${kind}" data-day="${day}">${isKg ? t('Remove weigh-in') : t('Remove steps')}</button>` : ''}
  </form>`;
}

const TIME_SOURCE = { exif: T('from photo'), file: T('from file'), manual: T('edited') };
const placeText = (place) => (place === 'out' ? t('out') : t('at {place}', { place: lower(String(place)) }));

// Full entry, shown in the bottom sheet: photos, numbers, corrections
function entryDetail(e) {
  const when = `${hhmm(e.ts)}${TIME_SOURCE[e.timeSrc] ? ` (${td(TIME_SOURCE[e.timeSrc])})` : ''}`;
  if (e.kind === 'weight' || e.kind === 'steps') {
    return `<article class="entry">
      <div class="entry-body">
        <h3>${esc(titleOf(e))}</h3>
        <p class="meta">${esc(dLong.format(parseDay(e.day)))}, ${when}</p>
        <div class="actions"><button type="button" class="btn btn-danger" data-act="delete" data-id="${esc(e.id)}">${t('Delete')}</button></div>
      </div>
    </article>`;
  }
  const v = eff(e);
  const photos = (e.photoIds || []).map((p) => `<img data-photo="${esc(p)}" alt="${t('Photo of the meal')}">`).join('');
  const meta = [when, SLOT_NAME[e.slot] ? td(SLOT_NAME[e.slot]) : '', e.place ? esc(placeText(e.place)) : ''].filter(Boolean).join(', ');
  let body;
  if (S.busy.has(e.id)) {
    body = `<p class="status"><span class="spin" aria-hidden="true"></span>${esc(entryState(e))}</p>`;
  } else if (e.status === 'pending') {
    body = `<p class="status">${esc(e.err || t('Waiting for analysis.'))}</p><div class="actions"><button type="button" class="btn btn-primary" data-act="analyze" data-id="${esc(e.id)}">${t('Analyse')}</button><button type="button" class="link link-danger" data-act="delete" data-id="${esc(e.id)}">${t('Delete')}</button></div>`;
  } else if (e.status === 'error') {
    body = `<p class="status is-error">${esc(e.err || t('Analysis failed.'))}</p><div class="actions"><button type="button" class="btn btn-primary" data-act="analyze" data-id="${esc(e.id)}">${t('Try again')}</button><button type="button" class="link link-danger" data-act="delete" data-id="${esc(e.id)}">${t('Delete')}</button></div>`;
  } else {
    const tier = e.tier === 'off' ? `<span class="tag tag-off">${t('Off plan')}</span>` : e.tier === 'flex' ? `<span class="tag tag-flex">${t('Weekly extra')}</span>` : e.planId ? `<span class="tag">${t('Plan meal')}</span>` : '';
    const rough = e.conf > 0 && e.conf < 0.6 && !e.planId;
    const mult = e.mult || 1;
    const canReanalyse = e.src === 'photo' || e.src === 'text';
    // Item table: what the total is made of. A last row accounts for any difference, so the column always adds up.
    const list = e.items || [];
    const itemSum = list.reduce((a, i) => a + (i.kcal || 0), 0) * mult;
    const rest = Math.round(v.kcal - itemSum);
    const restRow = list.length && itemSum > 0 && Math.abs(rest) >= 5
      ? `<tr class="items-rest"><th scope="row">${e.edited || (e.conf === 1 && !e.planId) ? t('Your edit') : t('Not itemised')}</th><td></td><td>${rest > 0 ? '+' : '−'}${n0(Math.abs(rest))}</td></tr>` : '';
    const items = list.length ? `<table class="items-table">
        <thead><tr><th scope="col">${t('Item')}</th><th scope="col">${t('Amount')}</th><th scope="col">kcal</th></tr></thead>
        <tbody>${list.map((i) => `<tr><th scope="row">${esc(i.n)}</th><td>${i.g ? n0(i.g * mult) + ' g' : ''}</td><td>${i.kcal ? n0(i.kcal * mult) : '–'}</td></tr>`).join('')}${restRow}</tbody>
      </table>` : '';
    // The person can always tell the model what it could not see; if the model asked, its question is the prompt
    const prompt = e.q || (e.src === 'photo' ? t('Something the photo does not show?') : t('Something to correct?'));
    const question = canReanalyse ? `<div class="question${e.q ? ' is-asked' : ''}"><p id="ask-${esc(e.id)}">${esc(prompt)}</p><div><input id="answer-${esc(e.id)}" type="text" aria-labelledby="ask-${esc(e.id)}" enterkeyhint="send" autocomplete="off" placeholder="${e.q ? t('Answer briefly') : t('e.g. 2 eggs, low-fat cheese, baked')}"><button type="button" class="btn" data-act="answer" data-id="${esc(e.id)}">${t('Update')}</button></div><p class="note">${t('The model revises the items with your note.')}</p></div>` : '';
    const mults = [0.5, 1, 1.5, 2].map((m) => `<button type="button" data-act="mult" data-id="${esc(e.id)}" data-v="${m}" aria-pressed="${(e.mult || 1) === m}">${m === 1 ? '1' : multLabel(m)}</button>`).join('');
    const slotOptions = Object.entries(SLOT_NAME).map(([k, name]) => `<option value="${k}"${e.slot === k ? ' selected' : ''}>${td(name)}</option>`).join('');
    body = `
      <p class="entry-value"><b>${n0(v.kcal)}</b> kcal<span>${t('{p} g protein, {c} g carbs, {f} g fat', { p: n0(v.p), c: n0(v.c), f: n0(v.f) })}</span></p>
      ${rough ? `<p class="status">${t('Rough estimate. A short note below tightens it.')}</p>` : ''}
      ${items}
      ${question}
      <div class="actions">
        <div class="seg seg-small" role="group" aria-label="${t('Portion')}">${mults}</div>
        ${tier}
      </div>
      <div class="field-grid">
        <label for="edit-kcal-${esc(e.id)}">${t('Calories')}<input id="edit-kcal-${esc(e.id)}" type="text" inputmode="numeric" value="${Math.round(v.kcal)}"></label>
        <label for="edit-protein-${esc(e.id)}">${t('Protein (g)')}<input id="edit-protein-${esc(e.id)}" type="text" inputmode="decimal" value="${Math.round(v.p)}"></label>
        <label for="edit-slot-${esc(e.id)}">${t('Meal')}<select id="edit-slot-${esc(e.id)}">${slotOptions}</select></label>
        <label for="edit-time-${esc(e.id)}">${t('Time')}<input id="edit-time-${esc(e.id)}" type="time" value="${hhmm(e.ts)}"></label>
      </div>
      <div class="actions">
        <button type="button" class="btn" data-act="save-edit" data-id="${esc(e.id)}">${t('Save changes')}</button>
        <button type="button" class="link" data-act="favorite" data-id="${esc(e.id)}">${t('Add to favourites')}</button>
        ${canReanalyse ? `<button type="button" class="link" data-act="reanalyze" data-id="${esc(e.id)}">${S.settings.provider === 'openai' ? t('Analyse again') : t('Analyse again with Sonnet')}</button>` : ''}
        <button type="button" class="link link-danger" data-act="delete" data-id="${esc(e.id)}">${t('Delete')}</button>
      </div>`;
  }
  return `<article class="entry">
    ${photos ? `<div class="entry-photos${(e.photoIds || []).length > 1 ? ' is-multi' : ''}">${photos}</div>` : ''}
    <div class="entry-body">
      <h3>${esc(titleOf(e))}</h3>
      <p class="meta">${meta}</p>
      ${e.text && e.src === 'photo' ? `<p class="meta">${t('Note: {text}', { text: esc(e.text) })}</p>` : ''}
      ${body}
    </div>
  </article>`;
}

export function renderEntrySheet(id) {
  const e = S.entries.find((x) => x.id === id);
  if (!e) return '';
  return `
  <header class="sheet-top"><h2 id="sheet-title">${t('Entry')}</h2><button type="button" class="btn" data-act="close-sheet">${t('Close')}</button></header>
  ${entryDetail(e)}`;
}

// ——— Log: one compact row per entry; the photo is a thumbnail, details open in a sheet ———
function logRow(e) {
  const ok = e.status === 'ok';
  const photoCount = (e.photoIds || []).length;
  const thumb = photoCount
    ? `<span class="log-thumb"><img data-photo="${esc(e.photoIds[0])}" alt="">${photoCount > 1 ? `<b>${photoCount}</b>` : ''}</span>`
    : '';
  let meta;
  let value = '';
  if (e.kind !== 'meal') {
    meta = e.kind === 'weight' ? t('Weigh-in') : t('Step count');
  } else if (!ok) {
    meta = esc(entryState(e)); // the full message is in the entry sheet
    value = S.busy.has(e.id) ? '<span class="spin" aria-hidden="true"></span>' : '';
  } else {
    const v = eff(e);
    const notes = [t('{n} g protein', { n: n0(v.p) })];
    if (e.mult && e.mult !== 1) notes.push(t('{mult} portion', { mult: multLabel(e.mult) }));
    if (e.tier === 'off') notes.push(t('off plan'));
    else if (e.tier === 'flex') notes.push(t('weekly extra'));
    else if (e.planId) notes.push(t('plan meal'));
    if (e.q) notes.push(t('has a question'));
    else if (e.conf > 0 && e.conf < 0.6 && !e.planId) notes.push(t('rough estimate'));
    meta = notes.join(', ');
    value = `<b>${n0(v.kcal)}</b><small>kcal</small>`;
  }
  const state = e.kind === 'meal' && !ok ? (e.status === 'error' ? ' is-error' : ' is-pending') : '';
  return `<li><button type="button" class="log-row${state}${e.tier === 'off' && ok ? ' is-off' : ''}" data-act="open-entry" data-id="${esc(e.id)}">
    <span class="log-time">${hhmm(e.ts)}</span>
    <span class="log-main"><span class="log-title">${esc(titleOf(e))}</span><span class="log-meta">${meta}</span></span>
    ${thumb}
    <span class="log-value">${value}</span>
  </button></li>`;
}

// The day's review: the verdict worked out from the numbers, then what the model wrote about the day
function reviewBlock(day) {
  const v = dayVerdict(day);
  if (!v) return '';
  const pill = { on: 'pill-good', under: 'pill-warn', over: 'pill-warn', back: 'pill-warn' }[v.level] || 'pill-plain';
  const r = S.days[day] && S.days[day].review;
  const busy = S.reviewing.has(day);
  const err = S.reviewErr.get(day);
  const wait = `<p class="review-wait" role="status"><span class="spin" aria-hidden="true"></span>${t('Writing the review…')}</p>`;
  const ask = (label) => `<button type="button" class="link" data-act="review-day" data-day="${day}">${label}</button>`;
  let ai = '';
  if (r) {
    const open = S.reviewOpen.has(day) ? S.reviewOpen.get(day) : day >= addDays(today(), -1);
    const rows = [[t('Helped'), r.good || []], [t('Cost most'), r.cut || []], [t('Next'), r.next ? [r.next] : []]].filter(([, list]) => list.length);
    const made = new Date(r.ts);
    const when = dayKey(made) === today() ? hhmm(r.ts) : dTiny.format(made);
    const stale = reviewState(day) === 'stale';
    ai = `<details class="review-ai" data-day="${day}"${open ? ' open' : ''}>
      <summary>${esc(r.head)}</summary>
      ${rows.length ? `<dl>${rows.map(([k, list]) => `<div><dt>${k}</dt>${list.map((x) => `<dd>${esc(x)}</dd>`).join('')}</div>`).join('')}</dl>` : ''}
      ${busy ? wait : `<p class="review-foot">${stale ? (r.live && !v.live ? t('Written before the day ended.') : t('The log changed after this review.')) : t('AI review, {when}.', { when })} ${hasKey() ? ask(stale ? t('Update the review') : t('Review again')) : ''}</p>`}
    </details>`;
  } else if (busy) ai = wait;
  else if (hasKey()) ai = `<p class="review-foot">${ask(v.live ? t('Review the day so far') : t('Review this day'))}</p>`;
  return `<div class="review">
    <p class="review-verdict"><i class="pill ${pill}">${td(VERDICT[v.level])}</i><span>${esc(verdictText(v).join(' '))}</span></p>
    ${ai}
    ${err && !busy ? `<p class="note is-error" role="alert">${esc(err)}</p>` : ''}
  </div>`;
}

export function renderLog() {
  const pending = S.entries.filter((e) => e.status === 'pending' && !S.busy.has(e.id));
  const byDay = new Map();
  for (const e of S.entries.slice().sort((a, b) => b.ts - a.ts)) {
    if (!byDay.has(e.day)) byDay.set(e.day, []);
    byDay.get(e.day).push(e);
  }
  const tod = today();
  const dayName = (d) => (d === tod ? t('Today') : d === addDays(tod, -1) ? t('Yesterday') : dLong.format(parseDay(d)));
  const groups = Array.from(byDay.entries()).slice(0, 60).map(([d, entries]) => {
    const tot = dayTotals(d);
    const target = dayTarget(d);
    const st = dayStatus(d);
    const fill = Math.min(100, (tot.kcal / target) * 100).toFixed(1);
    return `<section class="log-day">
      <header><h2>${esc(dayName(d))}</h2><p>${tot.n ? t('<b>{kcal}</b> / {target} kcal, {p} g protein', { kcal: n0(tot.kcal), target: n0(target), p: n0(tot.p) }) : ''}</p></header>
      ${tot.n ? `<div class="log-tape${st === 'on' ? ' is-on' : st === 'over' ? ' is-over' : ''}" style="--v:${fill}%" aria-hidden="true"><i></i></div>` : ''}
      ${reviewBlock(d)}
      <ul class="log-list">${entries.map(logRow).join('')}</ul>
    </section>`;
  }).join('');
  const keyNotice = hasKey() ? '' : `<div class="notice"><p>${t('Photo and free-text analysis needs an API key. Plan meals, weight and steps work without one.')}</p><button type="button" class="btn" data-act="settings" data-sec="analysis">${t('Add key')}</button></div>`;
  const pendingNotice = pending.length && hasKey() ? `<div class="notice"><p>${tn('{n} entry is waiting for analysis.|{n} entries are waiting for analysis.', pending.length)}</p><button type="button" class="btn" data-act="analyze-all">${t('Analyse all')}</button></div>` : '';
  return `
  <header class="top">
    <div><h1>${t('Log')}</h1><p class="sub">${t('Everything you sent, newest first, with a review of each day. Tap an entry to correct it.')}</p></div>
    <div class="top-actions">${avatarButton()}${settingsButton()}</div>
  </header>
  ${keyNotice}${pendingNotice}
  ${groups || `<div class="empty"><p>${t('Nothing logged yet.')}</p><p>${t('Everything you send lands here: photos, meals you type, weigh-ins, steps.')}</p>
    <div class="actions"><button type="button" class="btn btn-primary" data-act="camera">${t('Take a photo')}</button><button type="button" class="btn" data-act="library">${t('Choose from library')}</button></div>
    <p>${t('Typing works too. Tap the box below to see examples.')}</p></div>`}`;
}

// ——— Check: a verdict before ordering or buying ———
const FIT = { good: [T('Good choice'), 'pill-good'], ok: [T('With care'), 'pill-warn'], avoid: [T('Leave it'), 'pill-bad'] };
const CHECK_KIND = { menu: T('Menu'), product: T('Product'), dish: T('Dish') };
const kindLabel = (k) => CHECK_KIND[k] && td(CHECK_KIND[k]);
const checkWhen = (ts) => (dayKey(new Date(ts)) === today() ? hhmm(ts) : dTiny.format(new Date(ts)));

function checkOption(rec, o, i, rem) {
  const [label, pill] = FIT[o.fit] || FIT.ok;
  const dots = [1, 2, 3, 4, 5].map((k) => `<i${k <= o.rating ? ' class="on"' : ''}></i>`).join('');
  const nums = o.kcal
    ? `${o.p ? t('<b>{kcal}</b> kcal, {p} g protein', { kcal: n0(o.kcal), p: n0(o.p) }) : t('<b>{kcal}</b> kcal', { kcal: n0(o.kcal) })}${o.portion ? `<small>${esc(o.portion)}</small>` : ''}`
    : esc(o.portion);
  // What the portion does to today's budget: for food eaten now, not for shopping, and only on the day of the check
  let budget = '';
  if (rec.kind !== 'product' && o.kcal && rem != null) {
    budget = o.kcal <= rem ? t('Leaves {kcal} kcal of today’s budget.', { kcal: n0(rem - o.kcal) }) : rem > 0 ? t('{kcal} kcal more than is left today.', { kcal: n0(o.kcal - rem) }) : t('Today’s budget is already used up.');
  }
  return `<li class="option">
    <div class="option-head"><h3>${esc(o.name)}</h3><i class="pill ${pill}">${td(label)}</i></div>
    <p class="option-nums"><span class="rating" role="img" aria-label="${t('Quality {n} of 5', { n: esc(o.rating) })}"><em>${t('Quality')}</em>${dots}</span><span class="option-kcal">${nums}</span></p>
    ${o.why ? `<p class="option-why">${esc(o.why)}</p>` : ''}
    ${o.tip ? `<p class="option-tip"><b>${o.fit === 'avoid' ? t('Instead') : rec.kind === 'menu' ? t('Order it like this') : t('Make it fit')}:</b> ${esc(o.tip)}</p>` : ''}
    ${o.facts ? `<p class="option-facts">${esc(o.facts)}</p>` : ''}
    ${budget || o.kcal ? `<div class="option-foot"><span>${budget}</span>${o.kcal ? `<button type="button" class="btn btn-small" data-act="check-log" data-id="${esc(rec.id)}" data-i="${i}">${t('Log this')}</button>` : ''}</div>` : ''}
  </li>`;
}

function checkResult(rec, rem) {
  const sameDay = dayKey(new Date(rec.ts)) === today();
  return `<section class="verdict" id="check-result" aria-label="${t('Verdict')}">
    <header><h2>${esc(rec.title || kindLabel(rec.kind) || t('Verdict'))}</h2><p>${kindLabel(rec.kind) || t('Check')}, ${checkWhen(rec.ts)}</p></header>
    <p class="verdict-answer">${esc(rec.answer)}</p>
    ${rec.note ? `<p class="note">${t('Your note: {note}', { note: esc(rec.note) })}</p>` : ''}
    <ol class="options">${rec.options.map((o, i) => checkOption(rec, o, i, sameDay ? rem : null)).join('')}</ol>
    <p class="review-foot">${rec.photos ? tn('From {n} photo; the photos were not kept. Numbers are estimates.|From {n} photos; the photos were not kept. Numbers are estimates.', Number(rec.photos)) : t('From your note; the photos were not kept. Numbers are estimates.')} <button type="button" class="link" data-act="check-remove" data-id="${esc(rec.id)}">${t('Remove this check')}</button></p>
  </section>`;
}

export function renderCheck() {
  const c = S.check;
  const tod = today();
  const tot = dayTotals(tod);
  const rem = Math.round(dayTarget(tod) - tot.kcal);
  const remP = Math.max(0, Math.round(S.settings.protein - tot.p));
  const rec = S.checks.find((x) => x.id === c.openId) || null;
  const full = c.photos.length >= CHECK_MAX;
  const photos = c.photos.length
    ? `<ul class="check-photos">${c.photos.map((p, i) => `<li><img src="${p.url}" alt="${t('Photo {n} for this check', { n: i + 1 })}"><button type="button" data-act="check-photo-remove" data-id="${p.id}" aria-label="${t('Remove photo {n}', { n: i + 1 })}">${ICON.close}</button></li>`).join('')}</ul>`
    : '';
  const keyNotice = hasKey() ? '' : `<div class="notice"><p>${t('A check is done by a model, so it needs an API key.')}</p><button type="button" class="btn" data-act="settings" data-sec="analysis">${t('Add key')}</button></div>`;
  const earlier = S.checks.filter((x) => !rec || x.id !== rec.id);
  const history = earlier.length ? `<section class="check-history">
    <h2>${rec ? t('Other checks') : t('Earlier checks')}</h2>
    <ul class="log-list">${earlier.map((x) => {
      const best = x.options.find((o) => o.fit === 'good') || x.options[0];
      return `<li><button type="button" class="log-row" data-act="check-open" data-id="${esc(x.id)}">
        <span class="log-time">${checkWhen(x.ts)}</span>
        <span class="log-main"><span class="log-title">${esc(x.title || kindLabel(x.kind))}</span><span class="log-meta">${best ? t('{kind}, {verdict}: {name}', { kind: kindLabel(x.kind) || t('Check'), verdict: best.fit === 'avoid' ? t('leave') : best.fit === 'good' ? t('best') : t('with care'), name: esc(best.name) }) : kindLabel(x.kind) || t('Check')}</span></span>
      </button></li>`;
    }).join('')}</ul>
  </section>` : '';
  return `
  <header class="top">
    <div><h1>${t('Check')}</h1><p class="sub">${t('Before you order or buy: photograph the menu, the dish or the product and get a verdict against your plan.')}</p></div>
    <div class="top-actions">${avatarButton()}${settingsButton()}</div>
  </header>
  ${keyNotice}
  <section class="check-new" aria-label="${t('New check')}">
    <p class="check-budget">${rem > 0 ? (remP ? t('Left today: <b>{kcal}</b> kcal, <b>{p}</b> g protein to go.', { kcal: n0(rem), p: n0(remP) }) : t('Left today: <b>{kcal}</b> kcal.', { kcal: n0(rem) })) : rem < -10 ? t('Today’s budget is used up, by <b>{kcal}</b> kcal.', { kcal: n0(-rem) }) : t('Today’s budget is used up.')}</p>
    ${photos}
    <div class="actions">
      <button type="button" class="btn" data-act="check-cam"${full || c.busy ? ' disabled' : ''}>${ICON.camera}${t('Take a photo')}</button>
      <button type="button" class="btn" data-act="check-lib"${full || c.busy ? ' disabled' : ''}>${t('Choose photos')}</button>
    </div>
    <p class="note">${c.photos.length ? t('{n} of {max} photos.', { n: c.photos.length, max: CHECK_MAX }) : t('Up to {max} photos: both pages of a menu, or the front and the nutrition table of a product.', { max: CHECK_MAX })} ${t('They are sent for this check and not kept.')}</p>
    <label class="sr-only" for="check-note">${t('A note for this check')}</label>
    <input id="check-note" type="text" enterkeyhint="go" maxlength="300" placeholder="${t('Add a note: “dinner, very hungry”')}" value="${esc(c.note)}"${c.busy ? ' disabled' : ''}>
    <button type="button" class="btn btn-primary btn-wide" data-act="check-run"${checkReady() ? '' : ' disabled'}>${c.busy ? '<span class="spin" aria-hidden="true"></span>' + t('Checking…') : t('Check against my plan')}</button>
    ${c.busy && c.status ? `<p class="note" role="status">${esc(c.status)}</p>` : ''}
    ${c.err ? `<p class="note is-error" role="alert">${esc(c.err)}</p>` : ''}
  </section>
  ${rec ? checkResult(rec, rem) : ''}
  ${history}
  ${!rec && !earlier.length ? `<div class="empty check-empty"><p>${t('What a check tells you')}</p><p>${t('How good the food is in general, whether it fits your plan and what is left of today, and how to order it so that it does.')}</p><p>${t('It works for a restaurant menu, a dish in front of you, a product on the shelf, or two products side by side.')}</p></div>` : ''}`;
}

// ——— Progress ———
let chartData = null;

// The weight chart. Three ranges: the last 7 days or the last two weeks, where every weigh-in can be read, and the
// whole plan, which shows where it is going and when you arrive at this pace. Brass is you (the 7-day average),
// the dashed teal line is your line (the schedule), grey dots are the daily weigh-ins. The height never spans less
// than 2 kg, so a normal day-to-day wobble does not look like a cliff.
function weightChart() {
  const s = S.settings;
  const whole = S.chartRange === 'whole';
  const week = S.chartRange === 'week';
  const series = weightSeries();
  const tod = today();
  const pr = projection();
  const W = 340;
  const H = 214;
  const m = { l: 34, r: whole ? 42 : 64, t: 14, b: 26 };
  const { x0, x1, ticks } = chartWindow(S.chartRange, tod, s, series.length ? series[0].day : '');
  const span = Math.max(1, diffDays(x0, x1));
  const lineAt = (d) => (d < s.startDate ? s.startKg : targetAt(d, s));
  const visible = series.filter((d) => d.day >= x0 && d.day <= x1);
  const avgPoints = [];
  const from = whole ? (visible[0] && visible[0].day) : x0;
  if (from) for (let d = from; d <= (tod < x1 ? tod : x1); d = addDays(d, 1)) { const a = avg7(d); if (a) avgPoints.push({ day: d, kg: a.kg }); }
  const end = avgPoints[avgPoints.length - 1];

  // The height: everything shown, plus a little room, and at least 2 kg
  const lineDays = [x0, x1].concat(x0 < s.startDate && s.startDate < x1 ? [s.startDate] : []);
  const vals = visible.map((d) => d.kg).concat(avgPoints.map((p) => p.kg), lineDays.map(lineAt));
  let lo = Math.min(...vals) - 0.3;
  let hi = Math.max(...vals) + 0.3;
  if (hi - lo < 2) { const c = (hi + lo) / 2; lo = c - 1; hi = c + 1; }
  const step = hi - lo <= 3 ? 0.5 : hi - lo <= 10 ? 1 : 2;
  lo = Math.floor(lo / step) * step;
  hi = Math.ceil(hi / step) * step;
  const X = (day) => m.l + (diffDays(x0, day) / span) * (W - m.l - m.r);
  const Y = (kg) => m.t + ((hi - kg) / (hi - lo)) * (H - m.t - m.b);
  const f = (n) => n.toFixed(1);

  let grid = '';
  for (let k = lo; k <= hi + 1e-6; k += step) {
    grid += `<line x1="${m.l}" x2="${W - m.r}" y1="${f(Y(k))}" y2="${f(Y(k))}" class="c-grid"/><text x="${m.l - 6}" y="${f(Y(k) + 3.5)}" text-anchor="end" class="c-axis">${esc(kgLabel(Math.round(k * 10) / 10))}</text>`;
  }
  let xTicks = '';
  if (whole) {
    for (let i = 0; i <= span; i++) {
      const d = addDays(x0, i);
      if (d.endsWith('-01') || i === 0) {
        const px = X(d);
        if (i !== 0 && px - m.l < 52) continue;
        xTicks += `<text x="${f(px)}" y="${H - 8}" text-anchor="${i === 0 ? 'start' : 'middle'}" class="c-axis">${i === 0 ? esc(dTiny.format(parseDay(d))) : esc(dMonth.format(parseDay(d)))}</text>`;
      }
    }
  } else {
    const dTick = week ? dWd : dTiny;
    xTicks = ticks
      .map(([d, anchor]) => `<text x="${f(X(d))}" y="${H - 8}" text-anchor="${anchor}" class="c-axis">${esc(dTick.format(parseDay(d)))}</text>`).join('');
  }
  const linePts = lineDays.slice().sort().map((d) => `${f(X(d))},${f(Y(lineAt(d)))}`).join(' ');
  const r = whole ? 2.4 : week ? 4 : 3.2;
  const dots = visible.map((d) => `<circle cx="${f(X(d.day))}" cy="${f(Y(d.kg))}" r="${r}" class="c-dot"/>`).join('');
  const path = avgPoints.map((p, i) => `${i ? 'L' : 'M'}${f(X(p.day))} ${f(Y(p.kg))}`).join(' ');

  // Labels at the right end: you and your line; on the whole plan also the target and where this pace arrives
  let labels = '';
  let proj = '';
  if (whole) {
    labels += `<text x="${f(X(s.targetDate) + 6)}" y="${f(Y(s.targetKg) + 4)}" class="c-label">${esc(kgLabel(s.targetKg))} kg</text>`;
    // Near the plan's end the label goes left of the dot, so it stays on the chart and clear of the target's label
    const left = X(end ? end.day : x0) > W - m.r - 50;
    if (end) labels += `<text x="${f(X(end.day) + (left ? -8 : 8))}" y="${f(Y(end.kg) - 9)}"${left ? ' text-anchor="end"' : ''} class="c-label-you">${t('You {kg}', { kg: esc(n1(end.kg)) })}</text>`;
    // Only while the plan runs: after its end date, today lies outside the chart
    if (pr && pr.eta && end && tod >= x0 && tod < x1) {
      const stop = pr.eta < x1 ? pr.eta : x1;
      const at = pr.now + pr.slope * diffDays(tod, stop);
      proj = `<path d="M${f(X(tod))} ${f(Y(pr.now))}L${f(X(stop))} ${f(Y(at))}" class="c-proj"/>`;
      labels += `<text x="${f(Math.min(X(stop), W - m.r - 4))}" y="${f(Math.min(Y(at) + 16, H - m.b - 4))}" text-anchor="end" class="c-label-eta">${t('{date} at this pace', { date: esc(dTiny.format(parseDay(pr.eta))) })}</text>`;
    }
  } else if (end) {
    let yy = Y(end.kg);
    let yl = Y(lineAt(x1));
    if (Math.abs(yy - yl) < 14) { const mid = (yy + yl) / 2; const up = end.kg >= lineAt(x1) ? -1 : 1; yy = mid + up * 7; yl = mid - up * 7; }
    labels += `<text x="${f(X(x1) + 8)}" y="${f(yy + 4)}" class="c-label-you">${t('You {kg}', { kg: esc(n1(end.kg)) })}</text>`;
    labels += `<text x="${f(X(x1) + 8)}" y="${f(yl + 4)}" class="c-label">${t('Line {kg}', { kg: esc(n1(lineAt(x1))) })}</text>`;
  }
  const todayLine = whole && tod >= x0 && tod <= x1 ? `<line x1="${f(X(tod))}" x2="${f(X(tod))}" y1="${m.t}" y2="${H - m.b}" class="c-today"/>` : '';
  chartData = { x0, span, m, W, H, avg: Object.fromEntries(avgPoints.map((p) => [p.day, p.kg])) };
  const avgKg = end ? n1(end.kg) : '';
  const lineKg = end ? n1(lineAt(tod < x1 ? tod : x1)) : '';
  const alt = end
    ? (whole ? (pr && pr.eta ? t('Weight over the whole plan: 7-day average {avg} kg, your line {line} kg, at this pace you arrive on {date}.', { avg: avgKg, line: lineKg, date: dShort.format(parseDay(pr.eta)) }) : t('Weight over the whole plan: 7-day average {avg} kg, your line {line} kg.', { avg: avgKg, line: lineKg }))
      : week ? t('Weight over the last 7 days: 7-day average {avg} kg, your line {line} kg.', { avg: avgKg, line: lineKg }) : t('Weight over the last two weeks: 7-day average {avg} kg, your line {line} kg.', { avg: avgKg, line: lineKg }))
    : (whole ? t('Weight chart: no weigh-ins yet.') : week ? t('Weight chart: no weigh-ins in the last 7 days.') : t('Weight chart: no weigh-ins in the last two weeks.'));
  return `<div class="chart">
    <div class="chart-head"><h2>${t('Weight')}</h2>
      <div class="seg" role="group" aria-label="${t('Chart range')}">
        <button type="button" data-act="chart-range" data-v="week" aria-pressed="${week}">${t('Week')}</button>
        <button type="button" data-act="chart-range" data-v="weeks" aria-pressed="${!week && !whole}">${t('2 weeks')}</button>
        <button type="button" data-act="chart-range" data-v="whole" aria-pressed="${whole}">${t('Overall')}</button>
      </div>
    </div>
    <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(alt)}">
      ${grid}${xTicks}${todayLine}
      <polyline points="${linePts}" class="c-target"/>
      ${proj}${dots}
      ${path ? `<path d="${path}" class="c-avg"/>` : ''}
      ${end ? `<circle cx="${f(X(end.day))}" cy="${f(Y(end.kg))}" r="4.5" class="c-end"/>` : ''}
      ${labels}
      <line id="c-cross" x1="0" x2="0" y1="${m.t}" y2="${H - m.b}" class="c-cross" visibility="hidden"/>
    </svg>
    <div class="tip" id="c-tip" hidden></div>
    ${!end && !whole ? `<p class="note">${week ? t('No weigh-ins in the last 7 days.') : t('No weigh-ins in the last two weeks.')}</p>` : ''}
    <p class="legend"><span><i class="key-avg"></i>${t('You (7-day average)')}</span><span><i class="key-target"></i>${t('Your line')}</span><span><i class="key-dot"></i>${t('Daily weigh-in')}</span>${proj ? `<span><i class="key-proj"></i>${t('At this pace')}</span>` : ''}</p>
  </div>`;
}

export function attachChart(root) {
  const svg = root.querySelector('.chart svg');
  const tip = root.querySelector('#c-tip');
  const cross = root.querySelector('#c-cross');
  if (!svg || !chartData) return;
  const { x0, span, m, W } = chartData;
  const hide = () => { tip.hidden = true; cross.setAttribute('visibility', 'hidden'); };
  const move = (ev) => {
    const r = svg.getBoundingClientRect();
    const px = ((ev.clientX - r.left) / r.width) * W;
    const i = Math.round(((px - m.l) / (W - m.l - m.r)) * span);
    if (i < 0 || i > span) { hide(); return; }
    const day = addDays(x0, i);
    const cx = m.l + (i / span) * (W - m.l - m.r);
    cross.setAttribute('x1', cx);
    cross.setAttribute('x2', cx);
    cross.setAttribute('visibility', 'visible');
    const d = S.days[day];
    const rows = [[dShort.format(parseDay(day)), '']];
    if (d && d.kg) rows.push([n1(d.kg) + ' kg', t('weigh-in')]);
    if (chartData.avg[day]) rows.push([n1(chartData.avg[day]) + ' kg', t('average')]);
    if (day >= S.settings.startDate) rows.push([n1(targetAt(day, S.settings)) + ' kg', t('line')]);
    tip.innerHTML = '';
    rows.forEach(([value, label], k) => {
      const p = document.createElement('p');
      const b = document.createElement(k ? 'b' : 'span');
      b.textContent = value;
      p.append(b);
      if (label) { const sp = document.createElement('span'); sp.textContent = ' ' + label; p.append(sp); }
      tip.append(p);
    });
    tip.hidden = false;
    const left = (cx / W) * r.width;
    tip.style.left = Math.min(Math.max(left, 64), r.width - 64) + 'px';
  };
  svg.addEventListener('pointermove', move);
  svg.addEventListener('pointerdown', move);
  svg.addEventListener('pointerleave', hide);
}


// The calendar: each day shows its calories as the big number, coloured by how the day went, and its protein as a small pie
const WK_ICON = {
  star: '<path d="M12 2.8l2.7 5.8 6.3.7-4.7 4.3 1.3 6.2L12 16.7 6.4 19.8l1.3-6.2L3 9.3l6.3-.7z" fill="currentColor" stroke="none"/>',
  sprout: '<path d="M12 21V11"/><path d="M12 12C12 7.5 9 5 4.5 5c0 4.5 2.5 7 7.5 7z" fill="currentColor" fill-opacity=".25"/><path d="M12 14c0-3.5 2.3-5.5 7-5.5 0 3.5-2.3 5.5-7 5.5z" fill="currentColor" fill-opacity=".25"/>',
  steady: '<circle cx="12" cy="12" r="9" fill="currentColor" fill-opacity=".15"/><path d="M7.5 12.5l3 3 6-6.5"/>',
  caution: '<path d="M12 3.5L22 20H2z" fill="currentColor" fill-opacity=".18"/><path d="M12 10v4.5M12 17.3v.2"/>',
  reset: '<path d="M4 12a8 8 0 1 0 2.5-5.8"/><path d="M4 4v4.5h4.5"/>',
  going: '<circle cx="12" cy="12" r="9" stroke-dasharray="3 3.2"/><path d="M9.5 8.5l4 3.5-4 3.5"/>',
};
const wkIcon = (k) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${WK_ICON[k]}</svg>`;
const PIE = {
  target: '<circle cx="5" cy="5" r="4.4" fill="currentColor"/>',
  min: '<path d="M5 5V1A4 4 0 0 1 5 9Z" fill="currentColor"/>',
  near: '<path d="M5 5V1A4 4 0 0 1 9 5Z" fill="currentColor"/>',
  short: '',
};
const pie = (lv) => `<svg viewBox="0 0 10 10" aria-hidden="true"><circle cx="5" cy="5" r="4" fill="none" stroke="currentColor" stroke-width="1.2"/>${PIE[lv] || ''}</svg>`;
const PROTEIN_TEXT = { target: T('target reached'), min: T('minimum reached'), near: T('nearly at the minimum'), short: T('short of the minimum') };
const CAL_GLYPH = { on: '✓', over: '▲', far: '▲▲', under: '↓', open: '…', none: '' };
// English keeps the exact old rule (the last comma becomes " and", even inside one item: "…budget and within the 10% margin"); other languages use their list format
const lists = new Map();
const join = (list) => {
  if (LOCALE === 'en-GB') return list.join(', ').replace(/, ([^,]*)$/, ' and $1'); // i18n-ok: English only
  if (!lists.has(LOCALE)) lists.set(LOCALE, new Intl.ListFormat(LOCALE, { type: 'conjunction' }));
  return lists.get(LOCALE).format(list);
};

function calendar() {
  const s = S.settings;
  const tod = today();
  const first = weekStart(s.startDate);
  const weeks = Math.ceil((diffDays(first, s.targetDate) + 1) / 7);
  let rows = '';
  let lastMonth = '';
  for (let w = 0; w < weeks; w++) {
    const ws = addDays(first, w * 7);
    const firstOfMonth = Array.from({ length: 7 }, (_, i) => addDays(ws, i)).find((d) => d.endsWith('-01'));
    const monthDay = w === 0 ? ws : firstOfMonth;
    if (monthDay && monthDay.slice(0, 7) !== lastMonth) {
      lastMonth = monthDay.slice(0, 7);
      rows += `<p class="cal-month">${esc(dMonthYear.format(parseDay(monthDay)))}</p>`;
    }
    const ahead = ws > tod;
    let cells = '';
    let marked = false;
    for (let i = 0; i < 7; i++) {
      const d = addDays(ws, i);
      const dn = parseDay(d).getDate();
      if (d < s.startDate || d > s.targetDate) { cells += '<span class="cal-d cal-out"></span>'; continue; }
      if (d > tod) { cells += `<span class="cal-d cal-fut" title="${esc(dShort.format(parseDay(d)))}"><span class="n">${dn}</span></span>`; continue; }
      const st = dayStatus(d);
      const tot = dayTotals(d);
      const target = dayTarget(d);
      const lv = proteinLevel(d);
      const plus = st === 'on' && tot.kcal > target + 0.5;
      const label = !tot.n ? t('{date}: nothing logged', { date: dShort.format(parseDay(d)) })
        : t('{date}: {kcal} of {target} kcal, {status}; protein {p} g, {level}', { date: dShort.format(parseDay(d)), kcal: n0(tot.kcal), target: n0(target), status: td(STATUS_LABEL[st]), p: n0(tot.p), level: td(PROTEIN_TEXT[lv]) });
      if (S.calPick === d) marked = true;
      cells += `<button type="button" class="cal-d cal-${st}${d === tod ? ' is-today' : ''}${S.calPick === d ? ' is-selected' : ''}" data-act="cal" data-day="${d}" title="${esc(label)}" aria-label="${esc(label)}">`
        + `<span class="n">${dn}</span><span class="g" aria-hidden="true">${CAL_GLYPH[st]}</span>`
        + `<span class="k">${tot.n ? `${Math.round(tot.kcal)}${plus ? '<sup>+</sup>' : ''}` : '–'}</span>`
        + `<span class="p">${tot.n ? `${pie(lv)}${n0(tot.p)}` : ''}</span></button>`;
    }
    // The result of the week: only once it is over; the week in progress gets an encouragement, weeks to come stay empty
    let wk = '<span class="cal-wk"></span>';
    if (!ahead) {
      const r = weekResult(ws);
      const head = r.done ? td(r.tier.title) : t('This week so far');
      const body = r.done ? `${t('{n} of 7 days on plan, protein reached on {p}.', { n: r.onPlan, p: r.proteinDays })} ${td(r.tier.text)}`
        : tn('{n} day on plan so far. Keep going, the week is still yours.|{n} days on plan so far. Keep going, the week is still yours.', r.onPlan);
      if (S.calPick === `week:${ws}`) marked = true;
      wk = `<button type="button" class="cal-wk is-${r.done ? r.tier.tone : 'going'}${S.calPick === `week:${ws}` ? ' is-selected' : ''}" data-act="cal" data-day="week:${ws}" title="${esc(`${head}. ${body}`)}" aria-label="${esc(`${head}. ${body}`)}">${wkIcon(r.done ? r.tier.icon : 'going')}<span>${r.onPlan}/7</span></button>`;
    }
    rows += `<div class="cal-row${ahead ? ' is-ahead' : ''}">${cells}${wk}</div>`;
    if (marked) rows += calPick(ws);
  }
  return `<div class="calendar card">
    <p class="cal-targets"><span>${t('Budget <b>{rest}</b> rest · <b>{train}</b> workout', { rest: n0(s.kcalRest), train: n0(s.kcalTrain) })}</span><span>${t('Min <b>{kcal}</b> kcal', { kcal: n0(kcalMinDay()) })}</span><span class="is-prot">${t('Protein <b>{goal} g</b> · min <b>{min} g</b>', { goal: n0(s.protein), min: n0(proteinFloor()) })}</span></p>
    <div class="cal-row cal-head">${WEEKDAYS.map((x) => `<span>${td(x)}</span>`).join('')}<span></span></div>
    ${rows}
    <details class="cal-key"><summary>${t('How to read a day')}</summary>
      <p><span class="cal-sw cal-on"></span>✓ ${t('on plan')} <span class="cal-sw cal-over"></span>▲ ${t('over')} <span class="cal-sw cal-far"></span>▲▲ ${t('far over')} <span class="cal-sw cal-under"></span>↓ ${t('under {kcal}', { kcal: n0(kcalMinDay()) })} <span class="cal-sw cal-open"></span>${t('today')}</p>
      <p class="is-prot">${pie('target')} ${t('{n} g target', { n: n0(s.protein) })} ${pie('min')} ${t('{n} g minimum', { n: n0(proteinFloor()) })} ${pie('near')} ${t('nearly')} ${pie('short')} ${t('short')}. ${t('Protein never breaks a streak. A "+" after the calories means a little over the budget, still within the {pct}% margin.', { pct: Math.round((BAND.high - 1) * 100) })}</p>
    </details>
  </div>`;
}

// The detail line under the week that holds the tapped day or week icon
function calPick(ws) {
  const tod = today();
  const pick = S.calPick;
  if (pick.startsWith('week:')) {
    const r = weekResult(ws);
    const range = `${dTiny.format(parseDay(ws))} – ${dTiny.format(parseDay(addDays(ws, 6)))}`;
    return `<p class="cal-pick"><b>${esc(range)}</b>: ${r.done ? `${esc(td(r.tier.title))}. ${t('{n} of 7 days on plan, protein reached on {p}.', { n: r.onPlan, p: r.proteinDays })} ${esc(td(r.tier.text))}`
      : tn('{n} day on plan so far, {left} to go. Keep going, the week is still yours.|{n} days on plan so far, {left} to go. Keep going, the week is still yours.', r.onPlan, { left: diffDays(tod, addDays(ws, 6)) })}</p>`;
  }
  const d = pick;
  const tot = dayTotals(d);
  const dd = S.days[d] || {};
  const st = dayStatus(d);
  const reasons = dayReasons(d);
  const verdict = { over: t('Over the budget'), far: t('Well over the budget'), under: t('Under the minimum') }[st];
  const main = !tot.n ? '' : st === 'on' ? t('On plan.') : st === 'open' ? t('Still in progress.')
    : reasons.length ? t('{verdict}: {reasons}.', { verdict, reasons: join(reasons) }) : t('{verdict}.', { verdict });
  const noted = tot.n && st !== 'open' ? dayNotes(d) : [];
  const notes = noted.length ? ` ${st === 'on' ? `${join(noted)}.` : t('Also: {notes}.', { notes: join(noted) })}` : '';
  const sums = { kcal: n0(tot.kcal), target: n0(dayTarget(d)), p: n0(tot.p), level: tot.n ? td(PROTEIN_TEXT[proteinLevel(d)]) : '' };
  const day = dd.kg ? (tot.n ? t('{kcal} / {target} kcal, {p} g protein ({level}), weigh-in {kg} kg.', { ...sums, kg: n1(dd.kg) }) : t('no meals logged, weigh-in {kg} kg.', { kg: n1(dd.kg) }))
    : (tot.n ? t('{kcal} / {target} kcal, {p} g protein ({level}).', sums) : t('no meals logged.'));
  return `<p class="cal-pick"><b>${esc(dLong.format(parseDay(d)))}</b>: ${day} ${esc(main + notes)} <button type="button" class="link link-inline" data-act="goto-day" data-day="${d}">${t('Open day')}</button></p>`;
}

function checkpoints() {
  const s = S.settings;
  const total = diffDays(s.startDate, s.targetDate);
  const points = [];
  for (let i = 28; i < total - 6; i += 28) points.push(addDays(s.startDate, i));
  points.push(s.targetDate);
  const tod = today();
  return `<table class="table"><thead><tr><th scope="col">${t('Date')}</th><th scope="col">${t('Your line')}</th><th scope="col">${t('Your average')}</th></tr></thead><tbody>
    ${points.map((d) => { const a = d <= tod ? avg7(d) : null; return `<tr><td>${esc(dShort.format(parseDay(d)))}</td><td>${n1(targetAt(d, s))} kg</td><td>${a ? n1(a.kg) + ' kg' : '–'}</td></tr>`; }).join('')}
  </tbody></table>`;
}

function adjustNotice() {
  const s = S.settings;
  const tod = today();
  if (diffDays(s.startDate, tod) < 14) return '';
  const a = avg7(tod);
  const b = avg7(addDays(tod, -7));
  if (!a || !b || a.n < 3 || b.n < 3) return '';
  if (a.kg - targetAt(tod, s) > 0.7 && b.kg - targetAt(addDays(tod, -7), s) > 0.7) {
    return `<div class="notice"><p>${t('Your average has been more than 0.7 kg behind schedule for two weeks. Cut 100 kcal a day or add 2,000 steps. Do not go below {kcal} kcal.', { kcal: n0(Math.max(kcalMinDay(), s.kcalRest - 100)) })}</p><button type="button" class="btn" data-act="settings" data-sec="targets">${t('Open goals')}</button></div>`;
  }
  return '';
}

export function renderProgress() {
  const s = S.settings;
  const { head, line, a, target, started } = progressSummary();
  const pr = projection();
  const series = weightSeries();
  const lost = a ? s.startKg - a.kg : 0;
  const run = streak();
  const rows = series.slice().reverse().slice(0, 120).map((d) => {
    const avg = avg7(d.day);
    const tot = dayTotals(d.day);
    return `<tr><td>${esc(dTiny.format(parseDay(d.day)))}</td><td>${n1(d.kg)}</td><td>${avg ? n1(avg.kg) : '–'}</td><td>${d.day >= s.startDate ? n1(targetAt(d.day, s)) : '–'}</td><td>${tot.n ? n0(tot.kcal) : '–'}</td></tr>`;
  }).join('');
  // The hero: the kilos down once there is an average to count from; until then, where things stand in words
  let hero;
  let note;
  if (started && a) {
    hero = `<p class="glide-head">${t('{kg} kg {dir}', { kg: esc(n1(Math.abs(lost))), dir: lost < -0.05 ? `<em class="is-up">${t('up')}</em>` : `<em>${t('down')}</em>` })}</p>`;
    let arrive = '';
    if (pr && pr.eta && a.kg > s.targetKg) {
      const early = diffDays(pr.eta, s.targetDate);
      const date = esc(dShort.format(parseDay(pr.eta)));
      arrive = ` ${early > 0 ? t('At this pace you arrive on <b>{date}</b>, {days} early.', { date, days: tn('{n} day|{n} days', early) })
        : early < 0 ? t('At this pace you arrive on <b>{date}</b>, {days} after the goal date.', { date, days: tn('{n} day|{n} days', -early) })
          : t('At this pace you arrive on <b>{date}</b>, right on the date.', { date })}`;
    }
    note = `${esc(head)}.${arrive}`;
  } else {
    hero = `<p class="glide-head is-words">${esc(head)}</p>`;
    note = esc(line);
  }
  return `
  <header class="top">
    <div><h1>${t('Progress')}</h1><p class="sub">${esc(dTiny.format(parseDay(s.startDate)))} → ${esc(dTiny.format(parseDay(s.targetDate)))} · ${esc(kgLabel(s.startKg))} kg → ${esc(kgLabel(s.targetKg))} kg</p></div>
    <div class="top-actions">${avatarButton()}${settingsButton()}</div>
  </header>
  ${adjustNotice()}
  <section class="glide">
    ${hero}
    <p class="glide-note">${note}</p>
  </section>
  ${beamCard(a, target, started)}
  ${runs(run)}
  <section>
    ${weightChart()}
    <dl class="stats stats-wide">
      <div><dt>${t('Lost')}</dt><dd>${a ? `${n1(Math.max(0, lost))}<small>kg</small>` : '–'}</dd></div>
      <div><dt>${t('To go')}</dt><dd>${n1(Math.max(0, (a ? a.kg : s.startKg) - s.targetKg))}<small>kg</small></dd></div>
      <div><dt>${t('Per week')}</dt><dd>${pr ? `${n1(pr.perWeek).replace('-', '−')}<small>kg</small>` : '–'}</dd></div>
      <div><dt>${t('Arrival at this pace')}</dt><dd>${pr && pr.eta ? esc(dTiny.format(parseDay(pr.eta))) : '–'}</dd></div>
    </dl>
    ${pr ? '' : `<p class="note">${t('The weekly rate and the arrival appear after 4 weigh-ins within the last 14 days, at least 6 days apart.')}</p>`}
  </section>
  <section>
    <h2>${t('Consistency calendar')}</h2>
    <p class="note">${run > 0 ? t('{days} on plan in a row.', { days: tn('{n} day|{n} days', run) }) : t('Days on plan build a run.')}</p>
    ${calendar()}
  </section>
  <section>
    <h2>${t('Checkpoints')}</h2>
    ${checkpoints()}
  </section>
  ${badgesSection()}
  <section>
    <details class="table-details">
      <summary>${t('Weigh-in table')}</summary>
      ${rows ? `<table class="table"><thead><tr><th scope="col">${t('Day')}</th><th scope="col">${t('Weigh-in')}</th><th scope="col">${t('Avg')}</th><th scope="col">${t('Line')}</th><th scope="col">kcal</th></tr></thead><tbody>${rows}</tbody></table>` : `<p class="note">${t('No weigh-ins yet. Enter one on Today, or type a number into the log.')}</p>`}
    </details>
  </section>`;
}

// ——— Badges: the collection on the Progress tab and the sheet for one badge ———
const badgeName = (id) => td(BY_ID[id].name);
// What the screens measure badges by, worked out once per state. The key is everything it depends on: S.rev moves on every save, load, clear and
// restore (see app.js), the others catch a whole replaced list, the settings, the stored record and the day. `seen` is added fresh: it changes without the log changing.
export function badgeContext() {
  const b = S.badges;
  const ctx = cachedContext([S.rev, S.entries, S.days, S.settings, b && b.got, b && b.base, today()], S, today(), b);
  return { ...ctx, seen: b ? b.seen : undefined };
}
const badgeFinish = (c) => td(FINISH_NAME[c.step]);
// How far along: '18 / 30', or '2 of 3 kg' for the kilos (text only); nothing for a one-shot or a badge that has no steps left
function badgeProgress(c) {
  const { cur, target } = c.prog || { cur: 0, target: 0 };
  if (!c.ladder || !target) return '';
  const p = { cur: n0(cur), target: n0(target) };
  return c.id === 'kilos' ? t('{cur} of {target} kg', p) : t('{cur} / {target}', p);
}
const badgeDay = (d) => esc(dFull.format(parseDay(d)));
// The line under the name in the grid
const badgeLine = (c) => (c.ladder ? badgeProgress(c) : c.state === 'earned' ? dTiny.format(parseDay(c.day)) : '');
const badgeAria = (c) => [badgeName(c.id), c.state === 'earned' ? (c.ladder ? badgeFinish(c) : '') : t('Locked'), c.state === 'earned' && !c.ladder ? dFull.format(parseDay(c.day)) : badgeProgress(c)].filter(Boolean).join(', ');

function badgeCell(c) {
  const pips = c.ladder ? `<span class="bd-pips" aria-hidden="true">${Array.from({ length: c.total }, (_, i) => `<i${i < c.earned ? ' class="on"' : ''}></i>`).join('')}</span>` : '';
  const fresh = c.isNew ? `<i class="bd-dot" aria-hidden="true"></i><span class="bd-new">${t('New')}</span>` : '';
  return `<button type="button" class="bd-cell is-${c.state}${c.isNew ? ' is-new' : ''}" id="badge-${c.id}" data-act="badge" data-id="${c.id}" aria-label="${esc(badgeAria(c) + (c.isNew ? ', ' + t('New') : ''))}">
      ${fresh}${badgeSvg(c.id, { step: c.step, state: c.state, size: 42, label: badgeName(c.id) })}
      <span class="bd-name">${esc(badgeName(c.id))}</span>
      <span class="bd-line">${esc(badgeLine(c))}</span>${pips}
    </button>`;
}

function badgesSection() {
  const col = collection(badgeContext());
  return `<section class="badges" aria-labelledby="badges-title">
    <div class="card-head"><h2 id="badges-title">${t('Badges')}</h2><span class="label">${t('{n} of {total}', { n: col.earned, total: col.total })}</span></div>
    ${S.badgeIntro ? `<p class="note bd-intro">${tn('{n} badge from your history|{n} badges from your history', S.badgeIntro)}</p>` : ''}
    ${col.earned || S.badgeIntro ? '' : `<p class="note bd-intro">${t('Log a meal and your first badge is on its way.')}</p>`}
    ${col.groups.map((g) => `<h3 class="bd-group">${esc(td(GROUP_NAME[g.group]))}</h3>
    <div class="bd-grid">
    ${g.cells.map(badgeCell).join('\n    ')}
    </div>`).join('\n    ')}
  </section>`;
}

// One badge in the bottom sheet: the big badge, what it asks for with the count so far, and each step of the ladder
export function renderBadgeSheet(id) {
  if (!Object.hasOwn(BY_ID, id)) return '';
  const ctx = badgeContext();
  const c = cellOf(id, ctx);
  const name = badgeName(id);
  const earned = c.state === 'earned';
  const status = earned ? (c.ladder ? t('{finish}, earned {date}', { finish: esc(badgeFinish(c)), date: badgeDay(c.day) }) : t('Earned {date}', { date: badgeDay(c.day) })) : t('Not earned yet');
  const more = badgeProgress(c);
  const rows = stepRows(id, ctx);
  const kg = id === 'kilos' ? ' kg' : '';
  return `
  <header class="sheet-top"><h2 id="sheet-title">${esc(name)}</h2><button type="button" class="btn" data-act="close-sheet">${t('Close')}</button></header>
  <div class="bd-hero"><span aria-hidden="true">${badgeSvg(id, { step: c.step, state: c.state, size: 88, label: name })}</span>
    <p class="bd-status"><b>${status}</b>${more && !(earned && c.earned === c.total) ? `<span>${esc(more)}</span>` : ''}</p></div>
  <p class="note bd-desc">${esc(td(BY_ID[id].desc, { n: n0(c.cur) }))}</p>
  ${rows.length ? `<ol class="bd-steps" aria-label="${t('Steps to earn')}">${rows.map((r) => `<li class="${r.day ? 'is-earned' : r.next ? 'is-next' : ''}"><span aria-hidden="true">${badgeSvg(id, { step: r.step, state: r.state, size: 32, label: '' })}</span><span class="bd-step-n">${n0(r.n)}${kg}<small>${esc(td(FINISH_NAME[r.step]))}</small></span><span class="bd-step-d">${r.day ? badgeDay(r.day) : r.next ? t('Next up') : ''}</span></li>`).join('')}</ol>` : ''}`;
}

// What a locked part asks for: the badge's name and, for a ladder, the step ('Earn Days on plan: 30'; the kilos in kg)
const partHint = ([id, thr]) => (BY_ID[id].steps.length > 1 ? t('Earn {name}: {n}', { name: badgeName(id), n: id === 'kilos' ? `${n0(thr)} kg` : n0(thr) }) : t('Earn {name}', { name: badgeName(id) }));
// The avatar picker: a live preview and the three slots as chips. A locked chip shows its hint when tapped (data-hint), it never changes anything.
export function renderAvatarSheet() {
  const av = wornAv(S.badges);
  const chip = (c) => {
    const name = esc(partName(c.part));
    const lock = c.locked ? '<svg width="11" height="11" viewBox="0 0 16 16" aria-hidden="true"><rect x="3" y="7" width="10" height="7" rx="1.5" fill="currentColor"/><path d="M5 7V5a3 3 0 0 1 6 0v2" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>' : '';
    return `<button type="button" class="chip av-chip${c.locked ? ' is-locked' : ''}" data-act="avatar-pick" data-part="${c.part}"${c.locked ? ` data-hint="${esc(partHint(c.req))}"` : ''} aria-pressed="${c.selected}">${lock}${name}${c.locked ? `<span class="sr-only">, ${t('Locked')}</span>` : ''}</button>`;
  };
  return `
  <header class="sheet-top"><h2 id="sheet-title">${t('Your pickle')}</h2><button type="button" class="btn" data-act="close-sheet">${t('Close')}</button></header>
  <div class="av-hero"><span id="av-preview" aria-hidden="true">${avatarSvg(av, { size: 168, label: avatarLabel(av) })}</span></div>
  ${avatarChoices(S.badges).map((g) => `<h3 class="av-slot" id="av-${g.slot}">${esc(td(SLOT_TITLE[g.slot]))}</h3>
  <div class="av-chips" role="group" aria-labelledby="av-${g.slot}">${g.parts.map(chip).join('')}</div>`).join('\n  ')}
  <p class="note av-hint" id="av-hint" role="status">${t('Locked parts show what to earn. Nothing changes by itself.')}</p>`;
}

// The beam in its card: every kilo between the start and the target, the ones collected, and the next one by name
function beamCard(a, target, started) {
  const s = S.settings;
  const lost = a && started ? s.startKg - a.kg : 0;
  const marks = kiloMarks();
  if (!marks.length) return '';
  const got = marks.filter((kg) => s.startKg - kg <= lost + 1e-6).length;
  const next = marks.find((kg) => s.startKg - kg > lost + 1e-6);
  const note = next == null ? t('Every kilo collected.')
    : a && started ? t('Next kilo at <b>{kg}</b>, {away} kg away.', { kg: esc(kgLabel(next)), away: esc(n1(a.kg - next)) })
      : t('A kilo is yours when a weigh-in reaches it.');
  return `<section class="card beam-card" aria-labelledby="beam-title">
    <div class="card-head"><h2 id="beam-title" class="label">${t('The beam · latest weigh-in')}</h2><span class="label">${tn('{got} of {n} kilo|{got} of {n} kilos', marks.length, { got })}</span></div>
    ${beam(a, target, started)}
    <p class="note">${note}</p>
  </section>`;
}

// The runs of days on plan, as four small cards
function runs(run) {
  const h = history();
  const best = Math.max(h.best, run);
  const d = (n) => `${n}<small>${tn('day|days', n)}</small>`;
  return `<dl class="stats" aria-label="${t('Days on plan')}">
    <div><dt>${t('In a row')}</dt><dd>${d(run)}</dd></div>
    <div><dt>${t('Longest run')}</dt><dd>${d(best)}</dd></div>
    <div><dt>${t('On plan')}</dt><dd>${h.onPlan}<small>/ ${h.days}</small></dd></div>
    <div><dt>${t('All 5 goals')}</dt><dd>${d(h.perfect)}</dd></div>
  </dl>`;
}

// ——— Plan ———
// The picture of a plan meal: the person's own photo, or an invitation to add one
function planPic(id, emptyText) {
  const pid = (S.settings.planPhotos || {})[id];
  return `<span class="plan-pic${pid ? '' : ' is-empty'}"><span class="plan-pic-empty">${PLATE}${emptyText ? `<em>${emptyText}</em>` : ''}</span>${pid ? `<img data-photo="${esc(pid)}" alt="">` : ''}</span>`;
}

export function renderPlan() {
  const s = S.settings;
  const pictured = MEALS.filter((m) => (s.planPhotos || {})[m.id]).length;
  const slot = (id, title, time, note) => {
    const meals = MEALS.filter((m) => m.slot === id);
    return `<section class="plan-slot">
    <h2>${title}${time ? `<small>${time}</small>` : ''}</h2>${note ? `<p class="note">${note}</p>` : ''}
    <div class="plan-row">${meals.map((m) => `<button type="button" class="plan-card" data-act="plan-meal" data-id="${m.id}" aria-label="${esc(t('{meal}, {kcal} kcal, {p} g protein. Details', { meal: td(m.name), kcal: m.kcal, p: n0(m.p) }))}">
        ${planPic(m.id, t('Add photo'))}
        <span class="plan-name">${esc(td(m.name))}</span>
        <span class="plan-meta"><span><b>${m.kcal}</b> kcal</span> · <span>${t('{n} g protein', { n: n0(m.p) })}</span></span>
      </button>`).join('')}</div>
  </section>`;
  };
  const list = (items) => `<ul class="rules">${items.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>`;
  const group = (title, body) => `<details class="rule-group"><summary><span>${title}</span></summary><div class="rule-body">${body}</div></details>`;
  return `
  <header class="top">
    <div><h1>${t('Plan')}</h1><p class="sub">${pictured ? t('{n} of {total} meals show your own photo.', { n: pictured, total: MEALS.length }) : t('Tap a meal for its ingredients, and to add a photo of your own plate.')}</p></div>
    <div class="top-actions">${avatarButton()}${settingsButton()}</div>
  </header>
  <ul class="plan-targets" aria-label="${t('Daily goals')}">
    <li>${t('Rest day <b>{kcal}</b> kcal', { kcal: n0(s.kcalRest) })}</li>
    <li>${t('Workout day <b>{kcal}</b> kcal', { kcal: n0(s.kcalTrain) })}</li>
    <li>${t('Protein <b>{n}</b> g', { n: esc(s.protein) })}</li>
    <li>${t('Fibre <b>{n}</b> g', { n: esc(s.fiber) })}</li>
  </ul>
  ${Object.entries({
    lunch: t('The first meal of the day.'),
    snack1: t('A protein snack: 250 g of skyr.'),
    snack2: t('On meatball or salmon days, cottage cheese tops up the protein.'),
    dinner: t('Meat, chicken and fish by raw weight.'),
  }).map(([id, note]) => { const x = SLOTS.find((y) => y.id === id); return slot(id, td(x.name), x.time, note); }).join('')}
  ${slot('workout', t('Workout-day extras'), '', t('Only on workout days; together about 200 kcal.'))}
  ${slot('late', lateName(), '', t('Herbal tea by default.'))}
  <section class="plan-rules">
    <h2>${t('The rules')}</h2>
    ${group(t('Dinner rotation'), `<p class="note">${t('Fish twice and legumes twice a week.')}</p><table class="table"><tbody>${RULES.rotation.map(([day, meal]) => `<tr><th scope="row">${day}</th><td>${esc(meal)}</td></tr>`).join('')}</tbody></table>`)}
    ${group(t('Every day'), list(RULES.daily))}
    ${group(t('The week’s extras'), list(RULES.weekly))}
    ${group(t('Off for the whole period'), list(RULES.off))}
    ${group(t('Training and movement'), list(RULES.training))}
    ${group(t('Process'), list(processRules(kcalMinDay())))}
  </section>`;
}

// Framing a new plan picture: the photo already has the house treatment; the circle shows what will be kept
export function renderFrameSheet(id) {
  const m = MEALS.find((x) => x.id === id);
  return `
  <header class="sheet-top"><h2 id="sheet-title">${t('Frame the picture')}</h2><button type="button" class="btn" data-act="frame-cancel">${t('Cancel')}</button></header>
  <p class="note">${t('{meal}. Drag until the plate sits in the circle, zoom until it fills it.', { meal: esc(m ? td(m.name) : '') })}</p>
  <div class="frame-stage"><canvas id="frame-canvas" width="640" height="640" aria-label="${t('Preview of the picture. Drag to move.')}"></canvas><span class="frame-ring" aria-hidden="true"></span></div>
  <label class="frame-zoom" for="frame-zoom">${t('Zoom')}<input id="frame-zoom" type="range" min="1" max="3" step="0.01" value="1"></label>
  <p class="note">${t('Light and colour are evened out so all plan pictures match. Only this framed picture is stored, not the original photo.')}</p>
  <div class="actions"><button type="button" class="btn btn-primary btn-wide" data-act="frame-save">${t('Use this picture')}</button></div>`;
}

// One plan meal: its picture, what goes into it, and a button to log it
export function renderPlanSheet(id) {
  const m = MEALS.find((x) => x.id === id);
  if (!m) return '';
  const has = !!(S.settings.planPhotos || {})[id];
  return `
  <header class="sheet-top"><h2 id="sheet-title">${esc(td(m.name))}</h2><button type="button" class="btn" data-act="close-sheet">${t('Close')}</button></header>
  <div class="plan-photo">${planPic(id, t('No photo yet. Take one the next time you make this.'))}</div>
  <div class="actions">
    <button type="button" class="btn" data-act="plan-photo-cam" data-id="${id}">${has ? t('Retake') : t('Take a photo')}</button>
    <button type="button" class="btn" data-act="plan-photo-lib" data-id="${id}">${t('Choose a photo')}</button>
    ${has ? `<button type="button" class="link link-danger" data-act="plan-photo-remove" data-id="${id}">${t('Remove photo')}</button>` : ''}
  </div>
  <p class="entry-value"><b>${m.kcal}</b> kcal<span>${t('{p} g protein, {c} g carbs, {f} g fat, {fib} g fibre', { p: n0(m.p), c: n0(m.c), f: n0(m.f), fib: n0(m.fib) })}</span></p>
  <table class="items-table">
    <thead><tr><th scope="col">${t('Item')}</th><th scope="col">${t('Amount')}</th><th scope="col">kcal</th></tr></thead>
    <tbody>${m.items.map((i) => `<tr><th scope="row">${esc(td(i.n))}${i.measure ? `<small>${esc(td(i.measure))}</small>` : ''}</th><td>${i.g} g</td><td>${n0(i.kcal)}</td></tr>`).join('')}</tbody>
  </table>
  <div class="actions"><button type="button" class="btn btn-primary btn-wide" data-act="log-plan-today" data-id="${id}">${t('Log for today')}</button></div>`;
}

// ——— Settings: every section starts collapsed and shows its current state in the heading ———
export function renderSettings() {
  const s = S.settings;
  const u = s.usage || { in: 0, out: 0, calls: 0, usd: 0 };
  const storage = S.storage;
  const mb = (b) => (b / 1048576).toLocaleString(LOCALE, { maximumFractionDigits: 1 });
  const places = s.places || [];
  const favorites = s.favorites || [];
  const openai = s.provider === 'openai';
  const backupAge = s.lastBackup ? diffDays(dayKey(new Date(s.lastBackup)), today()) : null;
  const backupStatus = backupAge == null ? t('No backup yet') : backupAge === 0 ? t('Last backup today') : tn('Last backup {n} day ago|Last backup {n} days ago', backupAge);
  const preset = PRESETS.find((p) => p.base === s.oaBase);
  // Where the key is sent must be visible: a preset names its provider, any other address shows its host
  let host = s.oaBase;
  try { host = new URL(s.oaBase).host; } catch { /* not an address; show it as typed */ }
  const analysisStatus = !hasKey() ? t('No key') : openai ? `${preset ? preset.name.split(' (')[0] : host}, ${s.oaModel}` : `Claude, ${(MODELS[s.model] || { name: s.model }).name.split(' (')[0]}`;
  const section = (id, title, status, body) => `<details class="setting" data-sec="${id}"${S.openSetting === id ? ' open' : ''}>
    <summary><span>${title}</span><small>${esc(status)}</small></summary>
    <div class="setting-body">${body}</div>
  </details>`;

  const analysis = `
    <p class="note">${t('Analysis goes straight from this phone to the provider you choose. The key is stored only on this device and is never written to a backup.')}</p>
    <label for="set-prov">${t('Provider')}</label>
    <select id="set-prov" data-chg="provider">
      <option value="openai"${openai ? ' selected' : ''}>${t('Gemini, OpenCode, OpenRouter (OpenAI-compatible)')}</option>
      <option value="anthropic"${openai ? '' : ' selected'}>${t('Claude (needs prepaid credit)')}</option>
    </select>
    ${openai ? `
    <label for="set-preset">${t('Preset')}</label>
    <select id="set-preset" data-chg="preset"><option value="">${t('Choose, or fill in the fields below')}</option>${PRESETS.map((p) => `<option value="${p.id}"${p.base === s.oaBase ? ' selected' : ''}>${p.name}</option>`).join('')}</select>
    <label for="set-oakey">${t('Key')}</label>
    <input id="set-oakey" type="password" autocomplete="off" autocapitalize="off" spellcheck="false" value="${esc(s.oaKey)}">
    ${preset && preset.id === 'gemini' ? `<p class="note">${t('Get a free key at aistudio.google.com with “Get API key”.')}</p>` : ''}
    <label for="set-oamodel">${t('Model')}</label>
    <input id="set-oamodel" type="text" list="oa-models" autocomplete="off" autocapitalize="off" spellcheck="false" value="${esc(s.oaModel)}" placeholder="${t('model id')}">
    <datalist id="oa-models">${ZEN_FREE.map((m) => `<option value="${m}"></option>`).join('')}</datalist>
    <label for="set-base">${t('Address')}</label>
    <input id="set-base" type="text" inputmode="url" autocomplete="off" autocapitalize="off" spellcheck="false" value="${esc(s.oaBase)}" placeholder="https://…/v1">
    <div class="actions"><button type="button" class="btn btn-primary" data-act="test-key">${t('Save and test')}</button><button type="button" class="btn" data-act="save-key">${t('Save only')}</button></div>
    <p class="note pre" id="key-test" role="status"></p>
    <p class="note">${t('If the model does not read photos: {find}. It tries the provider’s models one by one with a small test image.', { find: `<button type="button" class="link link-inline" data-act="find-vision">${t('find a model that reads photos')}</button>` })}</p>` : `
    <label for="set-key">${t('Key')}</label>
    <input id="set-key" type="password" autocomplete="off" autocapitalize="off" spellcheck="false" value="${esc(s.apiKey)}" placeholder="sk-ant-…">
    <label for="set-model">${t('Model')}</label>
    <select id="set-model">${Object.entries(MODELS).map(([k, m]) => `<option value="${k}"${s.model === k ? ' selected' : ''}>${m.name}</option>`).join('')}</select>
    <div class="actions"><button type="button" class="btn btn-primary" data-act="test-key">${t('Save and test')}</button><button type="button" class="btn" data-act="save-key">${t('Save only')}</button></div>
    <p class="note pre" id="key-test" role="status"></p>`}
    <label class="check"><input type="checkbox" data-act="review-toggle"${s.autoReview === false ? '' : ' checked'}> ${t('Review each finished day by itself')}</label>
    <p class="note">${t('One short text request a day, sent when you open the app: the day’s meals and numbers, no photos. Switched off, a review is written only when you ask for it in the Log.')}</p>
    <p class="note">${tn('So far {calls} call, {input} input and {output} output tokens.|So far {calls} calls, {input} input and {output} output tokens.', u.calls, { calls: n0(u.calls), input: n0(u.in), output: n0(u.out) })}${openai ? '' : ` ${t('Estimated cost {cost}.', { cost: `$${u.usd.toLocaleString(LOCALE, { minimumFractionDigits: 2, maximumFractionDigits: 3 })}` })}`}</p>`;

  const targets = `
    <div class="field-grid">
      <label for="set-start">${t('Start')}<input id="set-start" type="date" value="${esc(s.startDate)}"></label>
      <label for="set-end">${t('End')}<input id="set-end" type="date" value="${esc(s.targetDate)}"></label>
      <label for="set-startkg">${t('Start weight')}<input id="set-startkg" type="text" inputmode="decimal" value="${n1(s.startKg)}"></label>
      <label for="set-endkg">${t('Goal weight')}<input id="set-endkg" type="text" inputmode="decimal" value="${n1(s.targetKg)}"></label>
      <label for="set-rest">${t('Rest-day kcal')}<input id="set-rest" type="text" inputmode="numeric" value="${esc(s.kcalRest)}"></label>
      <label for="set-train">${t('Workout-day kcal')}<input id="set-train" type="text" inputmode="numeric" value="${esc(s.kcalTrain)}"></label>
      <label for="set-minday">${t('Minimum kcal')}<input id="set-minday" type="text" inputmode="numeric" value="${esc(kcalMinDay())}"></label>
      <label for="set-prot">${t('Protein (g)')}<input id="set-prot" type="text" inputmode="numeric" value="${esc(s.protein)}"></label>
    </div>
    <div class="actions"><button type="button" class="btn btn-primary" data-act="save-targets">${t('Save goals')}</button></div>`;

  const location = `
    <label class="check"><input type="checkbox" data-act="loc-toggle"${s.useLocation ? ' checked' : ''}> ${t('Use the photo’s location')}</label>
    <p class="note">${t('Location is read on the device and matched to your saved places here. The model only gets the word “Home”, “Office” or “out”; coordinates are never sent to the model (they are in your backup file). When you choose from the library, location only comes through if Location is switched on under Options in the picker.')}</p>
    <div class="actions">
      <button type="button" class="btn" data-act="loc-save" data-name="Home">${t('I am here: Home')}</button>
      <button type="button" class="btn" data-act="loc-save" data-name="Office">${t('I am here: Office')}</button>
    </div>
    <p class="note" id="loc-out" role="status">${places.length ? t('Saved places: {names}.', { names: places.map((p) => esc(p.name)).join(', ') }) : t('No saved places.')}</p>`;

  const backup = `
    <p class="note">${t('Data lives only on this device. iOS can delete web data when storage runs low; save a backup to Files once a week.')}</p>
    <div class="actions">
      <button type="button" class="btn btn-primary" data-act="export">${t('Save backup')}</button>
      <button type="button" class="btn" data-act="export-photos">${t('With photos')}</button>
      <button type="button" class="btn" data-act="import">${t('Restore from backup')}</button>
    </div>
    <input id="set-import" type="file" accept="application/json,.json" hidden>
    <p class="note">${t('For analysis on a computer: one .sql file with your days, meals and goals that loads into any SQLite database. Photos, keys and saved places are left out.')}</p>
    <div class="actions"><button type="button" class="btn" data-act="export-sql">${t('Export for SQLite')}</button></div>
    <p class="note">${S.persisted === true ? t('Persistent storage is on.') : S.persisted === false ? t('Persistent storage has not been granted yet. Adding the app to the Home Screen makes that more likely.') : ''} ${storage && storage.usage != null ? t('Space used: {mb} MB.', { mb: mb(storage.usage) }) : ''}</p>
    ${S.persisted === false ? `<div class="actions"><button type="button" class="btn" data-act="persist">${t('Request persistent storage')}</button></div>` : ''}`;

  const favoritesBody = favorites.length
    ? `<ul class="items">${favorites.map((f) => `<li><span>${esc(f.name)}, ${n0(f.kcal)} kcal</span><button type="button" class="link" data-act="favorite-remove" data-id="${esc(f.id)}">${t('Remove')}</button></li>`).join('')}</ul>`
    : `<p class="note">${t('Open an entry and tap “Add to favourites”. It then logs with one tap from the Log tab.')}</p>`;

  const supps = s.supplements || [];
  const suppEdit = supps.find((x) => x.id === S.suppEdit);
  const suppBody = `
    <p class="note">${t('The vitamins and minerals you take every day. They appear as chips on Today, and a tap ticks one for the day, so you can see at a glance what you forgot. They are not part of the daily goals.')}</p>
    ${supps.length ? `<ul class="items">${supps.map((x) => `<li><span>${esc(x.name)}${x.dose ? `, ${esc(x.dose)}` : ''}</span><span><button type="button" class="link" data-act="supp-edit" data-id="${esc(x.id)}">${t('Edit')}</button> <button type="button" class="link link-danger" data-act="supp-remove" data-id="${esc(x.id)}">${t('Remove')}</button></span></li>`).join('')}</ul>` : `<p class="note">${t('None yet.')}</p>`}
    <div class="field-grid">
      <label for="supp-name">${t('Name')}<input id="supp-name" type="text" maxlength="40" enterkeyhint="done" autocomplete="off" placeholder="${t('Magnesium')}" value="${esc(suppEdit ? suppEdit.name : '')}"></label>
      <label for="supp-dose">${t('Dose (optional)')}<input id="supp-dose" type="text" maxlength="30" enterkeyhint="done" autocomplete="off" placeholder="${t('400 mg')}" value="${esc(suppEdit ? suppEdit.dose : '')}"></label>
    </div>
    <div class="actions"><button type="button" class="btn btn-primary" data-act="supp-save">${suppEdit ? t('Save changes') : t('Add supplement')}</button>${suppEdit ? `<button type="button" class="btn" data-act="supp-cancel">${t('Cancel')}</button>` : ''}</div>`;

  const version = `
    <p class="note">${t('The app looks for a new version when it opens and when it comes to the front; if it finds one it reloads. Your entries are not affected.')}</p>
    <div class="actions"><button type="button" class="btn btn-primary" data-act="check-update">${t('Check for updates')}</button><button type="button" class="btn" data-act="hard-reload">${t('Clear cache and reload')}</button></div>
    <p class="note" id="update-out" role="status"></p>`;

  const reset = `
    <p class="note">${t('Neither can be undone. {backup}', { backup: `<button type="button" class="link link-inline" data-act="export">${t('Save a backup first')}</button>` })}</p>
    <section class="reset-card">
      <h3>${t('Clear my log')}</h3>
      <p class="note">${t('Starts your tracking over; the app stays set up as it is.')}</p>
      <dl class="reset-diff">
        <div><dt class="is-gone">${t('Deletes')}</dt><dd>${t('Meals and their photos, weigh-ins, steps, water, coffee, supplements taken, workout days, day reviews and Check verdicts.')}</dd></div>
        <div><dt class="is-kept">${t('Keeps')}</dt><dd>${t('Every setting: goals and dates, favourites, saved places, the plan’s pictures, your API key and provider, and the badges you have earned.')}</dd></div>
      </dl>
      <div class="actions"><button type="button" class="btn btn-danger" data-act="wipe">${t('Clear my log')}</button></div>
    </section>
    <section class="reset-card">
      <h3>${t('Factory reset')}</h3>
      <p class="note">${t('Back to how the app was on its first launch.')}</p>
      <dl class="reset-diff">
        <div><dt class="is-gone">${t('Deletes')}</dt><dd>${t('Everything above, plus your goals and dates, favourites, saved places, the plan’s pictures, the usage totals and your other settings. The getting-started steps come back.')}</dd></div>
        <div><dt class="is-kept">${t('Keeps')}</dt><dd>${t('Nothing, except your API key and provider if the box is ticked.')}</dd></div>
      </dl>
      <label class="check"><input type="checkbox" id="keep-key" checked> ${t('Keep my API key and provider')}</label>
      <div class="actions"><button type="button" class="btn btn-danger btn-danger-solid" data-act="wipe-all">${t('Factory reset')}</button></div>
      <p class="note">${t('You will be asked to type {word}.', { word: t('DELETE', { $id: 'reset.word' }) })}</p>
    </section>`;

  // The language control: the two names and the heading are written in both languages and never translated.
  const lang = getLang() === 'tr' ? 'tr' : 'en'; // the language on the screen, which is English when the Turkish text could not be loaded
  const langBody = `
    <div class="seg" role="group" aria-label="${t('Language')}">
      <button type="button" lang="en" data-act="lang" data-lang="en" aria-pressed="${lang === 'en'}">English</button>
      <button type="button" lang="tr" data-act="lang" data-lang="tr" aria-pressed="${lang === 'tr'}">Türkçe</button>
    </div>
    <p class="note">${t('The change applies at once. Your entries are not changed.')}</p>`;
  const langSection = section('language', 'Language / Dil', lang === 'tr' ? 'Türkçe' : 'English', langBody) + '\n    '; // i18n-ok: the heading names both languages

  return `
  <header class="sheet-top"><h2 id="sheet-title">${t('Settings')}</h2><button type="button" class="btn" data-act="close-sheet">${t('Close')}</button></header>
  <div class="settings">
    ${langSection}${section('analysis', t('Photo and text analysis'), analysisStatus, analysis)}
    ${section('targets', t('Goals'), t('{start} kg to {end} kg by {date}', { start: n1(s.startKg), end: n1(s.targetKg), date: dShort.format(parseDay(s.targetDate)) }), targets)}
    ${section('backup', t('Backup and export'), backupStatus, backup)}
    ${section('location', t('Location'), s.useLocation ? (places.length ? t('On: {names}', { names: places.map((p) => p.name).join(', ') }) : t('On, no saved places')) : t('Off'), location)}
    ${section('favorites', t('Favourites'), favorites.length ? tn('{n} meal|{n} meals', favorites.length) : t('None yet'), favoritesBody)}
    ${section('supplements', t('Supplements'), supps.length ? supps.map((x) => x.name).join(', ') : t('None yet'), suppBody)}
    ${section('version', t('Version and updates'), t('Version {v}', { v: APP_VERSION }), version)}
    ${section('reset', t('Reset'), t('Clear my log, or factory reset'), reset)}
  </div>
  <footer class="brand"><img src="icons/icon.svg" width="44" height="44" alt=""><p><b>Pickle <small>v${APP_VERSION}</small></b><span>${t('Good things take time. A cucumber becomes a pickle through time and steady conditions, not one big effort, and that is what the app asks of you: a steady average along your line, day after day.')}</span><span>${t('Entries, photos and settings are stored on this device. Photos and text you send for analysis go to the provider you chose.')}</span></p></footer>`;
}

// The toast for new badge steps ([[id, threshold, day], ...]): one badge shows its mark, name and finish; several collapse into one line with their names.
// null when there is nothing to tell. `id` is the badge to open for a single one; several open the collection.
export function unlockToast(news) {
  const { ids, one } = unlockSummary(news);
  if (!ids.length) return null;
  if (one) {
    const b = BY_ID[one.id];
    return { id: one.id, msg: badgeName(one.id), sub: b.steps.length > 1 ? td(FINISH_NAME[one.step]) : t('New badge'), mark: badgeSvg(one.id, { step: one.step, state: 'earned', size: 40, label: '' }) };
  }
  const shown = ids.slice(0, 3).map(badgeName).join(', ');
  return { id: '', msg: tn('{n} new badge|{n} new badges', ids.length), sub: ids.length > 3 ? t('{names} and more', { names: shown }) : shown, mark: '' };
}
