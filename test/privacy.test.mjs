// What must never leave the device: every model call, on both routes, is built from a seeded state that holds the
// person's name, age, gender, saved place with coordinates, API keys, supplement and install id. Nothing of that may
// reach the request body, and only the progress review may carry the Person line. `node --test`
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyze, review, progressReview, check, coach, foodValues } from '../js/ai.js';
import { reviewBrief, coachBrief, checkBrief, progressBrief } from '../js/briefs.js';
import { addDays, buildPlan } from '../js/plan.js';
import seedPlan from '../js/default-plan.js';
import { S, today, freshSettings } from '../js/core.js';

// Node has no FileReader: a small one that reads a Blob as a data URL, as the browser's does (same shim as test/ai.test.mjs)
globalThis.FileReader ??= class {
  readAsDataURL(blob) {
    blob.arrayBuffer().then((buf) => { this.result = `data:${blob.type};base64,${Buffer.from(buf).toString('base64')}`; this.onload(); }, (e) => { this.error = e; this.onerror(); });
  }
};

const KEYS = { anthropic: 'sk-ant-PRIVATEKEY-42', openai: 'sk-openai-PRIVATEKEY-77' };
const PERSON = { name: 'Zehra Quillon', age: 34, gender: 'female' };
const CLIENT_ID = 'c1ient-install-7f3e9a';
const SUPP = { id: 'supp-quill-1', name: 'Quillmag Citrate', dose: '400 mg' };
const PLACE = { name: 'Mum Quillflat', lat: 41.318273, lon: 29.104657 };
const FORBIDDEN = [PERSON.name, 'Zehra', 'Quillon', KEYS.anthropic, KEYS.openai, 'PRIVATEKEY', CLIENT_ID, SUPP.name, 'Quillmag', PLACE.name, 'Quillflat', String(PLACE.lat), String(PLACE.lon)];

const ROUTES = {
  anthropic: { provider: 'anthropic', key: KEYS.anthropic, model: 'claude-sonnet-5-5' },
  openai: { provider: 'openai', key: KEYS.openai, model: 'm', base: 'https://x.test/v1/' },
};
const IMG = new Blob(['img'], { type: 'image/jpeg' });
const meal = JSON.stringify({ kind: 'meal', title: 'x', slot: 'lunch', plan: '', items: [], kcal: 1, p: 1, c: 1, f: 1, fib: 1, tier: 'plan', flags: [], conf: 1, q: '', kg: 0, steps: 0 });
const REPLY = {
  analyze: meal,
  check: JSON.stringify({ kind: 'dish', title: 't', answer: 'a', options: [] }),
  review: JSON.stringify({ head: 'h', good: [], cut: [], next: 'n' }),
  coach: JSON.stringify({ note: 'n' }),
  progressReview: JSON.stringify({ rating: 'on-track', head: 'h', good: [], change: [], adjust: '' }),
  foodValues: JSON.stringify({ name: 'Skyr', known: true, kcal: 60, p: 10, c: 4, f: 0, fib: 0 }),
};

const day = today();
const CALLS = {
  analyze: (cfg) => analyze({ cfg, when: new Date(), text: 'lentil soup', place: PLACE.name, blobs: [IMG] }),
  check: (cfg) => check({ cfg, brief: checkBrief('pancakes, please'), note: 'pancakes, please', blobs: [IMG] }),
  review: (cfg) => review({ cfg, brief: reviewBrief(day) }),
  coach: (cfg) => coach({ cfg, brief: coachBrief(day) }),
  progressReview: (cfg) => progressReview({ cfg, brief: progressBrief(), appRating: 'on-track' }),
  foodValues: (cfg) => foodValues({ cfg, name: 'Skyr', blobs: [IMG] }),
};

// The app's real state, seeded with everything that must stay on the device. Returns a function that puts the old state back.
function seed() {
  const saved = { settings: S.settings, entries: S.entries, days: S.days, plan: S.plan };
  S.plan = buildPlan(seedPlan);
  S.settings = {
    ...freshSettings(),
    name: PERSON.name, age: PERSON.age, gender: PERSON.gender, clientId: CLIENT_ID, apiKey: KEYS.anthropic, oaKey: KEYS.openai,
    places: [PLACE], supplements: [SUPP],
    startDate: addDays(day, -10), startKg: 86.4, targetDate: addDays(day, 60), targetKg: 78, kcalRest: 1550, kcalTrain: 1750, protein: 135, proteinMin: 120,
  };
  S.entries = [{ id: 'e1', day, ts: Date.now(), kind: 'meal', status: 'ok', slot: 'lunch', title: 'Lentil soup', tier: 'plan', flags: [], mult: 1,
    kcal: 300, p: 20, c: 30, f: 10, fib: 2, conf: 1, q: '', items: [{ n: 'lentils 200 g', g: 200, kcal: 300, p: 20, c: 30, f: 10, fib: 2 }], place: PLACE.name, photoIds: [], planId: '' }];
  S.days = { [day]: { day, kg: 85.9, steps: 6000, water: 1500, train: true, taken: [SUPP.id] } };
  return () => Object.assign(S, saved);
}

let calls;
function mockFetch(text, route) {
  const body = route === 'anthropic'
    ? { content: [{ type: 'text', text }], stop_reason: 'end_turn', usage: { input_tokens: 10, output_tokens: 5 } }
    : { choices: [{ message: { content: text }, finish_reason: 'stop' }], usage: {} };
  globalThis.fetch = async (url, init) => {
    calls.push({ url, init, body: JSON.parse(init.body) });
    return { ok: true, status: 200, json: async () => body };
  };
}

for (const [name, call] of Object.entries(CALLS)) {
  for (const [route, cfg] of Object.entries(ROUTES)) {
    test(`${name} on ${route}: no name, key, coordinates, install id, supplement or place name in the request body`, async () => {
      calls = [];
      const restore = seed();
      try {
        mockFetch(REPLY[name], route);
        await call(cfg);
        assert.equal(calls.length, 1);
        const body = JSON.stringify(calls[0].body);
        for (const s of FORBIDDEN) assert.ok(!body.includes(s), `"${s}" leaked into ${name} on ${route}`);
        if (name === 'progressReview') {
          // positive control: the known-present fields really are in this body, so the checks above are not vacuous
          assert.ok(body.includes('Person: 34 years old, female'), 'age and gender are sent by the progress review');
        } else {
          assert.ok(!body.includes('Person:') && !body.includes('years old'), `the Person line is only in the progress review (${name} on ${route})`);
        }
      } finally { restore(); }
    });
  }
}

// Not covered here: the EXIF strip. Photos are re-encoded on a canvas in shrink() (js/ai.js), which node --test has no
// canvas for, so an Exif marker in a data URL cannot be asserted from these tests.
