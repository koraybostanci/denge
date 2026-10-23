// First-run setup: the checks on what the setup form collects and the settings it produces. No DOM and no text for
// people: a failed check is a { field, code } the screen turns into words. `node --test`
import { T } from './i18n.js';
import { RANGES, GENDERS, squeeze } from './backup.js';
import { DEFAULTS } from './plan.js';
import { PERSONAL } from './core.js';

export const GOAL_KEYS = PERSONAL; // one list of the goal settings (core.js owns it: it cannot import this file)

export const NAME_MAX = 40;
export const AGE_RANGE = [18, 120];
export const KCAL_FLOOR = 500;
export const PROTEIN_MIN = 50;
export const PROTEIN_MIN_RATIO = 0.89; // the same ratio save-targets in app.js uses
export const MAX_LOSS_PER_WEEK = 2; // kg per week: a product choice, not medical advice; a goal that needs more is not a steady pace
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

const realDay = (d) => { const t = Date.parse(`${d}T00:00:00Z`); return Number.isFinite(t) && new Date(t).toISOString().slice(0, 10) === d; };

export function newClientId() {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  // no Web Crypto: no id at all, never one from the clock, the timer or Math.random
  if (!c || typeof c.getRandomValues !== 'function') return '';
  const h = [...c.getRandomValues(new Uint8Array(16))].map((x) => x.toString(16).padStart(2, '0')).join('');
  const v = h.slice(0, 12) + '4' + h.slice(13, 16) + '89ab'[parseInt(h[16], 16) & 3] + h.slice(17); // version 4, variant 10
  return `${v.slice(0, 8)}-${v.slice(8, 12)}-${v.slice(12, 16)}-${v.slice(16, 20)}-${v.slice(20)}`;
}

// The loss the goal needs, kg per week (the weights to 0.1 kg): Infinity when it is due today or earlier and needs a loss, NaN when it cannot be told
export function weeklyLoss(weight, targetKg, today, targetDate) {
  const kg = Math.round((weight - targetKg) * 10) / 10;
  const days = (Date.parse(`${targetDate}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 864e5;
  if (!Number.isFinite(kg) || !Number.isFinite(days)) return NaN;
  if (days <= 0) return kg > 0 ? Infinity : NaN;
  return kg / days * 7;
}
// True when the goal needs more than MAX_LOSS_PER_WEEK (a hair of slack for float noise); false when it cannot be told
export const tooFast = (weight, targetKg, today, targetDate) => weeklyLoss(weight, targetKg, today, targetDate) > MAX_LOSS_PER_WEEK + 1e-9;

// Settings: a changed goal is judged by the loss still ahead, from the current weight and today.
// Returns true only when a goal field changed and the remaining pace is too fast; unchanged goals
// are accepted even if the stored plan is already past the limit. startKg only feeds the pace
// (as the fallback current weight) while there is no weigh-in; startDate never does.
export function goalPaceError(stored, patch, currentKg, today, hasWeighIn) {
  const changed = patch.targetDate !== stored.targetDate || patch.targetKg !== stored.targetKg || (!hasWeighIn && patch.startKg !== stored.startKg);
  return changed && tooFast(currentKg, patch.targetKg, today, patch.targetDate);
}

// A number typed into a field: digits with one decimal separator ('.' or ','), or (integer fields only) a thousands form
// like '1,550', '1.550' or '1 550'. Anything else ('85kg', '85.4.2', '1e2', '0x10', 'Infinity', '-5') is NaN.
export function parseNumberInput(str, integer = false) {
  if (typeof str === 'number') return Number.isFinite(str) ? str : NaN;
  if (typeof str !== 'string') return NaN;
  const s = str.trim();
  if (integer && /^\d{1,3}([.,\s\u00a0]\d{3})+$/.test(s)) return Number(s.replace(/[.,\s\u00a0]/g, ''));
  if (/^\d+([.,]\d+)?$/.test(s)) return Number(s.replace(',', '.'));
  return NaN;
}

// A number as typed or already a number: NaN when empty (required), null when it is text that is not a number (invalid)
const read = (v, integer = false) => {
  if (typeof v === 'number') return v;
  if (typeof v !== 'string' || !v.trim()) return NaN;
  const n = parseNumberInput(v, integer);
  return Number.isNaN(n) ? null : n;
};
const rnd = (x) => (typeof x === 'number' ? Math.round(x) : x);

// The optional profile fields (name, age, gender), checked the same way in setup and in Settings: reports through bad(field, code), writes value
function readProfile(input, bad, value) {
  const rawName = input.name == null ? '' : input.name;
  if (typeof rawName !== 'string') bad('name', 'invalid');
  else {
    const name = squeeze(rawName, Infinity); // the same cleaning as a restore
    if (name.length > NAME_MAX) bad('name', 'too_long');
    else value.name = name;
  }
  const rawAge = input.age == null ? '' : input.age;
  if ((typeof rawAge === 'string' && !rawAge.trim()) || rawAge === 0) value.age = 0;
  else {
    const age = typeof rawAge === 'number' ? rawAge : typeof rawAge === 'string' && /^\d+$/.test(rawAge.trim()) ? Number(rawAge.trim()) : NaN;
    if (!Number.isInteger(age) || age < AGE_RANGE[0] || age > AGE_RANGE[1]) bad('age', 'range');
    else value.age = age;
  }
  const gender = input.gender == null ? '' : input.gender;
  if (gender === '' || GENDERS.includes(gender)) value.gender = gender;
  else bad('gender', 'invalid');
}

// The profile saved from Settings: { name, age, gender } as typed; gives { ok, errors: [{ field, code }], value }
export function validateProfile(input) {
  input = input && typeof input === 'object' ? input : {};
  const errors = [];
  const value = {};
  readProfile(input, (field, code) => errors.push({ field, code }), value);
  return { ok: errors.length === 0, errors, value };
}

// input: { weight, targetKg, targetDate, kcalRest, kcalTrain, protein, name?, age?, gender? }, today: 'YYYY-MM-DD'
// Gives { ok, errors: [{ field, code }], value }; value holds the cleaned fields when ok
export function validateOnboarding(input, today) {
  input = input && typeof input === 'object' ? input : {};
  const errors = [];
  const bad = (field, code) => errors.push({ field, code });
  const value = {};
  const [lo, hi] = RANGES.startKg;
  const weight = read(input.weight);
  if (weight === null) bad('weight', 'invalid');
  else if (!Number.isFinite(weight)) bad('weight', 'required');
  else if (weight < lo || weight > hi) bad('weight', 'range');
  else value.weight = weight;
  const [tlo, thi] = RANGES.targetKg;
  const targetKg = read(input.targetKg);
  if (targetKg === null) bad('targetKg', 'invalid');
  else if (!Number.isFinite(targetKg)) bad('targetKg', 'required');
  else if (targetKg < tlo || targetKg > thi) bad('targetKg', 'range');
  else if (value.weight !== undefined && !(targetKg < weight)) bad('targetKg', 'not_below_weight');
  else value.targetKg = targetKg;
  const td = typeof input.targetDate === 'string' ? input.targetDate.trim() : '';
  if (!td) bad('targetDate', 'required');
  else if (!DAY_RE.test(td) || !realDay(td) || !(typeof today === 'string' && DAY_RE.test(today) && realDay(today))) bad('targetDate', 'invalid');
  else if (!(td > today)) bad('targetDate', 'not_after_today');
  else if (value.weight !== undefined && value.targetKg !== undefined && tooFast(value.weight, value.targetKg, today, td)) bad('targetDate', 'too_fast');
  else value.targetDate = td;
  const kcalRest = rnd(read(input.kcalRest, true));
  if (kcalRest === null) bad('kcalRest', 'invalid');
  else if (!Number.isFinite(kcalRest)) bad('kcalRest', 'required');
  else if (kcalRest < KCAL_FLOOR) bad('kcalRest', 'below_floor');
  else if (kcalRest > RANGES.kcalRest[1]) bad('kcalRest', 'range');
  else value.kcalRest = kcalRest;
  const kcalTrain = rnd(read(input.kcalTrain, true));
  if (kcalTrain === null) bad('kcalTrain', 'invalid');
  else if (!Number.isFinite(kcalTrain)) bad('kcalTrain', 'required');
  else if (kcalTrain > RANGES.kcalTrain[1]) bad('kcalTrain', 'range');
  else if (value.kcalRest !== undefined && kcalTrain < kcalRest) bad('kcalTrain', 'below_rest');
  else if (kcalTrain < KCAL_FLOOR) bad('kcalTrain', 'below_floor');
  else value.kcalTrain = kcalTrain;
  const protein = rnd(read(input.protein, true));
  if (protein === null) bad('protein', 'invalid');
  else if (!Number.isFinite(protein)) bad('protein', 'required');
  else if (protein < PROTEIN_MIN) bad('protein', 'below_min');
  else if (protein > RANGES.protein[1]) bad('protein', 'range');
  else value.protein = protein;

  readProfile(input, bad, value);
  return { ok: errors.length === 0, errors, value };
}

// The settings a finished setup writes over the fresh ones; input is a validated value (validateOnboarding's)
export function settingsFromOnboarding(input, today, clientId) {
  return {
    startDate: today, startKg: input.weight, targetKg: input.targetKg, targetDate: input.targetDate,
    kcalRest: input.kcalRest, kcalTrain: input.kcalTrain, protein: input.protein, proteinMin: Math.round(input.protein * PROTEIN_MIN_RATIO),
    kcalMinDay: Math.min(DEFAULTS.kcalMinDay, input.kcalRest),
    name: input.name || '', age: input.age || 0, gender: input.gender || '', clientId, onboarded: true,
  };
}

// An empty My plan, named as the editor names the copy of Default it creates
export const blankPlan = (uid) => ({ id: 'P-' + uid, name: T('My plan'), foods: {}, meals: [] });

// Setup is shown only to an install with no settings from a past use and nothing logged (hasData: a boolean the caller works out)
export function needsOnboarding(stored, hasData) {
  const set = stored && typeof stored === 'object' && Number.isFinite(stored.startKg);
  return !set && !hasData;
}

// Settings kept from before setup existed: goals that are missing take the defaults, and the install gets an id
export function upgradeSettings(stored, clientId) {
  const out = { ...(stored && typeof stored === 'object' ? stored : {}) };
  const base = DEFAULTS;
  for (const k of GOAL_KEYS) {
    const ok = typeof base[k] === 'number' ? Number.isFinite(out[k]) : typeof out[k] === 'string' && out[k] !== '';
    if (!ok) out[k] = base[k];
  }
  if (typeof out.clientId !== 'string' || !out.clientId) out.clientId = clientId;
  out.onboarded = true;
  return out;
}
