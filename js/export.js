// SQL export: one text file that builds the app's tables in any SQLite database.
//   sqlite3 -bail pickle.db < pickle-export-2026-10-03.sql
// (-bail stops at the first error, so a failed load is rolled back instead of leaving half the tables.)
// Loading the file again replaces the weightplan_* tables and views and touches nothing else (weightplan: the app's
// internal id, APP_ID in core.js, which stays when the app is renamed, so queries keep working).
import { targetAt, dayKey, addDays } from './plan.js';
import { trendSeriesOf } from './core.js';

// The export's own version, for whoever loads the .sql file. It moves when the tables change (the backup file's
// SCHEMA_VERSION does not: a new kv key is invisible to it), and an export is always a full one, never a patch.
export const EXPORT_SCHEMA = 7;
export const exportName = (now = new Date()) => `pickle-export-${dayKey(now)}.sql`;

const text = (v) => (v == null || v === '' ? 'NULL' : `'${String(v).replace(/\u0000/g, '').replace(/'/g, "''")}'`);
const num = (v, digits = 2) => (v == null || v === '' || !Number.isFinite(+v) ? 'NULL' : String(+(+v).toFixed(digits)));
const int = (v) => (v == null || v === '' || !Number.isFinite(+v) ? 'NULL' : String(Math.round(+v)));
const pad = (n) => String(n).padStart(2, '0');
const localTime = (ts) => {
  const d = new Date(ts);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
};

const SCHEMA = `
CREATE TABLE weightplan_settings (
  key   TEXT PRIMARY KEY,
  value TEXT
);

CREATE TABLE weightplan_days (
  day              TEXT PRIMARY KEY,            -- YYYY-MM-DD
  weight_kg        REAL,                        -- that day's weigh-in
  weight_trend_kg  REAL,                        -- the trend weight on the day (see the app's Progress tab); NULL with no weigh-in in the 7 days up to it
  steps            INTEGER,
  water_ml         INTEGER,
  coffee_cups      INTEGER,                     -- the day's coffee tally; NULL when none was ever added
  workout          INTEGER NOT NULL DEFAULT 0,  -- 1 on workout days
  target_kcal      INTEGER NOT NULL,            -- the day's calorie budget under the current Goals, so changing them changes past rows
  target_weight_kg REAL                         -- where the schedule stood on the day; NULL before the start date
);

CREATE TABLE weightplan_badges (
  id        TEXT NOT NULL,                      -- the badge: first_meal, days_on, best_run, ...
  threshold INTEGER NOT NULL,                   -- the step earned: 1 for a one-off badge, otherwise the count (7, 30, 100, ...)
  day       TEXT NOT NULL,                      -- YYYY-MM-DD, the day it was earned
  PRIMARY KEY (id, threshold)
);

CREATE TABLE weightplan_supplements (
  id   TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  dose TEXT                                     -- as typed, for example 400 mg; NULL when none
);

CREATE TABLE weightplan_supplement_log (
  day           TEXT NOT NULL,                  -- YYYY-MM-DD
  supplement_id TEXT NOT NULL,                  -- weightplan_supplements.id; one row per supplement ticked that day
  PRIMARY KEY (day, supplement_id)
);

CREATE TABLE weightplan_meals (
  id         TEXT PRIMARY KEY,
  day        TEXT NOT NULL,                     -- YYYY-MM-DD
  logged_at  TEXT NOT NULL,                     -- local time, YYYY-MM-DD HH:MM:SS
  slot       TEXT,                              -- morning, lunch, snack1, snack2, dinner, late, workout
  title      TEXT,
  source     TEXT,                              -- plan, flex, favorite, photo, text, check
  plan_id    TEXT,                              -- id of the plan meal, if it was one
  tier       TEXT,                              -- plan, flex, off
  status     TEXT NOT NULL,                     -- ok, pending, error; only ok rows have numbers
  portion    REAL NOT NULL DEFAULT 1,           -- 0.5, 1, 1.5 or 2
  kcal       REAL,                              -- kcal and the macros are already multiplied by portion
  protein_g  REAL,
  carbs_g    REAL,
  fat_g      REAL,
  fibre_g    REAL,
  confidence REAL,                              -- 0 to 1: the model's own estimate; 1 for meals you tapped or edited; NULL when unknown
  place      TEXT,                              -- Home, Office or out, when photo location is on
  note       TEXT,                              -- what was typed
  photos     INTEGER NOT NULL DEFAULT 0,        -- number of photos; the photos themselves are not exported
  flags      TEXT                               -- comma-separated, for example alcohol
);
CREATE INDEX weightplan_meals_day ON weightplan_meals (day);

CREATE TABLE weightplan_meal_items (
  meal_id   TEXT NOT NULL REFERENCES weightplan_meals (id),
  position  INTEGER NOT NULL,
  name      TEXT,
  grams     REAL,                               -- multiplied by the meal's portion, like kcal and protein_g
  kcal      REAL,
  protein_g REAL,
  carbs_g   REAL,
  fat_g     REAL,
  fibre_g   REAL,
  PRIMARY KEY (meal_id, position)
);

CREATE TABLE weightplan_foods (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,                 -- what the person named it, brand typed in, for example "Eker Skyr natural"
  kcal        REAL,                          -- the five values below per 100 g, as stored
  protein_g   REAL,
  carbs_g     REAL,
  fat_g       REAL,
  fibre_g     REAL,
  ingredients TEXT,                          -- the ingredients text, as typed; NULL when there is none
  last_used   TEXT,                          -- local time the food was last used; NULL when never
  has_photo   INTEGER NOT NULL DEFAULT 0     -- 1 when the food has a photo; the photo itself is not exported
);

-- One row per day: the day's own values, the trend weight the app uses, the plain 7-day weight average, and the meal totals.
-- beers: the planned extras flagged alcohol (Beer 0.33 l, Beer 0.5 l, or a typed "2 beers").
CREATE VIEW weightplan_daily AS
SELECT
  d.day,
  d.weight_kg,
  d.weight_trend_kg,
  (SELECT ROUND(AVG(w.weight_kg), 2) FROM weightplan_days w
    WHERE w.weight_kg IS NOT NULL AND w.day BETWEEN date(d.day, '-6 days') AND d.day) AS weight_avg7_kg,
  d.target_weight_kg,
  d.steps,
  d.water_ml,
  d.coffee_cups,
  d.workout,
  d.target_kcal,
  COALESCE(m.meals, 0)                AS meals,
  COALESCE(m.beers, 0)                AS beers,
  ROUND(COALESCE(m.kcal, 0), 1)       AS kcal,
  ROUND(COALESCE(m.protein_g, 0), 1)  AS protein_g,
  ROUND(COALESCE(m.carbs_g, 0), 1)    AS carbs_g,
  ROUND(COALESCE(m.fat_g, 0), 1)      AS fat_g,
  ROUND(COALESCE(m.fibre_g, 0), 1)    AS fibre_g
FROM weightplan_days d
LEFT JOIN (
  SELECT day, COUNT(*) AS meals, SUM(kcal) AS kcal, SUM(protein_g) AS protein_g,
         SUM(carbs_g) AS carbs_g, SUM(fat_g) AS fat_g, SUM(fibre_g) AS fibre_g,
         SUM(CASE WHEN source = 'flex' AND flags LIKE '%alcohol%' THEN 1 ELSE 0 END) AS beers
  FROM weightplan_meals WHERE status = 'ok' GROUP BY day
) m ON m.day = d.day;
`;

/**
 * @param {{settings: object, entries: object[], days: object[], badges?: object, foods?: object[], appVersion: string, now?: Date}} data
 * @returns {{sql: string, counts: {days: number, meals: number, items: number}}}
 */
export function buildSql({ settings: s, entries, days, badges = {}, foods = [], appVersion, now = new Date() }) {
  const out = [];
  out.push(
    `-- Pickle export, ${localTime(now.getTime())} (app version ${appVersion}, export schema ${EXPORT_SCHEMA})`,
    '-- Load it into a new or existing SQLite database:',
    `--   sqlite3 -bail pickle.db < ${exportName(now)}`,
    '-- Loading again replaces the weightplan_* tables and the weightplan_daily view; nothing else in the database is touched.',
    '-- Not included: photos, API keys, the coordinates of saved places.',
    '',
    'BEGIN TRANSACTION;',
    'DROP VIEW IF EXISTS weightplan_daily;',
    'DROP TABLE IF EXISTS weightplan_badges;',
    'DROP TABLE IF EXISTS weightplan_supplement_log;',
    'DROP TABLE IF EXISTS weightplan_supplements;',
    'DROP TABLE IF EXISTS weightplan_meal_items;',
    'DROP TABLE IF EXISTS weightplan_meals;',
    'DROP TABLE IF EXISTS weightplan_foods;',
    'DROP TABLE IF EXISTS weightplan_days;',
    'DROP TABLE IF EXISTS weightplan_settings;',
    SCHEMA,
  );

  const settings = [
    ['export_schema', EXPORT_SCHEMA], ['exported_at', localTime(now.getTime())], ['app_version', appVersion],
    ['start_date', s.startDate], ['target_date', s.targetDate], ['start_weight_kg', s.startKg], ['target_weight_kg', s.targetKg],
    ['kcal_rest_day', s.kcalRest], ['kcal_workout_day', s.kcalTrain], ['protein_g', s.protein], ['fibre_g', s.fiber],
    ['steps', s.steps], ['water_ml', s.water],
  ];
  for (const [k, v] of settings) out.push(`INSERT INTO weightplan_settings (key, value) VALUES (${text(k)}, ${text(v)});`);
  out.push('');

  // Every day that has a day record or a meal gets a row, so weightplan_daily has no gaps where something was logged
  const meals = entries.filter((e) => e.kind === 'meal').sort((a, b) => a.ts - b.ts);
  const byDay = new Map(days.map((d) => [d.day, d]));
  for (const e of meals) if (!byDay.has(e.day)) byDay.set(e.day, { day: e.day });
  const dayRows = Array.from(byDay.values()).filter((d) => d.day).sort((a, b) => (a.day < b.day ? -1 : 1));
  // The trend weight, worked out by the same function as the app's screens; a day shows it when a weigh-in lies in the 7 days up to it
  const weighIns = dayRows.filter((d) => Number.isFinite(+d.kg) && +d.kg > 0).map((d) => ({ day: d.day, kg: +d.kg }));
  const trendRows = trendSeriesOf(weighIns, s);
  const trendOn = (day) => {
    const upto = trendRows.filter((r) => r.day <= day);
    const last = upto.findLast((r) => !r.skipped);
    return last && upto.some((r) => r.day >= addDays(day, -6)) ? last.trend : null;
  };
  for (const d of dayRows) {
    const targetKg = d.day >= s.startDate ? targetAt(d.day, s) : null;
    out.push(`INSERT INTO weightplan_days (day, weight_kg, weight_trend_kg, steps, water_ml, coffee_cups, workout, target_kcal, target_weight_kg) VALUES (${text(d.day)}, ${num(d.kg)}, ${num(trendOn(d.day))}, ${int(d.steps)}, ${int(d.water)}, ${int(d.coffee)}, ${d.train ? 1 : 0}, ${int(d.train ? s.kcalTrain : s.kcalRest)}, ${num(targetKg)});`);
  }
  out.push('');

  const supps = s.supplements || [];
  const known = new Set(supps.map((x) => x.id));
  for (const x of supps) out.push(`INSERT INTO weightplan_supplements (id, name, dose) VALUES (${text(x.id)}, ${text(x.name)}, ${text(x.dose)});`);
  for (const d of dayRows) for (const id of (d.taken || [])) if (known.has(id)) out.push(`INSERT INTO weightplan_supplement_log (day, supplement_id) VALUES (${text(d.day)}, ${text(id)});`);
  out.push('');

  for (const [id, steps] of Object.entries(badges || {})) for (const [thr, d] of Object.entries(steps || {})) out.push(`INSERT INTO weightplan_badges (id, threshold, day) VALUES (${text(id)}, ${int(thr)}, ${text(d)});`);
  out.push('');

  // The pantry: values per 100 g and the photo only as a flag, never as bytes
  for (const f of (Array.isArray(foods) ? foods : []).filter((f) => f && f.id)) {
    const v = (i) => num(Array.isArray(f.v) ? f.v[i] : null);
    out.push(`INSERT INTO weightplan_foods (id, name, kcal, protein_g, carbs_g, fat_g, fibre_g, ingredients, last_used, has_photo) VALUES (${text(f.id)}, ${text(f.name)}, ${v(0)}, ${v(1)}, ${v(2)}, ${v(3)}, ${v(4)}, ${text(f.ing)}, ${f.lastUsed > 0 && f.lastUsed <= 1e14 ? text(localTime(f.lastUsed)) : 'NULL'}, ${f.photo ? 1 : 0});`);
  }
  out.push('');

  let items = 0;
  for (const e of meals) {
    const ok = e.status === 'ok';
    const m = e.mult || 1;
    const v = (x) => (ok ? num((x || 0) * m) : 'NULL');
    out.push(`INSERT INTO weightplan_meals (id, day, logged_at, slot, title, source, plan_id, tier, status, portion, kcal, protein_g, carbs_g, fat_g, fibre_g, confidence, place, note, photos, flags) VALUES (${[
      text(e.id), text(e.day), text(localTime(e.ts)), text(e.slot), text(e.title), text(e.src), text(e.planId), text(ok ? e.tier : null),
      text(e.status), num(m), v(e.kcal), v(e.p), v(e.c), v(e.f), v(e.fib), ok && e.conf > 0 ? num(e.conf) : 'NULL',
      text(e.place), text(e.text), int((e.photoIds || []).length), text((e.flags || []).join(',')),
    ].join(', ')});`);
    if (!ok) continue;
    (e.items || []).forEach((it, i) => {
      items += 1;
      out.push(`INSERT INTO weightplan_meal_items (meal_id, position, name, grams, kcal, protein_g, carbs_g, fat_g, fibre_g) VALUES (${text(e.id)}, ${i + 1}, ${text(it.n)}, ${it.g ? num(it.g * m) : 'NULL'}, ${num((it.kcal || 0) * m)}, ${num((it.p || 0) * m)}, ${num((it.c || 0) * m)}, ${num((it.f || 0) * m)}, ${num((it.fib || 0) * m)});`);
    });
  }
  out.push('', 'COMMIT;', '');
  return { sql: out.join('\n'), counts: { days: dayRows.length, meals: meals.length, items } };
}

