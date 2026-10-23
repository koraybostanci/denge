// The start-up decision (js/boot.js): setup or upgrade, and whether the upgraded settings are written. `node --test`
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bootDecision } from '../js/boot.js';
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
