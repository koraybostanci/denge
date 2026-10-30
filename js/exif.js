// Small EXIF reader: the capture time of a JPEG.
// The photo is read here before it leaves the device; no metadata goes into the analysis request.

const TAG_EXIF_IFD = 0x8769;
const TAG_DATETIME = 0x0132;
const TAG_DATETIME_ORIGINAL = 0x9003;

function readIFD(view, tiff, off, le) {
  const out = new Map();
  if (off <= 0 || tiff + off + 2 > view.byteLength) return out;
  const n = view.getUint16(tiff + off, le);
  for (let i = 0; i < n; i++) {
    const e = tiff + off + 2 + i * 12;
    if (e + 12 > view.byteLength) break;
    out.set(view.getUint16(e, le), {
      type: view.getUint16(e + 2, le),
      count: view.getUint32(e + 4, le),
      valueOff: e + 8,
    });
  }
  return out;
}

function ascii(view, tiff, ent, le) {
  if (!ent) return '';
  const start = ent.count <= 4 ? ent.valueOff : tiff + view.getUint32(ent.valueOff, le);
  if (start + ent.count > view.byteLength) return '';
  let s = '';
  for (let i = 0; i < ent.count; i++) {
    const c = view.getUint8(start + i);
    if (c === 0) break;
    s += String.fromCharCode(c);
  }
  return s.trim();
}

function parseDate(s) {
  // "YYYY:MM:DD HH:MM:SS", read as local time
  const m = /^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})/.exec(s);
  if (!m) return null;
  const d = new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
  if (Number.isNaN(d.getTime()) || +m[1] < 2000) return null;
  return d.getTime();
}

export function parseExif(buf) {
  const view = new DataView(buf);
  if (view.byteLength < 4 || view.getUint16(0) !== 0xffd8) return {};
  let p = 2;
  while (p + 4 <= view.byteLength) {
    if (view.getUint8(p) !== 0xff) break;
    const marker = view.getUint8(p + 1);
    const size = view.getUint16(p + 2);
    if (marker === 0xe1 && p + 10 <= view.byteLength && view.getUint32(p + 4) === 0x45786966) {
      const tiff = p + 10;
      if (tiff + 8 > view.byteLength) return {};
      const le = view.getUint16(tiff) === 0x4949;
      const ifd0 = readIFD(view, tiff, view.getUint32(tiff + 4, le), le);
      const res = {};
      const exifPtr = ifd0.get(TAG_EXIF_IFD);
      let ts = null;
      if (exifPtr) {
        const ex = readIFD(view, tiff, view.getUint32(exifPtr.valueOff, le), le);
        ts = parseDate(ascii(view, tiff, ex.get(TAG_DATETIME_ORIGINAL), le));
      }
      if (!ts) ts = parseDate(ascii(view, tiff, ifd0.get(TAG_DATETIME), le));
      if (ts) res.ts = ts;
      return res;
    }
    if (marker === 0xda) break; // image data starts here
    p += 2 + size;
  }
  return {};
}

// Reads only the start of the file (EXIF sits in the first blocks).
export async function readMeta(file) {
  try {
    const buf = await file.slice(0, 262144).arrayBuffer();
    return parseExif(buf);
  } catch {
    return {};
  }
}
