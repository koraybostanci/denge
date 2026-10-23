// Text on its way out of the device, and the squeeze every outside text passes. Pure: no DOM, no network, no model module, so the briefs
// and the tests import it on their own.

// Text that came from outside (the pantry's records, a model reply): the squeeze of cleanFood in js/backup.js and
// cleanIng in js/app.js, mirrored here — one plain line, no control characters, so no text can forge a line's shape
export const sq = (v) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ').replace(/\s+/g, ' ').trim() : '');

// Free text the person wrote (a note, a title, a food or ingredient name) leaves the device only after sanitizeOut: an e-mail, a link,
// a phone number or a street address is redacted, so contact details and saved places never reach the model. Conservative on purpose:
// "200 g rice", "2 x 150 g", "1200-1500 kcal", "2026-10-24" and "2 Dr Pepper" come out unchanged, and the output has no digits left for a
// second pass to match, so it is idempotent.
const REDACTED = '[redacted]';
// Street types, longest first so 'sokağı' is not cut to 'sokak' with its ending left behind; each in lower and capital case
const STREET_WORDS = ['street', 'avenue', 'road', 'lane', 'drive', 'boulevard', 'caddesi', 'sokağı', 'sokak', 'sokagi', 'sok', 'sk', 'cd', 'mahallesi', 'mah'];
const STREET = [...STREET_WORDS].sort((a, b) => b.length - a.length).flatMap((w) => [w, w[0].toUpperCase() + w.slice(1)]).join('|');
// A house number, then up to two words and a street type: "12 Elm Street", "45 Bağdat sokağı"
const STREET_NUMBER = new RegExp(`\\b\\d{1,5}\\s+(?:[\\p{L}'.]+\\s+){0,2}(?:${STREET})(?!\\p{L})\\.?`, 'gu');
// A name, then a street type and the number: "Işıklar Sokak 12", "Atatürk Caddesi No:12"
const NAME_NUMBER = new RegExp(`\\p{Lu}[\\p{L}'-]*(?:\\s+\\p{Lu}[\\p{L}'-]*)?\\s+(?:${STREET})(?!\\p{L})\\.?\\s*(?:[Nn]o\\.?:?\\s*)?\\d{1,5}(?!\\d)`, 'gu');
// 7 or more digits make a phone number, except a date (2026-10-24), a range (1200-1500) and a list of single digits (1 2 3 4 5 6 7)
const PHONE = /\+?\d[\d\s().-]*\d/g;
const phone = (m) => {
  const t = m.trim();
  if (m.replace(/\D/g, '').length < 7) return m;
  if (/\d{4}[-./]\d{1,2}[-./]\d{1,2}/.test(t)) return m; // a date, with or without a time after it
  if (!t.startsWith('+') && /^\d+\s*[-–]\s*\d+$/.test(t) && m.replace(/\D/g, '').length < 10) return m;
  if (!t.startsWith('+') && t.split(/[\s().-]+/).every((g) => g.length === 1)) return m;
  return REDACTED;
};
const RULES = [
  [/[\p{L}\p{N}_.+-]+@[\p{L}\p{N}-]+(?:\.[\p{L}\p{N}-]+)+/gu, REDACTED],
  [/\b(?:https?:\/\/|www\.)\S+/gi, REDACTED],
  [/(?<![\p{L}\p{N}-])[\p{L}\p{N}-]+\.(?:com|net|org|io|tr|uk|co)(?![\p{L}\p{N}])(?:\/\S*)?/giu, REDACTED],
  [STREET_NUMBER, REDACTED],
  [NAME_NUMBER, REDACTED],
  [PHONE, phone],
];
export const sanitizeOut = (v) => RULES.reduce((s, [re, rep]) => s.replace(re, rep), sq(v));

// A saved place is named by the person: only the two words the app suggests (Home, Office) and "out" go to the model as they are
export const placeWord = (p) => {
  const w = sq(p).toLowerCase();
  return p === 'out' ? 'out' : w === 'home' || w === 'office' ? w : 'a saved place';
};
