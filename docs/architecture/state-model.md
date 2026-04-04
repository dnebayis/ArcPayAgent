# State Model

## FlowState

`core/state.ts` (FlowStateManager) manages the FlowState, backed by `memory/conversation.ts`.

```typescript
type FlowState = {
    status: "idle" | "awaiting_amount" | "awaiting_confirmation";
    since?: number;
    token?: string;
    beneficiary?: string;
};
```

### Transitions

```
idle
  ├─ create_payment (with amount)  → awaiting_confirmation
  ├─ create_payment (no amount)    → awaiting_amount
  └─ any other action              → stays idle

awaiting_amount
  └─ user types a number           → create_payment → awaiting_confirmation

awaiting_confirmation
  ├─ [Confirm] button              → execute() → idle
  ├─ [Cancel] button               → clear pending → idle
  └─ text "yes/no/cancel"          → redirect to button message
```

### Writers

Only two places write FlowState:
1. `core/orchestrator.ts` — sets `awaiting_amount`
2. `engines/payment.ts` — sets `awaiting_confirmation`, resets to `idle`

### Pending Payment

```
created:  paymentEngine.prepare()
cleared:  paymentEngine.execute() success/failure
          paymentEngine.processCallback("cancel")
          paymentEngine.expireOld() (30 min timeout)
          paymentEngine.reconcile() (startup)
```

### Submitted TX

```
created:  paymentEngine.execute() — before circle.submitTx()
cleared:  paymentEngine.execute() — after pollTx() terminal
          paymentEngine.reconcile() — startup recovery
```

### Invoice Session Status

```
uploaded → analyzed → review_required → ready_to_prepare → awaiting_payment → paid/cancelled
                    → awaiting_override → ready_to_prepare (after override)
HIGH_RISK: blocked, cannot proceed
```

## Conversation Memory Per-User

```
messages[]       history (max 100, summarize overflow; includes "tool" role for call tracking)
flowState        current FlowState
lastAction       last tool name (informational only)
lastPayment      { beneficiary, amount, token }
lastVendor       { name, address }
lastSchedule     { id, beneficiary, amount }
lastInvoice      { vendor, amount, currency } (recall only — cannot reopen payment)
```

Key methods:
- `addToolCallMessage()` — records tool calls with args (role: "tool", filtered from LLM history)
- `buildContextSummary()` — async, injects real-time wallet balance, vendor/schedule counts via RichContextProvider
- `getHistory()` — filters out tool role messages to prevent LLM mimicry
