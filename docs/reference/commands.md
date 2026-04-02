# Commands

## Slash Commands

| Command | Purpose |
|---------|---------|
| `/start` | Welcome message |
| `/help` | Command list |
| `/llmkey <provider> <key> [model]` | Set LLM API key |
| `/model <name>` | Change model |
| `/provider <name>` | Switch provider (keeps key) |
| `/llminfo` | Show LLM config |
| `/llmremove` | Remove LLM key |
| `/reset` | Clear conversation |

## Wallet

- `create wallet` / `show wallet` / `wallet balance` / `export wallet`

## Payments

- `send 5 usdc to jack`
- `send 5 usdc to 0x...`
- `send $20 to jack` (→ 20 USDC)
- `pay jack 10 eurc`
- `request 20 usdc`

## Vendors

- `save vendor jack 0x...`
- `list vendors` / `vendor jack` / `remove vendor jack` / `remove all vendors`

## Invoices

- Upload PDF or image
- `is this safe?` / `pay this invoice` / `pay it anyway`

## Schedules

- `schedule payment 10 usdc to jack weekly`
- `schedule 5 usdc to aws tomorrow at 9am`
- `list schedules` / `cancel schedule <id>` / `cancel all schedules`

## Reports

- `report` / `weekly report` / `monthly report`
- `account summary` / `recent payments` / `monthly spending` / `spending by vendor`

## Notifications

- `watch my wallet` / `stop watching my wallet`
- `alert me when BTC hits $100000`
- `notify me when ETH drops below $2000`
- `show my price alerts` / `remove alert <id>` / `remove all price alerts`

## Research

- `BTC price` / `ETH price`
- `how much is 1000 EUR in USD?`
- `Arc network stats`

## Agent Identity

- `show agent status` / `show agent validation status`
