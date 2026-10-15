// A backup file comes from outside the app. Everything read from one is checked and given the right
// type and size before it is stored or shown, so a damaged or hostile file cannot break the screens.
// Pure functions: no DOM and no storage.
import { T, parseNum } from './i18n.js';
import { SLOT_NAME, PLAN_SLOTS } from './plan.js';
import { cleanReview, cleanCoach, cleanVerdict } from './ai.js';
import { CATALOG, BY_ID, PARTS, DEFAULT_AV, merge, unlocked, freshBadges } from './badges.js';
import { SCHEMA_VERSION, APP_ID, COUNT_MAX, SUPP_MAX, TK_KINDS, tkValid } from './core.js';

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const ID_RE = /^[\w-]{1,40}$/;
const TIERS = ['plan', 'flex', 'off'];
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const pos = (v, max) => (isNum(v) ? Math.max(0, Math.min(max, v)) : 0);
const orNull = (v, max) => (isNum(v) ? Math.max(0, Math.min(max, v)) : null);
const txt = (v, n = 400) => (typeof v === 'string' ? v.slice(0, n) : '');
const oneOf = (v, list, def) => (list.includes(v) ? v : def);
const isDay = (v) => typeof v === 'string' && DAY_RE.test(v) && !Number.isNaN(Date.parse(v));
const isId = (v) => typeof v === 'string' && ID_RE.test(v);
const plain = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
// A key that is looked up in a plain object: never one of Object.prototype's own names ("constructor", "toString")
const ownSafe = (k) => typeof k === 'string' && !(k in Object.prototype);
const MEAL_ID_MAX = 40;
const MEAL_ID = new RegExp(`^[A-Za-z][\\w-]{0,${MEAL_ID_MAX - 1}}$`);
const isMealId = (k) => ownSafe(k) && MEAL_ID.test(k);
const PLAN_PHOTOS_MAX = 200;
const flagList = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === 'string').map((x) => x.slice(0, 20)).slice(0, 4) : []);
const itemList = (v) => (Array.isArray(v) ? v : []).slice(0, 12).map((i) => ({ n: txt(i && i.n, 80), g: pos(i && i.g, 5000), kcal: pos(i && i.kcal, 6000), p: pos(i && i.p, 500) }));

// The recipe of a generated title (see titleOf in js/core.js): a known kind and a few plain parameters. Anything else is dropped,
// and the entry keeps its English title.
const TK_PARAMS = ['kg', 'steps', 'id'];
function cleanTk(tk) {
  if (!tk || typeof tk !== 'object' || !TK_KINDS.includes(tk.kind)) return null;
  const p = tk.params;
  if (!p || typeof p !== 'object' || Array.isArray(p)) return null;
  const params = {};
  for (const k of Object.keys(p)) {
    const v = p[k];
    if (!TK_PARAMS.includes(k) || !((typeof v === 'string' && v.length <= 40) || (isNum(v) && Math.abs(v) <= 1e7))) return null;
    params[k] = v;
  }
  return tkValid({ kind: tk.kind, params }) ? { kind: tk.kind, params } : null;
}

// Why a file cannot be restored, or '' when it can be tried
export function backupProblem(data) {
  if (!data || typeof data !== 'object' || data.app !== APP_ID || !Array.isArray(data.entries)) return T('This is not a Pickle backup');
  if (!Number.isInteger(data.v)) return T('This backup has no valid version number, so it cannot be restored');
  if (data.v > SCHEMA_VERSION) return T('This backup is from a newer version of Pickle. Update the app first');
  return '';
}

export function b64FromBuf(buf) {
  const u8 = new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
  return btoa(s);
}
function bufFromB64(b64) {
  const bin = atob(b64);
  const u8 = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  return u8.buffer;
}

// Returns the entry with every field the app uses, or null when it has no usable id, day and time
export function cleanEntry(e) {
  if (!e || typeof e !== 'object' || !isId(e.id) || !isDay(e.day) || !isNum(e.ts)) return null;
  const out = {
    id: e.id, ts: e.ts, day: e.day, createdAt: pos(e.createdAt, 1e14),
    kind: oneOf(e.kind, ['meal', 'weight', 'steps'], 'meal'),
    status: oneOf(e.status, ['ok', 'pending', 'error'], 'error'),
    src: txt(e.src, 20), text: txt(e.text), title: txt(e.title, 80), err: txt(e.err, 300),
    slot: oneOf(e.slot, Object.keys(SLOT_NAME), 'dinner'), planId: txt(e.planId, MEAL_ID_MAX), items: itemList(e.items),
    kcal: pos(e.kcal, 6000), p: pos(e.p, 500), c: pos(e.c, 800), f: pos(e.f, 500), fib: pos(e.fib, 150),
    tier: oneOf(e.tier, TIERS, 'plan'), flags: flagList(e.flags), conf: pos(e.conf, 1), q: txt(e.q, 160),
    mult: isNum(e.mult) && e.mult > 0 ? Math.min(10, e.mult) : 1,
    photoIds: (Array.isArray(e.photoIds) ? e.photoIds : []).filter(isId).slice(0, 6),
    timeSrc: oneOf(e.timeSrc, ['now', 'exif', 'file', 'manual'], 'now'),
    place: typeof e.place === 'string' ? e.place.slice(0, 40) : null,
    edited: e.edited === true, model: txt(e.model, 60),
  };
  // Weigh-ins and step counts carry only the fields they had
  if (out.kind !== 'meal') for (const k of Object.keys(out)) if (e[k] === undefined) delete out[k];
  const tk = cleanTk(e.tk);
  if (tk) out.tk = tk;
  if (e.kg != null) out.kg = orNull(e.kg, 400);
  if (e.steps != null) out.steps = orNull(e.steps, 200000);
  return out;
}

export function cleanDay(d) {
  if (!d || typeof d !== 'object' || !isDay(d.day)) return null;
  const out = { day: d.day, kg: orNull(d.kg, 400), steps: orNull(d.steps, 200000), water: pos(d.water, 20000), train: d.train === true,
    coffee: isNum(d.coffee) ? Math.round(pos(d.coffee, COUNT_MAX)) : null };
  if (Array.isArray(d.taken)) out.taken = [...new Set(d.taken.filter(isId))].slice(0, SUPP_MAX);
  if (d.review && typeof d.review === 'object') {
    const r = cleanReview(d.review);
    if (r.head) out.review = { ...r, ts: pos(d.review.ts, 1e14), sig: txt(d.review.sig, 4000), live: d.review.live === true, model: txt(d.review.model, 60) };
  }
  if (d.coach && typeof d.coach === 'object') {
    const c = cleanCoach(d.coach);
    if (c.note) out.coach = { ...c, ts: pos(d.coach.ts, 1e14), sig: txt(d.coach.sig, 4000), model: txt(d.coach.model, 60) };
  }
  return out;
}

export function cleanCheck(c) {
  if (!c || typeof c !== 'object' || !isId(c.id) || !isNum(c.ts)) return null;
  return { id: c.id, ts: c.ts, ...cleanVerdict(c), note: txt(c.note, 300), photos: Math.round(pos(c.photos, 4)), model: txt(c.model, 60) };
}

// A photo with its bytes decoded, or null when it is damaged. Stored photos are always JPEG, whatever the file claims.
export function cleanPhoto(p) {
  if (!p || typeof p !== 'object' || !isId(p.id) || typeof p.b64 !== 'string') return null;
  let buf;
  try { buf = bufFromB64(p.b64); } catch { return null; }
  const out = { id: p.id, buf, type: 'image/jpeg', w: Math.round(pos(p.w, 10000)), h: Math.round(pos(p.h, 10000)) };
  if (isMealId(p.plan)) out.plan = p.plan; // a meal id of any plan, so only its shape is checked
  return out;
}

function cleanFavorite(f) {
  if (!f || typeof f !== 'object' || !isId(f.id)) return null;
  return {
    id: f.id, name: txt(f.name, 80), slot: 'any', kcal: pos(f.kcal, 6000), p: pos(f.p, 500), c: pos(f.c, 800), f: pos(f.f, 500), fib: pos(f.fib, 150),
    tier: oneOf(f.tier, TIERS, 'plan'), flags: flagList(f.flags), items: itemList(f.items),
  };
}

// Settings that travel with a backup: the targets, favourites, saved places and the plan's pictures.
// What the app talks to (provider, address, model, keys) and its running totals stay as they are on this device,
// so a backup can never point the stored key at another server.
const RANGES = { startKg: [30, 300], targetKg: [30, 300], kcalRest: [500, 6000], kcalTrain: [500, 6000], kcalMinDay: [500, 6000], protein: [20, 400], proteinMin: [20, 400], fiber: [0, 200], steps: [0, 100000], water: [0, 10000] };
export function cleanSettings(s) {
  s = s && typeof s === 'object' ? s : {};
  const out = {};
  for (const k of ['startDate', 'targetDate']) if (isDay(s[k])) out[k] = s[k];
  for (const [k, [lo, hi]] of Object.entries(RANGES)) if (isNum(s[k]) && s[k] >= lo && s[k] <= hi) out[k] = s[k];
  if (out.kcalMinDay > out.kcalRest) delete out.kcalMinDay; // a minimum above the budget would leave no day on plan
  for (const k of ['useLocation', 'hideStart', 'autoReview']) if (typeof s[k] === 'boolean') out[k] = s[k];
  if (s.lang === 'en' || s.lang === 'tr') out.lang = s.lang;
  if (Array.isArray(s.places)) {
    out.places = s.places.filter((p) => p && typeof p.name === 'string' && isNum(p.lat) && isNum(p.lon) && Math.abs(p.lat) <= 90 && Math.abs(p.lon) <= 180)
      .slice(0, 10).map((p) => ({ name: p.name.slice(0, 40), lat: p.lat, lon: p.lon }));
  }
  if (Array.isArray(s.supplements)) {
    const seen = new Set();
    out.supplements = s.supplements.filter((x) => x && isId(x.id) && txt(x.name, 40).trim() && !seen.has(x.id) && seen.add(x.id))
      .slice(0, SUPP_MAX).map((x) => ({ id: x.id, name: txt(x.name, 40).trim(), dose: txt(x.dose, 30).trim() }));
  }
  if (Array.isArray(s.favorites)) out.favorites = s.favorites.slice(0, 50).map(cleanFavorite).filter(Boolean);
  if (s.planPhotos && typeof s.planPhotos === 'object') {
    out.planPhotos = Object.fromEntries(Object.entries(s.planPhotos).filter(([meal, id]) => isMealId(meal) && isId(id)).slice(0, PLAN_PHOTOS_MAX));
  }
  if (s.wins && typeof s.wins === 'object') out.wins = { kilos: Math.round(pos(s.wins.kilos, 1000)), perfect: isDay(s.wins.perfect) ? s.wins.perfect : '' };
  return out;
}

// ——— Plans (kv `plans`: { active, list: [the Default seed, My plan] }) ———
// The limits of a user plan. A save over one is refused; a file is trimmed to them.
export const PLAN_CAPS = { grams: 5000, kcal: 1000, per100: 100, ingredients: 12, name: 60, measure: 30, meals: 100, foods: 300 };
const PLAN_ID = /^P-[\w-]{1,38}$/;
const FOOD_KEY = /^[A-Za-z][\w-]{0,39}$/;
const isFoodKey = (k) => ownSafe(k) && FOOD_KEY.test(k);
const clean1 = (v) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ').replace(/\s+/g, ' ').trim() : '');

// One user plan, checked for both a save and a restore. Returns { plan, changed }: plan is null when nothing usable is left
// (no user plan id), and changed says that something was dropped, cut or clamped to get it. A save takes only an unchanged plan,
// so it never loses data; a restore takes the cleaned one. Spaces are tidied without counting as a change. Never throws.
export function cleanPlan(raw) {
  if (!plain(raw) || typeof raw.id !== 'string' || !PLAN_ID.test(raw.id)) return { plan: null, changed: true };
  let changed = false;
  const text = (v, max) => {
    const x = clean1(v);
    if (x.length > max) changed = true;
    return x.slice(0, max);
  };
  const clamp = (x, lo, hi) => {
    const y = Math.min(hi, Math.max(lo, x));
    if (y !== x) changed = true;
    return y;
  };
  const foods = {};
  let nFoods = 0;
  for (const [key, f] of Object.entries(plain(raw.foods) ? raw.foods : {})) {
    const name = plain(f) ? text(f.name, PLAN_CAPS.name) : '';
    if (nFoods >= PLAN_CAPS.foods || !isFoodKey(key) || !name || !Array.isArray(f.v) || f.v.length !== 5 || !f.v.every(isNum)) { changed = true; continue; }
    foods[key] = { name, v: f.v.map((x, i) => clamp(x, 0, i === 0 ? PLAN_CAPS.kcal : PLAN_CAPS.per100)) };
    nFoods += 1;
  }
  if (raw.foods !== undefined && !plain(raw.foods)) changed = true;
  const meals = [];
  const seen = new Set();
  for (const m of Array.isArray(raw.meals) ? raw.meals : []) {
    const name = plain(m) ? text(m.name, PLAN_CAPS.name) : '';
    if (meals.length >= PLAN_CAPS.meals || !name || !isMealId(m.id) || seen.has(m.id) || !PLAN_SLOTS.includes(m.slot)) { changed = true; continue; }
    const rows = Array.isArray(m.ingredients) ? m.ingredients : [];
    if (!Array.isArray(m.ingredients) || rows.length > PLAN_CAPS.ingredients) changed = true;
    const ingredients = [];
    for (const row of rows.slice(0, PLAN_CAPS.ingredients)) {
      if (!Array.isArray(row) || !Object.hasOwn(foods, row[0]) || !isNum(row[1])) { changed = true; continue; }
      if (row.length > 3 || (row[2] !== undefined && typeof row[2] !== 'string')) changed = true;
      const g = clamp(row[1], 1, PLAN_CAPS.grams);
      const measure = text(row[2], PLAN_CAPS.measure);
      ingredients.push(measure ? [row[0], g, measure] : [row[0], g]);
    }
    seen.add(m.id);
    meals.push({ id: m.id, slot: m.slot, name, ingredients });
  }
  if (!Array.isArray(raw.meals)) changed = true;
  return { plan: { id: raw.id, name: text(raw.name, PLAN_CAPS.name) || T('My plan'), foods, meals }, changed };
}

// What the meal editor holds, read for a save: the name and the rows as typed (grams a number or typed text, decimal comma
// allowed), grams rounded to 0.1 (as stored, so an untouched 100.5 stays) so that cleanPlan passes a valid save unchanged. bad marks what is typed and wrong
// (an empty field is not marked); valid needs a name, at least one ingredient, and every row's grams from 1 to 5,000.
export function readMeal(meal) {
  const name = clean1(meal.name);
  const rows = Array.isArray(meal.ingredients) ? meal.ingredients : [];
  const bad = { name: name.length > PLAN_CAPS.name, rows: [] };
  const ingredients = [];
  for (const [food, g, measure] of rows) {
    const typed = String(g ?? '').trim();
    const grams = Math.round((typeof g === 'number' ? g : parseNum(typed)) * 10) / 10;
    const ok = grams >= 1 && grams <= PLAN_CAPS.grams;
    const m = clean1(measure);
    bad.rows.push({ g: !!typed && !ok, m: m.length > PLAN_CAPS.measure });
    if (ok) ingredients.push(m ? [food, grams, m] : [food, grams]);
  }
  const valid = !!name && !bad.name && rows.length > 0 && rows.length <= PLAN_CAPS.ingredients && ingredients.length === rows.length && !bad.rows.some((r) => r.m);
  return { meal: { id: meal.id, slot: meal.slot, name, ingredients }, bad, valid };
}

// What the food form holds, read for Done: the name and the five values per 100 g (numbers, or text as typed with a decimal
// comma allowed), kcal rounded to whole numbers and the rest to 0.1, so that cleanPlan passes the food unchanged. bad marks what
// is typed and wrong (an empty field is not marked); valid needs a name and all five values in range (kcal 0–1,000, the rest 0–100).
export function readFood(form) {
  const name = clean1(form.name);
  const bad = { name: name.length > PLAN_CAPS.name, v: [] };
  const v = [];
  for (let i = 0; i < 5; i++) {
    const raw = Array.isArray(form.v) ? form.v[i] : '';
    const typed = String(raw ?? '').trim();
    const x = typeof raw === 'number' ? raw : parseNum(typed);
    const r = i === 0 ? Math.round(x) : Math.round(x * 10) / 10;
    const ok = r >= 0 && r <= (i === 0 ? PLAN_CAPS.kcal : PLAN_CAPS.per100);
    bad.v.push(!!typed && !ok);
    v.push(ok ? r : null);
  }
  const valid = !!name && !bad.name && v.every((x) => x !== null);
  return { food: { name, v }, bad, valid };
}

// The plan a meal editor save writes: the draft plan with the meal put in (replacing the one with its id, else added at the end)
// or, with remove, taken out. A copy of Default becomes My plan under newId. The input is not changed.
export function planFromDraft(plan, meal, { remove = false, newId } = {}) {
  const at = plan.meals.findIndex((m) => m.id === meal.id);
  const meals = remove ? plan.meals.filter((m) => m.id !== meal.id) : at < 0 ? [...plan.meals, meal] : plan.meals.map((m, i) => (i === at ? meal : m));
  return plan.id === 'default' ? { ...plan, id: newId, name: T('My plan'), meals } : { ...plan, meals };
}

// The plan a meal editor save writes, built on the plans stored now (record), not on the draft's copy, so that a write while
// the editor was open stays: only the draft's meal and the foods it added or changed (against draft.base) are put in. Null, and
// the save is refused, when the plan the draft started from is gone (My plan replaced or deleted) or a draft of Default would
// now meet a user plan. The inputs are not changed.
export function savedPlan(record, draft, meal, { remove = false, newId } = {}) {
  const user = record.list.find((p) => p.id !== 'default');
  const current = draft.plan.id === 'default' ? (user ? null : record.list[0]) : record.list.find((p) => p.id === draft.plan.id);
  if (!current) return null;
  const base = plain(draft.base) ? draft.base : {};
  const changed = Object.entries(draft.plan.foods).filter(([k, f]) => !Object.hasOwn(base, k) || JSON.stringify(base[k]) !== JSON.stringify(f));
  const plan = JSON.parse(JSON.stringify(current));
  const saved = planFromDraft({ ...plan, foods: Object.fromEntries([...Object.entries(plan.foods), ...JSON.parse(JSON.stringify(changed))]) }, meal, { remove, newId });
  // a food the draft added (in neither draft.base nor the stored plan) that no meal uses is not kept; earlier foods always are
  const used = new Set(saved.meals.flatMap((m) => m.ingredients.map((i) => i[0])));
  const drop = changed.map(([k]) => k).filter((k) => !Object.hasOwn(base, k) && !Object.hasOwn(plan.foods, k) && !used.has(k));
  return drop.length ? { ...saved, foods: Object.fromEntries(Object.entries(saved.foods).filter(([k]) => !drop.includes(k))) } : saved;
}

// An earlier build stored (and backed up) the plans as a bare list of user plans, with the active id in settings.activePlan
const plansShape = (raw, oldActive) => (Array.isArray(raw) ? { active: oldActive, list: raw } : plain(raw) ? raw : {});

// The plans of a backup file ({ active, list }, or the older bare list with oldActive from its settings.activePlan): one user
// plan only, cleaned, and the active id when that plan exists. In the older bare list the plan that was active is kept, else
// the first usable one; a plan with no foods and no meals is not usable there, so it does not become an empty My plan.
export function cleanPlans(raw, oldActive) {
  const r = plansShape(raw, oldActive);
  const old = Array.isArray(raw);
  const usable = [];
  for (const p of Array.isArray(r.list) ? r.list : []) {
    const user = cleanPlan(p).plan;
    if (user && old && !user.meals.length && !Object.keys(user.foods).length) continue;
    if (user) usable.push(user);
    if (user && !old) break;
  }
  const user = (old && usable.find((p) => p.id === r.active)) || usable[0] || null;
  return { active: user && r.active === user.id ? user.id : 'default', list: user ? [user] : [] };
}

// The record to store: Default always from the seed (never from the caller's list), then the user plan given, unchanged by
// cleanPlan. Null when that plan would not pass unchanged, so a save never drops anything. An unknown active id is 'default'.
export function plansRecord(seed, list, active) {
  const given = (Array.isArray(list) ? list : []).find((p) => !(p && p.id === 'default'));
  let user = null;
  if (given !== undefined) {
    const r = cleanPlan(given);
    if (!r.plan || r.changed) return null;
    user = r.plan;
  }
  return { active: user && active === user.id ? user.id : 'default', list: user ? [seed, user] : [seed] };
}

// The plan a record makes active (Default for an unknown id)
export const activePlan = (record) => record.list.find((p) => p.id === record.active) || record.list[0];

// What load makes of the stored record: Default is the seed as shipped, the user plan stays as stored when it is sound
// (a damaged one is cleaned). rewrite is true when the record on the device differs from that, e.g. after an update changed the seed
// or when it is the older bare list of user plans (oldActive is then settings.activePlan).
export function loadedPlans(stored, seed, oldActive) {
  const { list, active } = cleanPlans(stored, oldActive);
  const record = plansRecord(seed, list, active);
  return { record, rewrite: JSON.stringify(record) !== JSON.stringify(stored) };
}

// The plan pictures to keep from next (only meal ids some stored plan holds), and the photo ids that are no longer
// referred to: any value of prev or next that the kept map does not hold. A photo shared by two meals stays while one keeps it.
export function sweepPlanPhotos(prev, next, record) {
  const known = new Set(record.list.flatMap((p) => p.meals.map((m) => m.id)));
  const planPhotos = Object.fromEntries(Object.entries(plain(next) ? next : {}).filter(([meal, id]) => isMealId(meal) && known.has(meal) && isId(id)).slice(0, PLAN_PHOTOS_MAX));
  const kept = new Set(Object.values(planPhotos));
  const all = [...Object.values(plain(prev) ? prev : {}), ...Object.values(plain(next) ? next : {})];
  return { planPhotos, gone: [...new Set(all)].filter((id) => isId(id) && !kept.has(id)) };
}

// Earned badges, from the stored copy or a backup: only catalog ids, steps on the ladder and real calendar days survive, and a worn
// part the badges do not unlock falls back to the default. Never throws, whatever it is given.
export function cleanBadges(raw) {
  const out = freshBadges();
  if (!plain(raw)) return out;
  if (plain(raw.got)) {
    const got = {};
    for (const id of Object.keys(BY_ID)) if (Object.hasOwn(raw.got, id) && plain(raw.got[id])) got[id] = Object.fromEntries(Object.entries(raw.got[id]).slice(0, 20));
    out.got = merge(got, {}); // merge keeps the steps that are on the ladder and the days that exist
  }
  if (plain(raw.seen)) {
    for (const b of CATALOG) if (Object.hasOwn(raw.seen, b.id) && b.steps.includes(raw.seen[b.id])) out.seen[b.id] = raw.seen[b.id];
  }
  if (raw.told === true) out.told = true;
  if (plain(raw.av)) {
    for (const slot of Object.keys(DEFAULT_AV)) {
      const p = raw.av[slot];
      if (typeof p === 'string' && Object.hasOwn(PARTS, p) && PARTS[p].slot === slot && unlocked(p, out.got)) out.av[slot] = p;
    }
  }
  const b = plain(raw.base) ? raw.base : null;
  if (b && [b.startKg, b.targetKg].every((x) => isNum(x) && x >= RANGES.startKg[0] && x <= RANGES.startKg[1])) out.base = { startKg: b.startKg, targetKg: b.targetKg };
  return out;
}

// The stored badges (or null) together with those of a backup: union of what is earned (earliest day wins), the highest step seen,
// the worn parts and the frozen weights of this device when it has them
export function restoreBadges(current, incoming) {
  const a = current ? cleanBadges(current) : null;
  const b = cleanBadges(incoming);
  const seen = { ...b.seen };
  if (a) for (const [id, n] of Object.entries(a.seen)) seen[id] = Math.max(n, seen[id] || 0);
  return cleanBadges({ got: merge(a && a.got, b.got), seen, told: !!(a && a.told) || b.told, av: a ? a.av : b.av, base: (a && a.base) || b.base });
}
