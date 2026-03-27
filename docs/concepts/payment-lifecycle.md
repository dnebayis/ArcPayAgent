# Payment Lifecycle

## Prepare

A payment starts when the user supplies enough information to build a payment review:

- amount
- beneficiary
- optional memo

The bot then opens `Review payment`.

The review message is the execution boundary, not final submission.

## Waiting for confirmation

After review opens, the active state becomes a pending payment waiting for confirmation.

Valid follow-ups include:

- `yes`
- `cancel`
- amount update
- vendor update
- memo update

Orphan updates after cancellation are rejected safely instead of reviving stale state.

Common natural follow-ups:

- `yes`
- `actually make that 3 instead`
- `use aws instead`
- `add memo lunch`
- `leave that payment alone for now`

## Submit

Once confirmed, the payment engine:

1. checks balance
2. checks approval requirements
3. submits through Circle
4. records the submitted transaction

## Confirm

After the payment reaches final status:

- submitted state is persisted
- payment logs are updated
- stale pending state is cleared

## Schedules

Schedules use the same explicit payment boundary.

They are reminder-driven, not silent autopay. When a schedule becomes due, the bot asks the user to confirm or cancel.

## Invoice-derived payments

Invoice-derived payments carry source metadata so the invoice session can close after successful payment.
