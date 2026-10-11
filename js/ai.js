// Model calls. Two routes: Claude (Anthropic Messages API) or any OpenAI-compatible endpoint
// (Gemini, OpenCode Zen/Go, OpenRouter…). Kept token-lean: small image, short fixed
// instruction, short JSON output.
import { planDigest, planFoods, RULES, SLOTS, hhmm } from './plan.js';
import { T, inEnglish, getUiLang } from './i18n.js';
import { decode } from './picture.js';

export const MODELS = {
  'claude-haiku-4-5-20251001': { name: 'Haiku 4.5 (fast, cheap)', inp: 1, out: 5 },
  'claude-sonnet-5-5': { name: 'Sonnet 5.5 (more careful)', inp: 2, out: 10 },
};
export const STRONG_MODEL = 'claude-sonnet-5-5';
const IMG_EDGE = 768; // long edge; 768×576 is about 590 image tokens
export const CHECK_EDGE = 1536; // menus and nutrition tables have small print, so checks send a larger copy

const SYSTEM = `You log food for one person on a weight-loss plan. Reply with JSON only. Write food names, title and q in English.
Input: photo(s) and/or a short text in any language, plus local time and place.
kind: "meal" (food or drink), "weight" (scale reading, set kg), "steps" (step count, set steps), "none" (nothing to log).
For meals: list each item with grams estimated from visual cues (dinner plate ≈ 26 cm, cutlery, hands), include visible oil, sauces and drinks, and when unsure pick the larger plausible portion. Name each item specifically and, where you assumed something you cannot see, say so in brackets: "falafel (assumed fried)", "white cheese (assumed full-fat)". Food eaten "out" usually carries more fat. kcal, p, c, f, fib are totals for the whole entry; kcal equals the sum of the items' kcal.
A note or correction from the person outranks what you see: follow it, drop the matching assumption and do not ask about it again.
If the meal clearly matches a plan meal below, set plan to its id and use its numbers; otherwise plan is "".
slot: morning, lunch, snack1, snack2, dinner, late, or workout (pre/post-workout banana or skyr). Choose by time and content.
tier: "plan" = fits the plan's foods; "flex" = weekly-budget items (beer, a small dessert, a restaurant dinner); "off" = sugary drinks, fried food, crisps, salted nuts, pastries (simit, börek, poğaça, croissant, pretzel), white bread or toast.
flags: add "alcohol" for any alcohol.
conf: 0–1 confidence in the kcal total. q: if something you cannot see (cooking method, fat content, a count, hidden oil or sugar) could change kcal by more than 10%, ask about it in one short line, else "".
Plan meals:
${planDigest()}`;

// The prompts are English and built once, and what the model sends back is shown as it comes. For Turkish one line is added at request time,
// from the language the person chose (getUiLang, not changed by inEnglish). English adds nothing, so its prompts are byte-identical.
// Entries keep English food names and titles (the plan and the favourites match on them), so only the question is asked for in Turkish.
const TURKISH = {
  entry: '\nWrite q in Turkish; keep food names and title in English. Keep JSON keys and enum values exactly as specified.',
  text: '\nWrite all user-facing text (titles, notes, questions, reviews, glosses) in Turkish; keep JSON keys and enum values exactly as specified.',
};
export const langLine = (kind = 'text') => (getUiLang() === 'tr' ? TURKISH[kind] : '');

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['kind', 'title', 'slot', 'plan', 'items', 'kcal', 'p', 'c', 'f', 'fib', 'tier', 'flags', 'conf', 'q', 'kg', 'steps'],
  properties: {
    kind: { type: 'string', enum: ['meal', 'weight', 'steps', 'none'] },
    title: { type: 'string' },
    slot: { type: 'string', enum: ['morning', 'lunch', 'snack1', 'snack2', 'dinner', 'late', 'workout'] },
    plan: { type: 'string' },
    items: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['n', 'g', 'kcal', 'p'],
        properties: { n: { type: 'string' }, g: { type: 'number' }, kcal: { type: 'number' }, p: { type: 'number' } },
      },
    },
    kcal: { type: 'number' },
    p: { type: 'number' },
    c: { type: 'number' },
    f: { type: 'number' },
    fib: { type: 'number' },
    tier: { type: 'string', enum: ['plan', 'flex', 'off'] },
    flags: { type: 'array', items: { type: 'string' } },
    conf: { type: 'number' },
    q: { type: 'string' },
    kg: { type: 'number' },
    steps: { type: 'number' },
  },
};

// Shrinks the photo on the device; this copy is what gets sent (and, for logged meals, stored).
export async function shrink(file, edge = IMG_EDGE) {
  const bmp = await decode(file);
  const w0 = bmp.naturalWidth || bmp.width;
  const h0 = bmp.naturalHeight || bmp.height;
  const k = Math.min(1, edge / Math.max(w0, h0));
  const w = Math.max(1, Math.round(w0 * k));
  const h = Math.max(1, Math.round(h0 * k));
  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
  const g = cv.getContext('2d');
  g.fillStyle = '#fff'; // a transparent PNG would turn black as a JPEG
  g.fillRect(0, 0, w, h);
  try { g.drawImage(bmp, 0, 0, w, h); } finally { if (bmp.close) bmp.close(); }
  const blob = await new Promise((res) => cv.toBlob(res, 'image/jpeg', 0.8));
  cv.width = 0; // gives the canvas memory back: Safari limits the total
  if (!blob) throw new Error('Could not shrink the image');
  return { blob, w, h };
}

const toB64 = (blob) => new Promise((res, rej) => {
  const fr = new FileReader();
  fr.onload = () => res(String(fr.result).split(',')[1]);
  fr.onerror = () => rej(fr.error);
  fr.readAsDataURL(blob);
});

function parseLoose(text) {
  const t = String(text).replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
  try { return JSON.parse(t); } catch { /* try below */ }
  const a = t.indexOf('{');
  const b = t.lastIndexOf('}');
  if (a >= 0 && b > a) { try { return JSON.parse(t.slice(a, b + 1)); } catch { /* not JSON either */ } }
  throw new AiError('empty', 'Reply is not JSON');
}
// A reply that was cut off at the token limit is reported as that, not as unreadable
function parseReply(r) {
  try {
    return parseLoose(r.text);
  } catch (e) {
    throw r.truncated ? new AiError('truncated', 'The answer was cut off') : e;
  }
}

export class AiError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

// Presets for OpenAI-compatible providers. The model name is the provider's own id.
export const PRESETS = [
  { id: 'gemini', name: 'Google Gemini (free tier)', base: 'https://generativelanguage.googleapis.com/v1beta/openai', model: 'gemini-3.5-flash', alt: ['gemini-3.5-flash-lite', 'gemini-3.8-flash'] },
  { id: 'opencode-zen', name: 'OpenCode Zen (free models)', base: 'https://opencode.ai/zen/v1', model: '' },
  { id: 'opencode-go', name: 'OpenCode Go', base: 'https://opencode.ai/zen/go/v1', model: '' },
  { id: 'openrouter', name: 'OpenRouter', base: 'https://openrouter.ai/api/v1', model: '' },
];
// Free OpenCode Zen ids to try when the /models list cannot be fetched
export const ZEN_FREE = [
  'mimo-v2.5-free', 'mimo-v2.6-flash-free', 'muse-spark-1.3-contributor-free', 'big-pickle', 'space-bunny-free',
  'longcat-2.5-preview-free', 'nemotron-3-ultra-free', 'nemotron-3.5-lightning-free', 'ling-3.0-flash-fin-free', 'jev-1.13-free',
];

const SHAPE = '\nReturn exactly one JSON object with all of these keys: {"kind":"meal|weight|steps|none","title":"","slot":"morning|lunch|snack1|snack2|dinner|late|workout","plan":"","items":[{"n":"","g":0,"kcal":0,"p":0}],"kcal":0,"p":0,"c":0,"f":0,"fib":0,"tier":"plan|flex|off","flags":[],"conf":0,"q":"","kg":0,"steps":0}';

function classify(status, msg) {
  // 429 is a quota or rate limit, whatever the text says: Gemini's quota message mentions "billing" on the free tier too.
  // "limit: 0" means this model has no quota at all on the account's plan.
  if (status === 429) return /limit:\s*0\b/.test(msg) ? 'no_quota' : 'rate';
  if (status === 402 || /credit balance|insufficient (credit|balance|funds)|payment required/i.test(msg)) return 'no_credit';
  if (/free tier is not available|enable billing|billing account/i.test(msg)) return 'needs_billing';
  if (status === 401 || status === 403 || /api key not valid|invalid api key|incorrect api key/i.test(msg)) return 'bad_key';
  // A photo that is too large is a different problem from a model that cannot read photos
  if (/image|vision|multimodal|modalit/i.test(msg) && !/exceed|too (large|big)|maximum/i.test(msg) && (status === 400 || status === 404 || status === 415 || status === 422)) return 'no_vision';
  if (status === 404) return 'bad_model';
  if (status === 400 || status === 422) return 'bad_request';
  if (status >= 500) return 'server';
  return 'http';
}

// When the provider is busy (503 and the like) the request is retried after short waits (ms)
const RETRY_MS = [1200, 3000];
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const TIMEOUT_MS = 60000; // a request that has not answered by then is given up on, so the queue does not stall behind it

async function postOnce(url, headers, payload, timeout) {
  let res;
  try {
    res = await fetch(url, {
      method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(payload),
      signal: typeof AbortSignal.timeout === 'function' ? AbortSignal.timeout(timeout) : undefined,
    });
  } catch (err) {
    if (err && err.name === 'TimeoutError') throw new AiError('timeout', 'The provider did not answer in time');
    throw new AiError(navigator.onLine === false ? 'offline' : 'net', 'Could not connect');
  }
  let json = null;
  try { json = await res.json(); } catch { /* no body */ }
  if (!res.ok) {
    const er = (Array.isArray(json) ? json[0] : json) || {};
    const e = er.error;
    let msg = String((e && (e.message || (typeof e === 'string' ? e : ''))) || er.message || `HTTP ${res.status}`);
    // A provider that echoes the key in its error must not get it into a stored message
    const secret = headers['x-api-key'] || String(headers.authorization || '').slice(7);
    if (secret.length > 8) msg = msg.split(secret).join('…');
    throw new AiError(classify(res.status, msg), /HTTP \d+/.test(msg) ? msg : `${msg} (HTTP ${res.status})`);
  }
  return json || {};
}

async function post(url, headers, payload, opts = {}) {
  const tries = opts.retry === false ? 0 : RETRY_MS.length;
  for (let i = 0; ; i++) {
    try {
      return await postOnce(url, headers, payload, opts.timeout || TIMEOUT_MS);
    } catch (e) {
      if (e.code !== 'server' || i >= tries) throw e;
      if (opts.onRetry) opts.onRetry(i + 1, tries);
      await wait(RETRY_MS[i] * (0.85 + Math.random() * 0.3));
    }
  }
}

/**
 * One call. cfg: {provider:'anthropic'|'openai', key, model, base?}
 * schema: a JSON schema the Claude route enforces. shape: the same reply described in words, which
 * the OpenAI-compatible route needs instead, because not every endpoint takes a schema.
 * @returns {Promise<{text:string, usage:{in:number,out:number}, truncated:boolean}>}
 */
export async function callModel(cfg, { system, shape = '', text, blobs = [], schema = null, json = false, maxTokens = 600, maxImages = 3, retry = true, onRetry = null, timeout = TIMEOUT_MS }) {
  const retryOpts = { retry, onRetry, timeout };
  if (!cfg || !cfg.key) throw new AiError('no_key', 'No API key set');
  const imgs = [];
  for (const b of blobs.slice(0, maxImages)) imgs.push(await toB64(b));

  if (cfg.provider === 'openai') {
    if (!cfg.base || !cfg.model) throw new AiError('no_key', 'No address or model set');
    const content = imgs.map((d) => ({ type: 'image_url', image_url: { url: `data:image/jpeg;base64,${d}` } }));
    content.push({ type: 'text', text });
    const body = {
      model: cfg.model,
      max_tokens: Math.max(maxTokens * 2, 1500), // thinking models spend part of the budget on reasoning
      messages: [{ role: 'system', content: system + shape }, { role: 'user', content: imgs.length ? content : text }],
    };
    if (json) body.response_format = { type: 'json_object' };
    const url = cfg.base.replace(/\/+$/, '') + '/chat/completions';
    const headers = { authorization: `Bearer ${cfg.key}` };
    let out;
    try {
      out = await post(url, headers, body, retryOpts);
    } catch (e) {
      if (json && e.code === 'bad_request' && /response_format|json/i.test(e.message)) {
        const { response_format, ...rest } = body;
        out = await post(url, headers, rest, retryOpts);
      } else throw e;
    }
    const choice = (out.choices && out.choices[0]) || {};
    const msg = choice.message;
    let txt = msg ? msg.content : '';
    if (Array.isArray(txt)) txt = txt.filter((c) => c.type === 'text' || typeof c.text === 'string').map((c) => c.text).join('');
    const truncated = choice.finish_reason === 'length';
    if (!txt) throw new AiError(truncated ? 'truncated' : 'empty', truncated ? 'The answer was cut off' : 'The model returned nothing');
    const u = out.usage || {};
    return { text: String(txt), usage: { in: u.prompt_tokens || 0, out: u.completion_tokens || 0 }, truncated };
  }

  const content = imgs.map((d) => ({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: d } }));
  content.push({ type: 'text', text });
  const body = { model: cfg.model, max_tokens: maxTokens, system, messages: [{ role: 'user', content }] };
  // Sonnet 5.5 thinks before it answers unless told not to, and that thinking would eat the small token budget
  if (cfg.model === STRONG_MODEL) body.thinking = { type: 'between_tools' };
  if (schema) body.output_config = { format: { type: 'json_schema', schema } };
  const headers = { 'x-api-key': cfg.key, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' };
  const url = 'https://api.anthropic.com/v1/messages';
  let out;
  try {
    out = await post(url, headers, body, retryOpts);
  } catch (e) {
    // If schema output is rejected, retry the same request once without the schema.
    if (schema && e.code === 'bad_request' && /output_config|schema|format/i.test(e.message)) {
      const { output_config, ...rest } = body;
      out = await post(url, headers, rest, retryOpts);
    } else throw e;
  }
  const txt = (out.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('');
  const truncated = out.stop_reason === 'max_tokens';
  if (out.stop_reason === 'refusal' || !txt) throw new AiError(truncated ? 'truncated' : 'empty', truncated ? 'The answer was cut off' : 'The model returned nothing');
  return { text: txt, usage: { in: (out.usage && out.usage.input_tokens) || 0, out: (out.usage && out.usage.output_tokens) || 0 }, truncated };
}

/**
 * @param {{cfg:object, blobs?:Blob[], text?:string, when:Date, place?:string|null, hint?:string, onRetry?:Function}} o
 * @returns {Promise<{data:object, usage:{in:number,out:number}, model:string}>}
 */
export async function analyze(o) {
  const lines = [`Time ${hhmm(o.when)}` + (o.place ? `, place: ${o.place}` : '')];
  if (o.text) lines.push(`Note: ${o.text}`);
  if (o.hint) lines.push(o.hint);
  const req = { system: SYSTEM + langLine('entry'), shape: SHAPE, text: lines.join('\n'), blobs: o.blobs || [], schema: SCHEMA, json: true };
  return callWithFallback(o.cfg, req, o.onRetry);
}

// One request; when the model is busy or out of quota (quotas are per model), the same provider's fallback models get one try each
async function callWithFallback(cfg, req, onRetry) {
  try {
    const r = await callModel(cfg, { ...req, onRetry });
    return { data: parseReply(r), usage: r.usage, model: cfg.model };
  } catch (e) {
    if (!FALLBACK_ON.includes(e.code)) throw e;
    const preset = cfg.provider === 'openai' ? PRESETS.find((p) => p.base === cfg.base) : null;
    for (const model of ((preset && preset.alt) || []).filter((m) => m !== cfg.model)) {
      if (onRetry) onRetry(0, 0, model, e.code);
      try {
        const r = await callModel({ ...cfg, model }, { ...req, retry: false });
        return { data: parseReply(r), usage: r.usage, model, fallbackFrom: e };
      } catch (e2) {
        if (!FALLBACK_ON.includes(e2.code) && e2.code !== 'bad_model') throw e2;
      }
    }
    throw e;
  }
}
const FALLBACK_ON = ['server', 'rate', 'no_quota'];

// ——— The day's review: text only, a few hundred tokens ———
// The prompts are always English, whatever the interface language is
const REVIEW_SYSTEM = inEnglish(() => `You review one day of a food log for one person on a weight-loss plan, against the plan and the goal. Reply with JSON only, in English.
The plan: the calorie budget and protein goal given with the day; meals are ${SLOTS.filter((x) => x.id !== 'late').map((x) => `${x.name.toLowerCase()} ${x.time}`).join(', ')}.
Weekly allowance: ${RULES.weekly.join(' ')}
Off plan: ${RULES.off.join(' ')}
The calories against the budget are the main goal; protein, fibre and the rest are secondary, so never call a day a miss for those alone. Use only the foods and numbers given; never invent an amount. Name the actual foods. Be supportive and encouraging, like a kind coach reading the numbers: name what went well first, stay concrete, never scold or moralise, and treat a bigger day as one day, not a failure. No medical advice.
head: one sentence. How did the day go against the plan, and what is the main reason? Follow the app's verdict, which is computed from the numbers. If the log is clearly incomplete, say that instead of judging.
good: up to 2 things that helped, each naming the food or habit. Empty if there were none.
cut: up to 2 things that cost the most and what would have reduced them, with the kcal that would save. Empty if nothing needed cutting.
next: one concrete thing to do tomorrow; for a day still in progress, for the rest of today.
Every string at most 22 words.`);
const REVIEW_SHAPE = '\nReturn exactly one JSON object with these keys: {"head":"","good":[""],"cut":[""],"next":""}';
const REVIEW_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['head', 'good', 'cut', 'next'],
  properties: {
    head: { type: 'string' },
    good: { type: 'array', items: { type: 'string' } },
    cut: { type: 'array', items: { type: 'string' } },
    next: { type: 'string' },
  },
};

/**
 * @param {{cfg:object, brief:string, onRetry?:Function}} o brief: the day in plain lines, built by the app
 * @returns {Promise<{data:{head:string,good:string[],cut:string[],next:string}, usage:{in:number,out:number}, model:string}>}
 */
export async function review(o) {
  const req = { system: REVIEW_SYSTEM + langLine(), shape: REVIEW_SHAPE, text: o.brief, schema: REVIEW_SCHEMA, json: true, maxTokens: 400 };
  const r = await callWithFallback(o.cfg, req, o.onRetry);
  const data = cleanReview(r.data);
  if (!data.head) throw new AiError('empty', 'The model returned no review');
  return { ...r, data };
}

// Text that came from outside (a model, a backup file): plain, single-spaced and short
const clean = (v, max) => String(typeof v === 'string' || typeof v === 'number' ? v : '').replace(/\s+/g, ' ').trim().slice(0, max);
export function cleanReview(d) {
  d = d && typeof d === 'object' ? d : {};
  const list = (v) => (Array.isArray(v) ? v : v ? [v] : []).map((x) => clean(x, 240)).filter(Boolean).slice(0, 2);
  return { head: clean(d.head, 240), good: list(d.good), cut: list(d.cut), next: clean(d.next, 240) };
}

// ——— The quick note on the day so far: text only, a few sentences ———
// The prompts are always English, whatever the interface language is
const COACH_SYSTEM = inEnglish(() => `You give one person on a weight-loss plan a quick, supportive check-in on their day so far. Reply with JSON only, in English.
The plan: the calorie budget and protein goal given with the day; meals are ${SLOTS.filter((x) => x.id !== 'late').map((x) => `${x.name.toLowerCase()} ${x.time}`).join(', ')}.
Weekly allowance: ${RULES.weekly.join(' ')}
Off plan: ${RULES.off.join(' ')}
note: two or three short sentences, at most 45 words in all. Say how the day is going so far, then what is left of the budget and which macros (protein first, then fibre) are still worth adding, with a concrete food or meal from the plan for the rest of the day. Warm and encouraging, never scolding; if the day is already above budget, be kind and say what to do next without skipping meals.
The calories against the budget are the main goal; protein and fibre are secondary, so mention them as an easy extra, never as a failure. Use only the foods and numbers given; never invent an amount. No medical advice.`);
const COACH_SHAPE = '\nReturn exactly one JSON object with this key: {"note":""}';
const COACH_SCHEMA = { type: 'object', additionalProperties: false, required: ['note'], properties: { note: { type: 'string' } } };

/**
 * @param {{cfg:object, brief:string, onRetry?:Function}} o brief: the day so far in plain lines, built by the app
 * @returns {Promise<{data:{note:string}, usage:{in:number,out:number}, model:string}>}
 */
export async function coach(o) {
  const req = { system: COACH_SYSTEM + langLine(), shape: COACH_SHAPE, text: o.brief, schema: COACH_SCHEMA, json: true, maxTokens: 250 };
  const r = await callWithFallback(o.cfg, req, o.onRetry);
  const data = cleanCoach(r.data);
  if (!data.note) throw new AiError('empty', 'The model returned no note');
  return { ...r, data };
}
export const cleanCoach = (d) => ({ note: clean(d && typeof d === 'object' ? d.note : '', 400) });

// ——— Check before ordering or buying: photos of a menu, a dish or a product, judged against the plan ———
// The prompts are always English, whatever the interface language is
const CHECK_SYSTEM = inEnglish(() => `You help one person on a weight-loss plan decide what to order or what to buy. They send photos of a restaurant menu, a dish, a shop shelf or a packaged product (front, nutrition table, ingredients), sometimes with a note. Several photos can show one thing or several things to compare. Reply with JSON only, in English. Keep dish and product names as written; add a short English gloss in brackets when the name is in another language.
The plan is built from: ${planFoods()}.
Weekly allowance: ${RULES.weekly.join(' ')}
Off plan: ${RULES.off.join(' ')}
kind: "menu", "product" (one or several packaged products), "dish" (prepared food in front of them), or "none" when there is nothing to judge or the text is too small or blurred to read.
title: what you are looking at, in a few words.
answer: the decision in one or two sentences: what to order, or buy it / leave it, and the main reason, measured against the plan and what is left of today. For "none", say what is missing.
options: up to 6. Menu: the best choices first (up to 4), then up to 2 tempting ones to avoid. Products: each product shown. Dish: that dish.
For each option:
- rating: 1 to 5, the food's nutritional quality in general, whoever eats it. 5 = whole foods, lean protein, vegetables, fibre. 1 = mostly sugar, refined starch, deep-fried or ultra-processed.
- fit: "good" fits the plan and today's remaining budget; "ok" works with the change in tip or in a smaller portion; "avoid".
- portion: the amount the numbers are for, as the person would eat it: "1 plate", "1 bar (40 g)", "150 g".
- kcal, p, c, f, fib: for that portion. For packaged products read the nutrition table and compute; if no table is visible, estimate and say so in why. For restaurant food estimate as restaurants cook: more fat than at home.
- facts: for packaged products the label per 100 g, "per 100 g: 380 kcal, 8 g protein, 22 g sugar, 12 g fat, 1.1 g salt"; otherwise "".
- why: one sentence with the numbers or ingredients that decide it.
- tip: how to make it fit: "grilled instead of fried, sauce on the side", "eat 30 g, not the bag". For an option to avoid, what to have instead. "" if nothing is needed.
- tier: "plan" = fits the plan's foods; "flex" = weekly-allowance items; "off" = the off-plan list.
Judge only what you can read or see; never invent a label value. answer at most 40 words, why at most 24, tip at most 16.`);
const CHECK_SHAPE = '\nReturn exactly one JSON object with these keys: {"kind":"menu|product|dish|none","title":"","answer":"","options":[{"name":"","rating":0,"fit":"good|ok|avoid","portion":"","kcal":0,"p":0,"c":0,"f":0,"fib":0,"facts":"","why":"","tip":"","tier":"plan|flex|off"}]}';
const CHECK_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['kind', 'title', 'answer', 'options'],
  properties: {
    kind: { type: 'string', enum: ['menu', 'product', 'dish', 'none'] },
    title: { type: 'string' },
    answer: { type: 'string' },
    options: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['name', 'rating', 'fit', 'portion', 'kcal', 'p', 'c', 'f', 'fib', 'facts', 'why', 'tip', 'tier'],
        properties: {
          name: { type: 'string' }, rating: { type: 'number' }, fit: { type: 'string', enum: ['good', 'ok', 'avoid'] },
          portion: { type: 'string' }, kcal: { type: 'number' }, p: { type: 'number' }, c: { type: 'number' }, f: { type: 'number' }, fib: { type: 'number' },
          facts: { type: 'string' }, why: { type: 'string' }, tip: { type: 'string' }, tier: { type: 'string', enum: ['plan', 'flex', 'off'] },
        },
      },
    },
  },
};

/**
 * @param {{cfg:object, blobs:Blob[], brief:string, onRetry?:Function}} o brief: today's state and the person's note, built by the app
 * @returns {Promise<{data:{kind:string,title:string,answer:string,options:object[]}, usage:{in:number,out:number}, model:string}>}
 */
export async function check(o) {
  const req = { system: CHECK_SYSTEM + langLine(), shape: CHECK_SHAPE, text: o.brief, blobs: o.blobs || [], maxImages: 4, schema: CHECK_SCHEMA, json: true, maxTokens: 1400, timeout: 90000 };
  const r = await callWithFallback(o.cfg, req, o.onRetry);
  const data = cleanVerdict(r.data);
  if (!data.answer && !data.options.length) throw new AiError('empty', 'The model returned no verdict');
  return { ...r, data };
}

// A verdict with every field the right type and size, whether it came from the model or from a backup file
export function cleanVerdict(d) {
  d = d && typeof d === 'object' ? d : {};
  const num = (v, max) => (Number.isFinite(+v) && +v > 0 ? Math.min(max, Math.round(+v)) : 0);
  const options = (Array.isArray(d.options) ? d.options : []).slice(0, 6).map((x) => {
    x = x && typeof x === 'object' ? x : {};
    return {
      name: clean(x.name, 90), rating: Math.min(5, Math.max(1, Math.round(+x.rating || 3))),
      fit: ['good', 'ok', 'avoid'].includes(x.fit) ? x.fit : 'ok', portion: clean(x.portion, 40),
      kcal: num(x.kcal, 5000), p: num(x.p, 500), c: num(x.c, 800), f: num(x.f, 500), fib: num(x.fib, 150),
      facts: clean(x.facts, 160), why: clean(x.why, 220), tip: clean(x.tip, 160),
      tier: ['plan', 'flex', 'off'].includes(x.tier) ? x.tier : 'flex',
    };
  }).filter((x) => x.name);
  return { kind: ['menu', 'product', 'dish', 'none'].includes(d.kind) ? d.kind : 'none', title: clean(d.title, 80), answer: clean(d.answer, 360), options };
}

// The useful part of a provider's error text: for quota errors the limit, the model and the wait, otherwise the start of the message
export function errorDetail(err, max = 200) {
  const msg = String((err && err.message) || '');
  if (err && (err.code === 'rate' || err.code === 'no_quota')) {
    const limit = /limit:\s*(\d+)/.exec(msg);
    const model = /model:\s*([\w.-]+)/.exec(msg);
    const retry = /retry in\s*([\d.]+)\s*s/i.exec(msg);
    const period = /per[\s_]?day/i.test(msg) ? ' a day' : /per[\s_]?minute/i.test(msg) ? ' a minute' : '';
    const parts = [];
    if (limit && model) parts.push(`The limit for ${model[1]} is ${limit[1]} ${limit[1] === '1' ? 'request' : 'requests'}${period}.`);
    else if (limit) parts.push(`The limit is ${limit[1]} ${limit[1] === '1' ? 'request' : 'requests'}${period}.`);
    if (retry && err.code === 'rate') parts.push(`The provider says to retry in ${Math.ceil(+retry[1])} s.`);
    if (parts.length) return parts.join(' ');
  }
  return msg.replace(/\s+/g, ' ').trim().slice(0, max);
}

// Checks that the model really sees photos: it has to read a random number from an image.
export async function probeVision(cfg) {
  const n = String(1000 + Math.floor(Math.random() * 9000));
  const cv = document.createElement('canvas');
  cv.width = 320;
  cv.height = 160;
  const g = cv.getContext('2d');
  g.fillStyle = '#fff';
  g.fillRect(0, 0, 320, 160);
  g.fillStyle = '#000';
  g.font = 'bold 96px sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(n, 160, 84);
  const blob = await new Promise((res) => cv.toBlob(res, 'image/jpeg', 0.9));
  const r = await callModel(cfg, { system: 'You read numbers from images.', text: 'Reply with only the number shown in the image.', blobs: [blob], maxTokens: 300 });
  return { ok: r.text.replace(/\D/g, '').includes(n), usage: r.usage };
}

// Fetches the model list from an OpenAI-compatible endpoint; returns [] on any failure.
export async function listModels(cfg) {
  try {
    const res = await fetch(cfg.base.replace(/\/+$/, '') + '/models', { headers: { authorization: `Bearer ${cfg.key}` } });
    if (!res.ok) return [];
    const j = await res.json();
    return (j.data || []).map((m) => m.id).filter(Boolean);
  } catch {
    return [];
  }
}

export function costUSD(model, usage) {
  const m = MODELS[model];
  return m ? (usage.in * m.inp + usage.out * m.out) / 1e6 : 0;
}

// What went wrong, in words that fit anywhere. Where an entry is parked because of it, the app adds WAITING.
export const AI_ERRORS = {
  no_key: T('No API key. Add one in Settings.'),
  bad_key: T('The API key was rejected. Check it in Settings.'),
  offline: T('No internet.'),
  net: T('Could not reach the server. If you are online, this provider may not allow calls from a browser.'),
  timeout: T('The provider took too long to answer.'),
  truncated: T('The answer was cut off before it was complete. Try again, or add a short note.'),
  rate: T('Too many requests or the quota is used up.'),
  no_quota: T('This model has no quota on your plan. Pick another model in Settings.'),
  no_credit: T('The provider says the account has no credit. Add credit or pick another provider in Settings.'),
  needs_billing: T('The provider wants billing enabled on this account before it answers. Enable it with the provider or pick another one in Settings.'),
  no_vision: T('This model does not accept photos. Pick a model with image support in Settings.'),
  bad_model: T('Model not found. Check the model name in Settings.'),
  server: T('The provider is busy right now.'),
  bad_request: T('The request was rejected.'),
  empty: T('The model could not interpret this input. Add a short note and try again.'),
  http: T('The request failed.'),
};
// A few words for each, for a list of results (the first sentence of the message, in lower case)
export const AI_ERROR_LABEL = {
  no_key: T('no api key'),
  bad_key: T('the api key was rejected'),
  offline: T('no internet'),
  net: T('could not reach the server'),
  timeout: T('the provider took too long to answer'),
  truncated: T('the answer was cut off before it was complete'),
  rate: T('too many requests or the quota is used up'),
  no_quota: T('this model has no quota on your plan'),
  no_credit: T('the provider says the account has no credit'),
  needs_billing: T('the provider wants billing enabled on this account before it answers'),
  no_vision: T('this model does not accept photos'),
  bad_model: T('model not found'),
  server: T('the provider is busy right now'),
  bad_request: T('the request was rejected'),
  empty: T('the model could not interpret this input'),
  http: T('the request failed'),
};
export const WAITING = T(' The entry is waiting; tap “Analyse” to try again.');
