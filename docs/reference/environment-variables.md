# Environment Variables

## Required

| Variable | Purpose |
|----------|---------|
| `TELEGRAM_TOKEN` | Telegram bot token |
| `CIRCLE_API_KEY` | Circle API key |
| `CIRCLE_ENTITY_SECRET` | 64-char hex entity secret |
| `CIRCLE_WALLET_SET_ID` | Circle wallet set UUID |
| `PAYABLES_ROUTER_ADDRESS` | Arc Router contract address |
| `LLM_KEY_SECRET` | Encryption secret for user LLM keys |

## Arc Network

| Variable | Default | Purpose |
|----------|---------|---------|
| `ARC_RPC_URL` | `https://rpc.testnet.arc.network` | Arc RPC |
| `ARC_CHAIN_ID` | `5042002` | Chain ID |
| `ARC_GAS_RESERVE_USDC` | `0.10` | Gas reserve before payment |
| `USDC_ADDRESS` | `0x3600...0000` | Arc USDC |
| `EURC_ADDRESS` | `0x89B5...D72a` | Arc EURC |

## App Config

| Variable | Default | Purpose |
|----------|---------|---------|
| `PORT` | `3000` | Health server port |
| `DATABASE_URL` | SQLite | PostgreSQL connection |
| `ALLOWED_CHAT_IDS` | (all) | Allowlist |
| `WEBHOOK_URL` | (polling) | Webhook mode |
| `MAX_AGENT_ITERATIONS` | `4` | Max tool chain depth |
| `SCHEDULER_INTERVAL_MS` | `10000` | Schedule check |
| `WATCHER_INTERVAL_MS` | `30000` | Balance watch |
| `ALERTER_INTERVAL_MS` | `60000` | Price alert check |

## ERC-8004 (optional)

| Variable | Purpose |
|----------|---------|
| `ARC_AGENT_METADATA_URI` | Agent metadata URI |
| `ARC_AGENT_OWNER_WALLET_ID` | Owner Circle wallet |
| `ARC_AGENT_VALIDATOR_WALLET_ID` | Validator Circle wallet |
| `ARC_AGENT_ID` | Known agent ID (recovery) |

For full env reference see [README.md](../../README.md).
