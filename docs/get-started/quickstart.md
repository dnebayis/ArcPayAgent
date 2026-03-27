# Quickstart

## Requirements

- Node.js 20+
- Telegram bot token
- Circle / Arc runtime credentials
- optional BYOK LLM key for richer semantic interpretation

Core runtime prerequisites:

- Arc router contract address
- Arc USDC contract address
- Circle API key
- Circle entity secret
- Circle wallet set ID
- encryption secret for user-saved LLM keys

## Install

```bash
npm install
```

## Configure

Create `.env` and set the required runtime variables.

See [Environment Variables](../reference/environment-variables.md).

Minimum bootstrap example:

```env
PAYABLES_ROUTER_ADDRESS=...
USDC_ADDRESS=...
LLM_KEY_SECRET=...
CIRCLE_API_KEY=...
CIRCLE_ENTITY_SECRET=...
CIRCLE_WALLET_SET_ID=...
TELEGRAM_TOKEN=...
BOT_USERNAME=...
```

## Start the bot

```bash
npm run dev
```

The health endpoint listens on `3000` by default.

## Run local validation

```bash
npx tsc --noEmit
npm test
```

## First manual smoke

Useful first-turn smoke flow:

1. `help?`
2. `my address`
3. `save vendor aws 0x...`
4. `send 0.0001 usdc to aws`
5. `cancel`

That covers help, wallet, vendor, payment review, and pending-payment cleanup.

## Invoice smoke

Upload a PDF or image invoice and try:

1. `is this safe?`
2. `why is this risky?`
3. `pay this invoice`
4. `pay it anyway`
5. `yes`

## Run live Telegram regression

Single suite:

```bash
npm run telegram:live -- --suite scenarios/live-short-phrases-gauntlet.json
```

Restart-per-suite batch:

```bash
npm run telegram:live:batch -- scenarios/live-ultra-wallet-vendor-identity.json scenarios/live-ultra-payment-schedule.json scenarios/live-ultra-history-analytics.json scenarios/live-ultra-invoice-e2e.json scenarios/live-short-phrases-gauntlet.json
```

This batch restarts the bot between suites.

Cataloged current-flow run:

```bash
npm run telegram:live:current
```

Development cycle with cleanup and fresh harvest:

```bash
npm run telegram:live:cycle:develop
```

## Next

- [Payments and Invoices](../build/payments-and-invoices.md)
- [Live Regression](../build/live-regression.md)
