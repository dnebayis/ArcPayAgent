# Quickstart

## Requirements

- Node.js 20+
- Telegram bot token
- Circle Developer-Controlled Wallet credentials
- Arc Router contract address
- LLM key encryption secret (`LLM_KEY_SECRET`)

## Install

```bash
npm install
npm run build
npm start
```

## Minimum `.env`

```env
TELEGRAM_TOKEN=
CIRCLE_API_KEY=
CIRCLE_ENTITY_SECRET=
CIRCLE_WALLET_SET_ID=
PAYABLES_ROUTER_ADDRESS=
LLM_KEY_SECRET=
```

## First Use

1. Start the bot
2. In Telegram: `create wallet`
3. Fund wallet with testnet USDC
4. Set LLM key: `/llmkey openai sk-...`
5. Test payment: `send 0.01 usdc to 0x<address>`

## LLM Setup Commands

```
/llmkey openai sk-...              Set API key
/llmkey anthropic sk-ant-...       Set Anthropic key
/model gpt-4.1-mini                Change model
/provider anthropic                Switch provider
/llminfo                           Show current config
/llmremove                         Remove key
```

Supported providers: `openai`, `anthropic`, `gemini`, `groq`, `deepseek`, `together`, `mistral`, `openrouter`, `qwen`

## Manual Smoke Test

```
1. create wallet
2. show wallet
3. save vendor jack 0x<address>
4. send 0.01 usdc to jack
5. [Cancel]
6. send 0.01 usdc to jack
7. [Confirm]
8. list vendors
9. report
```
