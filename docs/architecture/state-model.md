# State Model

## FlowState

FlowState is the primary execution guard in the orchestrator.

Stored in `conversationMemory.ts` per user.

Values:

| State | Meaning |
|---|---|
| `idle` | No active multi-turn flow. Normal LLM routing. |
| `payment_awaiting_confirmation` | A payment card is displayed. Orchestrator blocks new payment requests. |
| `invoice_awaiting_override` | An invoice is `review_required`. Override must come before payment prep. |

Lifecycle:

- `payment_awaiting_confirmation` is set only when `paymentEngine.preparePayment()` actually produces a card (non-empty return). Early exits (vendor not found, bad address) do not set this state.
- The state is cleared on Confirm, Cancel, or `/reset`.

## Conversation memory

Per-user in-memory store. Not persisted across restarts.

Contains:

- recent user / assistant messages (last 30)
- `lastAction` — last executed action name (fallback for pre-FlowState compatibility)
- `lastPayment` — last payment amount and recipient for conversational follow-up
- `lastVendor` — last vendor name touched
- `lastSchedule` — last schedule created
- `lastInvoice` — last analyzed invoice (recall only — does not reopen invoice sessions)
- `flowState` — current FlowState

When the 30-message buffer fills, the oldest 10 messages are replaced with a synthetic summary assistant turn so context is not silently lost.

## Episodic memory

Compact event log per user.

Stored in `episodicMemory.ts`.

Each significant action (payment confirmed, vendor saved, schedule created) appends a short event entry. The last ~20 events are summarized and injected into the LLM context as background history.

## Pending payment

Stored before user confirmation.

Used for:

- Confirm button
- Cancel button
- amount / vendor / memo update (inline keyboard)

Persisted in `pendingPayments.ts`. Survives restarts.

Invoice-derived pending payments carry source metadata so the invoice session can close after successful payment.

## Submitted transaction

Stored after payment submission starts.

Used for:

- duplicate submit prevention
- delayed Circle reconciliation
- restart recovery

Persisted in `submittedTransactions.ts`.

## Confirmed payment log

Stored only after successful terminal completion.

Used for:

- payment history
- analytics
- vendor totals

Persisted in `paymentLogs.ts`.

## Invoice session

Owned by `InvoiceEngine`.

States:

| State | Meaning |
|---|---|
| `processing` | Upload received, extraction in progress |
| `ready` | Extraction complete, no risk issues |
| `review_required` | Risk flags found; explicit override needed before payment prep |
| `awaiting_payment_confirmation` | Payment card is open for this invoice |
| `paid` | Payment confirmed; session closed |
| `cancelled` | User cancelled; session closed |

The invoice session is the execution truth for invoice-specific behavior. `lastInvoice` in conversation memory is recall-only — it does not reopen an invoice session.

## Persistence backend

Default: SQLite.

PostgreSQL enabled with `DATABASE_URL` env var.

The abstraction lives in `src/storage/persistence.ts`.
