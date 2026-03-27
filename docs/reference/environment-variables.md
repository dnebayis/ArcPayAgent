# Environment Variables

## Required

Core required variables:

| Variable | Purpose |
| --- | --- |
| `PAYABLES_ROUTER_ADDRESS` | Arc router contract address |
| `USDC_ADDRESS` | Arc USDC token contract address |
| `LLM_KEY_SECRET` | Secret used to encrypt user-saved LLM keys |
| `CIRCLE_API_KEY` | Circle API key |
| `CIRCLE_ENTITY_SECRET` | 32-byte hex entity secret |
| `CIRCLE_WALLET_SET_ID` | Circle wallet set ID |

Core groups:

- Telegram bot configuration
- Circle wallet and payment configuration
- Arc RPC and chain configuration
- persistence configuration

## Optional

Optional groups include:

- health server overrides
- scheduler tuning
- agent identity configuration
- BYOK LLM configuration
- live Telegram tooling variables

High-signal optional variables:

| Variable | Purpose |
| --- | --- |
| `TELEGRAM_TOKEN` | Telegram bot token |
| `BOT_USERNAME` | Bot username used for deep links |
| `TELEGRAM_API_ID` | Telegram API ID for live user-session testing |
| `TELEGRAM_API_HASH` | Telegram API hash for live user-session testing |
| `TELEGRAM_TEST_BOT_USERNAME` | Live suite target bot username |
| `DATABASE_URL` | PostgreSQL connection string |
| `PORT` | Health server port |
| `ARC_RPC_URL` | Arc RPC URL |
| `ARC_GAS_RESERVE_USDC` | USDC reserve required before payment submission |
| `FX_API_BASE_URL` | FX provider override used during invoice conversion |
| `ARC_AGENT_METADATA_URI` | Metadata URI used for ERC-8004 registration and KYC request URI derivation |
| `ARC_AGENT_OWNER_WALLET_ID` | Preferred owner wallet for identity reconcile and validation request writes |
| `ARC_AGENT_VALIDATOR_WALLET_ID` | Preferred validator wallet for reputation and validation response writes |

## Recommendation

Keep the root `.env` as runtime truth, and treat this page as the operator-facing map for GitBook docs.

For the complete current list and example file, see the root [README](../../README.md).
