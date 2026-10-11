# Make it your plan

The repository ships with one example plan: about 1,550 kcal on rest days and 1,750 kcal on
workout days, 135 g of protein, lunch at 12:00, two snacks, dinner at 18:00.

- **Goals** (dates, weights, calories, protein) are changed in the app under Settings → Goals.
  Daily calories below the minimum (`KCAL_MIN_DAY`, 1,500 by default, set there as Minimum kcal) are refused, and a
  day under it does not count as on plan. The goals for
  steps, water and fibre come from `DEFAULTS` in `js/plan.js` and apply only before the app is first
  opened on a device.
- **Meals and rules** live in `js/plan.js`:
  - `FOODS`: nutrition per 100 g, as `[kcal, protein, carbs, fat, fibre]`.
  - `TEMPLATES`: the meal options. Each has an id, a slot and a list of `[food, grams, measure]`.
    Calories and macros are computed from the food table, never typed by hand.
  - `SLOTS`: the meals of the day and their times.
  - `FLEX`: one-tap weekly extras (a beer, a small dessert) that count against the weekly allowance.
  - `RULES`: the text shown on the Plan tab.
  - `DEFAULTS`: goals used before anything is saved in Settings.

  The model receives a short digest of the plan with every request, so it follows your changes
  to meals and foods without further setup. Two things are not generated from the file: the numbers
  in `RULES` come from `DEFAULTS` and `SMALL_TREAT_KCAL`, not from what you saved in
  Settings → Goals, so keep them in step; and the meal slots are also named in `SLOT_NAME`,
  `slotByTime`, the prompt in `js/ai.js` and the notes on the Plan tab in `js/views.js`, so
  changing the slots means editing those too.

The app uses kilograms, kilocalories and millilitres. Its language is English or Turkish, chosen in
Settings → Language (first on the list); English is the default and nothing is guessed from the phone.
Number and date formats follow the language (`en-GB` or `tr-TR`).

