# Welcome to Arc Pay Agent

Arc Pay Agent is a Telegram-based USDC payment copilot for Arc Testnet.

It combines:

- Circle developer-controlled wallets
- Arc-native USDC payments
- interpreter-first conversational routing
- deterministic payment, schedule, vendor, and invoice execution
- invoice analysis from PDF and image uploads
- live Telegram regression tooling
- ERC-8004 agent identity with tutorial-aligned KYC validation helpers

## What It Is

Arc Pay Agent is not a general-purpose chatbot.

It is a product-scoped operator for:

- wallet lookup and account status
- vendor management
- payment preparation and confirmation
- recurring and one-time schedules
- invoice review and invoice-linked payment preparation
- payment history and spending analytics

## What Makes It Different

### Interpreter-first runtime

Natural language is interpreted into a semantic frame first. Execution still stays deterministic.

### Deterministic payment boundary

The LLM does not directly send money. It interprets the user turn; runtime and tool layers decide whether a payment can be prepared or confirmed.

### Invoice sessions

Invoices are no longer handled as loose memory fragments. Uploads create an active invoice session with explicit review, override, and post-pay cleanup rules.

## Start Here

1. [Quickstart](./quickstart.md)
2. [Interpreter-First Runtime](../concepts/interpreter-first-runtime.md)
3. [System Overview](../architecture/system-overview.md)
