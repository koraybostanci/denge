// Browser smoke test: the DOM and storage flows that `node --test` cannot reach, run in headless Chromium against the
// real js/db.js and js/app.js. No dependencies. Usage: node tools/browser-smoke.mjs   (CHROME=/path/to/chrome to choose a browser)
import { fileURLToPath } from 'node:url';
import { findBrowser, serve, launch, openApp, clearOrigin, evalPage, click, waitFor } from './browser-lib.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const GOALS = { startDate: '2026-01-01', startKg: 90, targetKg: 80, targetDate: '2030-01-01', kcalRest: 1600, kcalTrain: 1800, protein: 130, proteinMin: 115 };
const UUID = '/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i';

const bin = await findBrowser();
if (!bin) { console.log('SKIP: no Chromium found; set CHROME=/path/to/chrome'); process.exit(0); }

let checks = 0;
let step = '';
const ok = (cond, what) => { if (!cond) throw new Error(`${step}: ${what}`); checks += 1; };
const is = async (page, expression, what = expression) => ok(await evalPage(page, expression), what);

// Reads a kv record straight from IndexedDB (a separate connection from the app's)
const kv = (key) => `new Promise((ok, fail) => { const rq = indexedDB.open('weightplan'); rq.onerror = () => fail(rq.error); rq.onsuccess = () => { const db = rq.result; const g = db.transaction('kv').objectStore('kv').get(${JSON.stringify(key)}); g.onsuccess = () => { db.close(); ok(g.result ? g.result.v : null); }; g.onerror = () => fail(g.error); }; })`;
// Creates the database as js/db.js does (VER 1) and stores the old settings in it
const seed = (settings) => `new Promise((ok, fail) => { const rq = indexedDB.open('weightplan'); rq.onupgradeneeded = () => { const db = rq.result; db.createObjectStore('entries', { keyPath: 'id' }).createIndex('day', 'day'); db.createObjectStore('photos', { keyPath: 'id' }); db.createObjectStore('days', { keyPath: 'day' }); db.createObjectStore('kv', { keyPath: 'k' }); }; rq.onerror = () => fail(rq.error); rq.onsuccess = () => { const db = rq.result; const t = db.transaction('kv', 'readwrite'); t.objectStore('kv').put({ k: 'settings', v: ${JSON.stringify(settings)} }); t.oncomplete = () => { db.close(); ok(true); }; t.onerror = () => fail(t.error); }; })`;
const TODAY = `(() => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); })()`;
const LATER = `(() => { const d = new Date(); d.setDate(d.getDate() + 120); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); })()`;
const set = (id, value) => evalPage(PAGE, `(() => { const el = document.getElementById(${JSON.stringify(id)}); el.value = ${JSON.stringify(value)}; el.dispatchEvent(new Event('input', { bubbles: true })); })()`);
const fillSetup = async (plan) => {
  await set('ob-weight', '90'); await set('ob-target', '80'); await set('ob-rest', '1600'); await set('ob-train', '1800'); await set('ob-protein', '130');
  await evalPage(PAGE, `(() => { const el = document.getElementById('ob-date'); el.value = ${LATER}; el.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  await click(PAGE, `#ob-plan-${plan}`);
};
const SETUP = `document.querySelector('#view').dataset.view === 'onboarding' && !!document.getElementById('ob-weight')`;
const TODAYVIEW = `window.__app && document.querySelector('#view').dataset.view === 'today'`;
const BOOTED = `!!window.__app && (${SETUP} || document.querySelector('#view').dataset.view === 'today')`;

let server; let browser; let PAGE; let failure = null;
const cleanup = async () => { if (browser) await browser.close().catch(() => {}); if (server) await server.close().catch(() => {}); browser = server = null; };
process.once('SIGINT', () => { cleanup().finally(() => process.exit(130)); });
process.once('SIGTERM', () => { cleanup().finally(() => process.exit(143)); });

try {
  server = await serve(ROOT, { '/__seed.html': { type: 'text/html; charset=utf-8', body: '<!doctype html><title>seed</title>' } });
  try { browser = await launch(bin); } catch (err) {
    if (err.code === 'ENOBROWSER') { console.log(`SKIP: no Chromium found; set CHROME=/path/to/chrome (${err.message})`); await cleanup(); process.exit(0); }
    throw err;
  }
  PAGE = await browser.newPage();
  const APP = `${server.origin}/`;
  // A clean origin; `old` is the settings of an install from before setup existed (it is stored before the app starts)
  const fresh = async (old) => {
    await clearOrigin(PAGE, server.origin);
    if (old) {
      await PAGE.send('Page.navigate', { url: `${server.origin}/__seed.html` });
      await waitFor(PAGE, `location.pathname === '/__seed.html'`);
      await evalPage(PAGE, seed(old));
    }
    await openApp(PAGE, APP, BOOTED);
  };
  const OLD = { ...GOALS, lang: 'en' };

  step = '1 fresh setup validation';
  await fresh();
  await is(PAGE, SETUP, 'setup screen is shown');
  await evalPage(PAGE, `window.__focus = []; document.addEventListener('focusin', (e) => window.__focus.push(e.target.id));`);
  await click(PAGE, '[data-act="onboard-finish"]');
  await is(PAGE, `document.getElementById('ob-weight').getAttribute('aria-invalid') === 'true'`, 'weight is marked invalid');
  await is(PAGE, `document.getElementById('ob-plan-err') !== null`, 'the missing plan choice is reported');
  await is(PAGE, `document.activeElement.id === 'ob-weight'`, 'focus is on the first invalid field');

  step = '2 setup with Default';
  await fillSetup('default');
  await evalPage(PAGE, `window.__focus = []`);
  await click(PAGE, '[data-act="onboard-finish"]');
  await waitFor(PAGE, TODAYVIEW);
  await is(PAGE, `window.__focus.includes('ob-status')`, 'the status line took the focus while saving');
  await is(PAGE, `window.__app.S.settings.onboarded === true`, 'setup is finished');
  await is(PAGE, `window.__app.S.days[${TODAY}].kg === 90`, 'today has the weight');
  await is(PAGE, `window.__app.S.entries.some((e) => e.kind === 'weight' && e.kg === 90 && e.day === ${TODAY})`, 'a weigh-in entry exists');
  await is(PAGE, `${kv('plans')}.then((p) => p.active === 'default' && p.list.every((x) => x.id === 'default'))`, 'the stored plan is the default');
  await is(PAGE, `${kv('settings')}.then((s) => s.onboarded === true && ${UUID}.test(s.clientId))`, 'settings are stored with an install id');

  step = '3 old install upgrade';
  await fresh(OLD);
  await waitFor(PAGE, TODAYVIEW);
  await is(PAGE, `!document.getElementById('ob-weight')`, 'no setup screen');
  await is(PAGE, `${UUID}.test(window.__app.S.settings.clientId) && window.__app.S.settings.onboarded === true`, 'an id and onboarded are set');
  await is(PAGE, `${kv('settings')}.then((s) => s.onboarded === true && ${UUID}.test(s.clientId) && s.targetKg === 80)`, 'the upgrade is stored');

  step = '4 startup warning and Retry';
  await clearOrigin(PAGE, server.origin);
  await PAGE.send('Page.navigate', { url: `${server.origin}/__seed.html` });
  await waitFor(PAGE, `location.pathname === '/__seed.html'`);
  await evalPage(PAGE, seed(OLD));
  const { identifier } = await PAGE.send('Page.addScriptToEvaluateOnNewDocument', { source: `(() => { const orig = IDBObjectStore.prototype.put; window.__origPut = orig; IDBObjectStore.prototype.put = function (val, key) { if (this.name === 'kv' && val && val.k === 'settings') throw new Error('smoke: settings write failed'); return orig.call(this, val, key); }; })();` });
  await openApp(PAGE, APP, `${TODAYVIEW} && !!document.querySelector('.save-warning')`);
  await PAGE.send('Page.removeScriptToEvaluateOnNewDocument', { identifier });
  await evalPage(PAGE, `IDBObjectStore.prototype.put = window.__origPut`);
  await is(PAGE, `!!document.querySelector('.save-warning [data-act="retry-settings"]')`, 'the warning has a Retry button');
  await is(PAGE, `${kv('settings')}.then((s) => s && !s.clientId && !s.onboarded)`, 'the failed save stored nothing');
  await click(PAGE, '[data-act="retry-settings"]');
  await waitFor(PAGE, `!document.querySelector('.save-warning')`);
  await is(PAGE, `${kv('settings')}.then((s) => s && s.onboarded === true && ${UUID}.test(s.clientId) && s.targetKg === 80)`, 'Retry stored the upgraded settings');

  step = '5 factory reset keeps the install id';
  const id = await evalPage(PAGE, `window.__app.S.settings.clientId`);
  await click(PAGE, '[data-act="settings"]');
  await waitFor(PAGE, `!document.getElementById('sheet').hidden && !!document.querySelector('details[data-sec="reset"]')`);
  await evalPage(PAGE, `document.querySelector('details[data-sec="reset"]').open = true; window.prompt = () => 'DELETE';`);
  await click(PAGE, '[data-act="wipe-all"]');
  await waitFor(PAGE, SETUP);
  await is(PAGE, `window.__app.S.settings.onboarded === false`, 'setup returns');
  await is(PAGE, `window.__app.S.settings.clientId === ${JSON.stringify(id)}`, 'the id is unchanged in settings');
  await is(PAGE, `localStorage.getItem('weightplan.clientId') === ${JSON.stringify(id)}`, 'the id is unchanged in the local-storage mirror');
  await is(PAGE, `${kv('settings')}.then((s) => s.clientId === ${JSON.stringify(id)} && s.onboarded === false)`, 'the stored settings keep the id');

  step = '6a restore with goals';
  const restore = (backup) => evalPage(PAGE, `(() => { window.confirm = () => true; const dt = new DataTransfer(); dt.items.add(new File([${JSON.stringify(JSON.stringify(backup))}], 'backup.json', { type: 'application/json' })); const input = document.getElementById('set-import'); input.files = dt.files; input.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  await restore({ app: 'weightplan', v: 2, entries: [], days: [], settings: GOALS });
  await waitFor(PAGE, TODAYVIEW);
  await is(PAGE, `window.__app.S.settings.onboarded === true && window.__app.S.settings.targetKg === 80 && window.__app.S.settings.kcalRest === 1600`, 'the goals are restored and setup is finished');
  await is(PAGE, `${kv('settings')}.then((s) => s.onboarded === true && s.targetKg === 80)`, 'the restored settings are stored');

  step = '6b restore without goals';
  await fresh();
  await is(PAGE, SETUP, 'setup screen is shown');
  const entry = { id: 'smoke-weigh-1', day: '2026-10-01', ts: Date.UTC(2026, 9, 1, 8), createdAt: Date.UTC(2026, 9, 1, 8), kind: 'weight', status: 'ok', kg: 88, title: '88 kg' };
  await restore({ app: 'weightplan', v: 2, entries: [entry], days: [], settings: { lang: 'en' }, plans: { list: [{ id: 'P-smoke1', name: 'My plan', foods: {}, meals: [] }], active: 'P-smoke1' } });
  await waitFor(PAGE, `window.__app.S.entries.some((e) => e.id === 'smoke-weigh-1')`, { what: 'the restored entry' });
  await waitFor(PAGE, `window.__app.S.settings.setupRestorePlans === true`, { what: 'the restore marker' });
  await is(PAGE, SETUP, 'setup stays');
  await is(PAGE, `window.__app.S.settings.onboarded === false`, 'setup is not finished');
  await fillSetup('default');
  await click(PAGE, '[data-act="onboard-finish"]');
  await waitFor(PAGE, TODAYVIEW);
  await is(PAGE, `${kv('plans')}.then((p) => p.active === 'P-smoke1' && p.list.some((x) => x.id === 'P-smoke1' && x.name === 'My plan'))`, 'the restored My plan survived setup');
  await is(PAGE, `${kv('settings')}.then((s) => s.onboarded === true && !('setupRestorePlans' in s))`, 'the restore marker is gone');

  step = '7 failed save, failed cleanup, changed choice';
  await fresh();
  await is(PAGE, SETUP, 'setup screen is shown');
  await evalPage(PAGE, `(() => {
    window.__origPut = IDBObjectStore.prototype.put; window.__origDelete = IDBObjectStore.prototype.delete;
    let putFailed = false; let delFailed = false;
    IDBObjectStore.prototype.put = function (val, key) { if (!putFailed && this.name === 'days') { putFailed = true; throw new Error('smoke: days write failed'); } return window.__origPut.call(this, val, key); };
    IDBObjectStore.prototype.delete = function (key) { if (!delFailed && this.name === 'kv' && key === 'plans') { delFailed = true; throw new Error('smoke: plans delete failed'); } return window.__origDelete.call(this, key); };
  })()`);
  await fillSetup('default');
  await click(PAGE, '[data-act="onboard-finish"]');
  await waitFor(PAGE, `!document.getElementById('toast').hidden && document.getElementById('toast').textContent.includes('smoke: days write failed')`, { what: 'the error toast' });
  await is(PAGE, SETUP, 'setup stays after the failed save');
  await is(PAGE, `window.__app.S.settings.onboarded === false`, 'the settings are rolled back');
  await is(PAGE, `${kv('plans')}.then((p) => p !== null)`, 'the first attempt left its plan record behind');
  await evalPage(PAGE, `IDBObjectStore.prototype.put = window.__origPut; IDBObjectStore.prototype.delete = window.__origDelete;`);
  await click(PAGE, '#ob-plan-blank');
  await click(PAGE, '[data-act="onboard-finish"]');
  await waitFor(PAGE, TODAYVIEW);
  await is(PAGE, `${kv('plans')}.then((p) => { const mine = p.list.find((x) => x.id !== 'default'); return !!mine && mine.name === 'My plan' && p.active === mine.id; })`, 'the stored plan is the blank My plan, not the leftover default');
  await is(PAGE, `window.__app.S.settings.onboarded === true && window.__app.S.days[${TODAY}].kg === 90`, 'setup finished with its weight');
  await is(PAGE, `window.__app.S.entries.filter((e) => e.kind === 'weight').length === 1`, 'exactly one weigh-in exists');
} catch (err) {
  failure = err;
} finally {
  await cleanup();
}

if (failure) { console.error(`FAIL ${failure.message}`); process.exit(1); }
console.log(`ok ${checks} checks`);
