# ArcPay Agent

ArcPay Agent is a Telegram-based payment assistant for Arc Network testnet.

It supports:

- USDC payments to saved vendors or raw addresses
- payment request links
- invoice parsing from PDF and image uploads
- spending history and reports
- scheduled payments
- wallet balance and recent activity
- optional LLM-assisted intent understanding

## Stack

- Node.js
- TypeScript
- Telegram Bot API
- Circle programmable wallets
- Arc RPC / Arc router contracts
- local JSON persistence in `data/`

## Features

- Natural-language payment commands such as `send 5 usdc jack`
- Vendor address book
- Inline payment confirmation flow
- Invoice extraction and payment preparation
- Local payment analytics
- Router activity lookup
- Session memory for follow-up commands

## Project Structure

- `src/index.ts`: app bootstrap and dependency wiring
- `src/telegram/`: Telegram bot and handlers
- `src/engines/`: payment, invoice, analytics, and request flows
- `src/storage/`: JSON-backed persistence
- `src/blockchain/`: Arc router, USDC, Circle integrations
- `tests/`: unit and integration tests

## Local Development

Install dependencies:

```bash
npm install
```

Create a local `.env` file with the required variables:

```env
TELEGRAM_TOKEN=
BOT_USERNAME=
ARC_RPC_URL=
PAYABLES_ROUTER_ADDRESS=
USDC_ADDRESS=
LLM_KEY_SECRET=
WALLET_SECRET=
CIRCLE_API_KEY=
CIRCLE_ENTITY_SECRET=
CIRCLE_WALLET_SET_ID=
CIRCLE_API_URL=
TZ=Europe/Istanbul
```

Run the bot:

```bash
npm run dev
```

Build for production:

```bash
npm run build
```

Run the production build:

```bash
npm start
```

Run tests:

```bash
npm test
```

## Example Commands

- `create wallet`
- `show wallet`
- `wallet balance`
- `send 5 usdc jack`
- `request 20 usdc`
- `payment history`
- `show recent payments`
- `monthly spending`
- `schedule payment 10 usdc aws tomorrow`

## LLM Support

Users can attach their own LLM key inside Telegram:

- `/llmkey set openai <api-key>`
- `/llmkey model gpt-4o`
- `/llmkey status`
- `/llmkey remove`

If no LLM key is configured, the bot falls back to regex and heuristic intent parsing.

## Data Storage

Runtime data is stored under `data/`:

- wallets
- vendors
- invoices
- payment logs
- schedules
- memory

This directory is ignored by git and should be treated as runtime state, not source code.

## Deploying to Render

This app is designed to run on Render as a `Web Service`.

Recommended commands:

```bash
Build Command: npm ci && npm run build
Start Command: npm start
```

Important notes:

- add environment variables in Render, not in git
- the service exposes `/health` so Render can keep the web service healthy
- on the free plan, local JSON data is ephemeral across redeploys and restarts
- run a single worker instance to avoid JSON storage conflicts

## Security Notes

- Never commit `.env`
- Rotate secrets if they were ever exposed
- Treat Circle and Telegram credentials as production secrets
- Avoid using the fallback `LLM_KEY_SECRET` default in real deployments

## Current Limitations

- local persistence is JSON-file based, not database-backed
- router history scanning is windowed and depends on RPC limits
- long-term multi-instance scaling is not safe with the current storage model
