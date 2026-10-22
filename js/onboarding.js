// First-run setup: the checks on what the setup form collects and the settings it produces. No DOM and no text for
// people: a failed check is a { field, code } the screen turns into words. `node --test`
import { T } from './i18n.js';
import { RANGES, GENDERS } from './backup.js';
import { DEFAULTS } from './plan.js';

export const NAME_MAX = 40;
export const AGE_RANGE = [18, 120];
export const KCAL_FLOOR = 500;
export const PROTEIN_MIN = 50;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

const realDay = (d) => { const t = Date.parse(`${d}T00:00:00Z`); return Number.isFinite(t) && new Date(t).toISOString().slice(0, 10) === d; };

export function newClientId() {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  const b = new Uint8Array(16);
  c.getRandomValues(b);
  b[6] = (b[6] & 0x0f) | 0x40; // version 4
  b[8] = (b[8] & 0x3f) | 0x80; // variant 10
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

// A number as typed (comma decimals allowed) or already a number; NaN when empty or not a number
const read = (v) => {
  if (typeof v === 'number') return v;
  if (typeof v !== 'string' || !v.trim()) return NaN;
  return Number(v.trim().replace(',', '.'));
};

// The optional profile fields (name, age, gender), checked the same way in setup and in Settings: reports through bad(field, code), writes value
function readProfile(input, bad, value) {
  const rawName = input.name == null ? '' : input.name;
  if (typeof rawName !== 'string') bad('name', 'invalid');
  else {
    const name = rawName.replace(/[\u0000-\u001f\u007f-\u009f]/g, '').trim();
    if (name.length > NAME_MAX) bad('name', 'too_long');
    else value.name = name;
  }
  const rawAge = input.age == null ? '' : input.age;
  if (typeof rawAge === 'string' && !rawAge.trim()) value.age = 0;
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
  if (!Number.isFinite(weight)) bad('weight', 'required');
  else if (weight < lo || weight > hi) bad('weight', 'range');
  else value.weight = weight;
  const [tlo, thi] = RANGES.targetKg;
  const targetKg = read(input.targetKg);
  if (!Number.isFinite(targetKg)) bad('targetKg', 'required');
  else if (targetKg < tlo || targetKg > thi) bad('targetKg', 'range');
  else if (value.weight !== undefined && !(targetKg < weight)) bad('targetKg', 'not_below_weight');
  else value.targetKg = targetKg;
  const td = typeof input.targetDate === 'string' ? input.targetDate.trim() : '';
  if (!td) bad('targetDate', 'required');
  else if (!DAY_RE.test(td) || !realDay(td)) bad('targetDate', 'invalid');
  else if (!(td > today)) bad('targetDate', 'not_after_today');
  else value.targetDate = td;
  const kcalRest = Math.round(read(input.kcalRest));
  if (!Number.isFinite(kcalRest)) bad('kcalRest', 'required');
  else if (kcalRest < KCAL_FLOOR) bad('kcalRest', 'below_floor');
  else if (kcalRest > RANGES.kcalRest[1]) bad('kcalRest', 'range');
  else value.kcalRest = kcalRest;
  const kcalTrain = Math.round(read(input.kcalTrain));
  if (!Number.isFinite(kcalTrain)) bad('kcalTrain', 'required');
  else if (kcalTrain > RANGES.kcalTrain[1]) bad('kcalTrain', 'range');
  else if (value.kcalRest !== undefined && kcalTrain < kcalRest) bad('kcalTrain', 'below_rest');
  else if (kcalTrain < KCAL_FLOOR) bad('kcalTrain', 'below_floor');
  else value.kcalTrain = kcalTrain;
  const protein = Math.round(read(input.protein));
  if (!Number.isFinite(protein)) bad('protein', 'required');
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
    kcalRest: input.kcalRest, kcalTrain: input.kcalTrain, protein: input.protein, proteinMin: Math.round(input.protein * 0.89),
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

const GOAL_KEYS = ['startDate', 'startKg', 'targetDate', 'targetKg', 'kcalRest', 'kcalTrain', 'protein', 'proteinMin'];
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
