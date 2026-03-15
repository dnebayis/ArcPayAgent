# Architecture

## Overview

ArcPay Agent is a Telegram-first payment workflow service for Arc Testnet.

The system is organized around a few clear layers:

- Telegram transport
- intent parsing and tool routing
- domain engines
- blockchain and Circle integrations
- persistence-backed stores

The runtime entrypoint is `src/index.ts`.

## Runtime Flow

High-level request flow:

1. Telegram message or callback enters through `src/telegram/handlers.ts`
2. Text input is parsed by `IntentParser`
3. Parsed intent is validated and routed through `ToolRouter`
4. A registered tool handler calls the relevant engine
5. Engines use stores and blockchain clients
6. Telegram messages are sent back to the user

For callback-based flows such as payment confirmation:

1. `preparePayment()` stores a pending payment
2. Telegram inline buttons trigger `processCallback()`
3. `PaymentEngine` validates Arc network and balance
4. If needed, approval is submitted through Circle
5. Payment is submitted through Circle
6. The transaction is reconciled until terminal state
7. Payment logs, schedules, and requests are finalized only after success

## Main Modules

### `src/index.ts`

Central composition root.

Responsibilities:

- loads runtime config
- initializes persistence
- creates provider, Circle client, bot, stores, engines
- registers all user-facing tools
- starts health server
- starts scheduler and reconciliation timers

This file is the best place to understand the actual feature surface of the app.

### `src/telegram/`

Telegram-facing transport layer.

Files:

- `bot.ts`: Telegram bot creation and polling error handling
- `handlers.ts`: command handling, upload handling, callback query flows
- `commands.ts`: helper command definitions

Responsibilities:

- `/start`, `/help`, `/llmkey`
- payment request deep links
- invoice PDF/photo ingestion
- schedule and request button callbacks
- user ownership checks on action buttons

### `src/ai/`

Intent resolution layer.

Important files:

- `intentParser.ts`
- `detectIntent.ts`
- `resolveSlots.ts`
- `validateIntent.ts`
- `systemPrompt.ts`

Responsibilities:

- deterministic intent detection
- regex and heuristic parsing
- follow-up handling via session and memory
- optional LLM provider dispatch

Important design rule:

- the LLM does not execute actions
- it only helps produce an intent

### `src/agent/`

Execution routing and short-lived context.

Important files:

- `toolRegistry.ts`
- `toolRouter.ts`
- `conversationMemory.ts`
- `sessionStore.ts`

Responsibilities:

- map validated actions to runtime handlers
- hold follow-up context
- support clarification flows

### `src/engines/`

Domain logic lives here.

#### `paymentEngine.ts`

Most critical engine in the system.

Responsibilities:

- prepare payment state
- validate Arc chain ID
- enforce Arc gas reserve
- check router allowance
- submit approval and payment through Circle
- persist pending and submitted state
- reconcile delayed Circle transactions
- finalize logs and trigger request/schedule completion

#### `invoiceEngine.ts`

Responsibilities:

- parse PDF/image input
- extract fields
- normalize amounts/currencies
- prepare invoice-derived payment suggestions

#### `paymentRequestEngine.ts`

Responsibilities:

- create request links
- resolve deep links
- mark requests as paid only after payment confirmation

#### `analyticsEngine.ts`

Responsibilities:

- payment summaries
- vendor spending
- monthly breakdowns

#### `riskEngine.ts`

Responsibilities:

- invoice risk flags
- duplicate detection
- suspicious signal scoring

### `src/blockchain/`

Chain and Circle integration layer.

Files:

- `arcConfig.ts`: Arc constants and gas reserve config
- `usdc.ts`: ERC-20 helpers and calldata encoding
- `arcRouter.ts`: router calldata encoding
- `routerReader.ts`: router event scanning
- `circleClient.ts`: Circle API client for wallets and transactions

Key point:

- Arc uses USDC as gas
- the app explicitly reserves extra USDC before payment confirmation

### `src/storage/`

Persistence-backed domain stores.

Important stores:

- `walletStore.ts`
- `vendorStore.ts`
- `invoiceStore.ts`
- `paymentLogs.ts`
- `paymentRequests.ts`
- `schedules.ts`
- `llmKeyStore.ts`
- `pendingPayments.ts`
- `submittedTransactions.ts`
- `userPreferences.ts`

Persistence backend:

- SQLite by default
- PostgreSQL if `DATABASE_URL` is present

The backend abstraction is implemented in `persistence.ts`.

### `src/services/`

Background support services.

Important files:

- `scheduler.ts`
- `fxRateService.ts`

Scheduler behavior:

- checks due schedules every 10 seconds
- sends a Telegram reminder with action buttons
- does not auto-pay without user confirmation

## State Model

There are three important payment-related state buckets:

### Pending payment

Stored before user confirmation.

Used for:

- confirm
- cancel
- update amount/vendor/memo

Persisted in `pendingPayments.ts`.

### Submitted transaction

Stored after a payment or approval submission starts.

Used for:

- duplicate submit prevention
- delayed Circle reconciliation
- restart recovery

Persisted in `submittedTransactions.ts`.

### Confirmed payment log

Stored only after successful terminal completion.

Used for:

- payment history
- analytics
- vendor totals

Persisted in `paymentLogs.ts`.

## Health and Readiness

HTTP server lives in `src/http.ts`.

Endpoints:

- `/health`
- `/ready`
- `/`

Readiness tracks:

- persistence
- bot
- scheduler
- RPC

Current overall readiness is based on persistence plus bot readiness.

## Important Design Constraints

- request and schedule completion must happen only after successful payment confirmation
- pending and submitted state must survive restarts
- Arc network must match expected chain ID before payment submission
- user action buttons are owner-scoped by Telegram user ID
- local payment history is the default truth for confirmed user payments

## Known Limitations

- analytics and some stores still use `number` for amounts
- wallet intelligence has explorer-style dependencies
- router history is a scanned view, not a full indexed ledger
- scheduler is reminder-based, not autonomous
- multi-instance deployments need stronger shared-state guarantees

## Suggested Entry Points

If you are changing:

- payment behavior: start with `src/engines/paymentEngine.ts`
- user interaction: start with `src/telegram/handlers.ts`
- intent behavior: start with `src/ai/intentParser.ts`
- storage semantics: start with `src/storage/persistence.ts`
- app wiring: start with `src/index.ts`
