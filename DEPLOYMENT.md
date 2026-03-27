# Deployment

## Overview

ArcPay Agent is a long-running Node.js service with:

- Telegram polling
- a lightweight HTTP health server
- local or PostgreSQL-backed persistence
- periodic scheduler and reconciliation timers
- LLM-orchestrated conversation runtime

The safest deployment model is a single instance.

## Runtime Requirements

- Node.js 20+
- Telegram bot token
- Circle developer-controlled wallet credentials
- Arc Testnet RPC
- Arc router address
- Arc USDC address

## Environment Variables

### Required by current runtime validation

```env
PAYABLES_ROUTER_ADDRESS=
USDC_ADDRESS=
LLM_KEY_SECRET=
CIRCLE_API_KEY=
CIRCLE_ENTITY_SECRET=
CIRCLE_WALLET_SET_ID=
```

### Common runtime variables

```env
TELEGRAM_TOKEN=
BOT_USERNAME=ArcPayAgentBot
ARC_RPC_URL=https://rpc.testnet.arc.network
CIRCLE_API_URL=https://api.circle.com/v1/w3s
PORT=3000
TZ=Europe/Istanbul
ARC_GAS_RESERVE_USDC=0.10
```

### Optional operational variables

```env
DATABASE_URL=
ARC_CHAIN_ID=5042002
PAYMENT_HISTORY_SOURCE=local
PAYMENT_HISTORY_CHUNK=8000
PAYMENT_HISTORY_WINDOWS=2
CIRCLE_TX_POLL_ATTEMPTS=15
CIRCLE_TX_POLL_INTERVAL_MS=2000
ARC_AGENT_METADATA_URI=
ARC_AGENT_ID=
ARC_AGENT_OWNER_WALLET_ID=
ARC_AGENT_VALIDATOR_WALLET_ID=
ARC_AGENT_WALLET_SET_NAME=
ERC8004_IDENTITY_REGISTRY_ADDRESS=
ERC8004_REPUTATION_REGISTRY_ADDRESS=
ERC8004_VALIDATION_REGISTRY_ADDRESS=
```

## Build and Start

Install:

```bash
npm ci
```

Build:

```bash
npm run build
```

Run:

```bash
npm start
```

Development:

```bash
npm run dev
```

## Health Endpoints

The service exposes:

- `GET /health`
- `GET /ready`
- `GET /`

Recommended health check:

- liveness: `/health`
- readiness: `/ready`

Important note:

- current readiness becomes `true` when persistence and bot readiness are true
- RPC and scheduler state are included in the readiness payload but do not block the top-level `ready` flag

## Persistence Choices

### SQLite default

Default local path:

- `data/arcpay.sqlite`

Use this if:

- you run a single instance
- you have persistent disk
- you want the simplest deployment

### PostgreSQL

Enable with:

```env
DATABASE_URL=postgres://...
```

Use this if:

- you want persistence across redeploys without disk coupling
- you want cleaner operational durability

## Recommended Production Shape

Best current shape:

- 1 instance
- persistent disk if using SQLite
- fixed environment variables
- monitored health endpoints

Avoid:

- multiple app instances on SQLite
- shared write workloads without a shared database

## Northflank Deployment

Northflank is the recommended hosting platform.

Suggested service settings:

```text
Build Command: npm ci && npm run build
Start Command: npm start
```

Health check settings:

```text
Health path:    /health
Readiness path: /ready
Port:           3000 (or match PORT env)
```

Persistence notes:

- if using SQLite, attach a persistent volume and set its mount path to the `data/` directory
- if redeploy durability matters, prefer PostgreSQL with a Northflank addon or external DB

Environment variables:

- add all required env vars in the Northflank service environment settings
- use Northflank secrets for `TELEGRAM_TOKEN`, `CIRCLE_API_KEY`, `CIRCLE_ENTITY_SECRET`, and `LLM_KEY_SECRET`

## Arc-Specific Operational Notes

- this app targets Arc Testnet
- default RPC is `https://rpc.testnet.arc.network`
- expected chain ID is `5042002`
- Arc uses USDC as gas
- the app enforces a configurable extra reserve through `ARC_GAS_RESERVE_USDC`

Before live testing:

1. fund the Circle wallet on Arc Testnet
2. verify USDC contract address
3. verify router address
4. verify the bot can create and confirm a small payment

## Startup Behavior

At startup the app:

1. loads runtime config
2. initializes persistence
3. probes RPC connectivity
4. creates Telegram bot, Circle client, stores, and engines
5. creates orchestrator and tool dispatcher
6. starts scheduler and reconciliation intervals
7. optionally starts HTTP server

If configuration is invalid, startup should fail for payment-critical values.

## Operational Risks to Know

- missing `TELEGRAM_TOKEN` does not currently fail fast; the process can boot with polling disabled
- scheduler notifications depend on the bot being reachable and running
- wallet intelligence uses external explorer-style data paths
- payment history from router scans is not a full indexer
- running more than one bot process against the same Telegram token is not supported

## Deployment Checklist

1. Set all payment-critical env vars
2. Confirm `CIRCLE_ENTITY_SECRET` format is valid
3. Confirm Arc USDC and router addresses
4. Start the service
5. Check `/health`
6. Check `/ready`
7. Create a wallet in Telegram
8. Send a small test payment
9. Test a payment request
10. Test a scheduled payment reminder
11. Test an invoice upload + review + payment + post-pay cleanup sequence

## Rollback Advice

If a deploy misbehaves:

- keep the same persistence backend if possible
- avoid deleting `data/` blindly
- if using SQLite, preserve `data/arcpay.sqlite`
- if using PostgreSQL, keep schema/data intact and roll back only app code

Because the app tracks pending and submitted transactions, preserving persistence during rollback is important.
