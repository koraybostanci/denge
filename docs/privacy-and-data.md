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
  your goals, the weight schedule and where you stand against it. No photos.
- Photos taken for a check are sent at up to 1536 px, so small print stays readable, together with
  where your day stands. They are not stored; the last 30 verdicts are, as text.
- The API key is stored on the device only, unencrypted like the rest of the app's data, and is
  never written to a backup file.
- Photo location is off by default. When on, it is read on the device and matched to places you
  saved; the model only receives a label such as "Home" or "out", never coordinates.
- Badges are worked out on the device from your log and stored with it, in the same IndexedDB. The record holds, per badge, the
  steps you have earned and the day you earned each, the highest step you have looked at, whether the history on the device has
  been taken in, the parts of your pickle you wear, and your start and goal weights as they were when you first logged something (the weight badges are measured from them, so a later
  change of goals does not move them). Nothing about badges is sent anywhere, and the model never sees them.
- There is no sync. Back up from Settings → "Backup and export"; the backup is a JSON file you can
  restore on the same or another device. It holds your entries, goals, favourites, the plan's
  pictures, the verdicts of your checks, the badges you have earned (and which of them you have already looked at), the parts of your pickle avatar you chose to wear, and your saved places with their coordinates. Photos of
  logged meals are included only when you choose "With photos". Restoring adds the backup's
  entries, days, checks, badges and plan pictures to what is on the device (an entry or day that is in
  both takes the backup's version); its goals, favourites and saved places replace yours. The avatar you wear on this device stays (a device with no badge record yet takes the backup's); a worn part is only ever one that the badges on the device have earned. The
  provider, address, model and key stay as they are.
- Settings → "Reset" has two levels. "Clear my log" deletes what you tracked (meals and their photos,
  weigh-ins, steps, water, coffee, supplements taken, workout days, day reviews, checks) and keeps every setting, the plan's
  pictures, your API key and the badges you have earned. "Factory reset" empties the app as it was on its first launch, including
  goals, favourites, saved places, the plan's pictures, the badges and the usage totals; the API key and provider
  stay unless you untick the box. It asks you to type DELETE. Both refuse while something is being
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
| `weightplan_meal_items` | ingredient of a meal | `meal_id`, `position`, `name`, `grams`, `kcal`, `protein_g` |
| `weightplan_settings` | setting | `key`, `value` (dates, weights, daily goals, and the export's own version and time) |
| `weightplan_daily` (view) | day | the day's values, the 7-day weight average, and the meal totals with the day's `beers` |

Calories, macros and grams are already multiplied by the portion. Only meals with `status = 'ok'`
have numbers. `target_kcal` and `target_weight_kg` are worked out from your current Goals, so
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

