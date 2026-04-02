# Deployment

See [DEPLOYMENT.md](../../DEPLOYMENT.md) for the complete guide.

## Quick Reference

```bash
npm install
npm run build
npm start
```

Health: `GET /health`

## Northflank

```
Build: npm ci && npm run build
Start: npm start
Port:  3000
Health path: /health
```

## Checklist

1. All required env vars set
2. `CIRCLE_ENTITY_SECRET` = 64 hex chars
3. `PAYABLES_ROUTER_ADDRESS` = valid `0x` address
4. `/health` returns 200
5. `create wallet` in Telegram
6. Fund wallet with testnet USDC
7. `/llmkey openai sk-...`
8. `send 0.01 usdc to 0x<address>` → card with [Confirm] [Cancel]
