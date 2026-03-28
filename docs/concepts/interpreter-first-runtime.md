# LLM-Orchestrated Runtime

> This document describes the current architecture. An earlier draft of this file referred to an "interpreter-first runtime" with `runtimeOrchestrator`, `taskInterpreter`, `AgentPlanner`, and `executionBoundary` components. None of those exist. The actual system is described below.

## Core idea

Every text turn goes through a single orchestrator (`src/core/orchestrator.ts`) that:

1. Checks FlowState — if `payment_awaiting_confirmation`, blocks new payment commands
2. Checks for capability queries — answers directly without LLM
3. Calls the LLM with conversation history and system prompt
4. Validates and dispatches the returned action

## Two runtime modes

The orchestrator supports two mutually exclusive LLM modes, selected by `USE_TOOL_CALLING` env var (default `false`):

### JSON mode (default)

- System prompt contains full action reference and routing rules
- LLM returns `{"action": "...", "message": "...", ...params}`
- Orchestrator parses + validates JSON, then dispatches

### Native tool calling mode

- System prompt is trimmed (no action reference needed)
- LLM calls tools natively; orchestrator runs an agent loop (up to 4 iterations)
- `TERMINAL_ACTIONS` set controls when the loop breaks immediately

## FlowState guard

The orchestrator does not use regexes for routing. It checks an explicit FlowState:

```
idle → normal LLM routing
payment_awaiting_confirmation → block new payments; redirect to Confirm/Cancel buttons
invoice_awaiting_override → invoice must be explicitly approved before payment prep
```

See `docs/architecture/state-model.md` for full FlowState lifecycle.

## Fabrication guard

`isFabricatedMessage(action, message)` blocks LLM-fabricated data in data-display responses.

Checks applied only to `DATA_DISPLAY_ACTIONS` (show_wallet, list_vendors, etc.):

- `[Vendor Name]` — placeholder bracket patterns
- `1. Item` — numbered list (LLM-generated fake list)
- `- **Field**` — markdown list format
- length > 120 chars — too long for a loading indicator
- `0x[hex]{10+}` — fabricated wallet or contract address

## TERMINAL_ACTIONS

A set of actions where the agent loop stops immediately after dispatch.

These are actions where the dispatcher produces its own complete UI (payment card, data table, etc.) and no LLM synthesis step is needed or wanted.

Defined in `src/ai/toolDefinitions.ts`.

## What the LLM decides

- Which tool / action to call
- Pre-tool message to show the user while action executes
- Conversational responses when no action is needed

## What the LLM does not do

- Submit Circle payments (PaymentEngine controls that)
- Mutate vendor storage directly (ToolDispatcher mediates)
- Cancel schedules autonomously
- Confirm payments (requires explicit user button press)

## Walkthroughs

### Direct payment

1. user: `send 5 usdc to aws`
2. FlowState: idle → continue
3. LLM returns `{"action":"create_payment","amount":5,"beneficiary":"aws","message":"Preparing 5 USDC to aws."}`
4. message sent to user
5. `ToolDispatcher` → `paymentEngine.preparePayment()`
6. payment card shown
7. FlowState set to `payment_awaiting_confirmation`

### Follow-up during pending payment

1. user: `actually send 10`
2. FlowState: `payment_awaiting_confirmation`
3. PAYMENT_MODIFY_PATTERN matches → "There's already a payment waiting. Please cancel it first."
4. LLM never called

### Data display

1. user: `show my wallet`
2. LLM returns `{"action":"show_wallet","message":"Fetching your wallet…"}`
3. message passes `isFabricatedMessage` check (short, no address, no list)
4. `ToolDispatcher` → `walletEngine.showWallet()` sends real card
5. `show_wallet` is in TERMINAL_ACTIONS → loop stops

### Capability query

1. user: `what can you do?`
2. CAPABILITY_PATTERN matches → static capability list sent
3. LLM never called
