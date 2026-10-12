// The model layer (js/ai.js) against a fetch that never leaves the machine. `node --test`
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { analyze, review, coach, check, AI_ERRORS, WAITING } from '../js/ai.js';
import { setLang, inEnglish } from '../js/i18n.js';
import { S } from '../js/core.js';
import { buildPlan, planDigest, planFoods } from '../js/plan.js';
import seedPlan from '../js/default-plan.js';

const sonnet = { provider: 'anthropic', key: 'sk-ant-secretsecret', model: 'claude-sonnet-5-5' };
const haiku = { ...sonnet, model: 'claude-haiku-4-5-20251001' };
const gemini = { provider: 'openai', key: 'k', model: 'm', base: 'https://x.test/v1/' };
const meal = JSON.stringify({ kind: 'meal', title: 'x', slot: 'lunch', plan: '', items: [], kcal: 1, p: 1, c: 1, f: 1, fib: 1, tier: 'plan', flags: [], conf: 1, q: '', kg: 0, steps: 0 });
const reply = (status, body) => ({ ok: status < 300, status, json: async () => body });
const claudeBody = (text, stop = 'end_turn') => ({ content: [{ type: 'text', text }], stop_reason: stop, usage: { input_tokens: 10, output_tokens: 5 } });

let calls;
const mockFetch = (fn) => { globalThis.fetch = async (url, init) => { calls.push({ url, init, body: JSON.parse(init.body) }); return fn(url, init); }; };
beforeEach(() => { calls = []; });

const ask = (cfg) => analyze({ cfg, text: 'apple', when: new Date() });

test('Sonnet 5.5 is told not to think into its small token budget; Haiku is not (it would reject the field)', async () => {
  mockFetch(() => reply(200, claudeBody(meal)));
  await ask(sonnet);
  await ask(haiku);
  assert.deepEqual(calls[0].body.thinking, { type: 'between_tools' });
  assert.equal('thinking' in calls[1].body, false);
  assert.ok(calls[0].body.output_config.format.schema);
});

test('every request carries an abort signal, so a stalled one cannot block the queue', async () => {
  mockFetch(() => reply(200, claudeBody(meal)));
  await ask(haiku);
  assert.ok(calls[0].init.signal);
});

test('an OpenAI-compatible request describes the reply in words and sends no schema', async () => {
  mockFetch(() => reply(200, { choices: [{ message: { content: meal }, finish_reason: 'stop' }], usage: {} }));
  await ask(gemini);
  assert.equal(calls[0].url, 'https://x.test/v1/chat/completions');
  assert.match(calls[0].body.messages[0].content, /Return exactly one JSON object/);
  assert.equal('output_config' in calls[0].body, false);
});

test('an answer cut off at the token limit says so, instead of "SyntaxError"', async () => {
  mockFetch(() => reply(200, claudeBody('{"kind":"meal","title":"Ch', 'max_tokens')));
  await assert.rejects(ask(haiku), { code: 'truncated' });
  mockFetch(() => reply(200, { content: [], stop_reason: 'max_tokens', usage: {} }));
  await assert.rejects(ask(sonnet), { code: 'truncated' });
  mockFetch(() => reply(200, { choices: [{ message: { content: '{"kind":' }, finish_reason: 'length' }] }));
  await assert.rejects(ask(gemini), { code: 'truncated' });
});

test('a reply that is not JSON is an error with a code', async () => {
  mockFetch(() => reply(200, claudeBody('{not json}')));
  await assert.rejects(ask(haiku), { code: 'empty' });
});

test('a provider that echoes the key in its error does not get it into the message', async () => {
  mockFetch(() => reply(400, { error: { message: 'bad request for key sk-ant-secretsecret' } }));
  await assert.rejects(ask(haiku), (e) => !e.message.includes('sk-ant-secretsecret') && e.message.includes('…'));
});

test('a timeout is reported as one and is not retried', async () => {
  mockFetch(() => { const e = new Error('t'); e.name = 'TimeoutError'; throw e; });
  await assert.rejects(ask(haiku), { code: 'timeout' });
  assert.equal(calls.length, 1);
});

test('errors are told apart: a large image is not "no photos", a bad key is a bad key', async () => {
  const cases = [
    [400, 'image exceeds 5 MB maximum', 'bad_request'],
    [400, 'API key not valid. Please pass a valid API key.', 'bad_key'],
    [401, 'x', 'bad_key'],
    [400, 'model does not support image input', 'no_vision'],
    [429, 'quota', 'rate'],
  ];
  for (const [status, message, code] of cases) {
    mockFetch(() => reply(status, { error: { message } }));
    await assert.rejects(ask(haiku), { code }, `${status} ${message}`);
  }
});

test('every error code has a message, and the waiting note is added separately', () => {
  for (const code of ['no_key', 'bad_key', 'offline', 'net', 'timeout', 'truncated', 'rate', 'no_quota', 'no_credit', 'needs_billing', 'no_vision', 'bad_model', 'server', 'bad_request', 'empty', 'http']) {
    assert.ok(AI_ERRORS[code], code);
    assert.ok(!/entry is waiting/i.test(AI_ERRORS[code]), code);
  }
  assert.match(WAITING, /waiting/);
});

test('a check: hostile numbers and shapes from the model are clamped', async () => {
  const out = { kind: 'menu', title: 't', answer: 'a', options: [{ name: 'Soup', rating: 7, fit: 'good', portion: 'p', kcal: 1e9, p: -4, c: 'x', f: 5, fib: 1, facts: '', why: 'w', tip: '', tier: 'plan' }, null, 'junk'] };
  mockFetch(() => reply(200, claudeBody(JSON.stringify(out))));
  const { data } = await check({ cfg: haiku, brief: 'b' });
  assert.equal(data.options.length, 1);
  assert.deepEqual([data.options[0].kcal, data.options[0].rating, data.options[0].p], [5000, 5, 0]);
});

test('a review whose list is a plain string is accepted', async () => {
  mockFetch(() => reply(200, claudeBody(JSON.stringify({ head: 'h', good: 'one', cut: [], next: 'n' }))));
  const { data } = await review({ cfg: haiku, brief: 'b' });
  assert.deepEqual(data.good, ['one']);
});

test('a quick note: text is cleaned, an empty one is an error', async () => {
  mockFetch(() => reply(200, claudeBody(JSON.stringify({ note: '  Good  start.\n Add protein. ' }))));
  const { data } = await coach({ cfg: haiku, brief: 'b' });
  assert.equal(data.note, 'Good start. Add protein.');
  mockFetch(() => reply(200, claudeBody(JSON.stringify({ note: '' }))));
  await assert.rejects(() => coach({ cfg: haiku, brief: 'b' }), { code: 'empty' });
});

// ——— The language line in the prompts ———
const LINE = '\nWrite all user-facing text (titles, notes, questions, reviews, glosses) in Turkish; keep JSON keys and enum values exactly as specified.';
const ENTRY_LINE = '\nWrite q in Turkish; keep food names and title in English. Keep JSON keys and enum values exactly as specified.';
const askers = {
  analyze: [() => analyze({ cfg: haiku, text: 'apple', when: new Date() }), meal, ENTRY_LINE],
  review: [() => review({ cfg: haiku, brief: 'b' }), JSON.stringify({ head: 'h', good: [], cut: [], next: 'n' }), LINE],
  coach: [() => coach({ cfg: haiku, brief: 'b' }), JSON.stringify({ note: 'n' }), LINE],
  check: [() => check({ cfg: haiku, brief: 'b' }), JSON.stringify({ kind: 'dish', title: 't', answer: 'a', options: [] }), LINE],
};
test('Turkish adds one line to each prompt; the English prompt is untouched', async () => {
  try {
    for (const [name, [run, body, line]] of Object.entries(askers)) {
      mockFetch(() => reply(200, claudeBody(body)));
      await setLang('en');
      await run();
      await setLang('tr');
      await run();
      const [en, tr] = calls.splice(0).map((c) => c.body.system);
      assert.ok(!/Turkish/.test(en), name);
      assert.equal(tr, en + line, name);
    }
  } finally { await setLang('en'); }
});

test('the line follows the language the person chose, also when the request is made inside inEnglish', async () => {
  try {
    mockFetch(() => reply(200, claudeBody(askers.coach[1])));
    await setLang('tr');
    const pending = inEnglish(() => askers.coach[0]()); // the language is English here for a moment; the choice is not
    await pending;
    assert.ok(calls[0].body.system.endsWith(LINE));
  } finally { await setLang('en'); }
});

test('the vision probe prompt carries no language line', async () => {
  const src = (await import('node:fs')).readFileSync(new URL('../js/ai.js', import.meta.url), 'utf8');
  assert.match(src, /system: 'You read numbers from images\.'/);
});

test('every prompt is built from the active plan at request time, and stays English in Turkish', async () => {
  const saved = S.plan;
  // A plan of the person's own: a new food and meal, and no meal at snack 2
  const mine = buildPlan({ ...seedPlan, id: 'P-abc123', name: 'My plan', foods: { ...seedPlan.foods, u1: { name: 'Oat drink', v: [45, 1, 6.5, 1.5, 0.8] } },
    meals: [...seedPlan.meals.filter((m) => m.slot !== 'snack2'), { id: 'U-x1', slot: 'lunch', name: 'Oat bowl', ingredients: [['u1', 250]] }] });
  try {
    S.plan = buildPlan(seedPlan);
    for (const [run, body] of Object.values(askers)) { mockFetch(() => reply(200, claudeBody(body))); await run(); }
    const before = calls.splice(0).map((c) => c.body.system);
    assert.ok(before.every((x) => !/U-x1|Oat drink/.test(x)));
    S.plan = mine;
    for (const [name, [run, body, line]] of Object.entries(askers)) {
      mockFetch(() => reply(200, claudeBody(body)));
      await setLang('en');
      await run();
      await setLang('tr');
      await run();
      const [en, tr] = calls.splice(0).map((c) => c.body.system);
      assert.equal(tr, en + line, name); // English in Turkish too, with only the language line added
      assert.ok(en.includes(name === 'check' ? planFoods(mine) : planDigest(mine)), name);
      assert.match(en, /Oat drink/, name);
      if (name === 'review' || name === 'coach') assert.match(en, /meals are lunch 12:00, snack 1 14:30, dinner 18:00\./, name); // only the meal times the plan has
    }
  } finally { S.plan = saved; await setLang('en'); }
});
