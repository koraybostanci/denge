# Photo and text analysis

Optional. In Settings → "Photo and text analysis", choose a provider and enter your key:

- **OpenAI-compatible endpoints:** presets for Google Gemini (has a free tier), OpenCode (Zen and
  Go) and OpenRouter, or any `https://` base address and model you type in. "Save and test" checks
  both text and photo input; "find a model that reads photos" tries the provider's models one by one.
- **Claude:** an Anthropic API key from https://platform.claude.com, which needs prepaid credit.
  Haiku 4.5 is the default; Sonnet 5.5 can be chosen in Settings and is used by "Analyse again with
  Sonnet". Settings shows the calls made and, for Claude, their estimated cost.

If the provider is busy, the app retries twice and, where a preset lists other models (only Gemini
does), tries those. A request that takes longer than a minute is given up on. If it still fails,
the entry waits and is analysed later: when you open the app, when the connection comes back, or
when you tap Analyse. After a failure that every request would share (no quota, a wrong key, no
connection) the waiting entries pause instead of each sending a request. Nothing you sent is lost.
A failed new estimate never replaces an earlier one.

The last finished day (looked for up to three days back) is reviewed by itself when you open the
app or come back to it, if enough is logged: one short text request a day. Any other day, including
today so far, is reviewed when you ask for it in the Log. The automatic review can be switched off
in the same Settings section; the verdict from the numbers needs no model and is always shown.

On Today, once a meal is logged, "How am I doing so far?" under the coach line asks for a quick,
supportive note: how the day is going and what is left of the budget, protein and fibre. It is sent
only when you ask, as one short text request (the same text as the day's review, plus what is left).

On Progress, once the plan is a week old, a collapsed card at the bottom, "How has it gone so far?",
reviews the whole plan against your goal. It is sent only when you tap "Review it" (or "update?" once
the log has changed or the review is two weeks old); nothing runs by itself, and while the review is
up to date there is no button. It is one text request: a summary of the whole log, written by the app
as plain lines. It holds the goals and where you stand against the weight schedule, meals as numbers
(calories against budget, protein, flex used, off-plan entries), weigh-ins, steps, water, coffee,
workout days, how many supplements were taken (counts, never their names) and the day verdicts. It
carries no photos and none of the model's earlier reviews. The summary is kept to about 3,500 characters
(the goal and closing lines stay whole even past that); when
there are more weigh-ins than fit, the oldest are thinned into weekly averages. If nothing is logged
yet, a toast says so and nothing is sent. The reply is a rating in words (great, on track, a bit
behind, stuck, or too early), what helped, what to change, and sometimes an adjustment the app itself
worked out. It never changes your settings. It costs about 1,900 tokens in and at most 500 out (up to
1,500 on providers that are billed with room for thinking). The
card stays collapsed, showing only the title and rating, until tapped. The review is stored on the device (kv
`progressReview`) and is included in the backup, but not in the SQL export.

Each of these requests also carries the plan's meals, as a short digest of the plan in use (meal
names, foods with amounts, calories). The requests are longer than they were and cost a little more.
With a large My plan they grow with its size. The Default plan roughly doubles the review prompt (the
largest review measured about 1,640 characters before and 3,000 after).

The Pantry (Settings → "Pantry") feeds the analysis and the check too. Each of these
requests carries your products as short lines, one per stored product: `id: name, X kcal Xp Xc
Xf Xfib per 100 g`, and on a check line also `; ingredients: …`, a snippet of at most 60
characters of the product's stored ingredients text. The most recently used products come first
(newest first; never-used ones keep their stored order). At most 24 products travel and the whole
digest stays under about 2,000 characters, whole lines kept; a product your note names travels
whatever the caps. The lines are part of the SYSTEM text of both requests; with an empty Pantry, that
SYSTEM text stays byte-identical to what it ever was — the analysis reply's schema (and its worded shape
on schema-less providers) still declares the optional per-item `pantry` key on every request, so the
reply contract alone gains a few tokens, whether or not any products are stored. Only this text
travels — the Pantry's photos never do.

When the model marks an estimate's item as one of these products, it sets the item's `pantry` to
the line's id and the app applies the product's stored values: its per-100 g values at the grams
the model estimated, through the usual caps, and the item is named as the product is named in the
digest. An id that matches no stored product, or grams of 0, is silently ignored and the model's
own numbers stand. The id is transient: nothing of it is stored with the entry.

On a check's result, if one of the options names a product you have stored, a quiet line under
the verdict, "From your pantry: …", names them. The app derives the line from the stored verdict
at render time, and it never says which numbers were used (a label on the photo outranks the
stored values).

The food form (a product's fill from a photo or a name) can also read its ingredients: a
product may then carry an ingredients text of at most 400 characters. It is optional and is
stored with the product; on check requests its first 60 characters are the digest's snippet.

Cost: a digest line runs about 20 tokens, and the caps hold the cost — at most 24 products and
about 2,000 characters, so under 500 tokens in, in the worst case. The ingredients snippet adds a
little on each check line. Reading an ingredients text in the form costs about 30–60 tokens, once
per product.

The analysis also gets your own history, as name and kcal only: the meals you corrected lately (newest
first), then your favourites, one line each; a name that is in both is listed once, as the correction. A
line reads "Corrected: …" or "Favourite: …". The coach and the review get your Pantry products by name with
their values per 100 g, and a food's values (the food form's fill from a photo or a name) get the stored
product of the same name as a reference. Each of these blocks holds at most 8 lines and 600 characters,
whole lines only, and is left out when there is nothing to show. No ids are sent with them.

Each meal estimate is checked for consistency. Its confidence is capped at 0.5 when the entry's
calories miss 4 × protein + 4 × carbs + 9 × fat by more than 15% (at least 25 kcal, so small portions are
not flagged for rounding), or when any one item's calories miss the same sum by that much (an item is
checked only when it has both carbs and fat and some kcal). The numbers are never changed by the check. Alcohol entries
are not checked, since their alcohol energy is not in the sum, and plan meals are not checked: their
numbers come from the plan.

Estimates from a photo are rough. Treat them as a starting point and correct the portion when
it is off. Each item in an estimate now carries carbohydrates, fat and fibre next to the
calories and protein, and the entry sheet's edit fields let you correct them along with the rest.

In the entry sheet the item table shows what each food contributes: items are listed by
calories, biggest first, and each kcal cell carries the item's share of the meal (`71%`, best read
on a real screen — a tooltip names it). A last row explains what the item list cannot: a column
with a residual of 5 kcal / 2 g or more gets its own rest cell, labelled "Your edit" after a
manual calorie edit, "Estimate gap" where the item macros diverge from the entry totals, or
"Not itemised" for an unedited calorie-only gap, so every column still adds up to the line above.
When a correction pushes the total below the items' sum, the chips switch to sharing out the
items' total instead, with a negative share on the rest row, so no item can claim more than
100% of the meal. Storage is never rewritten by any of this: it is display-only.
