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

Each of these requests also carries the plan's meals, as a short digest of the plan in use (meal
names, foods with amounts, calories). The requests are longer than they were and cost a little more.
With a large My plan they grow with its size. The Default plan roughly doubles the review prompt (the
largest review measured about 1,640 characters before and 3,000 after).

Estimates from a photo are rough. Treat them as a starting point and correct the portion when
it is off.

