# Architecture

## Overview

ArcPay Agent is a Telegram payment assistant for Arc Testnet.

The system is organized around clear, non-overlapping layers:

```
Telegram → Orchestrator → LLM (tool-calling) → Action Registry → Engines → Chain/Store
```

Entry point: `src/main.ts`

## Runtime Flow

```
User message
  │
  ▼
telegram/bot.ts (attachHandlers)
  │  commands: /model, /provider, /aiconfig, /removekey, /reset, /start, /help
  │  document/photo → extractText() → invoiceEngine.analyze()
  │  callback_query → telegram/callbacks.ts → payment/invoice/request handler
  │
  ▼
core/orchestrator.ts (handleMessage)
  │
  ├─ awaiting_confirmation? → redirect to button
  ├─ awaiting_amount? → intercept number → create_payment
  ├─ no LLM key? → tryKeywordFallback() for basic commands
  │
  ▼
llm/client.ts (requestToolCompletion)
  │  builds messages: system prompt + conversation history (rebuilt per iteration)
  │  flattenForLLM() → merges tool records, ensures alternating roles
  │  calls provider: OpenAI / Anthropic / Gemini / Groq / ...
  │
  ▼
SILENT_ACTIONS check
  ├─ YES → execute action only (engine sends its own output, LLM text suppressed)
  └─ NO  → send LLM text first, then execute action
  │
  ▼
actions/registry.ts (executeAction)
  │  Zod validation (schemas.ts) → type coercion + error feedback
  │  Map<string, Handler>
  │
  ▼
engines/* or direct store operation
  │
  ▼
core/sender.ts (send / sendCard)
  └─ memory.addBotMessage() + safeSend()
```

## SILENT_ACTIONS

Actions where the LLM's pre-tool message is **never** sent to Telegram.
The engine is the sole sender — this makes button-disappearing structurally impossible.

```typescript
// core/orchestrator.ts
const SILENT_ACTIONS = new Set([
    "create_payment",       // PaymentEngine sends the review card with buttons
    "list_vendors",         // VendorAction sends the list
    "show_wallet",          // WalletAction sends balance
    "report",               // AnalyticsEngine sends report
    // ... 22 total actions
]);
```

## FlowState Machine

`core/state.ts` (FlowStateManager) wraps the FlowState stored in `memory/conversation.ts`.

```
FlowState:
  "idle"
  "awaiting_amount"         beneficiary known, amount missing
  "awaiting_confirmation"   review card shown, awaiting button press
```

Transitions:
- `idle → awaiting_confirmation`: PaymentEngine.prepare() stores pending + sends card
- `idle → awaiting_amount`: create_payment called without amount
- `awaiting_confirmation → idle`: Confirm or Cancel button clicked
- `awaiting_amount → awaiting_confirmation`: User types a number

The orchestrator is the only writer during LLM calls.
PaymentEngine is the only writer during payment execution.

## Module Responsibilities

### `src/main.ts`
Single composition root. DI order:
```
config → provider → chain clients → stores → memory → sender
       → engines → actions (registered) → orchestrator
       → telegram handlers → services → startup tasks → health server
```

### `src/core/orchestrator.ts`
- Receives every text turn
- Builds rich context once via `ConversationMemory.buildContextSummary()` (wallet balance, vendor/schedule counts)
- Agent loop: rebuilds message history each iteration so LLM sees tool results
- Records tool calls in memory via `addToolCallMessage()`
- Calls LLM via `requestToolCompletion()`
- Enforces SILENT_ACTIONS → dispatches to `executeAction()` with validation
- Handles `awaiting_amount` interception and no-key keyword fallback

### `src/core/sender.ts`
All outgoing Telegram messages pass through here.
`memory.addBotMessage()` is always called before `safeSend()`.
No bot message ever bypasses memory sync.

### `src/engines/payment.ts`
Full payment lifecycle:
1. `prepare()` → resolve vendor, check wallet, store pending, send review card
2. `processCallback("confirm")` → `execute()`
3. `execute()` → balance check → Circle approve TX → Circle pay TX → poll terminal
4. `processCallback("cancel")` → clear pending, reset FlowState
5. `reconcile()` → runs at startup, recovers in-flight TXs
6. `expireOld()` → clears pending payments older than 30 min

### `src/engines/invoice.ts`
1. `analyze(chatId, text)` → LLM JSON completion extracts invoice fields
2. Risk assessment (amount, missing fields, currency)
3. Fuzzy vendor resolution
4. Sends card with appropriate buttons (Pay / Override / Cancel)
5. `processCallback()` → handles invoice_pay / invoice_cancel / invoice_override

### `src/chain/circle.ts`
Circle Developer-Controlled Wallet client:
- `createWallet()` → new SCA wallet
- `submitTx(walletId, contractAddr, calldata, idempotencyKey)` → returns txId
- `pollTx(txId)` → polls 15× at 2000ms intervals until terminal
- `getTx(txId)` → single status check

### `src/chain/router.ts`
Arc Router encoding:
```
encodePay(beneficiary, amount, memo)
  proofHash = keccak256(solidityPacked(["string"], [memo]))
  → encodes pay(to, amount, proofHash, memo)
```

### `src/store/db.ts`
- SQLite (WAL mode) or PostgreSQL persistence
- 13 typed SQL tables, auto-created on first boot
- Legacy `kv` table auto-migrated if present

## Payment State Stores

```
pending_payments   created at prepare()
                   cleared at execute() completion/failure or cancel()

submitted_txs      created when Circle TX submitted
                   cleared after terminal state or startup reconcile()

payment_logs       written ONLY after COMPLETE terminal state
```

## Background Services

| Service | Interval | What it does |
|---------|----------|--------------|
| `SchedulerService` | 10s | Checks due schedules → PaymentEngine.prepare() |
| `WatcherService` | 30s | Polls USDC/EURC balances → notifies on increase |
| `AlerterService` | 60s | Fetches crypto prices → fires alert on threshold |

## Health

`GET /health` → `{"status":"ok","uptime":N,"timestamp":"..."}`

## Where to Start

| Change | File |
|--------|------|
| Payment behavior | `src/engines/payment.ts` |
| LLM routing / SILENT_ACTIONS | `src/core/orchestrator.ts` |
| Add new tool | `src/llm/tools.ts` + `src/actions/registry.ts` + `src/actions/schemas.ts` |
| System prompt | `src/llm/prompt.ts` |
| Telegram commands | `src/telegram/bot.ts` + `src/telegram/messages.ts` |
| Button callbacks | `src/telegram/callbacks.ts` |
| AI config actions | `src/actions/config.ts` |
| Provider/model constants | `src/llm/constants.ts` |
| Store schema | `src/store/db.ts` + `src/store/{name}.ts` |
| App wiring / DI | `src/main.ts` |
| Invoice parsing | `src/utils/parser.ts` + `src/engines/invoice.ts` |
