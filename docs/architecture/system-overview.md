# System Overview

## Layer Diagram

```
Telegram (telegram/bot.ts)
  → core/orchestrator.ts
    → llm/client.ts (OpenAI / Anthropic / Gemini / Groq / ...)
    → SILENT_ACTIONS check
    → actions/registry.ts (Map<string, Handler>)
      → engines/* (payment, invoice, analytics, requests, identity)
        → chain/* (circle, tokens, router, erc8004)
        → store/* (wallets, vendors, payments, ...)
      → core/sender.ts (memory sync + safeSend)

Background:
  services/scheduler.ts (10s) → PaymentEngine.prepare()
  services/watcher.ts   (30s) → balance change → notify
  services/alerter.ts   (60s) → price threshold → notify
```

## Key Files

| File | Responsibility |
|------|---------------|
| `src/main.ts` | DI wiring, startup sequence |
| `src/core/orchestrator.ts` | LLM loop, SILENT_ACTIONS, dispatch |
| `src/core/sender.ts` | All outgoing messages + memory sync |
| `src/memory/conversation.ts` | FlowState + message history |
| `src/engines/payment.ts` | Payment lifecycle (most critical) |
| `src/chain/circle.ts` | Circle DCW API client |
| `src/store/base.ts` | SQLite/PostgreSQL persistence |
| `src/telegram/bot.ts` | Telegram handler registration |
| `src/llm/tools.ts` | Tool schemas for LLM |
| `src/llm/prompt.ts` | System prompt |
| `src/utils/parser.ts` | PDF + image text extraction |

## Data Flow: Direct Payment

```
"send 5 usdc to jack"
  → orchestrator → LLM → create_payment (SILENT_ACTION)
  → actions/payment.ts → paymentEngine.prepare()
  → sender.sendCard() → [Payment Review: Confirm / Cancel]

[Confirm]
  → paymentEngine.processCallback("confirm") → execute()
  → circle.submitTx(approve) → pollTx() → COMPLETE
  → circle.submitTx(pay)     → pollTx() → COMPLETE
  → paymentLog.logPayment()
  → sender.send("Payment complete. Tx: https://...")
```

## Data Flow: Invoice

```
[PDF upload]
  → bot.ts → utils/parser.ts extractText(buffer, "application/pdf")
  → invoiceEngine.analyze(chatId, text)
  → LLM JSON completion → extract fields
  → risk assessment + vendor lookup
  → sender.sendCard() → [Invoice card + Pay/Cancel buttons]

[Pay Invoice button]
  → invoiceEngine.processCallback("invoice_pay")
  → paymentEngine.prepare(address, amount, token)
```
