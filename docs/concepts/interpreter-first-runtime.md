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
if (SILENT_ACTIONS.has(toolName)) {
    // LLM message NEVER sent — engine is sole sender
    await executeAction(chatId, toolName, toolArgs);
} else {
    if (response.message) await sender.send(chatId, response.message);
    await executeAction(chatId, toolName, toolArgs);
}
```

No regex. No length check. No heuristic. Set membership lookup.

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
