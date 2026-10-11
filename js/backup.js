// A backup file comes from outside the app. Everything read from one is checked and given the right
// type and size before it is stored or shown, so a damaged or hostile file cannot break the screens.
// Pure functions: no DOM and no storage.
import { T } from './i18n.js';
import { MEAL_BY_ID, SLOT_NAME, has } from './plan.js';
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
    slot: oneOf(e.slot, Object.keys(SLOT_NAME), 'dinner'), planId: txt(e.planId, 20), items: itemList(e.items),
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
  if (typeof p.plan === 'string' && has(MEAL_BY_ID, p.plan)) out.plan = p.plan;
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
    out.planPhotos = Object.fromEntries(Object.entries(s.planPhotos).filter(([meal, id]) => has(MEAL_BY_ID, meal) && isId(id)));
  }
  if (s.wins && typeof s.wins === 'object') out.wins = { kilos: Math.round(pos(s.wins.kilos, 1000)), perfect: isDay(s.wins.perfect) ? s.wins.perfect : '' };
  return out;
}

// Earned badges, from the stored copy or a backup: only catalog ids, steps on the ladder and real calendar days survive, and a worn
// part the badges do not unlock falls back to the default. Never throws, whatever it is given.
const plain = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
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
