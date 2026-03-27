# Arc Pay Agent Capability Matrix

This file describes what the agent currently does well, what is only partially supported, and what is intentionally out of scope.

It is meant to be an operational reference, not a product pitch.

## Status Key

- `Supported`
  Works in normal usage and is covered by tests or scenario runs.
- `Partial`
  Works in specific paths, but still has known limits or relies on user phrasing/context.
- `Not Supported`
  The agent should not claim to do this. If asked, it should answer honestly and redirect.

## Core Capabilities

| Area | Capability | Status | Notes |
| --- | --- | --- | --- |
| Wallet | Create a user wallet | `Supported` | One Circle developer-controlled wallet per Telegram user. |
| Wallet | Show wallet address / account status | `Supported` | Deterministic. |
| Wallet | Export wallet / private key | `Not Supported` | Circle MPC wallets never expose key material. Agent explains this and redirects to show_wallet or USDC transfer. |
| Wallet | Live wallet intelligence | `Supported` | Requires healthy Arc RPC / explorer reachability. |
| Payment | Prepare direct payment to saved vendor | `Supported` | Ends in explicit review + confirm. |
| Payment | Prepare direct payment to raw `0x...` address | `Supported` | Address validation enforced. |
| Payment | Update pending payment amount / vendor / memo | `Supported` | Deterministic update path. |
| Payment | Cancel pending payment | `Supported` | Deterministic. |
| Payment | Repeat last payment by reference | `Supported` | Works through follow-up confirmation flow. |
| Payment | Balance-first payment phrasing | `Supported` | Example: `check my balance and then send 5 usd to aws`. |
| Payment | Autonomous payment execution without confirm | `Not Supported` | Explicit review/confirm boundary remains mandatory. |
| Schedules | Create a one-time schedule | `Supported` | Deterministic schedule creation. |
| Schedules | Create recurring schedule | `Supported` | Current frequencies are limited to existing schedule model. |
| Schedules | List schedules | `Supported` | Deterministic. |
| Schedules | Cancel schedule by ID | `Supported` | Deterministic. |
| Schedules | Cancel recent / tomorrow / referenced schedule | `Supported` | Covered by orchestrator follow-up handling. |
| Invoices | Parse PDF invoice | `Supported` | Current primary invoice path. |
| Invoices | Parse image invoice | `Supported` | OCR-backed; quality depends on source image. |
| Invoices | Treat natural review captions as part of upload flow | `Supported` | Long “take a careful look at this PDF” phrasing should not trigger a second upload prompt. |
| Invoices | Explain invoice risk | `Supported` | Reason-first explanation supported. |
| Invoices | Prepare payment from invoice | `Supported` | Only from an active invoice session. |
| Invoices | Review-required override (`pay it anyway`) | `Supported` | Required before payment prep when invoice risk is `REVIEW`. |
| Invoices | Keep invoice in confirm state after override | `Supported` | Once payment review is open, invoice follow-ups should not reopen prep. |
| Invoices | `if it looks safe, pay it` | `Supported` | Safe invoices continue to payment prep; review/high-risk invoices stop safely. |
| Invoices | `leave it for now` | `Supported` | Clears invoice follow-up state cleanly. |
| Invoices | Reuse stale invoice after payment | `Not Supported` | Post-payment cleanup forces a new upload. |
| Vendors | Save vendor | `Supported` | Deterministic. |
| Vendors | Remove vendor | `Supported` | Deterministic. |
| Vendors | List vendors | `Supported` | Deterministic. |
| Vendors | Vendor detail lookup | `Supported` | Uses saved vendor stats. |
| Vendors | Remove vendor by recent reference | `Supported` | Example: `remove the payee i used last`. |
| Vendors | Remove `that vendor` | `Supported` | Only when vendor context exists. |
| Vendors | Standalone vendor risk profile | `Not Supported` | Agent should redirect to invoice risk or vendor lookup instead. |
| History / Admin | Show last payee | `Supported` | Deterministic recent payment path. |
| History / Admin | Show previous payment / previous payee | `Supported` | Referential context is supported. |
| History / Admin | Top payee / spending summary | `Supported` | Deterministic summary path. |
| Agent Identity | Show agent registration status | `Supported` | Read-only. |
| Agent Identity | Show agent ID / validation status | `Supported` | Read-only. |
| Agent Identity | Reputation / validation writes | `Partial` | Script/admin path exists; not part of user-facing payment flow. Tutorial-aligned KYC validation now uses the dedicated `agent:validation:*:kyc` commands. |
| Agent Operations | Explain runtime model / safety boundaries | `Supported` | LLM-orchestrated via read-only operational overview. |
| Agent Operations | Summarize current operational posture for this account | `Supported` | Includes wallet presence, saved vendors, schedules, payment-history count, invoice status, and agent identity status. |

## Conversation Quality Matrix

| Conversation Pattern | Status | Notes |
| --- | --- | --- |
| Greeting / small talk | `Supported` | LLM-orchestrated when BYOK is present. |
| Broad help (`what can you do`) | `Supported` | Deterministic and intentionally short. |
| Payment help (`I need help with payments`) | `Supported` | Deterministic. |
| Vendor help (`I need help with a vendor`) | `Supported` | Deterministic. |
| Short terse commands (`status`, `export wallet`, `pay it anyway`) | `Supported` | Handled by the LLM orchestrator; terse commands are resolved via conversation context. |
| Short natural fragments (`send 1`, `cancel that`, `who last`) | `Partial` | Works when active task/reference context is still present. |
| Task clearing on social turns | `Supported` | Social/help turns should clear stale invoice/admin tasks. |
| Invoice follow-up continuity | `Supported` | Context survives through `does this look okay`, `why is this risky`, `pay it`, `leave it for now`. |
| Referential admin follow-ups | `Supported` | Example: `show the payment before that`. |
| Long open-ended advisory chat | `Partial` | Not a general-purpose assistant; conversation is still product-scoped. |
| Operational self-knowledge (`how do you work`, `how do you manage operations`) | `Supported` | LLM-orchestrated when a key is set; bounded summary otherwise. |
| Unsupported capability honesty | `Supported` | Agent should say when something is not supported. |

## Known Limits

### Product Limits

- The product is still centered on a small set of jobs:
  - pay someone
  - review/pay an invoice
  - manage vendors and inspect recent payment history
- It is not intended to be a general chat assistant.
- It does not support standalone vendor risk scoring.
- It does not support autonomous spending or autopay without explicit review.
- ERC-8004 reputation/validation exists as an admin/script surface, not as an end-user workflow.
- The recommended validation semantic is now `kyc_verified`; older `service_verified` responses may still exist as legacy attestations.
- Draft-style flows are intentionally removed from the current supported surface.

### Conversation Limits

- Very broad or vague questions still work best when they are tied to a product outcome.
- Some follow-ups depend on fresh context; after a clear boundary reset, the agent may ask the user to restate the target.
- Very short phrases still rely on fresh active context. Outside that context, the agent should clarify instead of guessing.
- Displayed vendor names are only as good as the saved vendor record. The agent intentionally does not try to beautify brand casing automatically.

### Data / State Limits

- Recent payee/history answers depend on recorded local payment history.
- Invoice reasoning quality depends on the extracted invoice fields and OCR quality.
- Natural invoice captions are supported, but OCR mistakes can still distort the active invoice session.
- Live wallet intelligence depends on Arc RPC and external data availability.
- Vendor references are only as reliable as the current conversation context and saved vendor store.

## Behavioral Guardrails

- Payments always stop at explicit user confirmation before submission.
- Unsafe or review-required invoices do not automatically proceed to payment prep.
- Review-required invoices must receive an explicit override before payment prep opens.
- Once invoice payment review is open, later invoice text should point back to `yes` or `cancel`, not reopen review.
- Unsupported capabilities should produce a short, honest redirect instead of a speculative answer.
- Social/help turns should not silently revive stale invoice/payment/admin tasks.
- Completed invoice payments should close the active invoice session immediately.

## Recommended Regression Checklist

Use this set after any agent-side refactor:

### Broad Help

- `what can you do`
- `I need help with payments`
- `I need help with a vendor`

### Payment / Schedule

- `send aws 1 usd`
- `schedule 1 usd to aws tomorrow`
- `check my balance and then send 2 usd to aws`

### Invoice Follow-up

- upload invoice
- `does this look okay`
- `why is this risky`
- `if it looks safe, pay it`
- `pay it anyway`
- `I've reviewed it. Go ahead despite that.`
- `leave it for now`
- confirm payment
- `pay this invoice` again and verify that a new upload is required

### Admin / History

- `show me who i paid last`
- `show the payment before that`
- `remove the payee i used last`
- `remove that vendor`

### Agent Identity

- `show agent status`
- `what is our agent id?`
- `show agent validation status`

## Current Recommendation

Do not expand capability surface aggressively until transcript-driven smoke tests remain stable across:

- broad help
- invoice follow-up
- admin/history references
- payment/schedule direct commands

The current priority should be behavior stability, not feature count.

