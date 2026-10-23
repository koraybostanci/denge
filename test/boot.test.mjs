// The start-up decision (js/boot.js): setup or upgrade, and whether the upgraded settings are written. `node --test`
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bootDecision, commitSetup, newSetupJournal, setupHadPlans } from '../js/boot.js';
import { freshSettings } from '../js/core.js';
import { GOAL_KEYS } from '../js/onboarding.js';

const fresh = freshSettings();
const decide = (o) => bootDecision({ stored: null, hasData: false, live: fresh, fresh, usage: {}, fallbackId: 'id-fallback', ...o });
const goals = { startDate: '2026-10-01', proteinMin: 120, startKg: 90, targetKg: 80, targetDate: '2027-01-31', kcalRest: 1600, kcalTrain: 1800, protein: 130 };

test('a fresh install goes to setup and keeps the live language', () => {
  const d = decide({ live: { ...fresh, lang: 'tr' } });
  assert.equal(d.setup, true);
  assert.equal(d.needsSave, false);
  assert.equal(d.settings.onboarded, false);
  assert.equal(d.settings.lang, 'tr');
});

test('an old install with goals but no onboarded/clientId is upgraded and saved', () => {
  const stored = { ...fresh, ...goals };
  delete stored.onboarded; delete stored.clientId;
  const d = decide({ stored, hasData: true });
  assert.equal(d.setup, false);
  assert.equal(d.needsSave, true);
  assert.equal(d.settings.onboarded, true);
  assert.equal(d.settings.clientId, 'id-fallback');
  assert.equal(d.settings.startKg, 90);
});

test('an already-upgraded install needs no save', () => {
  const stored = { ...fresh, ...goals, onboarded: true, clientId: 'abc' };
  const d = decide({ stored, hasData: true });
  assert.equal(d.setup, false);
  assert.equal(d.needsSave, false);
  assert.equal(d.settings.clientId, 'abc');
});

test('a changed goal value (a missing goal taking its default) needs a save', () => {
  const stored = { ...fresh, ...goals, onboarded: true, clientId: 'abc' };
  delete stored.protein;
  const d = decide({ stored, hasData: true });
  assert.equal(d.needsSave, true);
  assert.ok(GOAL_KEYS.every((k) => d.settings[k] !== undefined));
});

test('a restore with onboarded:false and no start weight is setup again, even with data', () => {
  const d = decide({ stored: { onboarded: false, lang: 'en' }, hasData: true });
  assert.equal(d.setup, true);
  assert.equal(d.needsSave, false);
  assert.equal(d.settings.onboarded, false);
});

test('data with no stored settings is an upgrade, not setup', () => {
  const d = decide({ stored: null, hasData: true });
  assert.equal(d.setup, false);
  assert.equal(d.needsSave, true);
  assert.equal(d.settings.onboarded, true);
  assert.equal(d.settings.clientId, 'id-fallback');
});

test('a second load does not leak stale runtime keys into an upgraded install', () => {
  const stored = { ...fresh, ...goals, onboarded: true, clientId: 'abc' };
  const live = { ...fresh, staleRuntimeKey: 'x', activePlan: 'P-old' };
  const d = decide({ stored, hasData: true, live });
  assert.equal('staleRuntimeKey' in d.settings, false);
  assert.equal('activePlan' in d.settings, false);
});

test('stored usage cannot overwrite the merged usage', () => {
  const usage = { calls: 5 };
  const up = decide({ stored: { ...fresh, ...goals, onboarded: true, clientId: 'abc', usage: { calls: 1 } }, hasData: true, usage });
  assert.deepEqual(up.settings.usage, usage);
  const setup = decide({ stored: { onboarded: false, usage: { calls: 1 } }, hasData: false, usage });
  assert.deepEqual(setup.settings.usage, usage);
});

test('an upgraded install drops the restore marker and saves', () => {
  const stored = { ...fresh, ...goals, onboarded: true, clientId: 'abc', setupRestorePlans: true };
  const d = decide({ stored, hasData: true });
  assert.equal(d.setup, false);
  assert.equal('setupRestorePlans' in d.settings, false);
  assert.equal(d.needsSave, true);
});

test('setupHadPlans: a stored record is stale unless a restore marked it', () => {
  assert.equal(setupHadPlans(true, {}), false);
  assert.equal(setupHadPlans(true, { setupRestorePlans: true }), true);
  assert.equal(setupHadPlans(false, { setupRestorePlans: true }), false);
});

// A fake store that records its calls and fails on the named ones
function fake(failOn = []) {
  const calls = [];
  const fails = new Set(failOn);
  let n = 0;
  const call = (name, ...a) => async () => { calls.push([name, ...a]); if (fails.has(name)) throw new Error('boom ' + name); };
  const store = {
    writeSettings: async (s) => { calls.push(['writeSettings', s]); if (fails.has('writeSettings') || (fails.has('writeSettings2') && calls.filter((c) => c[0] === 'writeSettings').length === 2)) throw new Error('boom writeSettings'); },
    writePlans: async (r) => { calls.push(['writePlans', r]); if (fails.has('writePlans')) throw new Error('boom writePlans'); },
    deletePlans: call('deletePlans'),
    writeDay: async (d, kg) => { calls.push(['writeDay', d, kg]); if (fails.has('writeDay')) throw new Error('boom writeDay'); },
    deleteDay: async (d) => { calls.push(['deleteDay', d]); if (fails.has('deleteDay')) throw new Error('boom'); },
    addWeightEntry: async (d, kg, onId) => { const id = 'e' + (++n); onId(id); calls.push(['addWeightEntry', d, kg]); if (fails.has('addWeightEntry')) throw new Error('boom entry'); return id; },
    deleteEntry: async (id) => { calls.push(['deleteEntry', id]); },
    uid: () => 'u1',
  };
  return { store, calls, names: () => calls.map((c) => c[0]) };
}
const value = { name: '', age: 40, gender: '', weight: 90, targetKg: 80, targetDate: '2027-01-31', kcalRest: 1600, kcalTrain: 1800, protein: 130 };
const base = { value, today: '2026-10-23', clientId: 'cid', settings: { ...fresh, onboarded: false }, plan: 'default' };

test('commitSetup writes settings, plans, day, then the weigh-in', async () => {
  const f = fake();
  const j = newSetupJournal();
  const r = await commitSetup({ ...base, store: f.store, journal: j });
  assert.equal(r.ok, true);
  assert.deepEqual(f.names(), ['writeSettings', 'writePlans', 'writeDay', 'addWeightEntry']);
  assert.equal(r.settings.onboarded, true);
  assert.equal(r.settings.clientId, 'cid');
  assert.deepEqual(j.entryIds, ['e1']);
});

test('the plan record is one blank plan, or the default with no user plans', async () => {
  const a = fake(); await commitSetup({ ...base, plan: 'blank', store: a.store, journal: newSetupJournal() });
  const rec = a.calls.find((c) => c[0] === 'writePlans')[1];
  assert.equal(rec.list.length, 1);
  assert.equal(rec.list[0].id, 'P-u1');
  assert.equal(rec.active, 'P-u1');
  const b = fake(); await commitSetup({ ...base, store: b.store, journal: newSetupJournal() });
  assert.deepEqual(b.calls.find((c) => c[0] === 'writePlans')[1], { list: [], active: 'default' });
});

test('a failed day write cleans the plans and day and rolls the settings back', async () => {
  const f = fake(['writeDay']);
  const j = newSetupJournal();
  const r = await commitSetup({ ...base, store: f.store, journal: j });
  assert.equal(r.ok, false);
  assert.equal(r.error.message, 'boom writeDay');
  assert.equal(r.wrotePlans, true);
  assert.equal(r.rollbackFailed, false);
  assert.deepEqual(f.names(), ['writeSettings', 'writePlans', 'writeDay', 'deletePlans', 'deleteDay', 'writeSettings']);
  assert.equal(f.calls.at(-1)[1].onboarded, false);
  assert.equal(j.plansWritten, false);
  assert.deepEqual(j.entryIds, []);
});

test('a failed entry write deletes the id journaled before the write', async () => {
  const f = fake(['addWeightEntry']);
  const j = newSetupJournal();
  await commitSetup({ ...base, store: f.store, journal: j });
  assert.ok(f.calls.some((c) => c[0] === 'deleteEntry' && c[1] === 'e1'));
  assert.deepEqual(j.entryIds, []);
});

test('a failed settings write attempts the rollback and writes no plan', async () => {
  const f = fake(['writeSettings']);
  const r = await commitSetup({ ...base, store: f.store, journal: newSetupJournal() });
  assert.equal(r.ok, false);
  assert.equal(r.rollbackFailed, true);
  assert.equal(f.names().includes('writePlans'), false);
  assert.deepEqual(f.names().filter((n) => n === 'writeSettings').length, 2);
});

test('a rollback settings write that fails is reported', async () => {
  const f = fake(['writeDay', 'writeSettings2']);
  const r = await commitSetup({ ...base, store: f.store, journal: newSetupJournal() });
  assert.equal(r.ok, false);
  assert.equal(r.rollbackFailed, true);
  assert.equal(r.error.message, 'boom writeDay');
});

test('a plans delete that fails leaves the record to be rewritten by a retry with another choice', async () => {
  const j = newSetupJournal();
  const f1 = fake(['writeDay', 'deletePlans']);
  const r1 = await commitSetup({ ...base, plan: 'default', store: f1.store, journal: j });
  assert.equal(r1.plansRemain, true);
  assert.equal(j.plansWritten, true);
  assert.deepEqual(f1.names().slice(-3), ['deletePlans', 'deleteDay', 'writeSettings']);
  const f2 = fake();
  const r2 = await commitSetup({ ...base, plan: 'blank', store: f2.store, journal: j });
  assert.equal(r2.ok, true);
  assert.equal(f2.calls.find((c) => c[0] === 'writePlans')[1].list.length, 1);
  assert.equal(j.plansRemain, false);
});

test('restored plans are never written or deleted, and an existing day is kept', async () => {
  const f = fake(['addWeightEntry']);
  const j = newSetupJournal({ hadPlans: true, hadDay: true });
  const r = await commitSetup({ ...base, store: f.store, journal: j });
  assert.equal(r.ok, false);
  assert.equal(r.wrotePlans, false);
  assert.equal(f.names().includes('writePlans'), false);
  assert.equal(f.names().includes('deletePlans'), false);
  assert.equal(f.names().includes('deleteDay'), false);
});

test('the success path removes the restore marker from the settings it writes', async () => {
  const f = fake();
  const r = await commitSetup({ ...base, settings: { ...base.settings, setupRestorePlans: true }, store: f.store, journal: newSetupJournal({ hadPlans: true }) });
  assert.equal(r.ok, true);
  assert.equal('setupRestorePlans' in f.calls[0][1], false);
  assert.equal(f.names().includes('writePlans'), false);
});
