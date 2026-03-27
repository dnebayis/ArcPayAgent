# Scenarios

The `scenarios/` directory is the regression corpus for runtime and live testing.

## Main groups

### Runtime scenarios

Deterministic and interpreter-first scenario coverage.

Examples:

- `runtime-v2-stress.json`
- `runtime-v2-long-variations.json`
- `runtime-v2-invoice-session.json`
- `runtime-v2-invoice-review-policy.json`

### Live family suites

Smaller focused Telegram suites for one area.

### Live ultra suites

Long end-to-end Telegram suites with real money movement and invoice flows.

### Short gauntlet

Terse natural phrasing coverage.

## Practical use

Use runtime scenarios when:

- changing parser or interpreter behavior
- validating logic locally without Telegram

Use live suites when:

- touching invoice uploads
- validating real payment confirmation
- checking schedule behavior
- confirming that Telegram ingress still matches local runtime expectations

## Acceptance rule

Scenario or live expectation changes should happen only if product behavior intentionally changed. Otherwise the code should be fixed to meet the suite.
