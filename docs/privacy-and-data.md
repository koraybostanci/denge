# Privacy and data

- Entries, photos and settings are stored in the browser's IndexedDB on your device. Nothing is
  sent to a server of this project, because there is none.
- Photo and free-text analysis goes straight from your phone to the model provider you choose,
  with your own API key. That is the one place your data leaves the device: the photos and text you
  send, with the time of the entry. The provider and your static host also see your IP address.
  Logged photos are downscaled to 768 px before they are sent.
- Photos are never stored as taken. Logged photos are kept as a 768 px copy, plan pictures as a
  640 px framed and colour-corrected one. Both are re-encoded, so the stored file carries no
  location, capture time or camera details. The capture time is read once, to time the entry.
- The day's review and the quick note on Today send text only: that day's meals with their numbers, steps, water, weigh-in,
  your goals, the weight schedule and where you stand against it. No photos. These requests, and the
  check, also carry the meals and foods of the plan in use (names, amounts, calories), so anything you
  typed into My plan is sent too. The Pantry's products travel the same way, as one line each: the
  name and the values per 100 g, and on a check also up to 60 characters of the ingredients text.
  Photos are never sent.
- The progress review on Progress, sent only when you tap it, is text only too: a summary of the whole
  log since the start (meals as numbers, weigh-ins, steps, water, coffee, workout days, day verdicts,
  flex used), your goals and where you stand against the schedule. Supplements go as counts taken, never
  their names. No photos, and none of the model's earlier reviews. It is larger than a day's review but
  kept to about 3,500 characters; the goal line and a few closing lines stay whole even past that.
- Your age and gender, if you entered them (Settings → Profile, or at setup), are sent in the progress review only, as one line
  of context for a realistic pace and protein (only "female" or "male" is sent as a word; other choices send nothing). Your name is
  never sent: it stays on the device and is used for the greeting on Today. Neither goes into any other request.
- The app creates an install id on first start, with the browser's random generator (Web Crypto), if it has one; with none, the install has no id. It stays on this device, is mirrored in the browser's local storage on this device, and is not in a backup file or the SQL export or sent in any request. A factory reset keeps it. It changes only when the browser clears this site's data (for example clearing website data in the browser settings) or when the app is installed on another device. There is no control in the app to change it.
- Photos taken for a check are sent at up to 1536 px, so small print stays readable, together with
  where your day stands. They are not stored; the last 30 verdicts are, as text.
- A photo chosen to fill in a food's values is shrunk to 1280 px, held in memory only, and sent with
  the name and no other data, and only when you tap "Fill in with AI". It is never stored. The fill
  replaces the values it reads (Undo brings yours back), and its numbers are estimates. The
  ingredients text the fill can read is stored with the product, as text. Products no longer take a
  picture of their own; a picture stored before that is kept until you remove it.
- The API key is stored on the device only, unencrypted like the rest of the app's data, and is
  never written to a backup file.
- Photo location is off by default. When on, it is read on the device and matched to places you
  saved; the model only receives a generic label, "home", "office", "out" or "a saved place", never the
  name you gave the place, and never coordinates.
- Free text you type (a note, a meal or food name, an ingredient name) is filtered before it is sent:
  e-mail addresses, web links, phone numbers (7 or more digits, but not dates, time ranges or lists of single digits) and street addresses are replaced with
  "[redacted]". Nothing else is filtered, so other details in your text go as you wrote them. Photo
  pixels are not redacted: a face, a document or a screen in a photo goes to the model as it is.
- Exact dates, your start and target weights, and your weigh-ins are sent in the day's review, the quick
  note and the progress review.
- Badges are worked out on the device from your log and stored with it, in the same IndexedDB. The record holds, per badge, the
  steps you have earned and the day you earned each, the highest step you have looked at, whether the history on the device has
  been taken in, the parts of your pickle you wear, and your start and goal weights as they were when you first logged something (the weight badges are measured from them, so a later
  change of goals does not move them). Nothing about badges is sent anywhere, and the model never sees them.
- There is no sync. Back up from Settings → "Backup and export"; the backup is a JSON file you can
  restore on the same or another device. It holds your entries, goals, favourites, My plan (the
  Default plan comes with the app and is not in the file), the plan's pictures, the verdicts of your checks, the progress review, the badges you have earned (and which of them you have already looked at), the parts of your pickle avatar you chose to wear, and your saved places with their coordinates. It also holds your Pantry products with their values (name, per-100 g values, and the ingredients text where one is stored, and when each was last used) and their pictures. Photos of
  logged meals are included only when you choose "With photos". Restoring adds the backup's
  entries, days, checks, badges, plan pictures and Pantry products to what is on the device (an entry or day that is in
  both takes the backup's version; a Pantry product that is in both takes the backup's values); its goals, favourites, saved places and My plan replace yours (a backup with no My plan removes yours; a backup from before plans could be changed leaves yours alone). Your name, age and gender are part of the backup, but the install id of this device stays and the backup brings none. The avatar you wear on this device stays (a device with no badge record yet takes the backup's); a worn part is only ever one that the badges on the device have earned. The
  provider, address, model and key stay as they are.
- Settings → "Reset" has two levels. "Clear my log" deletes what you tracked (meals and their photos,
  weigh-ins, steps, water, coffee, supplements taken, workout days, day reviews, the progress review, checks) and keeps every setting (goals and profile included), your plans, the plan's
  pictures, your Pantry products with their photos, your API key and the badges you have earned. "Factory reset" empties the app as it was on its first launch and returns to the setup screen. It deletes the
  goals, name, age and gender, favourites, saved places, My plan, the plan's pictures, your Pantry products with their photos, the badges and the usage totals; the API key and provider
  stay unless you untick the box. The language and the install id stay too. It asks you to type DELETE. Both refuse while something is being
  analysed. Neither can be undone, so save a backup first.

## Export to SQLite

Settings → "Backup and export" → "Export for SQLite" saves one `.sql` file. It is plain text that
creates the tables and fills them, so any SQLite tool can load it:

```sh
sqlite3 -bail pickle.db < pickle-export-2026-10-12.sql
```

`-bail` stops at the first error, so a failed load is rolled back. Loading a newer export into the
same database replaces the `weightplan_*` tables and the view, with anything you added to them, and
leaves everything else in that database alone.

| Table or view | One row per | Columns |
|---|---|---|
| `weightplan_badges` | earned badge step | `id`, `threshold`, `day` (the day it was earned) |
| `weightplan_supplements` | id | `id`, `name`, `dose` |
| `weightplan_supplement_log` | day, supplement_id | `day`, `supplement_id` (one row per supplement ticked that day) |
| `weightplan_days` | day | `day`, `weight_kg`, `steps`, `water_ml`, `coffee_cups`, `workout`, `target_kcal`, `target_weight_kg` |
| `weightplan_meals` | logged meal | `id`, `day`, `logged_at`, `slot`, `title`, `source`, `plan_id`, `tier`, `status`, `portion`, `kcal`, `protein_g`, `carbs_g`, `fat_g`, `fibre_g`, `confidence`, `place`, `note`, `photos`, `flags` |
| `weightplan_meal_items` | ingredient of a meal | `meal_id`, `position`, `name`, `grams`, `kcal`, `protein_g`, `carbs_g`, `fat_g`, `fibre_g` |
| `weightplan_settings` | setting | `key`, `value` (dates, weights, daily goals, and the export's own version and time) |
| `weightplan_daily` (view) | day | the day's values, the 7-day weight average, and the meal totals with the day's `beers` |

Calories, macros and grams are already multiplied by the portion. Only meals with `status = 'ok'`
have numbers. The per-item macro columns (`carbs_g`, `fat_g`, `fibre_g` in `weightplan_meal_items`)
lose the app's difference between "estimated as 0" and "never estimated", which the app shows as
`–`: where nothing was stored for an item, the export writes 0. `target_kcal` and `target_weight_kg`
are worked out from your current Goals, so
changing them changes past rows. Photos, API keys and the coordinates of saved places are not
exported.

```sql
-- weight against the schedule
SELECT day, weight_kg, weight_avg7_kg, target_weight_kg FROM weightplan_daily ORDER BY day;

-- days over the calorie budget
SELECT day, kcal, target_kcal FROM weightplan_daily WHERE kcal > target_kcal;

-- what was off plan, and how much it cost
SELECT day, title, kcal FROM weightplan_meals WHERE tier = 'off' AND status = 'ok' ORDER BY kcal DESC;

-- beers and coffees per week
SELECT date(day, 'weekday 0', '-6 days') AS week, SUM(beers) AS beers, SUM(COALESCE(coffee_cups, 0)) AS coffees FROM weightplan_daily GROUP BY week ORDER BY week;
```

The export is for analysis. To move or restore the app's data, use the JSON backup.

