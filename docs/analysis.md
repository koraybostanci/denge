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

Estimates from a photo are rough. Treat them as a starting point and correct the portion when
it is off. Each item in an estimate now carries carbohydrates, fat and fibre next to the
calories and protein, and the entry sheet's edit fields let you correct them along with the rest.
