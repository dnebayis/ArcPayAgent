# Live Long-Term Testing

This repo now has a long-term live corpus for conversational styles that tend to break product agents.

## Suite families

- `scenarios/live-longterm-limited-english.json`
  Covers limited-English phrasing, broken grammar, and reduced-function-word prompts.
- `scenarios/live-longterm-terse-elliptical.json`
  Covers one-word or ultra-short prompts, elliptical references, and minimal follow-ups.
- `scenarios/live-longterm-verbose-indirect.json`
  Covers long, indirect, story-shaped, or hedged requests.
- `scenarios/live-longterm-context-switching.json`
  Covers switching between vendor, wallet, payment, and history lanes without losing context.

## How to run

Run the whole pack:

```bash
npm run telegram:live:longterm
```

Or through the cataloged development group:

```bash
npm run telegram:live:batch --group development-longterm
```

Run one suite:

```bash
npm run telegram:live:batch -- scenarios/live-longterm-limited-english.json
```

## Failure harvesting

After a run, harvest failures and warnings from recent live reports:

```bash
npm run telegram:live:harvest -- --pattern live-longterm-
```

That writes a Markdown summary under `.telegram-live/harvest/`.

## Promotion workflow

When a live step fails:

1. Keep the live step if it represents a real user style worth probing repeatedly.
2. If the miss is parser/runtime-shaped, add a deterministic regression to `tests/unit/confusingPhraseCorpus.test.ts`.
3. If the miss is stateful, add or update a runtime scenario under `scenarios/runtime-v2-*.json`.
4. Re-run the focused live suite after the fix.

The point is to grow the corpus from real failures instead of repeatedly rediscovering the same brittle phrasing classes.
