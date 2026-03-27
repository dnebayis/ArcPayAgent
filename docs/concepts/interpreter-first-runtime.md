# Interpreter-First Runtime

Arc Pay Agent now uses an interpreter-first runtime.

## Core idea

The system does not treat `intentParser` as the semantic owner anymore.

Instead:

1. Telegram input enters the runtime
2. the interpreter produces a semantic frame
3. conversation policy chooses a lane
4. deterministic tools or planner replies execute from that frame

## Runtime truth order

The effective truth order is:

1. active state
2. session or task follow-up context
3. compatibility parser
4. planner

This keeps product turns deterministic while still allowing natural language.

## What the interpreter decides

The interpreter is responsible for:

- whether the turn is `execute`, `clarify`, `answer`, `follow_up`, or `unsupported`
- the goal family, such as payment, schedule, vendor, invoice, analytics, wallet, or history
- missing slots
- whether existing state should be cleared
- whether planner help is needed

## Runtime lanes

### Deterministic lane

Used for product-scoped turns such as:

- wallet lookup
- payment prep and confirmation
- vendor operations
- schedules
- invoice follow-up
- reports and history

### Planner lane

Used for:

- broad help
- explanation shaping
- unsupported open-ended product-adjacent turns

### Compatibility fallback

Used only for narrow compatibility behaviors that the deterministic runtime still allows.

## What it does not do

The interpreter does not directly:

- submit Circle payments
- mutate vendor storage
- cancel schedules
- confirm payments

Those remain deterministic runtime actions.

## Why this matters

This change reduces the need to add one regex per new wording variation. It also shrinks generic fallback behavior for short product-scoped turns.

## Walkthroughs

### Broad help

1. user asks what the bot can do
2. interpreter frames it as planner-style help
3. planner answers with grounded capability guidance
4. no execution state changes

### Direct payment prep

1. user asks to send money
2. interpreter frames it as a deterministic payment turn
3. execution boundary keeps it out of planner lane
4. payment review opens

### Referential follow-up

1. user says `the previous one` or `remove that vendor`
2. session state or memory provides the recent entity
3. deterministic follow-up handler resolves it
4. unresolved references trigger clarification instead of guessing
