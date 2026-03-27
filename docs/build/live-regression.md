# Live Regression

Arc Pay Agent uses real Telegram live suites in addition to unit and scenario tests.

## Suite groups

Live suites are now organized by role, not only by filename.

### Current-flow groups

- `current-core`
  Stable release gate for the supported current flow.
- `current-expanded`
  Broader natural-language coverage for the contract-native runtime.
- `current`
  `current-core` plus `current-expanded`.

### Development groups

- `development`
  Stress suites for product expansion work.
- `development-longterm`
  Long-term conversational style probes.

### Compatibility-observation groups

- `compatibility-observation`
  Older live suites kept for historical/compatibility observation, not for the main current-flow gate.

## Core live suites

Primary current-flow gate:

```bash
npm run telegram:live:current
```

Development expansion pack:

```bash
npm run telegram:live:develop
```

Development cycle with automatic cleanup and fresh harvest:

```bash
npm run telegram:live:cycle:current
npm run telegram:live:cycle:develop
```

List all named groups:

```bash
npm run telegram:live:list
```

## Restart-per-suite rule

Live batches restart the bot between suites so stale local state does not bleed between runs.

Primary command:

```bash
npm run telegram:live:batch --group current
```

## Acceptance

A live run is considered healthy when:

- audited failures are zero
- warnings are only unmatched external Telegram noise
- real payment and invoice confirmation paths still succeed

## Operator notes

- stop stray local bot instances before manual live work
- prefer the batch runner when validating multiple suites
- keep real-money tests tiny
- treat suite expectation drift as a code bug unless product behavior intentionally changed
- use `current-core` as the release gate, and `development` as the place to grow the product surface
- when a development suite exposes a durable supported behavior, promote it into a current-flow group instead of leaving it as a one-off probe
