# SILENT_ACTIONS & Engine-First Output

## The Problem

In naive LLM+tool implementations:
```
LLM text sent → tool runs → engine sends card
```

Result: LLM fabricates "Preparing your payment..." → engine sends real card with buttons → user sees two messages, buttons may disappear or never appear.

## The Fix

```typescript
// core/orchestrator.ts
this.memory.addToolCallMessage(chatId, toolName, toolArgs); // record for context

if (SILENT_ACTIONS.has(toolName)) {
    // LLM message NEVER sent — engine is sole sender
    const result = await executeAction(chatId, toolName, toolArgs);
    if (!result.success && result.error) { /* send validation error */ }
} else {
    if (response.message) await sender.send(chatId, response.message);
    const result = await executeAction(chatId, toolName, toolArgs);
    if (!result.success && result.error) { /* send validation error */ }
}
```

No regex. No length check. No heuristic. Set membership lookup.

`executeAction()` returns `ActionResult` — Zod schemas in `actions/schemas.ts` validate and coerce parameters (e.g. string `"50"` → number `50`) before the handler runs.

## What Goes in SILENT_ACTIONS

Any action where the engine/action sends its own structured output:
- `create_payment` → payment review card with buttons
- `show_wallet` → formatted balance message
- `list_vendors` → vendor list
- `report` → spending report
- (22 total actions)

## Centralized Sender

All outgoing messages go through `core/sender.ts`:

```typescript
async send(chatId, text, opts?) {
    memory.addBotMessage(chatId, text);  // always syncs memory
    return safeSend(bot, chatId, text, opts);
}
```

No message bypasses memory sync. No out-of-sync state possible.

## Tool Result Feedback Loop

The orchestrator rebuilds the message history from memory on each loop iteration. When a tool executes and its output is recorded via `sender.send()` → `memory.addBotMessage()`, the next iteration's `getHistory()` includes that result. This allows the LLM to see what happened and chain follow-up tool calls.

Tool call markers (role: "tool") are stored in memory for debugging but filtered from `getHistory()` to prevent the LLM from mimicking the `[Called: ...]` format.

## Rich Context Injection

`ConversationMemory.buildContextSummary()` is async and uses a `RichContextProvider` callback to inject real-time data into the system prompt:
- Wallet address and USDC/EURC balances
- Vendor count
- Active schedule count

This runs once per user message (not per loop iteration) to avoid repeated RPC calls.
