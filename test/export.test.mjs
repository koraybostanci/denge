// The SQL export (js/export.js), loaded into a real SQLite and queried the way the README does. `node --test`
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { buildSql } from '../js/export.js';

const settings = { startDate: '2026-10-05', targetDate: '2026-12-31', startKg: 86, targetKg: 78, kcalRest: 1550, kcalTrain: 1750, protein: 135, fiber: 30, steps: 8000, water: 2500 };
const meal = (id, day, extra) => ({ id, day, ts: new Date(`${day}T12:00:00`).getTime(), kind: 'meal', status: 'ok', slot: 'lunch', title: `It's ${id}`, src: 'text', kcal: 800, p: 40, c: 50, f: 30, fib: 5, mult: 1, tier: 'plan', conf: 0.7, photoIds: [], flags: [], items: [{ n: 'egg', g: 100, kcal: 143, p: 12, c: 0.7, f: 10, fib: 0 }], ...extra });
const entries = [
  meal('a', '2026-10-06', {}),
  meal('b', '2026-10-06', { kcal: 1000, tier: 'off', title: "semi;colon -- and 'quotes'\nnewline", mult: 1.5, items: [{ n: 'egg', g: 100, kcal: 143, p: 12 }] }),
  meal('c', '2026-10-07', { status: 'pending', kcal: 0 }),
  meal('d', '2026-10-06', { title: 'Beer 0.5 l', src: 'flex', tier: 'flex', slot: 'late', kcal: 215, flags: ['alcohol'], items: [] }),
];
const days = [{ day: '2026-10-06', kg: 85.4, steps: 8200, water: 2000, coffee: 2 }, { day: '2026-10-07', kg: 85.0, train: true }];
const load = (db) => db.exec(buildSql({ settings, entries, days, appVersion: 'test' }).sql);
const rows = (db, sql) => db.prepare(sql).all();

test('the file loads, twice, and the numbers are multiplied by the portion', () => {
  const db = new DatabaseSync(':memory:');
  load(db);
  load(db); // a newer export replaces the tables
  assert.equal(rows(db, 'SELECT COUNT(*) AS n FROM weightplan_meals')[0].n, 4);
  const b = rows(db, "SELECT kcal, title, portion FROM weightplan_meals WHERE id = 'b'")[0];
  assert.equal(b.kcal, 1500);
  assert.equal(b.portion, 1.5);
  assert.equal(b.title, "semi;colon -- and 'quotes'\nnewline"); // quoting survives
});

test('only meals with status ok carry numbers', () => {
  const db = new DatabaseSync(':memory:');
  load(db);
  assert.equal(rows(db, "SELECT kcal FROM weightplan_meals WHERE id = 'c'")[0].kcal, null);
});

test('meal items export the macro columns, multiplied by the portion; old items without macros export 0', () => {
  const db = new DatabaseSync(':memory:');
  load(db);
  assert.deepEqual(rows(db, "SELECT name, grams, kcal, protein_g, carbs_g, fat_g, fibre_g FROM weightplan_meal_items WHERE meal_id = 'a' ORDER BY position").map((r) => ({ ...r })),
    [{ name: 'egg', grams: 100, kcal: 143, protein_g: 12, carbs_g: 0.7, fat_g: 10, fibre_g: 0 }]);
  const b = rows(db, "SELECT grams, protein_g, carbs_g, fat_g, fibre_g FROM weightplan_meal_items WHERE meal_id = 'b'")[0];
  assert.deepEqual([b.grams, b.protein_g, b.carbs_g, b.fat_g, b.fibre_g], [150, 18, 0, 0, 0]); // item macros × 1.5, absent macros as 0
});

test('the README queries run', () => {
  const db = new DatabaseSync(':memory:');
  load(db);
  assert.equal(rows(db, 'SELECT day, weight_kg, weight_avg7_kg, target_weight_kg FROM weightplan_daily ORDER BY day').length, 2);
  assert.equal(rows(db, 'SELECT day, kcal, target_kcal FROM weightplan_daily WHERE kcal > target_kcal')[0].day, '2026-10-06');
  assert.equal(rows(db, "SELECT day, title, kcal FROM weightplan_meals WHERE tier = 'off' AND status = 'ok' ORDER BY kcal DESC").length, 1);
  assert.deepEqual(rows(db, "SELECT date(day, 'weekday 0', '-6 days') AS week, SUM(beers) AS beers, SUM(COALESCE(coffee_cups, 0)) AS coffees FROM weightplan_daily GROUP BY week ORDER BY week").map((r) => ({ ...r })),
    [{ week: '2026-10-05', beers: 1, coffees: 2 }]);
});

test('coffee and beers per day: the tally, and the flex entries flagged alcohol', () => {
  const db = new DatabaseSync(':memory:');
  load(db);
  const [a, b] = rows(db, 'SELECT coffee_cups, beers FROM weightplan_daily ORDER BY day');
  assert.deepEqual({ ...a }, { coffee_cups: 2, beers: 1 });
  assert.deepEqual({ ...b }, { coffee_cups: null, beers: 0 });
});

test('loading leaves other tables in the database alone', () => {
  const db = new DatabaseSync(':memory:');
  db.exec("CREATE TABLE mine (x TEXT); INSERT INTO mine VALUES ('keep');");
  load(db);
  assert.equal(rows(db, 'SELECT x FROM mine')[0].x, 'keep');
});

test('the 7-day weight average is over the calendar days, as in the app', () => {
  const db = new DatabaseSync(':memory:');
  load(db);
  const r = rows(db, "SELECT weight_avg7_kg FROM weightplan_daily WHERE day = '2026-10-07'")[0];
  assert.equal(r.weight_avg7_kg, 85.2); // (85.4 + 85.0) / 2
});

test('supplements: the list and what was taken each day are exported; unknown ids are left out', () => {
  const db = new DatabaseSync(':memory:');
  const s = { ...settings, supplements: [{ id: 's1', name: "Vitamin D", dose: '2000 IU' }, { id: 's2', name: 'B12', dose: '' }] };
  db.exec(buildSql({ settings: s, entries, days: [{ day: '2026-10-06', taken: ['s1', 'gone'] }, { day: '2026-10-07', taken: ['s1', 's2'] }], appVersion: 'test' }).sql);
  assert.deepEqual(rows(db, 'SELECT name, dose FROM weightplan_supplements ORDER BY id').map((r) => [r.name, r.dose]), [['Vitamin D', '2000 IU'], [ 'B12', null]]);
  assert.equal(rows(db, 'SELECT COUNT(*) AS n FROM weightplan_supplement_log')[0].n, 3);
});

test('badges: one row per earned step, and none without any', () => {
  const db = new DatabaseSync(':memory:');
  db.exec(buildSql({ settings, entries, days, badges: { days_on: { 7: '2026-10-12', 30: '2026-11-05' }, first_meal: { 1: '2026-10-06' } }, appVersion: 'test' }).sql);
  assert.deepEqual(rows(db, 'SELECT id, threshold, day FROM weightplan_badges ORDER BY id, threshold').map((r) => ({ ...r })), [
    { id: 'days_on', threshold: 7, day: '2026-10-12' }, { id: 'days_on', threshold: 30, day: '2026-11-05' }, { id: 'first_meal', threshold: 1, day: '2026-10-06' },
  ]);
  assert.equal(rows(db, "SELECT value FROM weightplan_settings WHERE key = 'export_schema'")[0].value, '6');
  const none = new DatabaseSync(':memory:');
  load(none);
  load(none);
  assert.equal(rows(none, 'SELECT COUNT(*) AS n FROM weightplan_badges')[0].n, 0);
});

test('the pantry: per 100 g values, the ingredients and a photo flag export and round-trip; no photo bytes', () => {
  const db = new DatabaseSync(':memory:');
  const foods = [
    { id: 'f1', name: "Eker Skyr natural; it's plain", v: [59, 10.5, 4, 0.5, 0], ing: 'Pasteurised milk, cultures', photo: 'fp1', lastUsed: new Date(2026, 9, 6, 12, 0, 0).getTime() },
    { id: 'f2', name: 'Rolled oats', v: [380, 13.2, 60.1, 7.5, 10] },
  ];
  const sql = buildSql({ settings, entries, days, foods, appVersion: 'test' }).sql;
  db.exec(sql);
  db.exec(sql); // loading again replaces the table
  assert.deepEqual(rows(db, 'SELECT name, kcal, protein_g, carbs_g, fat_g, fibre_g, ingredients, last_used, has_photo FROM weightplan_foods ORDER BY id').map((r) => ({ ...r })), [
    { name: "Eker Skyr natural; it's plain", kcal: 59, protein_g: 10.5, carbs_g: 4, fat_g: 0.5, fibre_g: 0, ingredients: 'Pasteurised milk, cultures', last_used: '2026-10-06 12:00:00', has_photo: 1 },
    { name: 'Rolled oats', kcal: 380, protein_g: 13.2, carbs_g: 60.1, fat_g: 7.5, fibre_g: 10, ingredients: null, last_used: null, has_photo: 0 },
  ]);
  assert.ok(!sql.includes('fp1') && !sql.includes('b64') && !sql.includes('data:image'), 'the photo travels only as a flag');
  const none = new DatabaseSync(':memory:');
  none.exec(buildSql({ settings, entries, days, foods: 'junk', appVersion: 'test' }).sql); // junk input exports no rows and no error
  none.exec(buildSql({ settings, entries, days, appVersion: 'test' }).sql); // none when nothing was given either
  assert.equal(rows(none, 'SELECT COUNT(*) AS n FROM weightplan_foods')[0].n, 0);
});
