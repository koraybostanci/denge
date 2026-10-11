// js/app.js needs a browser, so no test imports it. This reads its import lines instead: every imported name must exist,
// and a name from the pure modules that app.js uses without importing or declaring it is caught here, not by a user.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';

const root = new URL('../js/', import.meta.url);
const src = readFileSync(new URL('app.js', root), 'utf8');

// import { a, b as c } from './x.js'; import * as d from './x.js'; import e from './x.js'
const IMPORT = /^import\s+([^;]*?)\s+from\s+'(\.\/[\w.-]+)';?[ \t]*$/gms;
const imports = [];
for (const m of src.matchAll(IMPORT)) {
  const clause = m[1];
  const names = [];
  let ns = false;
  let def = false;
  const braces = clause.match(/\{([^}]*)\}/);
  if (braces) for (const part of braces[1].split(',')) { const n = part.trim().split(/\s+as\s+/)[0]; if (n) names.push({ name: n, local: part.trim().split(/\s+as\s+/).pop() }); }
  if (/\*\s+as\s+\w+/.test(clause)) ns = true;
  if (/^\w+\s*(,|$)/.test(clause)) def = true;
  imports.push({ file: m[2], names, ns, def, text: m[0] });
}

test('app.js has import statements to check', () => {
  assert.ok(imports.length >= 8);
});

for (const imp of imports) {
  test(`app.js imports only names that ${imp.file} exports`, async () => {
    assert.ok(existsSync(new URL(imp.file, root)), `${imp.file} does not exist`);
    const mod = await import(new URL(imp.file, root).href);
    for (const { name } of imp.names) assert.ok(name in mod, `${imp.file} does not export ${name}`);
    if (imp.def) assert.ok('default' in mod, `${imp.file} has no default export`);
  });
}

// What app.js has outside its import lines, without comments and string literals (template parts stay: they hold code)
const body = src
  .replace(IMPORT, '')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1')
  .replace(/'(?:[^'\\\n]|\\.)*'/g, "''")
  .replace(/"(?:[^"\\\n]|\\.)*"/g, '""');
const importedLocals = new Set(imports.flatMap((i) => i.names.map((n) => n.local)));
const declared = (name) => new RegExp(`\\b(?:const|let|var|function\\*?|class)\\s+${name}\\b|[{,]\\s*${name}\\s*[,}]\\s*=|\\b(?:const|let|var)\\s*[{\\[][^=;]*\\b${name}\\b[^=;]*[}\\]]\\s*=`).test(body)
  || new RegExp(`\\(([^()]*,\\s*)?${name}(\\s*=[^,()]*)?(\\s*,[^()]*)?\\)\\s*=>|\\b${name}\\s*=>`).test(body);
// A use is the bare word: not a property (".name", "name:" in an object literal, "?.name")
const used = (name) => new RegExp(`(?<![\\w$.])${name}(?![\\w$])(?!\\s*:(?!:))`).test(body);

for (const file of ['plan.js', 'plans.js', 'backup.js', 'core.js', 'views.js']) {
  test(`every name of ${file} that app.js uses is imported or declared there`, async () => {
    const mod = await import(new URL(file, root).href);
    const missing = Object.keys(mod).filter((n) => n !== 'default' && /^[A-Za-z_$][\w$]*$/.test(n) && !importedLocals.has(n) && used(n) && !declared(n));
    assert.deepEqual(missing, [], `app.js uses ${missing.join(', ')} from ${file} without importing it`);
  });
}
