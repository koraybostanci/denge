// Everything read from a backup file is checked before it is stored or shown (js/backup.js). `node --test`
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { backupProblem, cleanEntry, cleanDay, cleanCheck, cleanPhoto, cleanSettings, cleanBadges, restoreBadges, readProgress, b64FromBuf, cleanFood, cleanFoods, restoreFoods, sweepFoodPhotos, FOODS_MAX, PLAN_CAPS } from '../js/backup.js';
import { SCHEMA_VERSION } from '../js/core.js';

const good = {
  id: 'abc123', ts: 1759300000000, day: '2026-10-01', kind: 'meal', status: 'ok', slot: 'lunch', title: 'Egg', kcal: 500, p: 30, c: 5, f: 20, fib: 2,
  tier: 'plan', flags: ['alcohol'], conf: 0.8, mult: 1.5, photoIds: ['p1'], items: [{ n: 'egg', g: 100, kcal: 143, p: 12, c: 0.6, f: 10, fib: 0 }],
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

test('a meal id up to the plan limit keeps its link through cleanEntry and an export/import round trip', () => {
  const planId = 'W'.repeat(24);
  assert.equal(cleanEntry({ ...good, planId }).planId, planId);
  assert.equal(cleanEntry(JSON.parse(JSON.stringify(cleanEntry({ ...good, planId })))).planId, planId);
  assert.equal(cleanEntry({ ...good, planId: 'A'.repeat(40) }).planId.length, 40);
  assert.equal(cleanEntry({ ...good, planId: 'A'.repeat(50) }).planId.length, 40);
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

test('items: capped and cut to the item limits; absence survives the round trip (absent = never estimated, not 0)', () => {
  const capped = cleanEntry({ ...good, items: [{ n: 'x', g: 1e9, kcal: 1e9, p: -4, c: 'x', f: 900, fib: 999 }, null, 'junk', { n: 'y' }] });
  assert.deepEqual(capped.items, [
    { n: 'x', g: 5000, kcal: 6000, p: 0, f: 500, fib: 150 }, // c given as junk text stays absent, f and fib are capped
    { n: '', g: 0, kcal: 0, p: 0 },
    { n: '', g: 0, kcal: 0, p: 0 },
    { n: 'y', g: 0, kcal: 0, p: 0 },
  ]);
  // a JSON round trip (a backup file) drops the absent keys and restores through itemList as absent again
  assert.deepEqual(cleanEntry(JSON.parse(JSON.stringify(capped))).items, capped.items);
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

test('settings: junk values and malformed plan meal ids are dropped', () => {
  const s = cleanSettings({ startKg: '90', targetKg: 1e9, startDate: '"><x>', kcalRest: -1, protein: 135, planPhotos: { 'L-A': 'p1', 'my meal': 'p2', 'D-A': '"><x', 'X-1': 'p3' } });
  assert.deepEqual(Object.keys(s).sort(), ['planPhotos', 'protein']);
  assert.deepEqual(s.planPhotos, { 'L-A': 'p1', 'X-1': 'p3' }); // plans are the person's own, so any well-formed meal id is kept
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
  assert.equal(cleanPhoto({ id: 'p1', b64: btoa('abc'), plan: 'X-1' }).plan, 'X-1'); // any well-formed meal id: plans are the person's own
  assert.equal(cleanPhoto({ id: 'p1', b64: btoa('abc'), plan: '"><x' }).plan, undefined);
  assert.equal(cleanPhoto({ id: 'p1', b64: btoa('abc'), food: 'f1' }).food, 'f1'); // a pantry ref too, checked by shape alone
  assert.equal('food' in cleanPhoto({ id: 'p1', b64: btoa('abc'), food: '"><x' }), false);
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

test('readProgress: a good record is kept, hostile input is clamped or gives null, and a round trip keeps the clamped form', () => {
  const rec = { v: 1, sig: 'abc', ts: 1759300000000, model: 'm', rating: 'on-track', head: 'Steady.', good: ['a'], change: ['b'], adjust: '' };
  assert.deepEqual(readProgress(rec), rec);
  assert.deepEqual(readProgress(JSON.parse(JSON.stringify(readProgress(rec)))), rec);
  for (const x of [null, undefined, 5, 'x', [], {}, { ...rec, ts: undefined }, { ...rec, ts: -1 }, { ...rec, ts: 1.5 }, { ...rec, ts: 1e15 }, { ...rec, head: '', good: [], change: [], adjust: '' }]) assert.equal(readProgress(x), null);
  const hostile = readProgress({ ...rec, sig: 's'.repeat(500), model: 'm'.repeat(500), rating: 'ahead', head: 'h'.repeat(900), good: 'x'.repeat(900), change: [1, null, 'y'] });
  assert.equal(hostile.sig.length, 120);
  assert.equal(hostile.model.length, 60);
  assert.equal(hostile.rating, '');
  assert.ok(hostile.head.length <= 240 && hostile.good.length === 1 && hostile.good[0].length <= 240);
  assert.deepEqual(readProgress(hostile), hostile);
});

test('a backup with or without a progress key is accepted (older backups have none)', () => {
  const ok = { app: 'weightplan', v: SCHEMA_VERSION, entries: [] };
  assert.equal(backupProblem(ok), '');
  assert.equal(backupProblem({ ...ok, progress: null }), '');
  assert.equal(backupProblem({ ...ok, progress: { junk: 1 } }), '');
});

// ——— The pantry (js/backup.js: cleanFood, cleanFoods, restoreFoods, sweepFoodPhotos) ———
const food = { id: 'f1', name: 'Eker Skyr natural', v: [59, 10.5, 4, 0.5, 0], ing: 'Pasteurised milk, cultures', photo: 'fp1', lastUsed: 1759300000000 };

test('a pantry food: a good record keeps its shape and round-trips', () => {
  assert.deepEqual(cleanFood(food), food);
  assert.deepEqual(cleanFood(JSON.parse(JSON.stringify(cleanFood(food)))), food);
  assert.deepEqual(cleanFood({ id: 'f1', name: 'Bare', v: [1, 2, 3, 4, 5], extra: 'gone' }), { id: 'f1', name: 'Bare', v: [1, 2, 3, 4, 5] });
});

test('a pantry food: the caps clamp, unusable text clears lastUsed, and junk in one value drops the record', () => {
  const c = cleanFood({ id: 'f1', name: 'x'.repeat(80) + '\n\t x', v: [1500, -3, 0.5, 1e9, 90], ing: 'a\u0000x to\u007fb ', lastUsed: 'lately' });
  assert.deepEqual(c, { id: 'f1', name: 'x'.repeat(PLAN_CAPS.name), v: [1000, 0, 0.5, 100, 90], ing: 'a x to b' });
  assert.equal(cleanFood({ ...food, lastUsed: -1 }).lastUsed, undefined);
  assert.equal(cleanFood({ ...food, lastUsed: 1e14 }).lastUsed, 1e14);
  assert.equal(cleanFood({ ...food, lastUsed: 1e14 + 1 }).lastUsed, undefined);
  for (const bad of [null, 5, 'x', [], { id: 'f1' }, { id: '"><x>', name: 'x', v: [1, 2, 3, 4, 5] }, { id: 'f1', name: '\n', v: [1, 2, 3, 4, 5] },
    { id: 'f1', name: 'x' }, { id: 'f1', name: 'x', v: [1, 2, 3] }, { id: 'f1', name: 'x', v: [1, 2, 3, 4, 5, 6] }, { id: 'f1', name: 'x', v: [1, 'x', 3, 4, 5] }, { id: 'f1', name: 'x', v: '12345' }]) {
    assert.equal(cleanFood(bad), null, String(JSON.stringify(bad)));
  }
});

test('cleanFoods: junk and duplicate ids dropped, the cap holds with the first ones winning, and cleaning twice gives one list', () => {
  const dup = { id: 'f1', name: ' Draft', v: [9, 9, 9, 9, 9] };
  const list = [food, null, 'junk', 7, dup, { id: 'f2', name: 'B', v: [1, 1, 1, 1, 1] }];
  const clean = cleanFoods(list);
  assert.deepEqual(clean, [food, { id: 'f2', name: 'B', v: [1, 1, 1, 1, 1] }]); // the first record keeps the id
  assert.deepEqual(cleanFoods(clean), clean);
  assert.deepEqual(cleanFoods('nope'), []);
  const cap = Array.from({ length: FOODS_MAX + 5 }, (_, i) => ({ id: `f${i}`, name: `F${i}`, v: [1, 1, 1, 1, 1] }));
  const capped = cleanFoods(cap);
  assert.equal(capped.length, FOODS_MAX);
  assert.deepEqual(capped, cleanFoods(cap.concat({ id: 'f0', name: 'again', v: [2, 2, 2, 2, 2] }))); // the cap with the first ones winning is stable
});

test('restoreFoods: merged by id, the backup wins on the fields, lastUsed is the later, a device-only food stays', () => {
  const mine = [
    { id: 'f1', name: 'Old name', v: [1, 1, 1, 1, 1], photo: 'fp9', lastUsed: 200 },
    { id: 'f2', name: 'Only here', v: [2, 2, 2, 2, 2], lastUsed: 50 },
    { id: 'f4', name: 'Later here', v: [4, 4, 4, 4, 4] },
    { id: 'f5', name: 'Never used here', v: [5, 5, 5, 5, 5] },
  ];
  const back = [
    { id: 'f1', name: 'Backup name', v: [3, 3, 3, 3, 3], ing: 'Milk' },
    { id: 'f2', name: 'Also there', v: [2, 2, 2, 2, 2], lastUsed: 60 },
    { id: 'f3', name: 'Only there', v: [1, 1, 1, 1, 1], lastUsed: 100 },
    { id: 'f5', name: 'Used there', v: [5, 5, 5, 5, 5], lastUsed: 300 },
  ];
  // the stored side keeps its list in place (the backup's values winning on the shared ids, lastUsed the later in
  // both directions), the backup's own foods are added after it
  assert.deepEqual(restoreFoods(mine, back), [
    { id: 'f1', name: 'Backup name', v: [3, 3, 3, 3, 3], photo: 'fp9', ing: 'Milk', lastUsed: 200 },
    { id: 'f2', name: 'Also there', v: [2, 2, 2, 2, 2], lastUsed: 60 },
    { id: 'f4', name: 'Later here', v: [4, 4, 4, 4, 4] },
    { id: 'f5', name: 'Used there', v: [5, 5, 5, 5, 5], lastUsed: 300 },
    { id: 'f3', name: 'Only there', v: [1, 1, 1, 1, 1], lastUsed: 100 },
  ]);
  assert.deepEqual(restoreFoods(mine, []), mine);
  assert.deepEqual(restoreFoods(mine, 'junk'), mine);
  assert.deepEqual(restoreFoods(null, back.slice(0, 1)), back.slice(0, 1));
  assert.deepEqual(restoreFoods(null, 'nope'), []);
  assert.deepEqual(restoreFoods([{ id: 'f1', name: 'x', v: [1, 1, 1, 1, 1] }], [{ id: 'f1', name: 'y', v: [2, 2, 2, 2, 2] }]), [{ id: 'f1', name: 'y', v: [2, 2, 2, 2, 2] }]); // no lastUsed on either side, none kept
});

test('restoreFoods: over the cap, the device keeps every food and only the backup-only tail is cut (no photo sweep loss)', () => {
  const device = Array.from({ length: FOODS_MAX }, (_, i) => ({ id: `d${i}`, name: `D${i}`, v: [1, 1, 1, 1, 1], photo: `pd${i}`, lastUsed: 100 + i }));
  const back = [
    ...Array.from({ length: 50 }, (_, i) => ({ id: `d${i}`, name: `Backup D${i}`, v: [2, 2, 2, 2, 2], lastUsed: i < 25 ? 500 + i : 1 })),
    ...Array.from({ length: 60 }, (_, i) => ({ id: `b${i}`, name: `B${i}`, v: [3, 3, 3, 3, 3] })),
  ];
  const merged = cleanFoods(restoreFoods(device, back)); // the same pass the stored write does
  assert.equal(merged.length, FOODS_MAX);
  for (let i = 0; i < FOODS_MAX; i++) assert.equal(merged[i].id, `d${i}`, `device food ${i}`); // every device food stays, in its place
  assert.deepEqual(merged[0], { id: 'd0', name: 'Backup D0', v: [2, 2, 2, 2, 2], photo: 'pd0', lastUsed: 500 });
  assert.deepEqual(merged[24], { id: 'd24', name: 'Backup D24', v: [2, 2, 2, 2, 2], photo: 'pd24', lastUsed: 524 });
  assert.deepEqual(merged[25], { id: 'd25', name: 'Backup D25', v: [2, 2, 2, 2, 2], photo: 'pd25', lastUsed: 125 });
  assert.deepEqual(merged[50], device[50]);
  assert.equal(merged.some((f) => f.id[0] === 'b'), false); // not a single backup-only food got in: there was no room at all
  assert.deepEqual(sweepFoodPhotos(device, [], merged), []); // so nothing of the device's is swept away either
});

test('restoreFoods: the backup-only foods fill the room the device list leaves, in order, and the rest goes', () => {
  const device = Array.from({ length: FOODS_MAX - 10 }, (_, i) => ({ id: `d${i}`, name: `D${i}`, v: [1, 1, 1, 1, 1], lastUsed: 100 + i }));
  const back = [
    ...Array.from({ length: 30 }, (_, i) => ({ id: `d${i}`, name: `Backup D${i}`, v: [2, 2, 2, 2, 2], lastUsed: 500 + i })),
    ...Array.from({ length: 30 }, (_, i) => ({ id: `b${i}`, name: `B${i}`, v: [3, 3, 3, 3, 3] })),
  ];
  const merged = restoreFoods(device, back);
  assert.equal(merged.length, FOODS_MAX);
  for (let i = 0; i < 90; i++) assert.equal(merged[i].id, `d${i}`, `device food ${i}`);
  for (let i = 0; i < 10; i++) assert.equal(merged[90 + i].id, `b${i}`, `backup-only food ${i}`); // the first ten in, in order
  assert.equal(merged.some((f) => f.id === `b${FOODS_MAX - 90}`), false); // the rest of the backup's new foods are cut, never a device's
});

test('restoreFoods: restoring the same backup to its own merged list is stable, capped or not', () => {
  const mine = [
    { id: 'f1', name: 'Old name', v: [1, 1, 1, 1, 1], photo: 'fp9', lastUsed: 200 },
    { id: 'f2', name: 'Only here', v: [2, 2, 2, 2, 2], lastUsed: 50 },
  ];
  const back = [
    { id: 'f1', name: 'Backup name', v: [3, 3, 3, 3, 3], ing: 'Milk' },
    { id: 'f2', name: 'Also there', v: [2, 2, 2, 2, 2], lastUsed: 60 },
    { id: 'f3', name: 'Only there', v: [1, 1, 1, 1, 1], lastUsed: 100 },
  ];
  const once = restoreFoods(mine, back);
  assert.deepEqual(restoreFoods(once, back), once);
  assert.deepEqual(restoreFoods(cleanFoods(once), back), cleanFoods(once)); // and after the pass the stored write does
  // the same holds where the cap truncated the backup-only tail: the cut foods stay cut (the capped list is
  // exactly FOODS_MAX, so no room ever reopens for them), and no device food comes or goes
  const device = Array.from({ length: FOODS_MAX - 10 }, (_, i) => ({ id: `d${i}`, name: `D${i}`, v: [1, 1, 1, 1, 1] }));
  const full = [
    { id: 'd0', name: 'Backup D0', v: [2, 2, 2, 2, 2], lastUsed: 500 },
    { id: 'f1', name: 'Only there', v: [1, 1, 1, 1, 1], lastUsed: 100 },
    ...Array.from({ length: FOODS_MAX + 1 }, (_, i) => ({ id: `b${i}`, name: `B${i}`, v: [3, 3, 3, 3, 3] })),
  ];
  const capped = restoreFoods(device, full);
  assert.equal(capped.length, FOODS_MAX);
  assert.deepEqual(capped[0], { id: 'd0', name: 'Backup D0', v: [2, 2, 2, 2, 2], lastUsed: 500 });
  for (let i = 1; i < 90; i++) assert.equal(capped[i].id, `d${i}`, `device food ${i}`);
  assert.deepEqual(capped.slice(90, 100), [full[1], ...full.slice(2, 11)]); // the room the device list leaves, the backup fills
  assert.deepEqual(restoreFoods(capped, full), capped); // and restoring the same backup again gives the same list back
});

test('sweepFoodPhotos: a photo shared by two foods stays, a replaced one goes, and entry or plan photos are never listed', () => {
  const stored = [
    { id: 'sp1', food: 'f1' }, // shared by f1 and f2 below: stays while either keeps it
    { id: 'fp2', food: 'f2' },
    { id: 'dead', food: 'f-gone' },
    { id: 'e1' }, // an entry photo: no food ref, never the pantry's to judge
    { id: 'e2', plan: 'M-1' },
    'junk', null,
  ];
  assert.deepEqual(sweepFoodPhotos(stored, [], [{ id: 'f1', photo: 'sp1' }, { id: 'f2', photo: 'sp1' }, { id: 'f3', photo: 'fp2' }]), ['dead']);
  assert.deepEqual(sweepFoodPhotos(stored, [], [{ id: 'f1', photo: 'sp1' }, { id: 'f2', photo: 'sp2' }, { id: 'f3' }]), ['fp2', 'dead']); // the replaced photo and the foodless one go
  // On a restore the merge keeps what either side points at (both photos of a device-only and a backup-only food
  // survive), and a backup photo whose food is on neither side goes.
  const merged = [{ id: 'f-dev', photo: 'p-dev' }, { id: 'f-new', photo: 'p-new' }];
  assert.deepEqual(sweepFoodPhotos([{ id: 'p-dev', food: 'f-dev' }], [{ id: 'p-new', food: 'f-new' }, { id: 'p-lost', food: 'nowhere' }], merged), ['p-lost']);
  assert.deepEqual(sweepFoodPhotos([], [{ id: 'p-dead', food: 'nowhere' }, { id: 'p-dup', food: 'gone1' }, { id: 'p-dup', food: 'gone1' }], [{ id: 'f1', photo: 'p-dead2' }]), ['p-dead', 'p-dup']); // deduplicated
});
