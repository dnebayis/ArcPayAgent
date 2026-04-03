# Deployment

## Overview

ArcPay Agent is a single long-running Node.js service:

- Telegram polling or webhook
- HTTP health server (`/health`)
- SQLite or PostgreSQL persistence
- Background scheduler, watcher, and alerter

## Requirements

- Node.js 20+
- Telegram bot token
- Circle Developer-Controlled Wallet credentials
- Arc Testnet RPC access
- Arc Router contract address

## Build and Start

```bash
npm install
npm run build
npm start
```

Development (ts-node with watch):
```bash
npm run dev
```

## Environment Variables

### Required

```env
TELEGRAM_TOKEN=
CIRCLE_API_KEY=
CIRCLE_ENTITY_SECRET=           # 64-char hex
CIRCLE_WALLET_SET_ID=           # UUID
PAYABLES_ROUTER_ADDRESS=        # 0x...
LLM_KEY_SECRET=                 # any strong random string for key encryption
```

### Common Optional

```env
ARC_RPC_URL=https://rpc.testnet.arc.network
ARC_CHAIN_ID=5042002
USDC_ADDRESS=0x3600000000000000000000000000000000000000
EURC_ADDRESS=0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a
ARC_GAS_RESERVE_USDC=0.10
CIRCLE_API_URL=https://api.circle.com/v1/w3s
PORT=3000
DATABASE_URL=                   # PostgreSQL connection string (leave blank for SQLite)
ALLOWED_CHAT_IDS=               # comma-separated Telegram chat IDs, blank = allow all
WEBHOOK_URL=                    # set to enable webhook instead of polling
MAX_AGENT_ITERATIONS=4
SCHEDULER_INTERVAL_MS=10000
WATCHER_INTERVAL_MS=30000
ALERTER_INTERVAL_MS=60000
```

### ERC-8004 Agent Identity (optional)

```env
ARC_AGENT_METADATA_URI=
ARC_AGENT_OWNER_WALLET_ID=
ARC_AGENT_VALIDATOR_WALLET_ID=
ARC_AGENT_ID=
ERC8004_IDENTITY_REGISTRY=0x8004A818BFB912233c491871b3d84c89A494BD9e
ERC8004_REPUTATION_REGISTRY=0x8004B663056A597Dffe9eCcC1965A193B7388713
ERC8004_VALIDATION_REGISTRY=0x8004Cb1BF31DAf7788923b405b754f57acEB4272
```

## Persistence

### SQLite (default)

Single file at `data/arcpay.sqlite`. Uses WAL mode for crash safety and fast writes.

**In containers:** mount a persistent volume at `/app/data` so the file survives restarts.
Without a volume, all user data is lost on every restart.

### PostgreSQL

Set `DATABASE_URL=postgres://...` — all tables are created automatically on first boot.
SSL is auto-enabled for non-localhost connections (Northflank, Railway, Render, Neon, etc.).

### Which to use?

| Scenario | Recommendation |
|----------|---------------|
| Single instance, persistent volume available | SQLite (default) |
| Multiple instances / high availability | PostgreSQL |
| Quick local dev | SQLite (default, no config needed) |
| Northflank with addon or Neon | PostgreSQL (`DATABASE_URL`) |

### Database Schema

13 typed tables — all created automatically:

| Table | Description |
|-------|-------------|
| `wallets` | Circle wallet per user |
| `vendors` | Address book with payment stats |
| `payments` | Payment history |
| `schedules` | Recurring payment schedules |
| `price_alerts` | Price alert rules |
| `watch_config` | Wallet balance monitoring |
| `pending_payments` | Awaiting user confirmation |
| `submitted_txs` | In-flight Circle transactions |
| `invoice_sessions` | Active invoice analysis |
| `payment_requests` | Shareable payment links |
| `llm_keys` | Encrypted LLM API keys |
| `agent_identity` | ERC-8004 on-chain identity |
| `conversations` | Last 20 messages per user (survives restarts) |

**Migration:** If a legacy `kv` table exists from a previous version, it is automatically migrated on first boot and renamed to `kv_migrated`.

## LLM Configuration

Users set their own AI keys via Telegram. Supported providers:

| Provider | Setup |
|----------|-------|
| OpenAI | `openai sk-...` |
| Anthropic | `anthropic sk-ant-...` |
| Gemini | `gemini AIza...` |
| Qwen | `qwen sk-...` |
| Groq | `groq gsk_...` |
| DeepSeek | `deepseek sk-...` |

Keys are encrypted at rest using `LLM_KEY_SECRET` (AES-256-GCM).

**Slash commands for AI config:**

| Command | Action |
|---------|--------|
| `/model gpt-4o` | Change model |
| `/provider anthropic` | Change provider |
| `/aiconfig` | Show current config |
| `/removekey` | Delete API key |
| `/reset` | Clear conversation history |

## Health Check

```
GET /health → 200 {"status":"ok","uptime":N,"timestamp":"..."}
```

Use `/health` for liveness probe.

## Northflank Deployment

Recommended service settings:

```
Build command:   npm ci && npm run build
Start command:   npm start
Port:            3000
Health path:     /health
```

**Persistence (required — choose one):**
- **Option A:** Attach a persistent volume at `/app/data` — uses SQLite automatically
- **Option B:** Add a PostgreSQL addon → set `DATABASE_URL` env var (recommended for production)

To get the connection string from a Northflank PostgreSQL addon:
1. Go to your addon → **Connection** tab
2. Copy the **Connection URI** (starts with `postgres://`)
3. Set it as `DATABASE_URL` in your service's environment variables

Add secrets: `TELEGRAM_TOKEN`, `CIRCLE_API_KEY`, `CIRCLE_ENTITY_SECRET`, `LLM_KEY_SECRET`

## Startup Sequence

1. Load and validate config (Zod schema — fails fast on invalid env)
2. Initialize DB (SQLite or PostgreSQL), create tables, run migration if needed
3. Create ethers provider, Circle client, chain clients
4. Create all stores (12 stores backed by typed SQL tables)
5. Create conversation memory (loads last 20 messages per user from DB)
6. Create engines (payment, invoice, analytics, requests, identity)
7. Register all actions into the action registry (8 action groups)
8. Attach Telegram handlers (polling or webhook)
9. Reconcile in-flight Circle transactions
10. Initialize ERC-8004 agent identity (if configured)
11. Start Scheduler (10s), Watcher (30s), Alerter (60s) services
12. Start health HTTP server
13. Log "ArcPay Agent ready"

## Graceful Shutdown

`SIGINT` or `SIGTERM` → stops scheduler/watcher/alerter → stops Telegram polling → closes DB → exits cleanly.

## Arc Testnet Notes

- Chain ID: `5042002`
- USDC is used as gas — wallets need USDC to cover amount + `ARC_GAS_RESERVE_USDC`
- Arc Router contract handles `pay(to, amount, proofHash, memo)` calls
- Explorer: https://testnet.arcscan.app

## Deployment Checklist

1. Set all required env vars
2. Confirm `CIRCLE_ENTITY_SECRET` is exactly 64 hex chars
3. Confirm `PAYABLES_ROUTER_ADDRESS` is a valid `0x` address
4. Set `DATABASE_URL` (Northflank addon or Neon connection URI)
5. Deploy and verify `GET /health` returns 200
6. In Telegram: `create wallet`
7. Fund wallet: `faucet` → get testnet USDC link
8. Set LLM key: `openai <your-key>` (or anthropic / gemini / qwen)
9. Test: `send 0.01 usdc to 0x<test_address>`
10. Verify payment card shows `[Confirm]` and `[Cancel]` buttons
11. Confirm payment, verify tx appears on arcscan

## Rollback

- SQLite: preserve `data/arcpay.sqlite` — do not delete
- PostgreSQL: roll back app code only, leave DB data intact
- In-flight Circle TXs are automatically reconciled on next startup
