// Dependency-free helpers for driving headless Chromium over the DevTools protocol (a pipe, no WebSocket, no npm).
// Shared by the browser tools in this folder. It lives under tools/, not test/, so `node --test` never picks it up.
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtemp, readFile, rm, access } from 'node:fs/promises';
import { constants } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, extname, delimiter, sep } from 'node:path';

const NAMES = ['chromium', 'chromium-browser', 'google-chrome', 'google-chrome-stable', 'msedge'];
const FIXED = ['/snap/bin/chromium', '/usr/bin/chromium'];

const runnable = (p) => access(p, constants.X_OK).then(() => true, () => false);

// The browser to use: $CHROME, then a name on the PATH, then the usual absolute paths. '' when there is none.
export async function findBrowser() {
  if (process.env.CHROME) return process.env.CHROME;
  for (const dir of (process.env.PATH || '').split(delimiter).filter(Boolean)) {
    for (const name of NAMES) { const p = join(dir, name); if (await runnable(p)) return p; }
  }
  for (const p of FIXED) if (await runnable(p)) return p;
  return '';
}

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json',
};

// A static file server for `root` on 127.0.0.1 (a free port). Open pages as http://localhost:<port>/ (the app exposes
// window.__app only on that host name). `extra` maps a path to { type, body } for pages that are not in the repository.
export async function serve(root, extra = {}) {
  const base = resolve(root);
  const server = createServer(async (req, res) => {
    const headers = { 'Cache-Control': 'no-store' };
    try {
      const path = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
      if (extra[path]) { res.writeHead(200, { ...headers, 'Content-Type': extra[path].type }); res.end(extra[path].body); return; }
      const file = resolve(base, '.' + (path.endsWith('/') ? path + 'index.html' : path));
      if (file !== base && !file.startsWith(base + sep)) { res.writeHead(403, headers); res.end(); return; }
      const body = await readFile(file);
      res.writeHead(200, { ...headers, 'Content-Type': MIME[extname(file)] || 'application/octet-stream' });
      res.end(body);
    } catch {
      res.writeHead(404, headers);
      res.end();
    }
  });
  await new Promise((ok, fail) => { server.once('error', fail); server.listen(0, '127.0.0.1', ok); });
  const { port } = server.address();
  return { port, origin: `http://localhost:${port}`, close: () => new Promise((ok) => { server.close(ok); server.closeAllConnections(); }) };
}

// Starts the browser with a throw-away profile and speaks the DevTools protocol on fds 3 (to it) and 4 (from it).
// Rejects with code 'ENOBROWSER' when the binary cannot be started.
export async function launch(bin, { timeout = 10000 } = {}) {
  const profile = await mkdtemp(join(tmpdir(), 'pickle-browser-'));
  const args = ['--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage', '--hide-scrollbars',
    '--remote-debugging-pipe', `--user-data-dir=${profile}`, '--window-size=390,844', 'about:blank'];
  let child;
  try {
    child = spawn(bin, args, { stdio: ['ignore', 'ignore', 'ignore', 'pipe', 'pipe'] }); // stderr ignored: it is full of dbus noise
  } catch (err) {
    await rm(profile, { recursive: true, force: true });
    throw Object.assign(new Error(`cannot start ${bin}: ${err.message}`), { code: 'ENOBROWSER' });
  }
  const pending = new Map();
  const sessions = new Map(); // sessionId -> event handlers
  let nextId = 1;
  let dead = null;
  const failAll = (err) => { dead = dead || err; for (const p of pending.values()) { clearTimeout(p.timer); p.fail(err); } pending.clear(); };
  const exited = new Promise((ok) => { child.once('exit', ok); child.once('error', ok); });
  child.on('error', (err) => failAll(Object.assign(new Error(`cannot start ${bin}: ${err.message}`), { code: 'ENOBROWSER' })));
  child.on('exit', () => failAll(new Error('the browser exited')));
  let buf = '';
  child.stdio[4].setEncoding('utf8');
  child.stdio[4].on('data', (chunk) => {
    buf += chunk;
    let i;
    while ((i = buf.indexOf('\0')) >= 0) {
      const msg = JSON.parse(buf.slice(0, i));
      buf = buf.slice(i + 1);
      if (msg.id && pending.has(msg.id)) {
        const p = pending.get(msg.id);
        pending.delete(msg.id);
        clearTimeout(p.timer);
        if (msg.error) p.fail(new Error(`${p.method}: ${msg.error.message}`)); else p.ok(msg.result);
      } else if (msg.method) (sessions.get(msg.sessionId || '') || []).forEach((h) => h(msg));
    }
  });
  child.stdio[3].on('error', () => {});
  const send = (method, params = {}, sessionId) => new Promise((ok, fail) => {
    if (dead) return fail(dead);
    const id = nextId++;
    const timer = setTimeout(() => { pending.delete(id); fail(new Error(`${method}: timed out`)); }, timeout);
    pending.set(id, { ok, fail, timer, method });
    child.stdio[3].write(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }) + '\0');
  });
  const close = async () => {
    try { await Promise.race([send('Browser.close'), new Promise((ok) => setTimeout(ok, 2000))]); } catch { /* already gone */ }
    if (child.exitCode === null && child.signalCode === null) {
      child.kill('SIGKILL');
      await exited;
    }
    await rm(profile, { recursive: true, force: true }); // a snap browser has a private /tmp: the profile is not looked into afterwards
  };
  try {
    await send('Browser.getVersion'); // the browser is up, or this rejects
  } catch (err) {
    await close();
    throw err;
  }
  return {
    send,
    close,
    // A tab: { send(method, params), session, on(handler), scriptIds }
    async newPage() {
      const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
      const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
      const handlers = [];
      sessions.set(sessionId, handlers);
      return { session: sessionId, send: (method, params) => send(method, params, sessionId), on: (h) => handlers.push(h) };
    },
  };
}

// Evaluates an expression in the page (promises are awaited) and gives back its value; a thrown error throws here too.
export async function evalPage(page, expression) {
  const r = await page.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(`${expression.slice(0, 120)} -> ${(r.exceptionDetails.exception && r.exceptionDetails.exception.description) || r.exceptionDetails.text}`);
  return r.result.value;
}

// Polls an expression until it is truthy
export async function waitFor(page, expression, { timeout = 10000, what = expression } = {}) {
  const end = Date.now() + timeout;
  let last;
  for (;;) {
    try { const v = await evalPage(page, expression); if (v) return v; last = ''; } catch (err) { last = err.message; }
    if (Date.now() > end) throw new Error(`timed out waiting for: ${what}${last ? ` (${last})` : ''}`);
    await new Promise((ok) => setTimeout(ok, 50));
  }
}

export async function click(page, selector) {
  await waitFor(page, `!!document.querySelector(${JSON.stringify(selector)})`, { what: `${selector} to exist` });
  await evalPage(page, `document.querySelector(${JSON.stringify(selector)}).click()`);
}

// Opens `url` in the tab with the service worker switched off (a cached shell would hide edits), as a phone-sized
// page, and waits until `ready` (an expression) is truthy.
export async function openApp(page, url, ready = 'true') {
  if (!page.prepared) {
    await page.send('Page.enable');
    await page.send('Runtime.enable');
    await page.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
    await page.send('Page.addScriptToEvaluateOnNewDocument', { source: 'delete Navigator.prototype.serviceWorker;' });
    page.prepared = true;
  }
  await page.send('Page.navigate', { url });
  await waitFor(page, `location.href === ${JSON.stringify(url)} && document.readyState !== 'loading' && (${ready})`, { what: `${url} to be ready` });
}

// Removes the origin's IndexedDB and local storage. The page goes to about:blank first, so no app connection is open
// (an open connection would block the delete).
export async function clearOrigin(page, origin) {
  await page.send('Page.navigate', { url: 'about:blank' });
  await waitFor(page, `location.href === 'about:blank'`);
  await page.send('Storage.clearDataForOrigin', { origin, storageTypes: 'indexeddb,local_storage' });
}
