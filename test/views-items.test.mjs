// View-level rules of the entry sheet's item table (language English): which columns rest, which label the rest row
// carries, when the share-% chips render and that no render ever rewrites storage. `node --test` with the core as
// plain imports, like test/screens.mjs: nothing here needs the DOM.
process.env.TZ = 'UTC';
import { test } from 'node:test';
import assert from 'node:assert/strict';
const core = await import('../js/core.js');
const views = await import('../js/views.js');
const { buildPlan } = await import('../js/plan.js');
const { default: seedPlan } = await import('../js/default-plan.js');
const { S, freshSettings, REST_KCAL, REST_MACROS } = core;

assert.equal(REST_KCAL, 5);
assert.equal(REST_MACROS, 2);
S.tab = 'today';
S.sheet = null;
S.settings = freshSettings();
S.plans = { active: 'default', list: [seedPlan] };
S.plan = buildPlan(seedPlan);
S.entries = [];
let n = 0;
const put = (extra = {}) => {
  const e = { id: `v${++n}`, day: '2026-10-21', ts: Date.parse('2026-10-21T08:00:00Z'), kind: 'meal', status: 'ok', slot: 'lunch', title: 'Test meal', kcal: 0, p: 0, c: 0, f: 0, fib: 0, mult: 1, tier: 'plan', flags: [], items: [], ...extra };
  S.entries.push(e);
  return e;
};
const render = (e) => views.renderEntrySheet(e.id);
const restRow = (html) => /<tr class="items-rest">[\s\S]*?<\/tr>/.exec(html)?.[0] || '';
const CHIP = 'Share of the meal';

test('thresholds: a residual below the rest thresholds keeps its rest cell empty even though a passing column in the same rest row renders', () => {
  const e = put({ kcal: 100, p: 20, c: 10, items: [{ n: 'oats', g: 50, kcal: 48, p: 8, c: 4 }, { n: 'milk', g: 100, kcal: 48, p: 8, c: 4 }] });
  // kcal residual 4 < REST_KCAL (hidden); p residual 4 and c residual 2 ≥ REST_MACROS (shown): the row renders, the kcal cell stays empty
  const row = restRow(render(e));
  assert.match(row, /<th scope="row">Estimate gap<\/th><td><\/td><td><\/td><td>\+4 g<\/td><td>\+2 g<\/td>/);
  assert.ok(!row.includes('items-kcal'), 'the kcal rest cell below its threshold must stay an empty cell');
});

test('label trifecta: a manual kcal edit → Your edit, a macro-only gap → Estimate gap, a kcal-only unedited gap → Not itemised', () => {
  const edited = put({ kcal: 200, edited: true, items: [{ n: 'egg', g: 100, kcal: 100 }] });
  assert.match(render(edited), /<th scope="row">Your edit<\/th>/);
  const macroOnly = put({ kcal: 100, p: 20, c: 10, items: [{ n: 'oats', g: 50, kcal: 96, p: 0, c: 0 }] }); // kcal 4 < REST_KCAL stays hidden
  assert.match(render(macroOnly), /<th scope="row">Estimate gap<\/th>/);
  const kcalOnly = put({ kcal: 200, items: [{ n: 'egg', g: 100, kcal: 100 }] });
  assert.match(render(kcalOnly), /<th scope="row">Not itemised<\/th>/);
});

test('denominator branch: with items overshooting the total every chip stays at or under 100 percent', () => {
  const e = put({ kcal: 100, items: [{ n: 'a', g: 10, kcal: 80 }, { n: 'b', g: 10, kcal: 50 }] }); // items sum 130 > 100, rest −30
  // Chips render wherever more than one kcal-carrying item is shown — with or without a rest row; the lone-item rule below is what suppresses them
  const html = render(e);
  const pcts = [...html.matchAll(new RegExp(`title="${CHIP}">(?:−)?(\\d+)%<`, 'g'))].map((m) => Number(m[1]));
  assert.ok(pcts.length >= 3, 'two item chips and the rest chip should render');
  assert.ok(pcts.every((x) => x <= 100), `chips must not exceed 100%: ${pcts}`);
  assert.match(restRow(html), /−30/); // the overshoot rest renders negative
});

test('lone-item rule: one kcal-carrying item with no rest row gets no chip, and the same entry with a gap gets one', () => {
  const exact = put({ kcal: 100, items: [{ n: 'yoghurt', g: 150, kcal: 100 }] }); // items make up the whole meal: no rest, chip skipped
  assert.ok(!render(exact).includes(CHIP));
  const gapped = put({ kcal: 200, items: [{ n: 'yoghurt', g: 150, kcal: 100 }] }); // rest 100: the row is there, so the chip is too
  const html = render(gapped);
  assert.match(html, new RegExp(`<small title="${CHIP}">50%</small>`));
  assert.match(restRow(html), /\+100/);
});

test('falsey kcal: a stored-0 kcal item prints an en dash and gets no chip', () => {
  const e = put({ kcal: 200, items: [{ n: 'still water', g: 500, kcal: 0 }, { n: 'egg', g: 100, kcal: 200 }] });
  const html = render(e);
  assert.match(html, /<tr><th scope="row">still water<\/th><td>500 g<\/td><td class="items-kcal">–<\/td><\/tr>/);
  assert.ok(!html.includes(CHIP));
});

test('storage order: rendering never rewrites e.items or the plan meal m.items, the sorted copy stays a copy', () => {
  const e = put({ kcal: 300, items: [{ n: 'egg', g: 100, kcal: 143 }, { n: 'bread', g: 60, kcal: 157 }, { n: 'tea', kcal: 0 }] });
  const before = JSON.stringify(e.items);
  const htmlFor = () => render(e);
  htmlFor(); htmlFor(); const last = htmlFor(); // several renders back to back
  assert.equal(JSON.stringify(e.items), before);
  assert.ok(last.indexOf('bread') < last.indexOf('egg'), 'the display sorts by kcal, biggest first, so bread prints before egg');
  const m = S.plan.meals.find((meal) => meal.items.length >= 3);
  const planBefore = JSON.stringify(m.items);
  views.renderPlanSheet(m.id);
  views.renderPlanSheet(m.id);
  assert.equal(JSON.stringify(m.items), planBefore);
});
