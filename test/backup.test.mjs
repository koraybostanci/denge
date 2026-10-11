// Everything read from a backup file is checked before it is stored or shown (js/backup.js). `node --test`
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { backupProblem, cleanEntry, cleanDay, cleanCheck, cleanPhoto, cleanSettings, cleanBadges, restoreBadges, b64FromBuf } from '../js/backup.js';
import { SCHEMA_VERSION } from '../js/core.js';

const good = {
  id: 'abc123', ts: 1759300000000, day: '2026-10-01', kind: 'meal', status: 'ok', slot: 'lunch', title: 'Egg', kcal: 500, p: 30, c: 5, f: 20, fib: 2,
  tier: 'plan', flags: ['alcohol'], conf: 0.8, mult: 1.5, photoIds: ['p1'], items: [{ n: 'egg', g: 100, kcal: 143, p: 12 }],
  place: 'Home', timeSrc: 'exif', src: 'photo', q: '', planId: 'L-A', edited: true,
};

test('backupProblem: what can be restored and what cannot', () => {
  const ok = { app: 'weightplan', v: SCHEMA_VERSION, entries: [] };
  assert.equal(backupProblem(ok), '');
  for (const bad of [null, 5, 'x', [], {}, { app: 'other', v: 2, entries: [] }, { app: 'weightplan', v: 2 }]) assert.match(backupProblem(bad), /not a Pickle backup/);
  assert.match(backupProblem({ ...ok, v: SCHEMA_VERSION + 1 }), /newer version/);
  for (const v of [undefined, '2', 2.5, null, NaN]) assert.match(backupProblem({ ...ok, v }), /no valid version/, String(v));
});

test('an entry with a hostile id, a bad day or the wrong shape is dropped', () => {
  assert.equal(cleanEntry({ id: '"><img src=x onerror=1>', day: '2026-10-01', ts: 1 }), null);
  assert.equal(cleanEntry({ id: 'a1', day: 'not-a-day', ts: 1 }), null);
  for (const x of [null, 5, 'x', []]) assert.equal(cleanEntry(x), null);
});

test('a good entry comes through unchanged', () => {
  const c = cleanEntry(good);
  for (const k of Object.keys(good)) assert.deepEqual(c[k], good[k], k);
});

test('entry fields are clamped and given the right type', () => {
  assert.equal(cleanEntry({ ...good, slot: 'constructor' }).slot, 'dinner');
  const c = cleanEntry({ ...good, kcal: 1e9, p: -5, c: 'abc', f: NaN, fib: null });
  assert.deepEqual([c.kcal, c.p, c.c, c.f, c.fib], [6000, 0, 0, 0, 0]);
  assert.equal(cleanEntry({ ...good, kcal: Infinity }).kcal, 0);
  assert.equal(cleanEntry({ ...good, place: { x: 1 } }).place, null);
  assert.deepEqual(cleanEntry({ ...good, photoIds: ['ok1', '"><b>', 5, 'x'.repeat(50)] }).photoIds, ['ok1']);
});

test('a weigh-in keeps only the fields it had', () => {
  const c = cleanEntry({ id: 'w1', ts: 5, day: '2026-10-01', kind: 'weight', status: 'ok', title: 'Weight 85.4 kg', kg: 85.4, src: 'text', photoIds: [], timeSrc: 'now' });
  assert.equal(c.kg, 85.4);
  assert.equal('slot' in c, false);
  assert.equal('kcal' in c, false);
});

test('a day: a review whose lists are strings or null does not break; bad days are dropped', () => {
  const d = cleanDay({ day: '2026-10-01', kg: 85, review: { head: 'h', good: 'one thing', cut: null, next: 'n', sig: 's', ts: 1, live: true } });
  assert.deepEqual(d.review.good, ['one thing']);
  assert.deepEqual(d.review.cut, []);
  assert.equal(cleanDay({ day: '2026-13-45x' }), null);
  assert.equal(cleanDay({ day: '2026-10-01' }).kg, null);
});

test('a day: the coffee tally is a whole number up to 30, or null', () => {
  const coffee = (v) => cleanDay({ day: '2026-10-01', coffee: v }).coffee;
  assert.equal(coffee(3), 3);
  assert.equal(coffee(-2), 0);
  assert.equal(coffee(1e9), 30);
  assert.equal(coffee('x'), null);
  assert.equal(cleanDay({ day: '2026-10-01' }).coffee, null);
});

test('settings: what the app talks to is never taken from a file', () => {
  const s = cleanSettings({
    provider: 'openai', oaBase: 'https://evil.example/v1', oaModel: 'm', model: 'm', apiKey: 'k', oaKey: 'k', usage: { in: 1 }, lastBackup: 9,
    startKg: 90, startDate: '2026-10-05', places: [{ name: 'Home', lat: 1, lon: 2 }],
  });
  for (const k of ['provider', 'oaBase', 'oaModel', 'model', 'apiKey', 'oaKey', 'usage', 'lastBackup']) assert.equal(k in s, false, k);
  assert.equal(s.startKg, 90);
  assert.equal(s.places.length, 1);
});

test('settings: junk values and unknown plan meals are dropped', () => {
  const s = cleanSettings({ startKg: '90', targetKg: 1e9, startDate: '"><x>', kcalRest: -1, protein: 135, planPhotos: { 'L-A': 'p1', constructor: 'p2', 'D-A': '"><x' } });
  assert.deepEqual(Object.keys(s).sort(), ['planPhotos', 'protein']);
  assert.deepEqual(s.planPhotos, { 'L-A': 'p1' });
});

test('a check: ratings, sizes and ids are made safe', () => {
  const c = cleanCheck({ id: 'c1', ts: 5, kind: 'menu', title: 't', answer: 'a', options: [{ name: 'Soup', rating: 99, fit: 'evil', kcal: 1e9, tier: 'x' }], photos: 99 });
  assert.equal(c.options[0].rating, 5);
  assert.equal(c.options[0].fit, 'ok');
  assert.equal(c.options[0].kcal, 5000);
  assert.equal(c.photos, 4);
  assert.equal(cleanCheck({ id: '<b>', ts: 1 }), null);
});

test('a photo is always stored as JPEG, and damaged base64 is skipped', () => {
  assert.equal(cleanPhoto({ id: 'p1', type: 'image/svg+xml', w: 10, h: 10, b64: btoa('abc') }).type, 'image/jpeg');
  assert.equal(cleanPhoto({ id: 'p1', b64: '!!!not base64!!!' }), null);
  const bytes = [0, 1, 2, 250, 251, 255];
  const back = cleanPhoto({ id: 'p', b64: b64FromBuf(new Uint8Array(bytes).buffer) }).buf;
  assert.deepEqual([...new Uint8Array(back)], bytes);
});

test('a day: the quick note is kept, cleaned, and dropped when empty', () => {
  const d = cleanDay({ day: '2026-10-01', coach: { note: ' Nice  start. ', sig: 's', ts: 1, model: 'm' } });
  assert.equal(d.coach.note, 'Nice start.');
  assert.equal(cleanDay({ day: '2026-10-01', coach: { note: '' } }).coach, undefined);
});

test('supplements: the list and the days taken are cleaned, deduplicated and capped', () => {
  const s = cleanSettings({ supplements: [{ id: 'a1', name: ' Magnesium ', dose: '400 mg' }, { id: 'a1', name: 'dup' }, { id: '"><x', name: 'bad id' }, { id: 'b2', name: '' }, { id: 'c3', name: 'B12' }, null] });
  assert.deepEqual(s.supplements, [{ id: 'a1', name: 'Magnesium', dose: '400 mg' }, { id: 'c3', name: 'B12', dose: '' }]);
  assert.deepEqual(cleanDay({ day: '2026-10-01', taken: ['a1', 'a1', '"><x', 7, 'c3'] }).taken, ['a1', 'c3']);
  assert.equal(cleanDay({ day: '2026-10-01' }).taken, undefined);
});

const BADGES = { v: 1, got: { first_meal: { 1: '2026-10-01' }, days_on: { 7: '2026-10-07', 30: '2026-11-01' } }, seen: { days_on: 7 }, av: { stage: 'stage2', face: 'face_plain', acc: 'acc_leaf' }, base: { startKg: 86, targetKg: 78 } };

test('cleanBadges: a good copy is kept, except a worn part that is not unlocked', () => {
  const c = cleanBadges(BADGES);
  assert.deepEqual(c.got, BADGES.got);
  assert.deepEqual(c.seen, { days_on: 7 });
  assert.deepEqual(c.base, BADGES.base);
  assert.deepEqual(c.av, { stage: 'stage2', face: 'face_plain', acc: 'acc_none' }); // first_on is not earned, days_on 30 is
  assert.deepEqual(cleanBadges(JSON.parse(JSON.stringify(c))), c);
});

test('cleanBadges: hostile input never throws and gives the empty shape', () => {
  const empty = { v: 1, got: {}, seen: {}, av: { stage: 'stage1', face: 'face_plain', acc: 'acc_none' }, base: null };
  for (const x of [null, undefined, 5, 'x', [], [1], true, () => 1, { got: [] }, { got: null, seen: 'a', av: 7, base: [] }, JSON.parse('{"__proto__":{"got":{"days_on":{"7":"2026-01-01"}}}}')]) assert.deepEqual(cleanBadges(x), empty, String(x));
  const c = cleanBadges(JSON.parse('{"got":{"__proto__":{"1":"2026-01-01"},"constructor":{"1":"2026-01-01"},"first_meal":["x","2026-01-01"],"days_on":{"__proto__":"2026-01-01","7":"x","8":"2026-01-01"}},"seen":{"__proto__":1,"days_on":999}}'));
  assert.deepEqual(c.got, {});
  assert.deepEqual(c.seen, {});
  assert.equal(({}).polluted, undefined);
  assert.equal(cleanBadges({ got: { first_meal: { 1: 'x'.repeat(1e6) } } }).got.first_meal, undefined);
});

test('cleanBadges: unknown ids, steps off the ladder and impossible days are dropped', () => {
  const c = cleanBadges({ got: { nope: { 1: '2026-01-01' }, days_on: { 7: '2026-99-99', 30: '2026-02-31', 31: '2026-03-01', 100: '2026-03-01' }, first_meal: { 1: '2026-03-01', 2: '2026-03-01' } } });
  assert.deepEqual(c.got, { days_on: { 100: '2026-03-01' }, first_meal: { 1: '2026-03-01' } });
});

test('cleanBadges: av parts must exist, fit the slot and be earned; base must be sane', () => {
  const got = { days_on: { 30: '2026-03-01', 100: '2026-04-01' }, first_weigh: { 1: '2026-03-01' } };
  assert.deepEqual(cleanBadges({ got, av: { stage: 'stage3', face: 'face_smile', acc: 'acc_none' } }).av, { stage: 'stage3', face: 'face_smile', acc: 'acc_none' });
  assert.deepEqual(cleanBadges({ got, av: { stage: 'face_smile', face: 'acc_crown', acc: 'toString' } }).av, { stage: 'stage1', face: 'face_plain', acc: 'acc_none' });
  assert.equal(cleanBadges({ av: { acc: 'acc_crown' } }).av.acc, 'acc_none');
  for (const base of [{ startKg: 'a', targetKg: 78 }, { startKg: NaN, targetKg: 78 }, { startKg: Infinity, targetKg: 78 }, { startKg: 86, targetKg: -1 }, { startKg: 86 }, { startKg: 9999, targetKg: 78 }, [86, 78]]) assert.equal(cleanBadges({ base }).base, null, JSON.stringify(base));
});

test('restoreBadges: union, earliest day wins, this device keeps its base and worn parts', () => {
  const cur = { got: { days_on: { 7: '2026-10-09' }, first_on: { 1: '2026-10-01' } }, seen: { days_on: 7 }, av: { stage: 'stage1', face: 'face_plain', acc: 'acc_leaf' }, base: { startKg: 90, targetKg: 80 } };
  const r = restoreBadges(cur, BADGES);
  assert.deepEqual(r.got, { first_meal: { 1: '2026-10-01' }, days_on: { 7: '2026-10-07', 30: '2026-11-01' }, first_on: { 1: '2026-10-01' } });
  assert.deepEqual(r.base, { startKg: 90, targetKg: 80 });
  assert.equal(r.av.acc, 'acc_leaf');
  assert.deepEqual(restoreBadges(null, BADGES).base, BADGES.base);
  assert.deepEqual(restoreBadges(null, BADGES).got, BADGES.got);
  assert.deepEqual(restoreBadges(null, 'junk'), cleanBadges(null));
});

test('a backup with or without badges can be restored (old backups have none)', () => {
  const ok = { app: 'weightplan', v: SCHEMA_VERSION, entries: [] };
  assert.equal(backupProblem(ok), '');
  assert.equal(backupProblem({ ...ok, badges: BADGES }), '');
  assert.equal(backupProblem({ ...ok, badges: 'junk' }), '');
  // round trip through JSON, as a backup file does
  assert.deepEqual(cleanBadges(JSON.parse(JSON.stringify({ ...ok, badges: cleanBadges(BADGES) })).badges), cleanBadges(BADGES));
});

test('settings: the minimum kcal is kept when sane, and dropped when it is above the budget', () => {
  assert.equal(cleanSettings({ kcalRest: 1550, kcalMinDay: 1200 }).kcalMinDay, 1200);
  assert.equal('kcalMinDay' in cleanSettings({ kcalRest: 1550, kcalMinDay: 2000 }), false);
  assert.equal('kcalMinDay' in cleanSettings({ kcalMinDay: 10 }), false);
});
