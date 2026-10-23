# Make it your plan

The repository ships with one example plan: about 1,550 kcal on rest days and 1,750 kcal on
workout days, 135 g of protein, lunch at 12:00, two snacks, dinner at 18:00.

- **Goals** (dates, weights, calories, protein) are changed in the app under Settings → Goals.
  Daily calories below the minimum (`KCAL_MIN_DAY`, 1,500 by default, set there as Minimum kcal) are refused, and a
  day under it does not count as on plan. The goals for
  steps, water and fibre come from `DEFAULTS` in `js/plan.js`. Calories, weights, dates and protein are
  not preset: they are entered on the setup screen at first start, which also asks you to start with a blank
  My plan ("Start blank") or with the Default plan ("Use the default plan").
  When you change a goal, the pace is judged from your latest weigh-in (or the start weight before the
  first one) to the goal by the goal date, from today, not from the plan's start. Needing more than 2 kg
  a week is refused; that limit (`MAX_LOSS_PER_WEEK` in `js/onboarding.js`) is a product choice, not
  medical advice, and may be revisited with real use. Pickle is weight-loss only: setup requires the goal
  weight below your current weight and Settings requires it below the start weight; maintenance and gain
  goals are not supported.
- **Meals** are changed in the app, on the Plan tab. The plan that comes with the app is called
  Default and is read-only. Tap a meal and then Edit meal, or + Add meal on a slot. The first save
  ("Save to My plan") creates My plan with that change and makes it the active plan; Cancel creates
  nothing. A meal has a name and ingredients (grams, and an optional measure such as "1 slice").
  A new food is added through a form with five values per 100 g: kcal, protein, carbs, fat and
  fibre. With an API key, the model can fill them in from a photo (a nutrition label, the package
  or the food) or a typed name; the photo is not stored. Calories and macros are computed from the
  food values, never typed by hand.
- Once My plan exists, a Default | My plan switch appears on the Plan tab. Default stays read-only.
  Delete My plan goes back to Default. Your log is kept; pictures of meals you added are deleted.
  There is one own plan for now.
- Today, the pace line, typed entries, photo matching and the model's prompts all use the active
  plan. A logged entry keeps its own title and numbers, so changing a meal later does not change
  your log.
- **The Default plan** for a fork lives in `js/default-plan.js`: the food table (per 100 g, as
  `[kcal, protein, carbs, fat, fibre]`) and the meal templates. Each meal has an id, a slot, a name
  and a list of `[food, grams, measure]`; the measure is optional. Meal ids stay stable, because
  pictures and logged entries refer to them. A retired meal id is never reused. The app rewrites
  the stored Default from this file when it changes. My plan is a copy and does not follow later
  changes to Default.
- **Rules and slots** live in `js/plan.js`:
  - `SLOTS`: the meals of the day and their times.
  - `FLEX`: one-tap weekly extras (a beer, a small dessert) that count against the weekly allowance.
  - `RULES`: the text shown on the Plan tab.
  - `DEFAULTS`: the numbers the text in `RULES` is worked out from, and the steps, water and fibre goals. A new install does not start with them: its goals are entered at first start.

  The numbers in `RULES` come from `DEFAULTS` and `SMALL_TREAT_KCAL`, not from what you saved in
  Settings → Goals, so keep them in step. The meal slots are also named in `SLOT_NAME`,
  `slotByTime`, the prompt in `js/ai.js` and the notes on the Plan tab in `js/views.js`, so
  changing the slots means editing those too.

The app uses kilograms, kilocalories and millilitres. Its language is English or Turkish, chosen in
Settings → Language (first on the list); English is the default and nothing is guessed from the phone.
Number and date formats follow the language (`en-GB` or `tr-TR`).

