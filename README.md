# ArcPay Agent

Follow on X: [@ArcPayAgent](https://x.com/ArcPayAgent)

ArcPay Agent is a Telegram-based USDC/EURC payment assistant for Arc Testnet.

It combines:

- Telegram bot with inline button flows
- Circle Developer-Controlled Wallets (DCW) on Arc Testnet
- Arc Router contract for on-chain payment execution with memo indexing
- Multi-provider LLM orchestration (BYOK: OpenAI, Anthropic, Gemini, Groq, DeepSeek, and more)
- Invoice analysis from PDF and image uploads (pdf-parse + Tesseract OCR)
- Vendor address book with fuzzy matching
- Recurring payment schedules
- Incoming payment notifications (wallet watch)
- Crypto price alerts
- Live crypto price lookups and FX rate conversions
- Optional ERC-8004 agent identity registration on Arc Testnet

## Architecture

```
src/
├── config.ts                 Zod env schema
├── main.ts                   Dependency injection wiring
├── health.ts                 HTTP /health endpoint
├── core/
│   ├── orchestrator.ts       LLM agent loop + SILENT_ACTIONS + tool feedback
│   ├── sender.ts             Centralized bot.sendMessage + memory sync
│   └── state.ts              FlowStateManager (payment flow state machine)
├── llm/
│   ├── client.ts             Multi-provider: OpenAI/Anthropic/Gemini/Groq/DeepSeek/...
│   ├── constants.ts          Shared VALID_PROVIDERS + DEFAULT_MODELS
│   ├── prompt.ts             System prompt (English only)
│   └── tools.ts              Tool definitions for LLM
├── telegram/
│   ├── bot.ts                attachHandlers: text, PDF/photo, slash commands
│   ├── messages.ts           Message formatters (start, help, AI config display)
│   └── callbacks.ts          Inline button callback handlers
├── actions/
│   ├── registry.ts           Map<string, Handler> router + Zod validation
│   ├── schemas.ts            Zod schemas for critical actions (type coercion)
│   ├── config.ts             AI config actions (set_model, set_provider, etc.)
│   ├── payment.ts            create_payment, schedule, cancel
│   ├── vendor.ts             save, list, remove, detail
│   ├── wallet.ts             create, show, export, intelligence
│   ├── analytics.ts          report, spending, monthly, history
│   ├── alerts.ts             set/list/remove price alerts + watch
│   ├── research.ts           crypto prices, FX, arc stats
│   └── agent.ts              agent status, identity, validation
├── engines/
│   ├── payment.ts            Full lifecycle: prepare → confirm → execute → poll
│   ├── invoice.ts            PDF/image parse, risk score, session management
│   ├── analytics.ts          Spending reports
│   ├── requests.ts           Payment request deep links
│   └── identity.ts           ERC-8004 registration
├── chain/
│   ├── circle.ts             Circle DCW API (createWallet, submitTx, pollTx)
│   ├── tokens.ts             USDC + EURC: balance, approve, transfer
│   ├── router.ts             Arc Router: pay() encoding
│   └── erc8004.ts            Identity/Reputation/Validation registries
├── store/
│   ├── db.ts                 SQLite/PostgreSQL typed SQL (13 tables)
│   ├── wallets.ts            Circle wallet per user
│   ├── vendors.ts            Address book with payment stats
│   ├── payments.ts           Payment history
│   ├── pending.ts            Awaiting user confirmation
│   ├── submitted.ts          In-flight Circle transactions
│   ├── schedules.ts          Recurring payment schedules
│   ├── alerts.ts             Price alert rules
│   ├── watch.ts              Wallet balance monitoring
│   ├── invoices.ts           Active invoice sessions
│   ├── requests.ts           Shareable payment links
│   ├── keys.ts               Encrypted LLM API keys
│   └── identity.ts           ERC-8004 on-chain identity
├── services/
│   ├── scheduler.ts          Due schedule check (every 10s)
│   ├── watcher.ts            Balance change detection (every 30s)
│   └── alerter.ts            Price alert check (every 60s)
├── memory/
│   └── conversation.ts       Message history + RichContextProvider + tool call records
├── middleware/
│   ├── rateLimit.ts          Per-user sliding window (10 req/10s)
│   └── access.ts             ALLOWED_CHAT_IDS allowlist
├── security/
│   └── vault.ts              AES-256-GCM key encryption
├── research/
│   └── tools.ts              CoinGecko, Frankfurter, Arc stats
└── utils/
    ├── logger.ts             Structured JSON logging
    ├── dates.ts              Date/schedule parsing
    ├── telegram.ts           Safe send + message splitting
    ├── format.ts             Amount formatting (6 decimals)
    └── parser.ts             PDF + image text extraction
```

## Key Design: SILENT_ACTIONS

The orchestrator **never** sends the LLM's pre-tool text for actions that produce their own output (payment cards, lists, balances). The engine is the sole sender.

```
User: "send 5 usdc to jack"
  → LLM: create_payment tool call
  → SILENT_ACTION → LLM message suppressed
  → PaymentEngine.prepare() → sends card with [Confirm] [Cancel]
```

This makes the button-disappearing bug structurally impossible.

## Payment Lifecycle

1. `send 5 usdc to jack` → orchestrator → `create_payment` (SILENT)
2. PaymentEngine resolves vendor, stores pending payment
3. Bot sends **Payment Review** card: `[Confirm]` `[Cancel]`
4. `[Confirm]` → balance check → Circle approve TX → Circle pay TX → poll
5. Both TXs polled until terminal state → payment logged → success message
6. `[Cancel]` → pending cleared, FlowState reset

## Installation

```bash
npm install
npm run build
npm start
```

Development:
```bash
npm run dev
```

## Environment Variables

### Required

| Variable | Purpose |
|---|---|
| `TELEGRAM_TOKEN` | Telegram bot token |
| `CIRCLE_API_KEY` | Circle API key |
| `CIRCLE_ENTITY_SECRET` | 64-char hex entity secret |
| `CIRCLE_WALLET_SET_ID` | Circle wallet set UUID |
| `PAYABLES_ROUTER_ADDRESS` | Arc Router contract address |
| `LLM_KEY_SECRET` | AES encryption secret for user LLM keys |

### Optional

| Variable | Default | Purpose |
|---|---|---|
| `ARC_RPC_URL` | `https://rpc.testnet.arc.network` | Arc Testnet RPC |
| `ARC_CHAIN_ID` | `5042002` | Arc chain ID |
| `USDC_ADDRESS` | `0x360...` | Arc USDC token |
| `EURC_ADDRESS` | `0x89B...` | Arc EURC token |
| `ARC_GAS_RESERVE_USDC` | `0.10` | USDC reserve before payment |
| `DATABASE_URL` | SQLite | PostgreSQL connection string |
| `PORT` | `3000` | Health server port |
| `ALLOWED_CHAT_IDS` | (all) | Comma-separated allowlist |
| `WEBHOOK_URL` | (polling) | Enable webhook mode |
| `MAX_AGENT_ITERATIONS` | `4` | Max LLM tool call chain depth |
| `ARC_AGENT_METADATA_URI` | | ERC-8004 metadata URI |
| `ARC_AGENT_OWNER_WALLET_ID` | | Owner wallet for identity |

### Example `.env`

```env
TELEGRAM_TOKEN=
CIRCLE_API_KEY=
CIRCLE_ENTITY_SECRET=
CIRCLE_WALLET_SET_ID=
PAYABLES_ROUTER_ADDRESS=
LLM_KEY_SECRET=

ARC_RPC_URL=https://rpc.testnet.arc.network
ARC_GAS_RESERVE_USDC=0.10

# Optional PostgreSQL
# DATABASE_URL=postgres://...
```

## LLM Setup (per user)

```
openai sk-...                  Set OpenAI key (natural language)
anthropic sk-ant-...           Set Anthropic key
gemini AIza...                 Set Gemini key
/model gpt-4.1-mini           Change model
/provider anthropic            Switch provider (keeps key)
/aiconfig                      Show current AI config
/removekey                     Remove LLM key
/reset                         Clear conversation history
```

Supported providers: `openai`, `anthropic`, `gemini`, `groq`, `deepseek`, `together`, `mistral`, `openrouter`, `qwen`

## Commands

### Wallet
- `create wallet` / `show wallet` / `wallet balance`

### Payments
- `send 5 usdc to aws` / `send 5 usdc to 0x...`
- `request 20 usdc`

### Vendors
- `save vendor aws 0x...` / `list vendors` / `remove vendor aws`

### Invoices
- Upload PDF or image → analysis + risk score + payment option

### Schedules
- `schedule payment 10 usdc to aws tomorrow at 9am`
- `list schedules` / `cancel schedule <id>`

### Reports
- `report` / `account summary` / `recent payments` / `monthly spending`

### Notifications
- `watch my wallet` / `alert me when BTC hits $100000`

### Research
- `BTC price` / `how much is 1000 EUR in USD?`

## HTTP Endpoints

- `GET /health` → `{"status":"ok","uptime":...,"timestamp":"..."}`

## Persistence

- Default: SQLite at `data/arcpay.sqlite`
- Optional: PostgreSQL via `DATABASE_URL`

## Arc Network

Targets **Arc Testnet** (chain ID `5042002`). USDC is used as gas.
Explorer: https://testnet.arcscan.app

## Security

- User LLM keys are AES-256-GCM encrypted at rest
- Circle MPC wallets never expose private key material
- Never commit `.env`
