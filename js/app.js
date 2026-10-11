import * as db from './db.js';
import { settle, viewed, unseenAdded, serial, wear } from './badges.js';
import { setLang, getLang, storedLang, rememberLang, applyStatic, t, tn, td, foldKey } from './i18n.js';
import { canRun, installHtml } from './standalone.js';
import { buildSql, exportName } from './export.js';
import * as picture from './picture.js';
import { readMeta, placeLabel } from './exif.js';
import { analyze, review, coach, check, CHECK_EDGE, shrink, costUSD, probeVision, listModels, AI_ERRORS, AI_ERROR_LABEL, WAITING, errorDetail, STRONG_MODEL, PRESETS, ZEN_FREE } from './ai.js';
import { reviewBrief, coachBrief, checkBrief } from './briefs.js';
import { backupProblem, cleanEntry, cleanDay, cleanCheck, cleanPhoto, cleanSettings, cleanBadges, restoreBadges, b64FromBuf } from './backup.js';
import { MEAL_BY_ID, SLOTS, SLOT_NAME, FLEX, slotByTime, dayKey, parseDay, addDays, has, DEFAULTS } from './plan.js';
import {
  APP_VERSION, SCHEMA_VERSION, APP_ID, freshSettings, freshCheck, S, aiCfg, hasKey, today, eff, dayTotals, isPerfect, suppTaken, SUPP_MAX, kilosDown, dayVerdict, verdictText, reviewSig, fmtInt, CHECK_MAX, checkReady, COUNT_MAX, parseLocal, titleFor, titleOf,
} from './core.js';
import { renderToday, renderLog, renderCheck, renderProgress, renderPlan, renderSettings, renderEntrySheet, renderNumSheet, renderSlotSheet, renderPlanSheet, renderBadgeSheet, renderAvatarSheet, badgeContext, unlockToast, renderFrameSheet, attachChart } from './views.js';

const $ = (s, r = document) => r.querySelector(s);


// ——— Storage ———
async function saveSettings() { S.rev++; rememberLang(S.settings.lang); await db.kvSet('settings', S.settings); }
// Switches the interface language and says whether it worked. When the text cannot be loaded (offline before it was cached)
// the screen stays in the language it had; the saved preference is never touched here, so the next start tries again.
async function applyLang(lang) {
  try { await setLang(lang); applyStatic(); return true; } catch { toast(t('Could not load that language. Try again when you are online.')); return false; }
}
async function saveDay(day, patch) {
  const d = { ...(S.days[day] || { day }), ...patch };
  S.days[day] = d;
  S.rev++;
  await db.put('days', d);
}
async function saveEntry(e) {
  const i = S.entries.findIndex((x) => x.id === e.id);
  if (i >= 0) S.entries[i] = e; else S.entries.push(e);
  S.rev++;
  await db.put('entries', e);
}

let toastTimer;
// rich: {mark, sub} puts a badge mark before the text and a second line under it
export function toast(msg, action, rich) {
  const el = $('#toast');
  const live = $('#toast-live');
  live.textContent = '';
  const said = rich ? `${msg}. ${rich.sub}` : msg;
  setTimeout(() => { live.textContent = action ? t('{msg}. {label} is available.', { msg: said, label: action.label }) : said; }, 50); // a change after a pause is announced even when the text repeats
  el.innerHTML = '';
  const sp = document.createElement('span');
  if (rich) {
    if (rich.mark) { const m = document.createElement('span'); m.className = 'toast-mark'; m.setAttribute('aria-hidden', 'true'); m.innerHTML = rich.mark; el.append(m); }
    const b = document.createElement('b');
    b.textContent = msg;
    const sub = document.createElement('small');
    sub.textContent = rich.sub;
    sp.className = 'toast-text';
    sp.append(b, sub);
  } else sp.textContent = msg;
  el.append(sp);
  if (action) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = action.label;
    b.onclick = () => { el.hidden = true; guard(action.fn); };
    el.append(b);
  }
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, action ? 6000 : 3200);
}

function timestampFor(day, slotId) {
  if (day === today()) return Date.now();
  const sl = SLOTS.find((s) => s.id === slotId);
  const [h, m] = (sl ? sl.time : '12:00').split(':').map(Number);
  const d = parseDay(day);
  d.setHours(h, m, 0, 0);
  return d.getTime();
}

async function logMeal(tpl, src, day = S.viewDay) {
  const ts = timestampFor(day, tpl.slot);
  const e = {
    id: db.uid(), ts, day, createdAt: Date.now(), kind: 'meal', status: 'ok', src,
    slot: tpl.slot && tpl.slot !== 'any' ? tpl.slot : slotByTime(new Date(ts)),
    planId: src === 'plan' ? tpl.id : '', title: tpl.name, ...((src === 'plan' || src === 'flex') && tpl.id ? { tk: { kind: 'plan', params: { id: tpl.id } } } : {}),
    items: (tpl.items || []).map((i) => ({ n: i.n, g: i.g, kcal: i.kcal, p: i.p })),
    kcal: tpl.kcal, p: tpl.p, c: tpl.c, f: tpl.f, fib: tpl.fib,
    tier: tpl.tier || 'plan', flags: tpl.flags || [], conf: tpl.conf || 1, q: '', mult: 1,
    photoIds: [], timeSrc: day === today() ? 'now' : 'manual', place: null,
  };
  await saveEntry(e);
  render();
  toast(t('{name} logged', { name: td(tpl.name) }), { label: t('Undo'), fn: () => removeEntry(e.id, true) });
  return e.id;
}
// A beer, typed or tapped, goes in the late slot, so it never stands in for a planned meal. A typed count is 0.5 l each
const logBeer = (day) => logMeal({ ...FLEX.find((f) => f.id === 'F-BEER50'), slot: 'late', tier: 'flex' }, 'flex', day);

async function removeEntry(id, silent) {
  const e = S.entries.find((x) => x.id === id);
  if (!e) return;
  S.entries = S.entries.filter((x) => x.id !== id);
  S.rev++;
  if (S.sheet && S.sheet.type === 'entry' && S.sheet.id === id) closeSheet();
  await db.del('entries', id);
  for (const pid of e.photoIds || []) {
    await db.del('photos', pid);
    const u = S.urls.get(pid);
    if (u) { URL.revokeObjectURL(u); S.urls.delete(pid); }
  }
  // The day keeps the latest weigh-in or step count still in the log, if there is one
  for (const [kind, key] of [['weight', 'kg'], ['steps', 'steps']]) {
    if (e.kind !== kind || !S.days[e.day] || S.days[e.day][key] !== e[key]) continue;
    const left = S.entries.filter((x) => x.day === e.day && x.kind === kind && x.status === 'ok').sort((a, b) => b.ts - a.ts)[0];
    await saveDay(e.day, { [key]: left ? left[key] : null });
  }
  render();
  if (!silent) toast(t('Entry deleted'));
}

async function noteEntry(kind, titled, extra, day = today()) {
  const e = { id: db.uid(), ts: Date.now(), day, createdAt: Date.now(), kind, status: 'ok', src: 'text', ...titled, photoIds: [], timeSrc: 'now', ...extra };
  await saveEntry(e);
  return e;
}

const weightTitle = (kg) => titleOf(titleFor('weight', { kg })); // for the screen: in the interface language
const stepsTitle = (steps) => titleOf(titleFor('steps', { steps }));

async function setWeight(kg, day = today(), viaLog = true) {
  await saveDay(day, { kg });
  if (viaLog) await noteEntry('weight', titleFor('weight', { kg }), { kg }, day);
  render();
  toast(t('{title} saved', { title: weightTitle(kg) }));
}
async function setSteps(steps, day = today(), viaLog = true) {
  await saveDay(day, { steps });
  if (viaLog) await noteEntry('steps', titleFor('steps', { steps }), { steps }, day);
  render();
  toast(t('{title} saved', { title: stepsTitle(steps) }));
}

async function submitText(text) {
  const local = parseLocal(text);
  if (local) {
    if (local.type === 'weight') return setWeight(local.kg);
    if (local.type === 'steps') return setSteps(local.steps);
    if (local.type === 'water') {
      const cur = (S.days[today()] && S.days[today()].water) || 0;
      await saveDay(today(), { water: cur + local.ml });
      render();
      return toast(t('{ml} ml of water added', { ml: local.ml }));
    }
    if (local.type === 'train') { await saveDay(today(), { train: true }); render(); return toast(t('Today is a workout day: budget {kcal} kcal', { kcal: fmtInt(S.settings.kcalTrain) })); }
    if (local.type === 'plan') return logMeal(local.meal, 'plan', today());
    if (local.type === 'flex') return logMeal({ ...local.flex, slot: (local.flex.flags || []).includes('alcohol') ? 'late' : 'any', tier: 'flex' }, 'flex', today());
    if (local.type === 'favorite') return logMeal({ ...local.favorite, slot: 'any' }, 'favorite', today());
    if (local.type === 'count' && local.key === 'coffee') {
      const cur = (S.days[today()] && S.days[today()].coffee) || 0;
      const next = Math.min(COUNT_MAX, cur + local.n);
      const added = next - cur;
      await saveDay(today(), { coffee: next });
      render();
      return toast(!added ? t('Coffee is at the day’s maximum') : added === 1 ? t('A coffee added') : t('{n} coffees added', { n: added }));
    }
    if (local.type === 'count') {
      const ids = [];
      for (let i = 0; i < local.n; i++) ids.push(await logBeer(today()));
      // One toast whose Undo takes back every beer just logged
      if (local.n > 1) toast(t('{n} beers logged', { n: local.n }), { label: t('Undo'), fn: async () => { for (const id of ids) await removeEntry(id, true); } });
      return;
    }
  }
  const now = new Date();
  const e = {
    id: db.uid(), ts: now.getTime(), day: dayKey(now), createdAt: now.getTime(), kind: 'meal', status: 'pending',
    src: 'text', text, title: text, slot: slotByTime(now), items: [], kcal: 0, p: 0, c: 0, f: 0, fib: 0,
    tier: 'plan', flags: [], conf: 0, q: '', mult: 1, photoIds: [], timeSrc: 'now', place: null,
  };
  await saveEntry(e);
  go('log');
  queueAnalyze(e.id);
}

let posCache = null;
function getPos(force = false) {
  if (!(force || S.settings.useLocation) || !navigator.geolocation) return Promise.resolve(null);
  if (posCache && Date.now() - posCache.at < 300000) return Promise.resolve(posCache);
  return new Promise((res) => {
    const t = setTimeout(() => res(null), 6000);
    navigator.geolocation.getCurrentPosition(
      (p) => { clearTimeout(t); posCache = { lat: p.coords.latitude, lon: p.coords.longitude, at: Date.now() }; res(posCache); },
      () => { clearTimeout(t); res(null); },
      { enableHighAccuracy: false, timeout: 5000, maximumAge: 300000 },
    );
  });
}

let preparing = 0; // photo batches being prepared; an update must not reload the page under them
async function submitPhotos(files, note) {
  preparing += 1;
  try { await prepareAndQueue(files, note); } finally { preparing -= 1; }
}
async function prepareAndQueue(files, note) {
  const list = Array.from(files).filter((f) => f.type.startsWith('image/') || /\.(heic|heif|jpe?g|png|webp)$/i.test(f.name));
  if (!list.length) return;
  go('log');
  toast(list.length > 1 ? t('Preparing {n} photos', { n: list.length }) : t('Preparing photo'));
  const prepared = [];
  for (const f of list) {
    try {
      const meta = await readMeta(f);
      const small = await shrink(f);
      let ts = meta.ts;
      let timeSrc = 'exif';
      if (!ts) {
        const lm = f.lastModified || 0;
        if (lm && Date.now() - lm > 120000 && lm > Date.parse('2020-01-01')) { ts = lm; timeSrc = 'file'; } else { ts = Date.now(); timeSrc = 'now'; }
      }
      if (ts > Date.now() + 60000) { ts = Date.now(); timeSrc = 'now'; }
      prepared.push({ small, ts, timeSrc, lat: meta.lat, lon: meta.lon });
    } catch (err) {
      toast(t('Could not open a photo: {name}', { name: f.name }));
    }
  }
  if (!prepared.length) return;
  prepared.sort((a, b) => a.ts - b.ts);
  // Frames of the same meal (within 3 minutes, time read from the photo) become one entry.
  const groups = [];
  for (const p of prepared) {
    const g = groups[groups.length - 1];
    if (g && p.timeSrc === 'exif' && g[0].timeSrc === 'exif' && p.ts - g[g.length - 1].ts <= 180000 && g.length < 3) g.push(p);
    else groups.push([p]);
  }
  for (const g of groups) {
    const first = g[0];
    let place = null;
    const withGps = g.find((p) => p.lat != null);
    if (S.settings.useLocation) {
      if (withGps) place = placeLabel(withGps.lat, withGps.lon, S.settings.places);
      else if (first.timeSrc === 'now') {
        const pos = await getPos();
        if (pos) place = placeLabel(pos.lat, pos.lon, S.settings.places);
      }
    }
    const photoIds = [];
    for (const p of g) {
      const pid = db.uid();
      await db.put('photos', { id: pid, buf: await p.small.blob.arrayBuffer(), type: 'image/jpeg', w: p.small.w, h: p.small.h });
      photoIds.push(pid);
    }
    const when = new Date(first.ts);
    const e = {
      id: db.uid(), ts: first.ts, day: dayKey(when), createdAt: Date.now(), kind: 'meal', status: 'pending',
      src: 'photo', text: note || '', ...titleFor('photo', {}), slot: slotByTime(when), items: [], kcal: 0, p: 0, c: 0, f: 0, fib: 0,
      tier: 'plan', flags: [], conf: 0, q: '', mult: 1, photoIds, timeSrc: first.timeSrc, place,
    };
    await saveEntry(e);
    queueAnalyze(e.id);
  }
  render();
}

// ——— Analysis queue (requests go one at a time) ———
let chain = Promise.resolve();
// After a failure that every further request would share (no quota, bad key, no connection...), the entries queued
// automatically wait instead of each sending a request that fails the same way. A tap on Analyse, or the
// connection coming back, lifts it.
let pausedUntil = 0;
const SHARED_FAILURE = ['no_key', 'bad_key', 'offline', 'net', 'timeout', 'rate', 'no_quota', 'no_credit', 'needs_billing'];
function queueAnalyze(id, opts) {
  S.busy.add(id);
  render();
  chain = chain.then(() => analyzeEntry(id, opts)).catch(() => {});
  return chain;
}
// Entries that are waiting for the model go again
function resumePending() {
  pausedUntil = 0;
  if (!hasKey() || navigator.onLine === false) return;
  S.entries.filter((e) => e.status === 'pending' && !S.busy.has(e.id)).forEach((e) => queueAnalyze(e.id));
}
// What the person sees while a request is retried
const retryNote = (n, of, alt, why) => (alt ? (why === 'server' ? t('Model busy, trying {alt}', { alt }) : t('Quota reached, trying {alt}', { alt })) : t('Provider busy, retrying ({n}/{of})', { n, of }));
// What the model has used so far, kept in Settings
async function addUsage(model, usage) {
  const u = S.settings.usage;
  u.in += usage.in; u.out += usage.out; u.calls += 1; u.usd += costUSD(model, usage);
  await saveSettings();
}

// ——— The day's review, written by the model ———
// `what` names the thing asked for. Each has whole sentences, so a translation never has to fit a fragment into one
const NO_KEY = { review: () => t('Add an API key in Settings to get a review.'), note: () => t('Add an API key in Settings to get a note.'), check: () => t('Add an API key in Settings to get a check.'), 'new estimate': () => t('Add an API key in Settings to get a new estimate.') };
const FAILED = { review: (detail) => t('The review failed. {detail}', { detail }), note: (detail) => t('The note failed. {detail}', { detail }), check: (detail) => t('The check failed. {detail}', { detail }), 'new estimate': (detail) => t('The new estimate failed. {detail}', { detail }) };
function modelFailure(err, what = 'review') {
  const code = err && err.code;
  if (code === 'no_key') return NO_KEY[what]();
  if (code === 'empty') return t('The model sent nothing usable. Try again.');
  if (!AI_ERRORS[code]) return FAILED[what](errorDetail(err, 120)).trim();
  // The same wording as for an entry, plus what the provider said where that explains it
  const later = code === 'offline' || code === 'net' ? t('Try again when you are online.') : ['rate', 'no_quota', 'server', 'timeout'].includes(code) ? t('Try again a little later.') : '';
  const said = ['rate', 'no_quota', 'server', 'no_credit', 'needs_billing'].includes(code) ? errorDetail(err, 120) : '';
  return [td(AI_ERRORS[code]), later, said].filter(Boolean).join(' ').trim();
}

async function runReview(day, auto) {
  try {
    const sig = reviewSig(day);
    const live = day === today();
    const { data, usage, model } = await review({ cfg: aiCfg(), brief: reviewBrief(day) });
    await addUsage(model, usage);
    // The day may have been wiped while the request was out
    if (dayTotals(day).n) await saveDay(day, { review: { ...data, ts: Date.now(), sig, live, model } });
    S.reviewErr.delete(day);
  } catch (err) {
    if (!auto) S.reviewErr.set(day, modelFailure(err)); // an automatic review that fails just leaves the button
  }
  S.reviewing.delete(day);
  render();
}
function queueReview(day, auto = false) {
  if (S.reviewing.has(day) || !dayVerdict(day)) return;
  S.reviewing.add(day);
  S.reviewErr.delete(day);
  render();
  chain = chain.then(() => runReview(day, auto)).catch(() => {});
}

// ——— The quick note on the day so far, written by the model ———
async function runCoach(day) {
  try {
    const sig = reviewSig(day);
    const { data, usage, model } = await coach({ cfg: aiCfg(), brief: coachBrief(day) });
    await addUsage(model, usage);
    // The day may have been wiped while the request was out
    if (dayTotals(day).n) await saveDay(day, { coach: { ...data, ts: Date.now(), sig, model } });
    S.coachErr.delete(day);
  } catch (err) {
    S.coachErr.set(day, modelFailure(err, 'note'));
  }
  S.coaching.delete(day);
  render();
}
function queueCoach(day) {
  if (S.coaching.has(day) || !dayTotals(day).n) return;
  S.coaching.add(day);
  S.coachErr.delete(day);
  S.reviewOpen.set(`coach:${day}`, true);
  render();
  chain = chain.then(() => runCoach(day)).catch(() => {});
}

// The last finished day is reviewed by itself, once: one small text request a day
const autoTried = new Set();
function autoReview() {
  if (S.settings.autoReview === false || !hasKey() || navigator.onLine === false) return;
  const t = today();
  for (let i = 1; i <= 3; i++) {
    const day = addDays(t, -i);
    const v = dayVerdict(day);
    if (!v) continue;
    if (autoTried.has(day)) return;
    const r = S.days[day] && S.days[day].review;
    const waiting = S.entries.some((e) => e.day === day && e.kind === 'meal' && e.status === 'pending');
    if (v.level !== 'thin' && !waiting && (!r || r.live)) { autoTried.add(day); queueReview(day, true); }
    return;
  }
}

// ——— Check before ordering or buying ———
const CHECK_PHOTOS = '__check'; // marks the photo picker as opened from the Check screen
const CHECK_KEEP = 30; // verdicts kept

async function addCheckPhotos(files) {
  const room = CHECK_MAX - S.check.photos.length;
  for (const f of files.slice(0, room)) {
    try {
      const { blob } = await shrink(f, CHECK_EDGE);
      S.check.photos.push({ id: db.uid(), blob, url: URL.createObjectURL(blob) });
    } catch { toast(t('Could not open that photo')); }
  }
  if (files.length > room) toast(t('A check takes up to {n} photos', { n: CHECK_MAX }));
  S.check.err = '';
  render();
}
function removeCheckPhoto(id) {
  const p = S.check.photos.find((x) => x.id === id);
  if (p) URL.revokeObjectURL(p.url);
  S.check.photos = S.check.photos.filter((x) => x.id !== id);
  render();
}

function showCheckResult() {
  const el = document.getElementById('check-result');
  if (el) el.scrollIntoView({ block: 'start', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
}

async function runCheck() {
  const c = S.check;
  if (!checkReady()) return;
  if (!hasKey()) { c.err = modelFailure({ code: 'no_key' }, 'check'); return render(); }
  if (navigator.onLine === false) { c.err = modelFailure({ code: 'offline' }, 'check'); return render(); }
  const note = c.note.trim().slice(0, 300);
  const sent = c.photos.slice();
  const blobs = sent.map((p) => p.blob);
  c.busy = true; c.err = ''; c.status = '';
  render();
  try {
    const { data, usage, model } = await check({
      cfg: aiCfg(), blobs, brief: checkBrief(note),
      onRetry: (...a) => { c.status = retryNote(...a); render(); },
    });
    await addUsage(model, usage);
    if (data.kind === 'none' || !data.options.length) {
      // Nothing to judge: the photos stay, so one more can be added
      c.err = data.answer || t('Nothing to judge was found. Try a closer or sharper photo.');
    } else {
      const rec = { id: db.uid(), ts: Date.now(), ...data, note, photos: blobs.length, model };
      S.checks = [rec, ...S.checks].slice(0, CHECK_KEEP);
      await db.kvSet('checks', S.checks);
      sent.forEach((p) => URL.revokeObjectURL(p.url));
      c.photos = c.photos.filter((p) => !sent.includes(p)); // a photo added while the request was out stays
      c.note = ''; c.openId = rec.id;
    }
  } catch (err) {
    c.err = modelFailure(err, 'check');
  }
  c.busy = false; c.status = '';
  render();
  if (!c.err) showCheckResult();
}

async function removeCheck(id) {
  S.checks = S.checks.filter((x) => x.id !== id);
  if (S.check.openId === id) S.check.openId = null;
  await db.kvSet('checks', S.checks);
  render();
}

// "I am having this": the chosen option goes into today's log with the check's estimate
async function logCheckOption(id, i) {
  const rec = S.checks.find((x) => x.id === id);
  const o = rec && rec.options[i];
  if (!o) return;
  await logMeal({
    name: o.name, slot: 'any', kcal: o.kcal, p: o.p, c: o.c, f: o.f, fib: o.fib, tier: o.tier, conf: 0.5,
    items: [{ n: o.portion ? `${o.name} (${o.portion})` : o.name, g: 0, kcal: o.kcal, p: o.p }],
  }, 'check', today());
}

// ——— Pictures of the plan's meals: the person's own photos, kept apart from the log ———
let photoTarget = null; // the plan meal waiting for the photo picker, if any
async function storePlanPhoto(mealId, blob, w, h) {
  const old = (S.settings.planPhotos || {})[mealId];
  const id = db.uid();
  await db.put('photos', { id, buf: await blob.arrayBuffer(), type: 'image/jpeg', w, h, plan: mealId });
  S.settings.planPhotos = { ...(S.settings.planPhotos || {}), [mealId]: id };
  await saveSettings();
  if (old) { await db.del('photos', old); const u = S.urls.get(old); if (u) { URL.revokeObjectURL(u); S.urls.delete(old); } }
}
// Framing step: the photo is opened with the house treatment applied, the person centres the plate in the
// circle, and only that square is stored. The original never touches the database.
let frame = null; // { id, src, zoom, cx, cy }
const frameCanvas = () => document.getElementById('frame-canvas');
function paintFrame() {
  const c = frameCanvas();
  if (c && frame) picture.drawFrame(c, frame.src, frame.zoom, frame.cx, frame.cy);
}
function moveFrame(dxCss, dyCss) {
  const c = frameCanvas();
  if (!c || !frame) return;
  const { side } = picture.frameRect(frame.src, frame.zoom, frame.cx, frame.cy);
  const perCss = side / c.getBoundingClientRect().width; // source pixels per CSS pixel
  const half = side / 2;
  frame.cx = Math.min(frame.src.width - half, Math.max(half, frame.cx - dxCss * perCss));
  frame.cy = Math.min(frame.src.height - half, Math.max(half, frame.cy - dyCss * perCss));
  paintFrame();
}
function zoomFrame(z) {
  if (!frame) return;
  frame.zoom = Math.min(3, Math.max(1, z));
  moveFrame(0, 0); // keeps the centre inside the photo at the new zoom
  const r = document.getElementById('frame-zoom');
  if (r && Math.abs(Number(r.value) - frame.zoom) > 0.005) r.value = String(frame.zoom);
}
async function openFrame(mealId, file) {
  if (!MEAL_BY_ID[mealId]) return;
  let src;
  try { src = await picture.prepare(file); } catch (err) { return toast(t('Could not open that photo')); }
  frame = { id: mealId, src, zoom: 1, cx: src.width / 2, cy: src.height / 2 };
  openSheet(renderFrameSheet(mealId), { type: 'plan-frame', id: mealId });
  paintFrame();
  const c = frameCanvas();
  const pts = new Map();
  let pinch = 0;
  c.addEventListener('pointerdown', (ev) => { c.setPointerCapture(ev.pointerId); pts.set(ev.pointerId, { x: ev.clientX, y: ev.clientY }); pinch = 0; });
  c.addEventListener('pointermove', (ev) => {
    const p = pts.get(ev.pointerId);
    if (!p) return;
    if (pts.size === 1) moveFrame(ev.clientX - p.x, ev.clientY - p.y);
    pts.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
    if (pts.size === 2) {
      const [a, b] = Array.from(pts.values());
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      if (pinch) zoomFrame(frame.zoom * (dist / pinch));
      pinch = dist;
    }
  });
  const end = (ev) => { pts.delete(ev.pointerId); pinch = 0; };
  c.addEventListener('pointerup', end);
  c.addEventListener('pointercancel', end);
}
async function saveFrame() {
  if (!frame) return;
  const f = frame;
  const { id, src, zoom, cx, cy } = f;
  frame = null; // a second tap while this one is saving does nothing
  try {
    await storePlanPhoto(id, await picture.render(src, zoom, cx, cy), picture.PICTURE_SIZE, picture.PICTURE_SIZE);
  } catch (err) {
    frame = f;
    return toast(t('Could not save the picture'));
  }
  openSheet(renderPlanSheet(id), { type: 'plan', id });
  render();
  toast(t('Picture saved'));
}
function cancelFrame() {
  const id = frame ? frame.id : S.sheet && S.sheet.id;
  frame = null;
  if (id) openSheet(renderPlanSheet(id), { type: 'plan', id }); else closeSheet();
  hydratePhotos();
}
async function removePlanPhoto(mealId) {
  const id = (S.settings.planPhotos || {})[mealId];
  if (!id) return;
  const { [mealId]: gone, ...rest } = S.settings.planPhotos;
  S.settings.planPhotos = rest;
  await saveSettings();
  await db.del('photos', id);
  const u = S.urls.get(id);
  if (u) { URL.revokeObjectURL(u); S.urls.delete(id); }
  render();
}

async function photoBlob(pid) {
  const p = await db.get('photos', pid);
  return p ? new Blob([p.buf], { type: p.type || 'image/jpeg' }) : null;
}

async function analyzeEntry(id, opts = {}) {
  const original = S.entries.find((x) => x.id === id);
  if (!original) { S.busy.delete(id); return; }
  if (Date.now() < pausedUntil) { S.busy.delete(id); render(); return; } // see pausedUntil
  const e = { ...original };
  const settled = original.status === 'ok'; // a new estimate was asked for: if it fails, the old one stays as it is
  let failure = '';
  try {
    const blobs = [];
    for (const pid of e.photoIds || []) { const b = await photoBlob(pid); if (b) blobs.push(b); }
    const cfg = aiCfg();
    if (opts.strong && cfg.provider === 'anthropic') cfg.model = STRONG_MODEL;
    const { data, usage, model: usedModel } = await analyze({
      cfg, blobs, text: e.text, when: new Date(e.ts), place: e.place, hint: opts.hint,
      onRetry: (...a) => { S.retry.set(id, retryNote(...a)); render(); },
    });
    await addUsage(usedModel, usage);
    if (!S.entries.some((x) => x.id === id)) { S.busy.delete(id); S.retry.delete(id); return render(); } // deleted while the request was out
    e.model = usedModel;
    e.err = '';
    // What comes back from the model is kept within sane bounds: a slipped decimal must not wreck a day
    const cap = (v, max) => Math.min(max, Math.max(0, +v || 0));
    if (data.kind === 'weight' && data.kg >= 50 && data.kg <= 160) {
      const kg = Math.round(data.kg * 10) / 10;
      Object.assign(e, { kind: 'weight', status: 'ok', kg, ...titleFor('weight', { kg }) });
      await saveDay(e.day, { kg });
    } else if (data.kind === 'steps' && data.steps > 0 && data.steps <= 100000) {
      const steps = Math.round(data.steps);
      Object.assign(e, { kind: 'steps', status: 'ok', steps, ...titleFor('steps', { steps }) });
      await saveDay(e.day, { steps });
    } else if (data.kind === 'meal') {
      const plan = has(MEAL_BY_ID, data.plan) ? MEAL_BY_ID[data.plan] : null;
      if (plan) {
        Object.assign(e, {
          planId: plan.id, ...titleFor('plan', { id: plan.id }), items: plan.items.map((i) => ({ n: i.n, g: i.g, kcal: i.kcal, p: i.p })),
          kcal: plan.kcal, p: plan.p, c: plan.c, f: plan.f, fib: plan.fib, tier: 'plan',
        });
        // A plan meal without a picture takes this photo as its own
        if (blobs[0] && !(S.settings.planPhotos || {})[plan.id]) {
          try {
            const src = await picture.prepare(blobs[0]);
            await storePlanPhoto(plan.id, await picture.render(src), picture.PICTURE_SIZE, picture.PICTURE_SIZE);
          } catch (err) { /* the picture is optional; the entry itself is fine */ }
        }
      } else {
        delete e.tk; // the title now comes from the model
        const items = Array.isArray(data.items) ? data.items.slice(0, 12).map((i) => ({ n: String((i && i.n) || '').slice(0, 80), g: cap(i && i.g, 5000), kcal: cap(i && i.kcal, 3000), p: cap(i && i.p, 300) })) : [];
        const sumKcal = items.reduce((a, i) => a + i.kcal, 0);
        Object.assign(e, {
          planId: '', title: String(data.title || e.text || 'Meal').slice(0, 80), items, // i18n-ok: the stored title stays English
          // The item list is what explains the total, so the total is their sum whenever items carry calories
          kcal: Math.round(cap(sumKcal || data.kcal, 6000)), p: cap(data.p, 500) || items.reduce((a, i) => a + i.p, 0), edited: false,
          c: cap(data.c, 800), f: cap(data.f, 500), fib: cap(data.fib, 150),
          tier: ['plan', 'flex', 'off'].includes(data.tier) ? data.tier : 'plan',
        });
      }
      Object.assign(e, {
        kind: 'meal', status: 'ok',
        slot: has(SLOT_NAME, data.slot) ? data.slot : e.slot,
        flags: Array.isArray(data.flags) ? data.flags.map((f) => String(f).slice(0, 20)).slice(0, 4) : [],
        conf: Math.max(0, Math.min(1, +data.conf || 0)), q: String(data.q || '').slice(0, 160),
      });
    } else if (settled) {
      failure = t('Nothing to log was found in that, so the entry is unchanged.');
    } else {
      Object.assign(e, { status: 'error', err: t('Nothing to log was found: no food, weight or step count.') });
    }
  } catch (err) {
    const code = err && err.code;
    if (SHARED_FAILURE.includes(code)) pausedUntil = Date.now() + 300000;
    const waiting = ['no_key', 'offline', 'net', 'timeout', 'no_credit', 'needs_billing', 'no_quota', 'no_vision', 'bad_model', 'bad_key', 'server', 'rate'].includes(code);
    const detail = ['bad_request', 'http', 'bad_model', 'server', 'rate', 'no_quota', 'no_credit', 'needs_billing'].includes(code) ? ' ' + errorDetail(err, 140) : '';
    if (settled) failure = modelFailure(err, 'new estimate');
    else Object.assign(e, { status: waiting ? 'pending' : 'error', err: (AI_ERRORS[code] ? td(AI_ERRORS[code]) : t('Analysis failed.')) + (waiting ? td(WAITING) : '') + detail });
  }
  S.busy.delete(id);
  S.retry.delete(id);
  if (failure) { render(); toast(failure); return; }
  if (S.entries.some((x) => x.id === id)) await saveEntry(e);
  render();
}

// ——— Backup ———
// Hands a file to the share sheet where that is possible (Save to Files on iOS), otherwise downloads it.
// content: a string, or a list of strings that are joined without ever being one big string.
// Returns false when the person cancelled.
async function deliverFile(name, content, type) {
  const blob = new Blob(Array.isArray(content) ? content : [content], { type });
  const file = new File([blob], name, { type });
  const canShare = navigator.canShare && navigator.canShare({ files: [file] });
  try {
    if (canShare) {
      await navigator.share({ files: [file], title: name });
      return true;
    }
  } catch (err) {
    if (err && err.name === 'AbortError') return false;
    // Safari only opens the share sheet shortly after a tap, and a big file takes longer to build than that:
    // ask for a new tap instead of falling back to a download that a Home Screen app may ignore
    if (err && err.name === 'NotAllowedError') {
      return new Promise((res) => {
        const timer = setTimeout(() => res(false), 7000);
        toast(t('The file is ready'), {
          label: t('Save'),
          fn: () => {
            clearTimeout(timer);
            navigator.share({ files: [file], title: name }).then(() => res(true), () => res(false));
          },
        });
      });
    }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
  return true;
}

async function exportBackup(withPhotos) {
  const { apiKey, oaKey, ...settingsNoKeys } = S.settings;
  const data = { app: APP_ID, v: SCHEMA_VERSION, at: new Date().toISOString(), settings: settingsNoKeys, entries: S.entries, days: Object.values(S.days), checks: S.checks, badges: S.badges };
  // The plan's pictures always travel with the backup; photos of logged meals only when asked for.
  // They are read one at a time, so the photos that are left out are never loaded.
  const planIds = new Set(Object.values(S.settings.planPhotos || {}));
  const content = [JSON.stringify(data).slice(0, -1) + ',"photos":['];
  for (const id of (await db.keys('photos')).filter((k) => withPhotos || planIds.has(k))) {
    const p = await db.get('photos', id);
    if (p) content.push((content.length > 1 ? ',' : '') + JSON.stringify({ id: p.id, type: p.type, w: p.w, h: p.h, plan: p.plan, b64: b64FromBuf(p.buf) }));
  }
  content.push(']}');
  const done = await deliverFile(`pickle-backup-${today()}.json`, content, 'application/json');
  if (!done) return;
  S.settings.lastBackup = Date.now();
  await saveSettings();
  render();
  toast(t('Backup ready'));
}

// For analysis elsewhere: a .sql file that builds the tables in any SQLite database
async function exportSql() {
  const { sql, counts } = buildSql({ settings: S.settings, entries: S.entries, days: Object.values(S.days), badges: S.badges && S.badges.got, appVersion: APP_VERSION });
  const done = await deliverFile(exportName(), sql, 'text/plain');
  if (done) toast(t('Exported {days} and {meals}', { days: tn('{n} day|{n} days', counts.days), meals: tn('{n} meal|{n} meals', counts.meals) }));
}

async function importBackup(file) {
  let data;
  try { data = JSON.parse(await file.text()); } catch { return toast(t('Could not read the file')); }
  const problem = backupProblem(data);
  if (problem) return toast(td(problem)); // backup.js marks its messages as translatable
  // Restoring adds to what is on the device; an entry or day that is in both is replaced by the backup's version.
  // Everything read from the file is checked first (see backup.js).
  let restored = 0;
  let skipped = 0;
  const gotBefore = S.badges ? S.badges.got : {};
  try {
    for (const p of Array.isArray(data.photos) ? data.photos : []) {
      const photo = cleanPhoto(p); // photos go in one at a time: a damaged one is skipped, and the others are not held in memory together
      if (photo) await db.put('photos', photo); else skipped += 1;
    }
    const entries = data.entries.map(cleanEntry).filter(Boolean);
    skipped += data.entries.length - entries.length;
    restored = entries.length;
    await db.putMany('entries', entries);
    await db.putMany('days', (Array.isArray(data.days) ? data.days : []).map(cleanDay).filter(Boolean));
    if (data.settings && typeof data.settings === 'object') {
      const before = Object.values(S.settings.planPhotos || {});
      const incoming = cleanSettings(data.settings);
      if (incoming.planPhotos) incoming.planPhotos = { ...(S.settings.planPhotos || {}), ...incoming.planPhotos }; // pictures are added to, not replaced
      S.settings = { ...S.settings, ...incoming };
      if (S.settings.kcalMinDay > S.settings.kcalRest) S.settings.kcalMinDay = DEFAULTS.kcalMinDay; // a restore never leaves a minimum no day can reach
      await applyLang(S.settings.lang);
      await saveSettings();
      // A plan picture that the backup replaces is no longer referred to by anything
      const now = new Set(Object.values(S.settings.planPhotos || {}));
      for (const id of before.filter((x) => !now.has(x))) {
        await db.del('photos', id);
        const u = S.urls.get(id);
        if (u) { URL.revokeObjectURL(u); S.urls.delete(id); }
      }
    }
    if (Array.isArray(data.checks)) {
      const have = new Set(S.checks.map((c) => c.id));
      const added = data.checks.map(cleanCheck).filter((c) => c && !have.has(c.id));
      await db.kvSet('checks', S.checks.concat(added).sort((a, b) => b.ts - a.ts).slice(0, CHECK_KEEP));
    }
    // Earned badges are added to, never replaced: the earliest day wins. An old backup has none; checkBadges then works them out from the restored log.
    if (data.badges && typeof data.badges === 'object') await badgeQueue(() => db.kvSet('badges', restoreBadges(S.badges, data.badges)));
  } catch (err) {
    toast(t('The backup could not be restored completely'));
    await load();
    return render();
  }
  await load();
  badgesMode = 'restore';
  restoredFrom = gotBefore;
  checkBadges(); // silently: the restored log may earn more than the backup recorded
  render();
  if (S.sheet && S.sheet.type === 'settings') await openSettings(); // the open sheet shows the restored language
  const back = tn('{n} entry restored|{n} entries restored', restored);
  toast(skipped ? t('{restored}; {skipped}', { restored: back, skipped: tn('{n} damaged item skipped|{n} damaged items skipped', skipped) }) : back);
}

// ——— Loading and rendering ———
async function load() {
  S.rev++;
  const stored = await db.kvGet('settings', null);
  S.entries = await db.all('entries');
  if (stored) S.settings = { ...S.settings, ...stored, usage: { ...S.settings.usage, ...(stored.usage || {}) } };
  S.days = Object.fromEntries((await db.all('days')).map((d) => [d.day, d]));
  S.checks = await db.kvGet('checks', []);
  const badges = await badgeQueue(() => db.kvGet('badges', null)); // after any write still on its way
  S.badges = badges ? cleanBadges(badges) : null;
}

async function refreshStorage() {
  try {
    if (navigator.storage && navigator.storage.persisted) S.persisted = await navigator.storage.persisted();
    if (navigator.storage && navigator.storage.estimate) S.storage = await navigator.storage.estimate();
  } catch { /* not supported */ }
}

export function go(tab) {
  if (tab !== 'progress') S.badgeIntro = 0; // the "from your history" line was there to be seen
  S.tab = tab;
  render();
  window.scrollTo(0, 0);
}

const RUNS = canRun(window); // false in a browser tab: the install screen stays and nothing touches the database
function render() {
  if (!RUNS) return;
  const v = $('#view');
  const y = window.scrollY;
  const fn = { today: renderToday, log: renderLog, check: renderCheck, progress: renderProgress, plan: renderPlan }[S.tab];
  const focusId = document.activeElement && v.contains(document.activeElement) ? document.activeElement.id : '';
  v.innerHTML = fn();
  v.dataset.view = S.tab;
  document.querySelectorAll('.tabs button').forEach((b) => {
    if (b.dataset.tab === S.tab) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
  });
  // Whatever is typed is always logged to today, so the composer hides on past days
  const showComposer = S.tab === 'log' || (S.tab === 'today' && S.viewDay === today());
  $('#composer').hidden = !showComposer;
  document.body.classList.toggle('has-composer', showComposer);
  renderFavorites();
  hydratePhotos();
  if (S.tab === 'progress') attachChart(v);
  checkWins();
  checkBadges();
  if (focusId) { const el = document.getElementById(focusId); if (el) el.focus({ preventScroll: true }); }
  window.scrollTo(0, y);
  if (S.sheet && S.sheet.type === 'badge') $('#sheet-body').innerHTML = renderBadgeSheet(S.sheet.id);
  if (S.sheet && S.sheet.type === 'avatar') $('#sheet-body').innerHTML = renderAvatarSheet();
  if (S.sheet && S.sheet.type === 'plan') { $('#sheet-body').innerHTML = renderPlanSheet(S.sheet.id); hydratePhotos(); }
  if (S.sheet && S.sheet.type === 'entry') {
    const html = renderEntrySheet(S.sheet.id);
    const body = $('#sheet-body');
    const typing = body.contains(document.activeElement) && /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName);
    const sig = entrySig(S.sheet.id);
    if (!html) closeSheet();
    else if (!typing || sig !== S.sheet.sig) { body.innerHTML = html; hydratePhotos(); } // a retry tick must not wipe what is being typed; a changed entry must show
    if (S.sheet) S.sheet.sig = sig;
  }
}
// What the entry sheet shows that can change under it: whether the entry is being analysed, and its state
const entrySig = (id) => { const e = S.entries.find((x) => x.id === id); return e ? `${e.status}|${S.busy.has(id)}` : ''; };

// ——— Small celebrations: a kilo milestone, a day with all five goals done ———
function celebrate() {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const box = document.createElement('div');
  box.className = 'confetti';
  box.setAttribute('aria-hidden', 'true');
  for (let i = 0; i < 20; i++) {
    const p = document.createElement('i');
    p.className = 'c' + (i % 4);
    p.style.setProperty('--x', `${Math.round((Math.random() * 2 - 1) * 44)}vw`);
    p.style.setProperty('--r', `${Math.round(Math.random() * 720 - 360)}deg`);
    p.style.setProperty('--d', `${(Math.random() * 0.2).toFixed(2)}s`);
    box.append(p);
  }
  document.body.append(box);
  setTimeout(() => box.remove(), 1900);
}
let winsBusy = false;
async function checkWins() {
  if (winsBusy) return;
  const day = today();
  const kilos = kilosDown(day);
  const perfect = isPerfect(day);
  const w = S.settings.wins;
  // First run with this feature: note where things stand without celebrating the past
  const next = w ? { ...w } : { kilos, perfect: perfect ? day : '' };
  let msg = '';
  if (w) {
    if (kilos > (w.kilos || 0)) { msg = kilos === 1 ? t('First kilo down') : t('{n} kilos down', { n: kilos }); next.kilos = kilos; }
    if (perfect && w.perfect !== day) { msg = msg || t('All five goals done today'); next.perfect = day; }
    if (!msg) return;
  }
  winsBusy = true;
  S.settings.wins = next;
  try { await saveSettings(); } finally { winsBusy = false; }
  if (msg) { celebrate(); toast(msg); }
}

// Earned badges: worked out from the whole log and stored only when something is new.
// Debounced, because every render asks; saves, edits, deletes, loading and restoring all end in a render.
// Only a save in normal use tells the person (one toast). The first evaluation after loading is quiet: the log may have moved on while the app was closed.
// Taking in a history (the first run with a log, a record from before `told`, a restore) marks everything seen and says nothing but one line on the Progress tab,
// never a toast: a restore's own toast would be replaced, and a toast on opening the app is not a moment the person asked for.
const badgeQueue = serial(); // every write to kv `badges`, one at a time, each from the latest S.badges
let announceTimer;
let badgesBusy = false;
let badgesAgain = false;
let badgesTimer;
let badgesMode = 'load'; // 'load' (the first evaluation after starting), 'restore', or '' (normal use)
let restoredFrom = null; // what was earned before a restore
function checkBadges() {
  clearTimeout(badgesTimer);
  badgesTimer = setTimeout(runBadges, 300);
}
async function runBadges() {
  if (badgesBusy) { badgesAgain = true; return; }
  badgesBusy = true;
  const mode = badgesMode;
  badgesMode = '';
  try {
    const backfill = mode === 'restore' ? { from: restoredFrom || {} } : mode === 'load' && !(S.badges && S.badges.told) ? { from: {} } : null;
    const { added: news, intro } = await badgeQueue(async () => {
      const r = settle(S.badges, S, today(), { backfill });
      if (r.changed) {
        const before = S.badges;
        S.badges = r.next; // at once, so the next turn in the queue builds on it
        try { await db.kvSet('badges', r.next); } catch (err) { S.badges = before; throw err; }
      }
      return r;
    });
    if (intro) { S.badgeIntro = intro; if (S.tab === 'progress') render(); } else if (!mode) announceBadges(unseenAdded(news, S.badges && S.badges.seen));
  } catch { /* badges are a bonus: a failure here must not get in the way of logging */ } finally {
    badgesBusy = false;
    if (badgesAgain) { badgesAgain = false; checkBadges(); }
  }
}
// One toast for what was just earned. It waits for a toast that is showing (an Undo must not be taken away) and gives up after a few seconds.
function announceBadges(news, tries = 0) {
  // What is still earned and not seen now: a reset or a look at the badge while this waited cancels the toast
  const have = (S.badges && S.badges.got) || {};
  const u = unlockToast(unseenAdded(news.filter(([id, thr]) => Object.hasOwn(have, id) && Object.hasOwn(have[id], thr)), S.badges && S.badges.seen));
  if (!u) return;
  if (!$('#toast').hidden && tries < 8) { announceTimer = setTimeout(() => announceBadges(news, tries + 1), 1000); return; }
  toast(u.msg, { label: t('View'), fn: () => (u.id ? showBadge(u.id) : showBadges()) }, { mark: u.mark, sub: u.sub });
}
// The badge sheet. Viewing it is what makes a badge no longer new.
async function showBadge(id) {
  const html = renderBadgeSheet(id);
  if (!html) return;
  openSheet(html, { type: 'badge', id });
  try {
    const changed = await badgeQueue(async () => {
      const next = viewed(S.badges, badgeContext().got, id);
      if (next === S.badges) return false;
      const before = S.badges;
      S.badges = next;
      try { await db.kvSet('badges', next); } catch (err) { S.badges = before; throw err; }
      return true;
    });
    if (changed) render();
  } catch { /* seen again next time */ }
}
// The avatar picker. A chosen part is written through the same queue, from the latest S.badges, and rolled back if the write fails.
function showAvatar() { openSheet(renderAvatarSheet(), { type: 'avatar' }); }
async function wearPart(part) {
  try {
    const changed = await badgeQueue(async () => {
      const next = wear(S.badges, part);
      if (next === S.badges) return false;
      const before = S.badges;
      S.badges = next;
      try { await db.kvSet('badges', next); } catch (err) { S.badges = before; throw err; }
      return true;
    });
    if (changed) render();
    const h = $('#av-hint');
    if (h) h.textContent = t('Locked parts show what to earn. Nothing changes by itself.');
  } catch { /* not saved: the picker shows what is worn */ }
  const again = S.sheet && S.sheet.type === 'avatar' && document.querySelector(`#sheet-body [data-part="${part}"]`);
  if (again) again.focus({ preventScroll: true });
}
function showBadges() {
  go('progress');
  const h = $('#badges-title');
  if (h) h.scrollIntoView({ block: 'start', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
}

function renderFavorites() {
  const row = $('#favorites');
  const favorites = S.settings.favorites || [];
  const show = S.tab === 'log' && favorites.length > 0;
  row.hidden = !show;
  row.innerHTML = '';
  if (!show) return;
  const label = document.createElement('span');
  label.className = 'favorites-label';
  label.textContent = t('Favourites');
  row.append(label);
  for (const f of favorites) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'chip';
    b.dataset.act = 'log-favorite';
    b.dataset.id = f.id;
    b.append(f.name + ' ');
    const sp = document.createElement('span');
    sp.textContent = String(Math.round(f.kcal));
    b.append(sp);
    row.append(b);
  }
}

async function hydratePhotos() {
  for (const img of document.querySelectorAll('img[data-photo]')) {
    const pid = img.dataset.photo;
    if (!S.urls.has(pid)) {
      const b = await photoBlob(pid);
      if (!b) continue;
      if (!S.urls.has(pid)) S.urls.set(pid, URL.createObjectURL(b)); // another call may have got there while this one waited
    }
    img.src = S.urls.get(pid);
  }
}

let sheetOpener = null;
let sheetOpenerId = '';
function openSheet(html, state, focusSel, keepFocus) {
  const wasHidden = $('#sheet').hidden;
  if (wasHidden) { sheetOpener = document.activeElement; sheetOpenerId = sheetOpener ? sheetOpener.id : ''; $('#toast').hidden = true; }
  const body = $('#sheet-body');
  const keep = !wasHidden && S.sheet && S.sheet.type === state.type ? body.scrollTop : 0;
  S.sheet = state;
  body.innerHTML = html;
  body.dataset.type = state.type;
  $('#sheet').hidden = false;
  $('#app').inert = true; // the page behind the sheet cannot be tabbed to or read out
  document.body.classList.add('sheet-open');
  body.scrollTop = keep;
  if (!keepFocus) {
    const f = focusSel ? body.querySelector(focusSel) : body.querySelector('h2');
    if (f) { if (!focusSel) f.tabIndex = -1; f.focus({ preventScroll: true }); if (focusSel && f.select) f.select(); }
  }
  hydratePhotos();
}
function closeSheet() {
  const was = S.sheet;
  if (S.sheet && S.sheet.type === 'settings') S.suppEdit = '';
  $('#sheet').hidden = true;
  S.sheet = null;
  frame = null; // a photo being framed is dropped with the sheet
  $('#app').inert = false;
  document.body.classList.remove('sheet-open');
  // A render may have replaced the button that opened the sheet: find it again by its id
  // (an opener that is hidden, such as the toast's View button, cannot take focus: use the badge's cell, else the Progress tab)
  const ok = (el) => el && el !== document.body && document.contains(el) && !el.closest('[hidden]');
  let back = ok(sheetOpener) ? sheetOpener : sheetOpenerId ? document.getElementById(sheetOpenerId) : null;
  if (!ok(back) && was && was.type === 'badge') back = document.getElementById(`badge-${was.id}`) || document.querySelector('.tabs [data-tab="progress"]');
  if (back) back.focus({ preventScroll: true });
  sheetOpener = null;
  sheetOpenerId = '';
}
async function openSettings(section, focusSel) {
  if (section) S.openSetting = section;
  await refreshStorage();
  const wasOpen = !!(S.sheet && S.sheet.type === 'settings');
  openSheet(renderSettings(), { type: 'settings' }, focusSel || null, wasOpen && !focusSel);
}

// ——— Actions ———
const ACT = {
  'tab': (el) => go(el.dataset.tab),
  'settings': (el) => openSettings(el && el.dataset.sec),
  'close-sheet': () => closeSheet(),
  'week-prev': () => { S.viewDay = addDays(S.viewDay, -7); render(); },
  'week-next': () => { const d = addDays(S.viewDay, 7); S.viewDay = d > today() ? today() : d; render(); },
  'day-today': () => { S.viewDay = today(); render(); },
  'log-plan': (el) => { if (S.sheet && S.sheet.type === 'slot') closeSheet(); return logMeal(MEAL_BY_ID[el.dataset.id], 'plan'); },
  'slot': (el) => openSheet(renderSlotSheet(el.dataset.slot, S.viewDay), { type: 'slot', slot: el.dataset.slot }),
  'slot-camera': () => { closeSheet(); photoTarget = null; $('#f-cam').click(); },
  'compose': () => { closeSheet(); const inp = $('#composer-input'); inp.focus(); },
  'log-flex': (el) => { const f = FLEX.find((x) => x.id === el.dataset.id); if (f) logMeal({ ...f, slot: (f.flags || []).includes('alcohol') ? 'late' : 'any', tier: 'flex' }, 'flex', today()); },
  'log-favorite': (el) => { const f = (S.settings.favorites || []).find((x) => x.id === el.dataset.id); if (f) logMeal({ ...f, slot: 'any' }, 'favorite', today()); },
  'open-entry': (el) => {
    const html = renderEntrySheet(el.dataset.id);
    if (html) openSheet(html, { type: 'entry', id: el.dataset.id, sig: entrySig(el.dataset.id) });
  },
  'num': (el) => {
    const kind = el.dataset.kind;
    openSheet(renderNumSheet(kind, S.viewDay), { type: 'num', kind }, '#num-in');
  },
  'num-clear': async (el) => {
    await saveDay(el.dataset.day, el.dataset.kind === 'kg' ? { kg: null } : { steps: null });
    closeSheet();
    render();
    toast(el.dataset.kind === 'kg' ? t('Weight removed') : t('Steps removed'));
  },
  'lang': async (el) => { // the language control in Settings
    const prev = S.settings.lang;
    S.settings.lang = el.dataset.lang === 'tr' ? 'tr' : 'en';
    if (!(await applyLang(S.settings.lang))) { S.settings.lang = prev; return; } // only a choice made here is rolled back
    await saveSettings();
    render();
    await openSettings('', '[data-act="lang"][aria-pressed="true"]'); // the open sheet is rebuilt in the new language, focus stays on the pressed button
  },
  'hide-start': async () => { S.settings.hideStart = true; await saveSettings(); render(); },
  'camera': () => { photoTarget = null; $('#f-cam').click(); },
  'library': () => { photoTarget = null; $('#f-lib').click(); },
  // Plan: a meal's details, and its picture
  'badge': (el) => showBadge(el.dataset.id),
  'avatar': () => showAvatar(),
  'avatar-pick': (el) => { // a locked chip carries its hint and changes nothing
    if (el.dataset.hint) { const h = $('#av-hint'); if (h) h.textContent = el.dataset.hint; return; }
    return wearPart(el.dataset.part);
  },
  'plan-meal': (el) => openSheet(renderPlanSheet(el.dataset.id), { type: 'plan', id: el.dataset.id }),
  'check-cam': () => { photoTarget = CHECK_PHOTOS; $('#f-cam').click(); },
  'check-lib': () => { photoTarget = CHECK_PHOTOS; $('#f-lib').click(); },
  'check-photo-remove': (el) => removeCheckPhoto(el.dataset.id),
  'check-run': () => runCheck(),
  'check-open': (el) => { S.check.openId = el.dataset.id; render(); showCheckResult(); },
  'check-remove': (el) => removeCheck(el.dataset.id),
  'check-log': (el) => logCheckOption(el.dataset.id, Number(el.dataset.i)),
  'plan-photo-cam': (el) => { photoTarget = el.dataset.id; $('#f-cam').click(); },
  'plan-photo-lib': (el) => { photoTarget = el.dataset.id; $('#f-lib').click(); },
  'plan-photo-remove': (el) => removePlanPhoto(el.dataset.id),
  'frame-save': () => saveFrame(),
  'frame-cancel': () => cancelFrame(),
  'log-plan-today': (el) => { closeSheet(); return logMeal(MEAL_BY_ID[el.dataset.id], 'plan', today()); },
  'hint': (el) => {
    const inp = $('#composer-input');
    inp.value = el.dataset.fill;
    inp.focus();
    inp.setSelectionRange(inp.value.length, inp.value.length);
  },
  'train': async (el) => { await saveDay(S.viewDay, { train: el.dataset.v === '1' }); render(); },
  'water': async (el) => {
    const day = S.viewDay;
    const cur = (S.days[day] && S.days[day].water) || 0;
    const next = Math.max(0, cur + Number(el.dataset.v));
    await saveDay(day, { water: next });
    render();
    if (next > cur) toast(t('A glass of water added'), { label: t('Undo'), fn: async () => { await saveDay(day, { water: cur }); render(); } });
  },
  'coffee': async (el) => {
    const day = S.viewDay;
    const cur = (S.days[day] && S.days[day].coffee) || 0;
    const next = Math.max(0, Math.min(COUNT_MAX, cur + Number(el.dataset.v)));
    await saveDay(day, { coffee: next });
    render();
    if (next > cur) toast(t('A coffee added'), { label: t('Undo'), fn: async () => { await saveDay(day, { coffee: cur }); render(); } });
  },
  'supp': async (el) => {
    const day = S.viewDay;
    const id = el.dataset.id;
    const cur = (S.days[day] && S.days[day].taken) || [];
    await saveDay(day, { taken: cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id] });
    render();
  },
  'supp-save': async () => {
    const name = $('#supp-name').value.replace(/\s+/g, ' ').trim().slice(0, 40);
    const dose = $('#supp-dose').value.replace(/\s+/g, ' ').trim().slice(0, 30);
    if (!name) return toast(t('Give the supplement a name'));
    const list = S.settings.supplements || [];
    const edit = list.find((x) => x.id === S.suppEdit);
    if (!edit && list.length >= SUPP_MAX) return toast(t('At most {n} supplements', { n: SUPP_MAX }));
    if (list.some((x) => x.id !== S.suppEdit && x.name.toLowerCase() === name.toLowerCase())) return toast(t('Already in the list'));
    S.settings.supplements = edit ? list.map((x) => (x.id === edit.id ? { ...x, name, dose } : x)) : [...list, { id: db.uid(), name, dose }];
    S.suppEdit = '';
    await saveSettings();
    render();
    openSettings('', '#supp-name');
  },
  'supp-edit': (el) => { S.suppEdit = el.dataset.id; openSettings('', '#supp-name'); },
  'supp-cancel': () => { S.suppEdit = ''; openSettings('', '#supp-name'); },
  'supp-remove': async (el) => {
    const x = (S.settings.supplements || []).find((y) => y.id === el.dataset.id);
    if (!x || !window.confirm(t('Remove {name}? Its history is no longer shown.', { name: x.name }))) return;
    S.settings.supplements = S.settings.supplements.filter((y) => y.id !== x.id);
    if (S.suppEdit === x.id) S.suppEdit = '';
    await saveSettings();
    render();
    openSettings('', '#supp-name');
  },
  'mult': async (el) => {
    const e = S.entries.find((x) => x.id === el.dataset.id);
    if (e) { await saveEntry({ ...e, mult: Number(el.dataset.v) }); render(); }
  },
  'delete': (el) => removeEntry(el.dataset.id),
  'analyze': (el) => { pausedUntil = 0; return queueAnalyze(el.dataset.id); },
  'analyze-all': () => { pausedUntil = 0; S.entries.filter((e) => e.status === 'pending' && !S.busy.has(e.id)).forEach((e) => queueAnalyze(e.id)); },
  'reanalyze': (el) => { pausedUntil = 0; return queueAnalyze(el.dataset.id, { strong: true }); },
  // The person tells the model what the photo does not show; the model revises its own item list
  'answer': async (el) => {
    const e = S.entries.find((x) => x.id === el.dataset.id);
    const inp = document.getElementById('answer-' + el.dataset.id);
    const said = inp ? inp.value.trim() : '';
    if (!e || !said) return;
    const earlier = (e.items || []).map((i) => `${i.n} ${Math.round(i.g || 0)} g ${Math.round(i.kcal || 0)} kcal`).join('; ');
    // The correction is kept as part of the entry's note, so a later re-analysis still knows it; when the note is full, the oldest part goes
    await saveEntry({ ...e, text: [e.text, said].filter(Boolean).join('; ').slice(-400) });
    pausedUntil = 0;
    queueAnalyze(e.id, { hint: `${earlier ? `Your earlier estimate: ${earlier}.\n` : ''}${e.q ? `Your earlier question: ${e.q}\n` : ''}Correction from the person: ${said}\nRevise the estimate with this correction and keep the items it does not mention.` });
  },
  'favorite': async (el) => {
    const e = S.entries.find((x) => x.id === el.dataset.id);
    if (!e) return;
    const favorites = S.settings.favorites || [];
    if (favorites.some((f) => f.name === e.title)) return toast(t('Already in favourites'));
    const v = eff(e);
    favorites.push({ id: db.uid(), name: e.title, slot: 'any', kcal: Math.round(v.kcal), p: v.p, c: v.c, f: v.f, fib: v.fib, tier: e.tier, flags: e.flags || [], items: e.items || [] });
    S.settings.favorites = favorites;
    await saveSettings();
    render();
    toast(t('Added to favourites. One tap next time.'));
  },
  'favorite-remove': async (el) => {
    S.settings.favorites = (S.settings.favorites || []).filter((f) => f.id !== el.dataset.id);
    await saveSettings();
    openSettings();
  },
  'save-edit': async (el) => {
    const id = el.dataset.id;
    const e = S.entries.find((x) => x.id === id);
    if (!e) return;
    const field = (k) => document.getElementById(`${k}-${id}`);
    const kcal = parseFloat(field('edit-kcal').value.replace(',', '.'));
    const p = parseFloat(field('edit-protein').value.replace(',', '.'));
    const slot = field('edit-slot').value;
    const time = field('edit-time').value;
    const next = { ...e, slot };
    if (kcal >= 0 && Math.round(kcal) !== Math.round(eff(e).kcal)) { next.kcal = Math.round(kcal / (e.mult || 1)); next.conf = 1; next.planId = ''; next.edited = true; }
    if (p >= 0) next.p = Math.round((p / (e.mult || 1)) * 10) / 10;
    if (/^\d{2}:\d{2}$/.test(time)) {
      const d = new Date(e.ts);
      d.setHours(+time.slice(0, 2), +time.slice(3, 5), 0, 0);
      if (d.getTime() !== e.ts) { next.ts = d.getTime(); next.timeSrc = 'manual'; }
    }
    await saveEntry(next);
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur(); // Safari keeps a field focused when a button is tapped, which would keep the sheet from refreshing
    render();
    toast(t('Entry updated'));
  },
  'chart-range': (el) => { S.chartRange = ['week', 'whole'].includes(el.dataset.v) ? el.dataset.v : 'weeks'; render(); },
  'cal': (el) => { S.calPick = S.calPick === el.dataset.day ? null : el.dataset.day; render(); },
  'goto-day': (el) => { if (el.dataset.day <= today()) { S.viewDay = el.dataset.day; go('today'); } },
  // Settings
  'save-key': async () => {
    if (S.settings.provider === 'openai') {
      // The key is sent to this address, so it must be a secure one; a schemeless address would be read as a path on this site
      const base = $('#set-base').value.trim().replace(/\/+$/, '').replace(/\/chat\/completions$/i, '');
      if (base && !/^https:\/\/[^/\s]+/i.test(base)) { toast(t('The address must start with https://')); return false; }
      S.settings.oaBase = base;
      S.settings.oaModel = $('#set-oamodel').value.trim();
      S.settings.oaKey = $('#set-oakey').value.trim();
    } else {
      S.settings.apiKey = $('#set-key').value.trim();
      S.settings.model = $('#set-model').value;
    }
    await saveSettings();
    toast(aiCfg().key ? t('Saved on this device') : t('Key removed'));
    render();
    await openSettings();
    if (hasKey()) ACT['analyze-all']();
  },
  'test-key': async () => {
    if ((await ACT['save-key']()) === false) return;
    const out = $('#key-test');
    if (!hasKey()) { out.textContent = S.settings.provider === 'openai' ? t('Address, model and key are all required.') : t('A key is required.'); return; }
    const cfg = aiCfg();
    const add = (u) => addUsage(cfg.model, u);
    // Always show what the provider said, so the cause can be checked
    const gemini = cfg.provider === 'openai' && /generativelanguage\.googleapis\.com/.test(cfg.base || '');
    const limitsHint = (err) => (gemini && ['rate', 'no_quota', 'no_credit', 'needs_billing'].includes(err.code) ? t('Your plan and limits: aistudio.google.com/rate-limit') : '');
    const said = (err) => { const d = errorDetail(err, 300); return !d ? '' : ['rate', 'no_quota'].includes(err.code) ? d : t('The provider said: “{detail}”', { detail: d }); };
    const why = (err) => [AI_ERRORS[err.code] ? td(AI_ERRORS[err.code]) : t('Failed.'), said(err), limitsHint(err)].filter(Boolean).join(' ');
    out.textContent = t('Testing text…');
    let textLine;
    try {
      const r = await analyze({ cfg, text: '1 medium apple', when: new Date() });
      await add(r.usage);
      textLine = t('Text works: “{title}”, {kcal} kcal ({tokensIn} input and {tokensOut} output tokens).', { title: r.data.title, kcal: Math.round(r.data.kcal), tokensIn: r.usage.in, tokensOut: r.usage.out });
      if (r.model !== cfg.model) {
        // The chosen model was out of quota or busy and a fallback answered
        const from = cfg.model;
        const reason = why(r.fallbackFrom);
        cfg.model = r.model;
        if (r.fallbackFrom.code === 'no_quota') {
          S.settings.oaModel = r.model;
          await saveSettings();
          const inp = $('#set-oamodel');
          if (inp) inp.value = r.model;
          textLine = t('{from}: {reason}\nSwitched to {model}. {line}', { from, reason, model: r.model, line: textLine });
        } else {
          textLine = t('{from}: {reason}\nFor now {model} answers instead. {line}', { from, reason, model: r.model, line: textLine });
        }
      }
    } catch (err) {
      out.textContent = t('Text: {why}', { why: why(err) });
      return;
    }
    out.textContent = `${textLine} ${t('Testing photo…')}`;
    try {
      const v = await probeVision(cfg);
      await add(v.usage);
      out.textContent = `${textLine} ${v.ok ? t('Photos work: the model read the number in the test image.') : t('Photos do not work: the model could not read the test image. Pick a model with image support.')}`;
    } catch (err) {
      out.textContent = `${textLine} ${t('Photo: {why}', { why: why(err) })}`;
    }
  },
  'find-vision': async () => {
    if ((await ACT['save-key']()) === false) return;
    const out = $('#key-test');
    if (!S.settings.oaBase || !S.settings.oaKey) { out.textContent = t('Enter the address and key first.'); return; }
    const base = { provider: 'openai', key: S.settings.oaKey, base: S.settings.oaBase };
    out.textContent = t('Fetching the model list…');
    let ids = await listModels(base);
    const zen = /opencode\.ai\/zen\/v1$/.test(S.settings.oaBase);
    if (zen) ids = ids.filter((id) => /free|big-pickle/i.test(id));
    if (!ids.length && zen) ids = ZEN_FREE.slice();
    if (S.settings.oaModel && !ids.includes(S.settings.oaModel)) ids.unshift(S.settings.oaModel);
    ids = ids.slice(0, 16);
    if (!ids.length) { out.textContent = t('Could not fetch the model list. Type a model name and tap “Save and test”.'); return; }
    const lines = [];
    let found = '';
    for (const id of ids) {
      out.textContent = lines.concat(t('{id}: testing…', { id })).join('\n');
      try {
        const v = await probeVision({ ...base, model: id });
        lines.push(v.ok ? t('{id}: read the photo', { id }) : t('{id}: could not read the photo', { id }));
        if (v.ok && !found) found = id;
      } catch (err) {
        lines.push(t('{id}: {label}', { id, label: AI_ERROR_LABEL[err.code] ? td(AI_ERROR_LABEL[err.code]) : t('error') }));
        if (err.code === 'net' || err.code === 'offline' || err.code === 'bad_key') break;
      }
    }
    if (found) {
      S.settings.oaModel = found;
      await saveSettings();
      const inp = $('#set-oamodel');
      if (inp) inp.value = found;
      lines.push(t('Selected model: {model}. Now tap “Save and test”.', { model: found }));
    } else lines.push(t('No model that reads photos was found.'));
    out.textContent = lines.join('\n');
    render();
  },
  'save-targets': async () => {
    const num = (id) => parseFloat($(id).value.replace(',', '.'));
    const patch = {
      startDate: $('#set-start').value, targetDate: $('#set-end').value,
      startKg: num('#set-startkg'), targetKg: num('#set-endkg'),
      kcalRest: Math.round(num('#set-rest')), kcalTrain: Math.round(num('#set-train')), kcalMinDay: Math.round(num('#set-minday')), protein: Math.round(num('#set-prot')),
    };
    if (!patch.startDate || !patch.targetDate || patch.targetDate <= patch.startDate || !(patch.startKg > patch.targetKg) || !(patch.kcalMinDay >= 500) || !(patch.kcalRest >= patch.kcalMinDay) || !(patch.kcalTrain >= patch.kcalRest) || !(patch.protein > 50)) {
      return toast(t('Check the values: the end must be after the start, the goal weight below the start weight, and calories at least {kcal}, as the plan\'s rules say', { kcal: fmtInt(patch.kcalMinDay >= 500 ? patch.kcalMinDay : 500) }));
    }
    S.settings = { ...S.settings, ...patch, proteinMin: Math.round(patch.protein * 0.89) };
    await saveSettings();
    render();
    toast(t('Goals saved'));
  },
  'loc-toggle': async (el) => { S.settings.useLocation = el.checked; await saveSettings(); openSettings(); },
  'review-toggle': async (el) => { S.settings.autoReview = el.checked; await saveSettings(); },
  'coach-day': (el) => {
    if (!hasKey()) return toast(t('Add an API key in Settings to get a note'));
    if (navigator.onLine === false) return toast(t('No connection. Try again when you are online'));
    queueCoach(el.dataset.day);
  },
  'review-day': (el) => {
    if (!hasKey()) return toast(t('Add an API key in Settings to get a review'));
    if (navigator.onLine === false) return toast(t('No connection. Try again when you are online'));
    queueReview(el.dataset.day);
  },
  'loc-save': async (el) => {
    const out = $('#loc-out');
    out.textContent = t('Getting your location…');
    posCache = null;
    const pos = await getPos(true);
    if (!pos) { out.textContent = t('Could not get a location. Check that the browser has location permission.'); return; }
    const name = el.dataset.name;
    S.settings.places = (S.settings.places || []).filter((p) => p.name !== name).concat([{ name, lat: pos.lat, lon: pos.lon }]);
    await saveSettings();
    openSettings();
    toast(t('This spot is saved as “{name}”', { name }));
  },
  'export': () => exportBackup(false),
  'export-photos': () => exportBackup(true),
  'export-sql': () => exportSql(),
  'import': () => $('#set-import').click(),
  'persist': async () => {
    try { if (navigator.storage && navigator.storage.persist) await navigator.storage.persist(); } catch { /* not supported */ }
    openSettings();
  },
  'check-update': async () => {
    const out = $('#update-out');
    if (!swReg) { out.textContent = t('Offline caching is off in this browser; reloading the page is enough.'); return; }
    out.textContent = t('Checking…');
    try {
      await swReg.update();
      // A new version installs itself and the page reloads on its own
      setTimeout(() => { if (document.contains(out)) out.textContent = swReg.installing || swReg.waiting ? t('Installing the new version…') : t('Up to date: this is the latest version.'); }, 1500);
    } catch {
      out.textContent = t('Could not check. Check your internet connection.');
    }
  },
  'hard-reload': async () => {
    try {
      // Only this app's own cache and worker: other apps on the same host share the origin
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k.startsWith(`${APP_ID}-`)).map((k) => caches.delete(k)));
      const here = new URL('./', location.href).href;
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.filter((r) => r.scope === here).map((r) => r.unregister()));
    } catch { /* not supported */ }
    location.reload();
  },
  'wipe': async () => {
    if (busyNow()) return toast(t('Something is still being analysed. Try again in a moment'));
    if (!window.confirm(t('Clear your log? This deletes meals and their photos, weigh-ins, steps, water, coffee, supplements taken, workout days, day reviews and Check verdicts from this device. Your goals, favourites, saved places, plan pictures and API key stay, and so do the badges you have earned. It cannot be undone. Do you have a backup?'))) return;
    const keep = new Set(Object.values(S.settings.planPhotos || {})); // the plan's own pictures stay
    await db.clear('entries'); await db.clear('days'); await db.kvSet('checks', []);
    for (const id of await db.keys('photos')) {
      if (keep.has(id)) continue;
      await db.del('photos', id);
      const u = S.urls.get(id);
      if (u) { URL.revokeObjectURL(u); S.urls.delete(id); }
    }
    delete S.settings.wins; // the next kilo or perfect day is celebrated again
    await saveSettings();
    S.entries = []; S.days = {}; S.checks = []; S.check.openId = null;
    closeSheet();
    render();
    toast(t('Log cleared'));
  },
  // Back to how the app was on its first launch: the database is emptied and the settings start again.
  // The API key and provider can stay, so they need not be typed in again.
  'wipe-all': async () => {
    if (busyNow()) return toast(t('Something is still being analysed. Try again in a moment'));
    const keepKey = !!($('#keep-key') && $('#keep-key').checked);
    const word = t('DELETE', { $id: 'reset.word' }); // the word to type; the Turkish one and the English one are both accepted
    const typed = window.prompt(t('Factory reset: this deletes everything on this device: your log and photos, goals, favourites, saved places, the plan’s pictures and the usage totals. {keyNote} It cannot be undone. Do you have a backup?\n\nType {word} to continue.', { keyNote: keepKey ? t('Your API key and provider stay.') : t('Your API key and provider are deleted too.'), word }));
    if (!typed || !['delete', 'sil'].includes(foldKey(typed.trim()))) return;
    const kept = { lang: S.settings.lang }; // the language is not data: a reset keeps it, and so does its mirror
    if (keepKey) for (const k of ['provider', 'oaBase', 'oaModel', 'oaKey', 'apiKey', 'model']) kept[k] = S.settings[k];
    clearTimeout(announceTimer);
    clearTimeout(badgesTimer);
    // The log goes from memory first: a badge turn that gets in line while the stores are cleared then sees an empty log and writes nothing
    S.entries = []; S.days = {}; S.badges = null; S.badgeIntro = 0; S.rev++;
    for (const store of ['entries', 'days', 'photos', 'kv']) { if (store === 'kv') await badgeQueue(() => db.clear(store)); else await db.clear(store); }
    S.urls.forEach((u) => URL.revokeObjectURL(u));
    S.urls.clear();
    S.check.photos.forEach((p) => URL.revokeObjectURL(p.url));
    S.settings = { ...freshSettings(), ...kept };
    await saveSettings();
    clearTimeout(announceTimer);
    S.entries = []; S.days = {}; S.checks = []; S.badges = null; S.badgeIntro = 0; S.check = freshCheck();
    S.viewDay = today(); S.calPick = null; S.openSetting = ''; S.suppEdit = '';
    S.busy.clear(); S.retry.clear(); S.reviewing.clear(); S.reviewErr.clear(); S.coaching.clear(); S.coachErr.clear(); S.reviewOpen.clear();
    autoTried.clear(); posCache = null; pausedUntil = 0; frame = null; photoTarget = null;
    closeSheet();
    go('today');
    toast(keepKey ? t('Factory reset done. Your API key is kept') : t('Factory reset done'));
  },
};
// Work that a wipe must not run into: it would write its result into the emptied app
const busyNow = () => S.busy.size > 0 || S.reviewing.size > 0 || S.coaching.size > 0 || preparing > 0 || S.check.busy;

// A handler that fails (storage full, a database that will not open) says so, instead of the screen showing
// something that was never saved. Runs fn straight away: file pickers need the tap's own turn.
const report = (err) => toast(t('Could not save: {reason}', { reason: (err && err.message) || t('storage error') }));
function guard(fn, undo) {
  const fail = (err) => { if (undo) undo(); report(err); };
  try {
    const r = fn();
    if (r && typeof r.catch === 'function') r.catch(fail);
  } catch (err) { fail(err); }
}

document.addEventListener('click', (ev) => {
  const el = ev.target.closest('[data-act],.tabs [data-tab],[data-close-sheet]');
  if (!el) return;
  if (el.matches('input[type=checkbox]')) return; // handled on change
  if (el.dataset.closeSheet !== undefined) return closeSheet();
  const act = el.dataset.act || (el.dataset.tab ? 'tab' : '');
  if (ACT[act]) { ev.preventDefault(); guard(() => ACT[act](el)); }
});

// The zoom slider of the framing step
document.addEventListener('input', (ev) => {
  if (ev.target.id === 'frame-zoom') zoomFrame(Number(ev.target.value));
  // What is typed for a check is kept in state, so a re-render does not lose it
  if (ev.target.id === 'check-note') {
    S.check.note = ev.target.value;
    const run = document.querySelector('[data-act="check-run"]');
    if (run) run.disabled = !checkReady();
  }
});

document.addEventListener('change', (ev) => guard(async () => {
  const el = ev.target;
  if (el.id === 'f-cam' || el.id === 'f-lib') {
    const files = Array.from(el.files || []);
    el.value = '';
    // A photo asked for from the Plan screen becomes that meal's picture and is not logged
    const target = photoTarget;
    photoTarget = null;
    if (target === CHECK_PHOTOS) { if (files.length) await addCheckPhotos(files); return; }
    if (target) { if (files.length) await openFrame(target, files[0]); return; }
    const note = $('#composer-input').value.trim();
    if (files.length) { $('#composer-input').value = ''; await submitPhotos(files, note); }
    return;
  }
  if (el.id === 'set-import') { const file = el.files[0]; el.value = ''; if (file) await importBackup(file); return; }
  if (el.dataset.act === 'loc-toggle') return ACT['loc-toggle'](el);
  if (el.dataset.act === 'review-toggle') return ACT['review-toggle'](el);
  if (el.dataset.chg === 'provider') { S.settings.provider = el.value; await saveSettings(); render(); return openSettings(); }
  if (el.dataset.chg === 'preset') {
    const p = PRESETS.find((x) => x.id === el.value);
    if (p) { $('#set-base').value = p.base; $('#set-oamodel').value = p.model; }
  }
}));

// Number sheet: saves a weigh-in or a step count
document.addEventListener('submit', (ev) => {
  const f = ev.target;
  if (f.id !== 'num-form') return;
  ev.preventDefault();
  const raw = $('#num-in').value.trim();
  const err = $('#num-err');
  const day = f.dataset.day;
  if (f.dataset.kind === 'kg') {
    const kg = parseFloat(raw.replace(',', '.'));
    if (!(kg >= 50 && kg <= 160)) { err.textContent = t('Enter a value between 50 and 160 kg. Example: 85.4'); err.hidden = false; return; }
    closeSheet();
    guard(() => setWeight(Math.round(kg * 10) / 10, day, false));
  } else {
    const steps = parseInt(raw.replace(/\D/g, ''), 10);
    if (!(steps >= 0 && steps <= 100000)) { err.textContent = t('Enter the step count in digits. Example: 8200'); err.hidden = false; return; }
    closeSheet();
    guard(() => setSteps(steps, day, false));
  }
});

// Expanded sections survive re-renders (toggle does not bubble, so listen in the capture phase)
document.addEventListener('toggle', (ev) => {
  const d = ev.target;
  if (!d.matches) return;
  if (d.matches('details.setting')) {
    if (d.open) {
      S.openSetting = d.dataset.sec;
      document.querySelectorAll('details.setting[open]').forEach((o) => { if (o !== d) o.open = false; });
    } else if (S.openSetting === d.dataset.sec) S.openSetting = '';
  }
  if (d.matches('details.review-ai')) S.reviewOpen.set(d.dataset.day, d.open);
  if (d.matches('details.coach-ai')) S.reviewOpen.set(`coach:${d.dataset.day}`, d.open);
}, true);

// Tapping an example chip must not take focus away from the composer input
document.addEventListener('pointerdown', (ev) => { if (ev.target.closest('[data-act="hint"]')) ev.preventDefault(); });

$('#btn-cam').addEventListener('click', () => { photoTarget = null; $('#f-cam').click(); });
$('#btn-lib').addEventListener('click', () => { photoTarget = null; $('#f-lib').click(); });
$('#composer').addEventListener('submit', (ev) => {
  ev.preventDefault();
  const inp = $('#composer-input');
  const t = inp.value.trim();
  if (!t) return;
  inp.value = '';
  guard(() => submitText(t), () => { if (!inp.value) inp.value = t; }); // a failed save gives the text back
});
document.addEventListener('keydown', (ev) => {
  if (ev.key === 'Escape' && !$('#sheet').hidden) closeSheet();
  // Enter in the correction box sends it
  if (ev.key === 'Enter' && (ev.target.id === 'supp-name' || ev.target.id === 'supp-dose')) { ev.preventDefault(); guard(ACT['supp-save']); }
  if (ev.key === 'Enter' && ev.target.id === 'check-note') { ev.preventDefault(); ev.target.blur(); guard(runCheck); }
  if (ev.key === 'Enter' && ev.target.id && ev.target.id.startsWith('answer-')) {
    ev.preventDefault();
    guard(() => ACT.answer({ dataset: { id: ev.target.id.slice(7) } }));
  }
});

// If the app stayed open past midnight, move on to the new day
let lastToday = today();
function newDay() {
  const t = today();
  if (t === lastToday) return false;
  if (S.viewDay === lastToday) S.viewDay = t;
  lastToday = t;
  return true;
}
document.addEventListener('visibilitychange', () => {
  if (!RUNS || document.visibilityState !== 'visible') return;
  newDay();
  render();
  autoReview();
});
// ...and when it stays open and in front through midnight
setInterval(() => { if (RUNS && document.visibilityState === 'visible' && newDay()) { render(); autoReview(); } }, 60000);

// ——— Updates ———
// When a new service worker takes control the page is still running old files, so it reloads.
let swReg = null;
function safeToReload() {
  const c = S.check;
  const working = S.busy.size || S.reviewing.size || S.coaching.size || preparing || c.busy || c.photos.length || c.note; // nothing in flight or half-written
  return $('#sheet').hidden && !$('#composer-input').value && !working && !(document.activeElement && /INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName));
}
function setupUpdates() {
  if (!('serviceWorker' in navigator) || location.protocol === 'file:') return;
  const hadController = !!navigator.serviceWorker.controller;
  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController || reloading) return; // no reload needed on first install
    if (safeToReload()) { reloading = true; location.reload(); } else toast(t('A new version is ready'), { label: t('Reload'), fn: () => location.reload() });
  });
  navigator.serviceWorker.register('./sw.js', { updateViaCache: 'none' }).then((reg) => { swReg = reg; }).catch(() => {});
  // A Home Screen app that was waiting in the background also checks when it comes forward
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && swReg) swReg.update().catch(() => {}); });
}

// Waiting entries go again as soon as the connection is back
window.addEventListener('online', () => { if (RUNS) resumePending(); });

(async function start() {
  setupUpdates(); // first, so that a fixed version can still arrive when the database does not open
  const mirror = storedLang();
  const mirrorLoaded = await applyLang(mirror); // the mirror in localStorage is read at once, so the first paint is already in the right language
  if (!RUNS) { $('.tabs').hidden = true; $('#view').innerHTML = installHtml(); return; } // a browser tab would get its own, separate database
  try {
    await load();
    // The stored setting wins over the mirror; when it is the one that just failed to load, it is not tried (and toasted) a second time
    if (S.settings.lang !== getLang() && !(S.settings.lang === mirror && !mirrorLoaded)) await applyLang(S.settings.lang);
    rememberLang(S.settings.lang);
  } catch (err) {
    $('#view').innerHTML = `<div class="empty"><h1>${t('Could not open the database')}</h1><p>${t('Local storage may be off in private browsing. Open the app in a normal window or add it to the Home Screen.')}</p></div>`;
    return;
  }
  render();
  refreshStorage();
  try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist().then((p) => { S.persisted = p; }); } catch { /* not supported */ }
  resumePending(); // unfinished analyses resume when there is a key and a connection
  autoReview();
})();

// For tests and debugging
if (location.hostname === 'localhost') window.__app = { S, parseLocal, render, submitPhotos, dayVerdict, verdictText, reviewBrief, autoReview, checkBrief };

// Keep the composer above the on-screen keyboard
if (window.visualViewport) {
  const vv = window.visualViewport;
  // Only a focused field has a keyboard: pulling the page past its edge or zooming also changes the visual viewport,
  // and that must not lift the composer or hide the tabs
  const typing = () => { const t = document.activeElement && document.activeElement.tagName; return t === 'INPUT' || t === 'TEXTAREA' || t === 'SELECT'; };
  const onViewport = () => {
    const kb = typing() ? Math.max(0, window.innerHeight - vv.height - Math.max(0, vv.offsetTop)) : 0;
    document.documentElement.style.setProperty('--kb', kb + 'px');
    document.body.classList.toggle('kb-open', kb > 120);
  };
  vv.addEventListener('resize', onViewport);
  vv.addEventListener('scroll', onViewport);
  document.addEventListener('focusin', onViewport);
  document.addEventListener('focusout', () => setTimeout(onViewport, 0));
}
