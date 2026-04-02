# ArcPay Agent Capability Matrix

Operational reference for what the agent does, what is partial, and what is out of scope.

## Status Key

- `Supported` — works in normal usage
- `Partial` — works in specific paths, known limits
- `Not Supported` — agent should redirect honestly, not attempt

## Core Capabilities

| Area | Capability | Status | Notes |
|------|-----------|--------|-------|
| Wallet | Create wallet | `Supported` | One Circle DCW per Telegram user |
| Wallet | Show address and balance | `Supported` | USDC + EURC |
| Wallet | Export private key | `Not Supported` | Circle MPC never exposes key material |
| Wallet | Portfolio intelligence | `Supported` | Balance + payment stats |
| Payment | Pay saved vendor | `Supported` | Fuzzy vendor resolution |
| Payment | Pay raw 0x address | `Supported` | Address format validated |
| Payment | Self-payment guard | `Supported` | Blocked at prepare() |
| Payment | Cancel pending payment | `Supported` | [Cancel] button or text |
| Payment | Autonomous payment (no confirm) | `Not Supported` | Review card is always required |
| Payment | EURC payments | `Supported` | Same flow as USDC |
| Schedules | One-time schedule | `Supported` | |
| Schedules | Recurring schedule | `Supported` | daily/weekly/monthly/once |
| Schedules | List / cancel schedules | `Supported` | |
| Invoices | PDF invoice parsing | `Supported` | pdf-parse library |
| Invoices | Image invoice parsing (OCR) | `Supported` | Tesseract.js |
| Invoices | Risk assessment | `Supported` | SAFE / REVIEW / HIGH_RISK |
| Invoices | Pay from invoice | `Supported` | Requires active session + vendor match |
| Invoices | Override REVIEW risk | `Supported` | "pay it anyway" |
| Invoices | Block HIGH_RISK | `Supported` | Cannot proceed without fix |
| Vendors | Save / list / remove / detail | `Supported` | |
| Vendors | Fuzzy match | `Supported` | Bigram similarity ≥ 0.5 |
| Analytics | Spending report | `Supported` | weekly / monthly / all |
| Analytics | Spending by vendor | `Supported` | |
| Analytics | Recent payments | `Supported` | Last 10 |
| Analytics | Account summary | `Supported` | Wallet + vendors + schedules |
| Notifications | Incoming payment watch | `Supported` | Balance polling every 30s |
| Notifications | Price threshold alerts | `Supported` | above/below, fires once |
| Research | Crypto prices | `Supported` | CoinGecko, 100+ symbols |
| Research | FX rates | `Supported` | Frankfurter / ECB, ISO 4217 pairs |
| Research | Arc network stats | `Supported` | Latest block, chain ID |
| Payment Request | Create deep link | `Supported` | `/start pay_<id>` format |
| Payment Request | Handle payer deep link | `Supported` | Shows pay/decline card |
| Agent Identity | Show ERC-8004 status | `Supported` | Read-only |
| Agent Identity | Register / write | `Partial` | Requires env config |

## LLM Configuration

| Feature | Status | Notes |
|---------|--------|-------|
| BYOK per user | `Supported` | Encrypted at rest |
| /llmkey set | `Supported` | /llmkey \<provider\> \<key\> [model] |
| /model change | `Supported` | /model \<name\> |
| /provider switch | `Supported` | Keeps existing key |
| /llminfo | `Supported` | Shows provider + model + available models |
| No-key fallback | `Partial` | Bot prompts for key, basic commands still work |
| OpenAI | `Supported` | |
| Anthropic | `Supported` | |
| Gemini | `Supported` | |
| Groq | `Supported` | |
| DeepSeek | `Supported` | |
| Together / Mistral / OpenRouter / Qwen | `Supported` | |

## SILENT_ACTIONS (Button Safety)

These actions never have an LLM text message sent before them.
The engine/action is always the sole sender, preventing button disappearing.

`create_payment`, `list_vendors`, `show_wallet`, `report`, `spending_by_vendor`,
`monthly_spending`, `show_recent_payments`, `list_schedules`, `top_vendors`,
`list_price_alerts`, `account_summary`, `vendor_detail`, `wallet_intelligence`,
`agent_status`, `agent_identity`, `agent_validation_status`, `watch_payments_status`,
`status`, `create_wallet`, `export_wallet`, `schedule_payment`, `cancel_schedule`,
`cancel_all_schedules`, `set_price_alert`, `remove_price_alert`, `remove_all_price_alerts`,
`watch_payments_enable`, `watch_payments_disable`, `get_crypto_prices`, `get_fx_rate`,
`get_arc_network_stats`, `get_my_arc_activity`, `create_payment_request`,
`remove_vendor`, `remove_all_vendors`, `save_vendor`

## Known Limits

- Invoice OCR quality depends on image resolution
- Wallet intelligence depends on Arc RPC availability
- Schedule execution requires explicit user confirmation (not autonomous)
- Payment history is local-only (no full chain indexer)
- Multi-instance deployments require PostgreSQL (SQLite is single-instance only)
- Analytics amounts use `number`, not fixed-precision decimal

## Regression Checklist

### Wallet
- `create wallet`
- `show wallet` / `wallet balance`

### Payment (core flow)
- `send 5 usdc to jack` → card appears with [Confirm] [Cancel]
- `[Confirm]` → processing message → success message
- `[Cancel]` → "Payment cancelled"
- `send usdc to jack` → "How much?" → `5` → card

### Vendor
- `save vendor jack 0x...`
- `list vendors`
- `remove vendor jack`

### Invoice
- Upload PDF → analysis card
- `is this safe?` → risk explanation
- `pay this invoice` → payment card (if vendor matched)
- `pay it anyway` → override REVIEW

### Schedule
- `schedule 5 usdc to jack tomorrow at 9am`
- `list schedules`
- `cancel schedule <id>`

### Alerts / Watch
- `watch my wallet`
- `alert me when BTC hits $100000`
- `show my price alerts`

### LLM Config
- `/llmkey openai sk-...`
- `/model gpt-4.1`
- `/provider anthropic`
- `/llminfo`

### Research
- `BTC price`
- `1000 EUR in USD`
