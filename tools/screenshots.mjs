// Regenerates the README screenshots in docs/ in headless Chromium: the setup screen, then Today, Log, Progress and the
// badge collection, drawn from the fixed state of test/screens.mjs. No dependencies.
// Usage: node tools/screenshots.mjs   (CHROME=/path/to/chrome to choose a browser)
import { fileURLToPath } from 'node:url';
import { writeFile } from 'node:fs/promises';
import { findBrowser, serve, launch, openApp, clearOrigin, evalPage, waitFor } from './browser-lib.mjs';
import { NOW, core, fixture } from '../test/screens.mjs'; // fixtures only: this also pins Date and TZ in this process

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const DOCS = fileURLToPath(new URL('../docs/', import.meta.url));

const bin = await findBrowser();
if (!bin) { console.log('SKIP: no Chromium found; set CHROME=/path/to/chrome'); process.exit(0); }

let server; let browser; let PAGE;
const cleanup = async () => { if (browser) await browser.close().catch(() => {}); if (server) await server.close().catch(() => {}); browser = server = null; };
process.once('SIGINT', () => { cleanup().finally(() => process.exit(130)); });
process.once('SIGTERM', () => { cleanup().finally(() => process.exit(143)); });

// The same clock as test/screens.mjs: Date.now() and new Date() are frozen at NOW, timers stay real
const CLOCK = `(() => { const NOW = ${NOW}; const Real = Date; globalThis.Date = class extends Real { constructor(...a) { super(...(a.length ? a : [NOW])); } static now() { return NOW; } }; })();`;

const shot = async (name) => {
  await evalPage(PAGE, `document.fonts.ready.then(() => new Promise((ok) => requestAnimationFrame(() => requestAnimationFrame(ok))))`);
  const { data } = await PAGE.send('Page.captureScreenshot', { format: 'png' });
  const buf = Buffer.from(data, 'base64');
  await writeFile(`${DOCS}${name}.png`, buf);
  console.log(`docs/${name}.png ${buf.length} bytes`);
};

try {
  server = await serve(ROOT);
  try { browser = await launch(bin); } catch (err) {
    if (err.code === 'ENOBROWSER') { console.log(`SKIP: no Chromium found; set CHROME=/path/to/chrome (${err.message})`); await cleanup(); process.exit(0); }
    throw err;
  }
  PAGE = await browser.newPage();
  await PAGE.send('Emulation.setTimezoneOverride', { timezoneId: 'UTC' });
  await PAGE.send('Page.enable');
  await PAGE.send('Page.addScriptToEvaluateOnNewDocument', { source: CLOCK });
  const APP = `${server.origin}/`;

  // The setup screen, from a clean origin
  await clearOrigin(PAGE, server.origin);
  await openApp(PAGE, APP, `!!window.__app && document.querySelector('#view').dataset.view === 'onboarding' && !!document.getElementById('ob-weight')`);
  await shot('setup');

  // The rest from the fixture state, seeded into the running app
  fixture();
  const { S } = core;
  const state = JSON.stringify({ settings: { ...S.settings, name: 'Ayşe', onboarded: true }, entries: S.entries, days: S.days, checks: S.checks, foods: S.foods, badges: S.badges, plans: S.plans, progressReview: S.progressReview, viewDay: S.viewDay });
  const seed = (tab) => evalPage(PAGE, `(async () => {
    const st = ${state};
    const { S, today } = (await import('/js/core.js'));
    const { buildPlan } = await import('/js/plan.js');
    Object.assign(S, { settings: st.settings, entries: st.entries, days: st.days, checks: st.checks, foods: st.foods, badges: st.badges, plans: st.plans, progressReview: st.progressReview });
    S.plan = buildPlan(st.plans.list.find((p) => p.id === st.plans.active));
    S.tab = ${JSON.stringify(tab)}; S.viewDay = today(); S.sheet = null; S.calPick = null; S.rev++;
    document.getElementById('view').dataset.view = '';
    window.__app.render();
    return true;
  })()`);
  for (const [tab, name] of [['today', 'today'], ['log', 'log'], ['progress', 'progress']]) {
    await seed(tab);
    await waitFor(PAGE, `document.querySelector('#view').dataset.view === ${JSON.stringify(tab)}`, { what: `${tab} to render` });
    await shot(name);
  }
  // The badge collection on Progress, scrolled to its heading
  await evalPage(PAGE, `window.scrollTo(0, document.getElementById('badges-title').getBoundingClientRect().top + window.scrollY - 24)`);
  await shot('badges');
} catch (err) {
  console.error(`FAIL: ${err.message}`);
  process.exitCode = 1;
} finally {
  await cleanup();
}
