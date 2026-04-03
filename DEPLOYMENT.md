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
DATABASE_URL=                   # PostgreSQL (leave blank for SQLite)
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
Without a volume, all user data (LLM keys, wallets, vendors, schedules) is lost on every restart.

### PostgreSQL

Set `DATABASE_URL=postgres://...` — the `kv` table is created automatically on first boot.
SSL is auto-enabled for non-localhost connections (Northflank, Railway, Render, etc.).

### Which to use?

| Scenario | Recommendation |
|----------|---------------|
| Single instance, persistent volume available | SQLite (default) |
| Multiple instances / high availability | PostgreSQL |
| Quick local dev | SQLite (default, no config needed) |

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
- Option A: Attach a persistent volume at `/app/data` — uses SQLite automatically
- Option B: Add a PostgreSQL addon → set `DATABASE_URL` env var

Without one of these, user LLM keys and wallet data are wiped on every restart.

Add secrets: `TELEGRAM_TOKEN`, `CIRCLE_API_KEY`, `CIRCLE_ENTITY_SECRET`, `LLM_KEY_SECRET`

## Startup Sequence

1. Load and validate config (Zod schema — fails fast on invalid env)
2. Initialize persistence store (SQLite or PostgreSQL)
3. Create ethers provider, Circle client, chain clients
4. Create all stores (13 stores)
5. Create engines (payment, invoice, analytics, requests, identity)
6. Register all actions into the action registry (8 action groups)
7. Attach Telegram handlers (polling or webhook)
8. Reconcile in-flight Circle transactions
9. Initialize ERC-8004 agent identity (if configured)
10. Start Scheduler (10s), Watcher (30s), Alerter (60s) services
11. Start health HTTP server
12. Log "ArcPay Agent ready"

## Graceful Shutdown

`SIGINT` or `SIGTERM` → stops scheduler/watcher/alerter → stops Telegram polling → exits cleanly.

## Arc Testnet Notes

- Chain ID: `5042002`
- USDC is used as gas — wallets need USDC to cover amount + `ARC_GAS_RESERVE_USDC`
- Arc Router contract handles `pay(to, amount, proofHash, memo)` calls
- Explorer: https://testnet.arcscan.app

## Deployment Checklist

1. Set all required env vars
2. Confirm `CIRCLE_ENTITY_SECRET` is exactly 64 hex chars
3. Confirm `PAYABLES_ROUTER_ADDRESS` is a valid `0x` address
4. Deploy and verify `GET /health` returns 200
5. In Telegram: type `create wallet`
6. Fund wallet: type `faucet` to get the testnet USDC link
7. Set LLM key: type `openai <your-key>` (or anthropic / gemini / qwen)
8. Test: `send 0.01 usdc to 0x<test_address>`
9. Verify payment card shows `[Confirm]` and `[Cancel]` buttons
10. Confirm payment, verify tx appears on arcscan

## Rollback

- SQLite: preserve `data/arcpay.sqlite` — do not delete
- PostgreSQL: roll back app code only, leave DB data intact
- In-flight Circle TXs are automatically reconciled on next startup
