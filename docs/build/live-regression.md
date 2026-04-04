# Manual Regression Guide

## Critical Path

### 1. Payment Card

```
send 5 usdc to jack
```
MUST: Card appears with [Confirm] and [Cancel]. No extra LLM text above the card.

```
[Cancel]     → "Payment cancelled."
```
Next `send 5 usdc to jack` must produce a fresh card (no stale state).

### 2. Confirm Flow

```
send 0.01 usdc to jack
[Confirm]    → "Processing..." → "Payment of 0.01 USDC to Jack completed. Tx: ..."
```

### 3. Amount Prompt

```
send usdc to jack    → "How much would you like to send?"
5                    → payment card for 5 USDC
[Cancel]
```

### 4. Text Confirm Blocked

```
send 5 usdc to jack
yes    → "Please use the Confirm button above"
[Cancel]
```

### 5. Invoice

```
[Upload PDF]  → "Processing document..." → invoice analysis card
is this safe? → risk explanation from LLM
[Cancel]
```

### 6. LLM Config

```
openai sk-...            → "LLM configured: openai"
/model gpt-4.1           → "Model changed to: gpt-4.1"
/aiconfig                → shows provider + model
```

## Pass Criteria

- [ ] Payment card shows NO extra LLM text above it
- [ ] [Cancel] cleans up state completely
- [ ] [Confirm] completes payment and shows tx link
- [ ] Invoice PDF is parsed (not empty text)
- [ ] No Turkish text in any response
- [ ] Natural language key entry, /model, /provider, /aiconfig all work
