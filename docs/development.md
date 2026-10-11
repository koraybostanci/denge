# Development

There is no build step and there are no dependencies: plain HTML, CSS and JavaScript modules.

```sh
python3 -m http.server 8770
# then open http://localhost:8770/
```

The service worker serves the app from a versioned cache, so after the first load your edits do
not show up until you either bump the version (see below), use Settings → "Version and updates" →
"Clear cache and reload", or bypass the service worker in the browser's developer tools.

Tests need Node 22 or later and no dependencies:

```sh
node --test
```

They cover the calculations (`js/core.js`), the checks on backup files (`js/backup.js`), the model
layer against a mocked `fetch` (`js/ai.js`) and the SQL export, which is loaded into Node's built-in
SQLite and queried as in the section above. The IndexedDB code is not covered. The screens are
rendered in Node from a fixed state (`test/screens.mjs`) for the English snapshot
(`test/fixtures/en-snapshot.json`, regenerate it with `UPDATE_SNAPSHOT=1 node --test` after an
intended English change) and for the language checks.

## Languages

The interface is English or Turkish. The English text is written inline in the code and is its own
key; `js/tr.js` maps it to the Turkish. English costs nothing at runtime: `js/tr.js` is loaded
when Turkish is chosen, and cached by the service worker so the first switch works offline. A string
without a Turkish entry shows in English.

To add or change a string:

1. Write it in English through `t('Saved {name}', { name })` (`js/i18n.js`). Plurals use
   `tn('{n} day|{n} days', n)`, and text in a data table is marked with `T('Lunch')` and translated
   where it is shown with `td()`. The first argument must be a plain string literal, never built from parts.
2. Add the Turkish to `js/tr.js` under the same English text. Text in `index.html` uses the
   `data-t` attributes. Where one English text means two things, or a long sentence changes
   often, give it an id with `t('Open', { $id: 'menu.open' })` and key `tr.js` by that id.
3. Run `node --test`. It finds every string in `js/*.js` and `index.html` and fails on a missing or
   orphaned entry, on different `{placeholders}` or HTML tags, on an English text left as the Turkish, and on a screen
   that still shows unmarked English when rendered in Turkish.

Rules for the Turkish: write the whole sentence, never attach a suffix to a `{placeholder}` (write
"Food: {food}", not "{food}'s"), and give `tn` one string, since Turkish has no plural form after a
number. A function as a value is the last resort and needs a comment.

What the language does not touch: the AI prompts and the briefs built for the model stay English
(`js/briefs.js` builds them in English whatever the language is; Turkish only adds one line asking for
Turkish replies), and so do the SQL export, the CSV headers and the backup file. Text the model wrote
and what you typed are shown as written. The typed-entry parser understands the Turkish words
(`js/parse-tr.js`: the Turkish words for steps, water and so on) in either language. New titles of generated entries keep the English
`title` and add a `tk` that is shown in the chosen language. The language survives "Clear my log" and a factory reset.

On `localhost` the app exposes `window.__app` for debugging.

The app's internal id is `weightplan` (`APP_ID` in `js/core.js`). It names the IndexedDB database, the
caches, the backup files' marker and the SQL tables, and stays the same when the app is renamed, so a
new name never touches the data.

## Releasing an update

Bump `VERSION` in `sw.js` (for version 41, `'weightplan-v41'`) and `APP_VERSION` in `js/core.js` (`'41'`) together, then
deploy. List a file you add in `SHELL` in `sw.js` so the first launch works offline; a listed file
that does not exist makes the install fail. Installed
copies find the new version when the app opens or comes to the front, and reload on their own, or,
if something is half-typed or being analysed, show a Reload button. Stored data is kept. The running
version is shown under Settings → "Version and updates".

## Project layout

- `index.html`, `styles.css`, `manifest.webmanifest`: shell, styles and web app manifest
- `js/core.js`: state and the calculations on it (budget, verdicts, weight, streaks). It has no
  DOM and no storage, so it loads in Node and can be tested there
- `js/app.js`: storage, event handling, the analysis queue, backup and restore
- `js/views.js`: the screens
- `js/plan.js`: food table, meal templates, goals, rules
- `js/ai.js`: model calls (Claude and OpenAI-compatible), prompt and output schema
- `js/badges.js`: the badge catalog and which badges the log has earned (no DOM, no storage). A weigh-in that is more than a kilo a day away from the last sane one (the first: from the start weight, with 3 kg of slack; never more than 15 kg) counts as a typo and moves no badge. `app.js` stores the result in kv `badges` (`{v:1, got, seen, told, av, base}`: `seen` is the highest step looked at per badge, which drives the New dot; `told` is set once the history on the device has been taken in, with its one "from your history" line; both are optional, so older records stay valid). The unlock toast comes after the first evaluation that follows a change (a save, or the clock or tab changing); the first evaluation after loading, a restore and the first run with a log are quiet. The "from your history" line is dropped if the person leaves Progress, or closes the app, without opening it (`told` is already set). Every write to the record goes through one queue (`serial()`), each from the latest `S.badges`. The screens measure badges through `badgeContext()` in `views.js`, cached on `S.rev`, which every save path moves. `av` is `{stage, face, acc}`, part ids from `PARTS` (`unlocked(part, got)` gates each against what is earned; stage 1, the plain face and no accessory are free). `wornAv` is what is shown (header and picker): an unearned or unknown part is its slot's default, and `cleanBadges` applies the same rule on load and restore. The header avatar button opens the picker sheet (`renderAvatarSheet`); a choice goes through `wear()` and the same badge queue, rolled back if the write fails. `avatarSvg` in `js/badge-art.js` draws the pickle from the `--pickle*` tokens.
- `js/badge-art.js`: the badge icons (18 line icons in five shapes and four finishes) and the pickle avatar, drawn as inline SVG from the colour tokens
- `js/backup.js`: checks everything read from a backup file before it is stored
- `js/exif.js`: reads capture time and location from a photo
- `js/db.js`: IndexedDB
- `js/picture.js`: the treatment every plan picture gets (framing, white balance, exposure)
- `js/export.js`: the SQL export
- `js/i18n.js`: the language: `t`, `tn`, `T`, number and date formats, the language switch
- `js/tr.js`: the Turkish text, keyed by the English; `js/parse-tr.js`: the Turkish words the typed-entry parser accepts
- `js/briefs.js`: what is sent to the model, always in English
- `js/standalone.js`: the install screen shown in a browser tab (its two languages are inline)
- `test/`: `node --test` tests (`badges`, `badge-art`, `unlock` and `avatar` cover the badge system); `extract.mjs` finds the strings, `screens.mjs` renders the screens
- `sw.js`: offline cache and updates
- `icons/`: `icon.svg` is the source; the PNG files are rendered from it for the Home Screen and
  the web app manifest
- `fonts/`: IBM Plex Sans, IBM Plex Mono and Space Grotesk, self-hosted so the app works offline
  (latin and latin-ext, for Turkish letters), with their licences (SIL Open Font License)

