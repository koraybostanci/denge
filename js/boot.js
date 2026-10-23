// The start-up decision, with no DOM and no storage: setup still to do, or an install to bring up to date.
import { needsOnboarding, upgradeSettings, settingsFromOnboarding, blankPlan, GOAL_KEYS } from './onboarding.js';

// What a start should do with the stored settings. `live` is the current S.settings (keeps a language chosen on the
// setup screen), `fresh` is freshSettings(), `usage` the merged usage totals (always wins over a stored copy) and
// `fallbackId` is mirroredClientId() || newClientId().
export function bootDecision({ stored, hasData, live, fresh, usage, fallbackId }) {
  // A restore that brought no goals leaves onboarded:false stored with no start weight: setup is still to be done
  const setup = needsOnboarding(stored, hasData) || (!!stored && stored.onboarded === false && !Number.isFinite(stored.startKg));
  if (setup) {
    // A new install: the settings stay fresh (a language chosen on the setup screen is kept) until setup is finished
    return { setup: true, settings: { ...live, ...(stored || {}), usage, onboarded: false }, needsSave: false };
  }
  // An install from before setup existed, or one set up: goals that are missing take the defaults, and it gets its id once
  const settings = { ...fresh, ...upgradeSettings(stored, fallbackId), usage };
  const leftover = !!stored && 'setupRestorePlans' in stored; // the restore marker does not outlive setup
  delete settings.setupRestorePlans;
  const needsSave = !stored || leftover || stored.clientId !== settings.clientId || stored.onboarded !== true || GOAL_KEYS.some((k) => stored[k] !== settings[k]);
  return { setup: false, settings, needsSave };
}

// A fresh journal for one setup run; it is kept across retries so a failed cleanup is not forgotten.
export function newSetupJournal({ hadPlans = false, hadDay = false } = {}) {
  return { hadPlans: !!hadPlans, hadDay: !!hadDay, plansWritten: false, plansRemain: false, entryIds: [] };
}

// A plans record seen while setup is showing is stale (this run did not write it) unless a restore
// without goals marked it as intentionally restored.
// `onboard-finish` only runs while setup shows, so only the marker decides.
export function setupHadPlans(storedPlans, settings) {
  return !!storedPlans && !!settings.setupRestorePlans;
}

// Writes the setup in order (settings, plans, day, first weigh-in) through an injected store and undoes this run's writes on
// any error. store: { writeSettings(settings), writePlans({ list, active }), deletePlans(), writeDay(day, kg), deleteDay(day),
// addWeightEntry(day, kg, onId), deleteEntry(id), uid() }. `onId` is told the entry id before the write is awaited.
// Resolves { ok: true, settings } or { ok: false, settings, error, plansRemain, wrotePlans, rollbackFailed }.
export async function commitSetup({ store, journal, value, today, clientId, settings, plan }) {
  let wrotePlans = false; // the plans were written (or tried) in this call, so memory holds them even if the record is gone
  try {
    const next = { ...settings, ...settingsFromOnboarding(value, today, clientId || '') };
    delete next.setupRestorePlans;
    await store.writeSettings(next);
    if (!journal.hadPlans || journal.plansRemain) {
      const record = plan === 'blank' ? (() => { const mine = blankPlan(store.uid()); return { list: [mine], active: mine.id }; })() : { list: [], active: 'default' };
      journal.plansWritten = true;
      wrotePlans = true;
      await store.writePlans(record);
      journal.plansRemain = false;
    }
    await store.writeDay(today, value.weight);
    await store.addWeightEntry(today, value.weight, (id) => journal.entryIds.push(id));
    return { ok: true, settings: next };
  } catch (error) {
    const rollback = { ...settings, onboarded: false };
    // Each cleanup stands alone; the settings go last, so no failure hides another
    for (const id of journal.entryIds) { try { await store.deleteEntry(id); } catch { /* best effort */ } }
    journal.entryIds = [];
    if (journal.plansWritten) {
      try { await store.deletePlans(); journal.plansWritten = false; journal.plansRemain = false; } catch { journal.plansRemain = true; }
    }
    if (!journal.hadDay) { try { await store.deleteDay(today); } catch { /* best effort */ } }
    let rollbackFailed = false;
    try { await store.writeSettings(rollback); } catch { rollbackFailed = true; }
    return { ok: false, settings: rollback, error, plansRemain: journal.plansRemain, wrotePlans, rollbackFailed };
  }
}
