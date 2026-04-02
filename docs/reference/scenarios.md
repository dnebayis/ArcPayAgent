# Test Scenarios

| # | Input | Expected |
|---|-------|---------|
| 1 | `send 5 usdc to jack` | Payment card with [Confirm] [Cancel] ONLY |
| 2 | `[Cancel]` → `send 10 eurc to jack` | Fresh card, no stale state |
| 3 | `send usdc to jack` → `50` | "How much?" → 50 USDC card |
| 4 | `send $20 to jack` | 20 USDC card, no FX text |
| 5 | `send 5 usdc to <own_address>` | Error: can't pay yourself |
| 6 | `list my vendors` | List only, no LLM text above |
| 7 | `BTC price?` → `thanks` | Price → social reply, no button hallucination |
| 8 | `alert BTC 100k` twice | Second: "already have this alert" |
| 9 | Non-English message | English response |
| 10 | Upload PDF invoice | Analysis card with risk + buttons |

## SILENT_ACTIONS Check

These must show NO LLM text above the action output:
- `send 5 usdc to jack` → card only
- `list vendors` → list only
- `show wallet` → balance only
- `report` → report only
- `list schedules` → list only
