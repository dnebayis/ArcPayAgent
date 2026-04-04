# Welcome to ArcPay Agent

ArcPay Agent is a Telegram-based USDC/EURC payment assistant for Arc Testnet.

## What It Does

- One Circle Developer-Controlled Wallet per user
- Send USDC/EURC to saved vendors or raw `0x` addresses
- Schedule recurring payments
- Analyze PDF/image invoices and pay them
- Watch for incoming payments
- Set crypto price alerts
- Live crypto price and FX lookups

## What Makes It Different

### SILENT_ACTIONS — Button Safety

For actions that produce their own output (payment cards, lists, balances), the LLM message is **never** sent. Only the engine sends. This makes the classic "buttons disappeared" bug structurally impossible.

### Tool Result Feedback Loop

The orchestrator rebuilds message history each loop iteration so the LLM sees tool results. Tool calls are recorded in memory, and `executeAction()` validates parameters with Zod schemas before dispatch.

### Rich Context

The system prompt includes real-time wallet balance, vendor count, and schedule count — so the LLM can answer questions like "do I have enough?" without extra tool calls.

### Single LLM Path

Tool-calling mode only. No JSON fallback, no dual execution paths.

### FlowState Machine

Single source of truth for conversation state (`core/state.ts`). `awaiting_confirmation` is set exactly once — when the payment card appears — and cleared exactly once — when Confirm or Cancel is pressed.

## Start Here

1. [Quickstart](./quickstart.md)
2. [Payment Lifecycle](../concepts/payment-lifecycle.md)
3. [System Overview](../architecture/system-overview.md)
