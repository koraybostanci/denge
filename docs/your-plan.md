# Make it your plan

The repository ships with one example plan: about 1,550 kcal on rest days and 1,750 kcal on
workout days, 135 g of protein, lunch at 12:00, two snacks, dinner at 18:00.

- **Goals** (dates, weights, calories, protein) are changed in the app under Settings → Goals.
  Daily calories below the minimum (`KCAL_MIN_DAY`, 1,500 by default, set there as Minimum kcal) are refused, and a
  day under it does not count as on plan. The goals for
  steps, water and fibre come from `DEFAULTS` in `js/plan.js` and apply only before the app is first
  opened on a device.
- **Meals and foods** can be changed in the app, on the Plan tab:
  - **Plans**: the Plans button opens a sheet where you make a new plan from the one in use, switch between plans, rename them
    and delete them. You can keep up to 10 plans of your own.
  - **Default plan**: the plan that ships with the app is read-only, so it stays a fixed reference and you can always switch back to it.
    Editing a meal or a food while it is active copies it first (copy-on-edit). With no plan of your own yet, a copy named "My plan"
    is made and switched to. With plans of your own, you choose "Edit in <plan name>" or "New copy".
  - **Meals**: "Add meal" in any group, or tap a meal to edit it: name, slot, ingredients in grams, and an optional household
    measure. A plan holds up to 60 meals, a meal up to 12 ingredients, and an ingredient up to 5,000 g.
  - **Foods**: the Foods button edits the food table of the plan, per 100 g: kcal, protein, carbs, fat and fibre. A plan holds up
    to 200 foods. A food that a meal uses cannot be deleted.
  - Calories and macros are always computed from the food table. History is not touched: a logged entry keeps its own numbers,
    and after a meal is renamed, past entries keep the name they were logged under. Only the suggestions, the meals offered on Today
    and the digest sent to the model follow the plan in use.
  - Goals and the rules stay the same in every plan. On your own plans the dinner rotation table and the notes on each slot
    (for the example plan) are hidden.
- **The example plan and the rules** live in `js/plan.js`:
  - `DEFAULT_FOODS`: nutrition per 100 g, as `[kcal, protein, carbs, fat, fibre]`.
  - `DEFAULT_TEMPLATES`: the meal options. Each has an id, a slot and a list of `[food, grams, measure]`.
    Calories and macros are computed from the food table, never typed by hand.
  - `SLOTS`: the meals of the day and their times.
  - `FLEX`: one-tap weekly extras (a beer, a small dessert) that count against the weekly allowance.
  - `RULES`: the text shown on the Plan tab.
  - `DEFAULTS`: goals used before anything is saved in Settings.

  The model receives a short digest of the plan in use with every request, so it follows your changes
  to meals and foods without further setup. Two things are not generated from the file: the numbers
  in `RULES` come from `DEFAULTS` and `SMALL_TREAT_KCAL`, not from what you saved in
  Settings → Goals, so keep them in step; and the meal slots are also named in `SLOT_NAME`,
  `slotByTime`, the prompt in `js/ai.js` and the notes on the Plan tab in `js/views.js`, so
  changing the slots means editing those too.

The app uses kilograms, kilocalories and millilitres. Its language is English or Turkish, chosen in
Settings → Language (first on the list); English is the default and nothing is guessed from the phone.
Number and date formats follow the language (`en-GB` or `tr-TR`).

