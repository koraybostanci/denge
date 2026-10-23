// The start-up decision, with no DOM and no storage: setup still to do, or an install to bring up to date.
import { needsOnboarding, upgradeSettings, GOAL_KEYS } from './onboarding.js';

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
  const needsSave = !stored || stored.clientId !== settings.clientId || stored.onboarded !== true || GOAL_KEYS.some((k) => stored[k] !== settings[k]);
  return { setup: false, settings, needsSave };
}
