# ArcPay Agent

ArcPay Agent is a Telegram-based USDC payment assistant for Arc Testnet.

It combines:

- Telegram bot workflows
- Circle developer-controlled wallets
- Arc router contract execution
- invoice extraction from PDF/image uploads
- payment requests, schedules, reports, and wallet utilities
- optional user-supplied LLM intent parsing

## What It Does

- Creates one Arc testnet wallet per Telegram user through Circle
- Sends USDC to saved vendors or raw `0x...` addresses
- Creates payment request deep links via `/start req_<id>`
- Extracts invoice fields from PDFs and images, then prepares payment flows
- Tracks local payment history and spending analytics
- Schedules future payments and prompts the user when they become due
- Supports follow-up commands such as payment updates and invoice references
- Lets each user attach their own LLM API key for better intent resolution

## Product Model

This project is not a general chat bot. It is a payment workflow agent with a strict execution model:

- Telegram collects input and renders action buttons
- the intent layer only decides what the user meant
- the engine layer executes blockchain and Circle actions
- payments are only considered complete after Circle reaches a successful terminal state
- pending and submitted payment state is persisted so restarts do not lose in-flight workflows

## Core Architecture

- `src/index.ts`
  App bootstrap, dependency wiring, tool registration, health server startup, scheduler startup.
- `src/telegram/`
  Telegram bot setup, `/start`, `/help`, `/llmkey`, invoice uploads, callback handlers.
- `src/ai/`
  Intent detection, validation, slot resolution, provider adapters, fallback heuristics.
- `src/agent/`
  Tool routing, conversation memory, session state.
- `src/engines/`
  Payment execution, invoice analysis, payment requests, analytics, risk handling.
- `src/blockchain/`
  Arc config, USDC contract helpers, Arc router encoding, Circle client, router event reads.
- `src/storage/`
  Wallets, vendors, invoices, payment logs, schedules, LLM keys, pending payments, submitted transactions.
- `src/services/`
  Scheduler and FX helper services.

## Payment Lifecycle

The payment flow is intentionally staged:

1. User prepares a payment with text such as `send 5 usdc to jack`
2. Bot shows a review message with `Confirm` and `Cancel`
3. On confirm, the engine validates Arc chain ID and USDC balance
4. The engine also enforces an Arc gas reserve because Arc uses USDC as gas
5. If router allowance is too low, the user sees `Approve via Circle`
6. Circle contract execution is submitted
7. Payment stays pending until Circle returns a terminal state
8. Only then does ArcPay mark requests or schedules as completed and write payment logs

Important:

- Arc gas reserve is configurable with `ARC_GAS_RESERVE_USDC`
- duplicate callback submits are blocked
- submitted Circle transactions are reconciled after restarts

## Scheduler Behavior

Scheduled payments are not auto-executed in the background.

The scheduler checks due schedules every 10 seconds and sends the user a Telegram action message:

- `Send now`
- `Cancel`

If the user confirms the payment and Circle later confirms the transaction, the schedule is marked executed. One-time schedules are deactivated; recurring schedules advance to the next date.

## Storage and Persistence

Current persistence behavior:

- default backend: SQLite in `data/arcpay.sqlite`
- optional backend: PostgreSQL via `DATABASE_URL`
- legacy JSON files in `data/` are auto-migrated into the active store on first access

Runtime state includes:

- wallets
- vendors
- invoices
- payment requests
- payment logs
- schedules
- user preferences
- encrypted LLM credentials
- pending payment sessions
- submitted Circle transactions awaiting reconciliation

This means the README claim that the app is “JSON-backed” is no longer accurate. The runtime now uses a unified store abstraction with SQLite by default.

## Tech Stack

- Node.js
- TypeScript
- Telegram Bot API
- `ethers`
- Circle developer-controlled wallets API
- Arc Testnet RPC
- `pdf-parse`
- `tesseract.js`
- SQLite (`node:sqlite`)
- PostgreSQL via `pg` when `DATABASE_URL` is present
- Vitest

## Requirements

- Node.js 20+ recommended
- Telegram bot token
- Circle developer-controlled wallet credentials
- Arc Testnet USDC contract address
- Arc router contract address

## Environment Variables

### Required

These are the non-test values that are actually required by the current runtime validation.

| Variable | Purpose |
| --- | --- |
| `PAYABLES_ROUTER_ADDRESS` | Arc router contract address |
| `USDC_ADDRESS` | Arc USDC token contract address |
| `LLM_KEY_SECRET` | Secret used to encrypt user-saved LLM API keys |
| `CIRCLE_API_KEY` | Circle API key |
| `CIRCLE_ENTITY_SECRET` | 32-byte hex entity secret |
| `CIRCLE_WALLET_SET_ID` | Circle wallet set ID |

### Optional

| Variable | Purpose |
| --- | --- |
| `TELEGRAM_TOKEN` | Telegram bot token. If missing, the app can still boot but Telegram polling is disabled |
| `BOT_USERNAME` | Bot username used for request deep links, default `ArcPayAgentBot` |
| `ARC_RPC_URL` | Arc RPC URL, default official Arc testnet RPC |
| `DATABASE_URL` | Enable PostgreSQL instead of SQLite |
| `PORT` | Health server port, default `3000` |
| `TZ` | Runtime timezone |
| `ARC_CHAIN_ID` | Override expected Arc chain ID, default `5042002` |
| `ARC_GAS_RESERVE_USDC` | Extra USDC balance reserve required before sending, default `0.10` |
| `CIRCLE_API_URL` | Circle API base URL, default `https://api.circle.com/v1/w3s` |
| `PAYMENT_HISTORY_SOURCE` | `local` or `router`, default `local` |
| `PAYMENT_HISTORY_CHUNK` | Router scan chunk size |
| `PAYMENT_HISTORY_WINDOWS` | Number of recent block windows to scan |
| `CIRCLE_TX_POLL_ATTEMPTS` | Poll attempts for Circle terminal state |
| `CIRCLE_TX_POLL_INTERVAL_MS` | Poll interval for Circle terminal state |

### Example `.env`

```env
TELEGRAM_TOKEN=
BOT_USERNAME=ArcPayAgentBot

ARC_RPC_URL=https://rpc.testnet.arc.network
PAYABLES_ROUTER_ADDRESS=
USDC_ADDRESS=
ARC_GAS_RESERVE_USDC=0.10

LLM_KEY_SECRET=

CIRCLE_API_KEY=
CIRCLE_ENTITY_SECRET=
CIRCLE_WALLET_SET_ID=
CIRCLE_API_URL=https://api.circle.com/v1/w3s

PORT=3000
TZ=Europe/Istanbul
```

Notes:

- `PAYABLES_ROUTER_ADDRESS` and `USDC_ADDRESS` must be valid EVM addresses
- `CIRCLE_ENTITY_SECRET` must be a 64-character hex string
- Arc RPC is validated against the expected Arc chain ID before payments are allowed
- if `TELEGRAM_TOKEN` is missing, the process can still start but the bot will not poll Telegram updates

## Local Development

Install dependencies:

```bash
npm install
```

Run in development:

```bash
npm run dev
```

Build:

```bash
npm run build
```

Run the built app:

```bash
npm start
```

Run tests:

```bash
npm test
```

Useful test commands:

```bash
npm run test:unit
npm run test:integration
npx tsc --noEmit
```

## Main Commands

### Wallet

- `create wallet`
- `show wallet`
- `wallet balance`
- `account summary`
- `status`
- `wallet recovery`

### Payments

- `send 5 usdc to jack`
- `send 5 usdc to "Anthropic, PBC"`
- `send 5 usdc to 0x...`
- `cancel payment`
- `update amount to 7`
- `update recipient to 0x...`
- `update memo to cloud invoice`

### Vendors

- `save vendor jack 0x...`
- `save vendor "Anthropic, PBC" 0x...`
- `my vendors`
- `vendor aws`
- `top vendors`
- `remove vendor aws`

### Invoices

- send a PDF invoice
- send a photo invoice
- `analyze invoice`
- `pay that invoice`

### Payment Requests

- `request 20 usdc`
- users pay request links through Telegram deep links and inline actions

### Schedules

- `schedule payment 10 usdc to aws tomorrow`
- `schedule payment 10 usdc to 0x... in 1 minute`
- `list schedules`
- `cancel schedule <id>`

### Reports

- `payment history`
- `show recent payments`
- `show pending payments`
- `report`
- `spending by vendor`
- `monthly spending`

## LLM Support

Users can bring their own API key through Telegram:

- `/llmkey status`
- `/llmkey set openai sk-...`
- `/llmkey model gpt-4.1-mini`
- `/llmkey remove`

Supported provider adapters in the current code:

- `openai`
- `groq`
- `openrouter`
- `together`
- `mistral`
- `anthropic`
- `gemini`

If no valid LLM key is configured, the app falls back to deterministic parsing, regexes, heuristics, and session context.

LLM keys are encrypted before storage using `LLM_KEY_SECRET`.

## HTTP Endpoints

The app exposes a lightweight HTTP server:

- `GET /health` -> `200 ok`
- `GET /ready` -> JSON readiness payload
- `GET /` -> same as `/health`

Readiness currently reports:

- persistence readiness
- bot readiness
- scheduler readiness
- RPC readiness

The overall `ready` flag is based on persistence plus bot readiness.

## Deployment Notes

This service is suitable for a single-instance worker or web service deployment.

Recommended production characteristics:

- single instance
- persistent disk if using SQLite
- PostgreSQL if you want safer persistence across restarts and deployments

Example build/start:

```bash
Build: npm ci && npm run build
Start: npm start
```

## Operational Notes

- ArcPay is designed around Arc Testnet, not mainnet
- Arc uses USDC as gas, so balances must cover payment amount plus reserve
- router history is optional and window-scanned; local payment history is the safer default source
- payment requests and schedules now complete only after successful payment confirmation
- submitted Circle transactions are periodically reconciled to handle delayed finalization

## Current Limitations

- amounts in analytics and some stores still use `number`, not a fixed-precision money type
- wallet intelligence depends partly on ArcScan-style explorer data
- router payment history is windowed and not a full indexer
- scheduler requires user confirmation; it is not autonomous auto-pay
- multi-instance writes are not safe unless you move fully to a shared database strategy
- `src/engines/vendorEngine.ts` exists but is not part of the active runtime flow

## Security Notes

- never commit `.env` files
- never commit Circle recovery material or secrets
- treat `TELEGRAM_TOKEN`, `CIRCLE_API_KEY`, `CIRCLE_ENTITY_SECRET`, and `LLM_KEY_SECRET` as production secrets
- user-provided LLM keys are sensitive; rotate `LLM_KEY_SECRET` carefully because stored keys become undecryptable if it changes

## Project Layout

```text
src/
  agent/         tool routing, session state, conversation memory
  ai/            parsing, validation, provider adapters, prompts
  blockchain/    Arc config, router, USDC, Circle client
  engines/       payment, invoice, analytics, requests
  services/      scheduler and support services
  storage/       persistence-backed domain stores
  telegram/      bot bootstrapping and handlers
  utils/         date and user-timezone helpers
tests/
  integration/   end-to-end flow coverage
  unit/          isolated module tests
```
