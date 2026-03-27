# Invoice Session Lifecycle

Invoices are handled through an active session model, not just loose memory.

## Session states

An invoice may move through these states:

- `uploaded`
- `analyzed`
- `review_required`
- `ready_to_prepare`
- `awaiting_override`
- `awaiting_payment_confirmation`
- `paid`
- `cancelled`
- `closed`

## Upload behavior

When a PDF or photo arrives:

1. the file is analyzed
2. an invoice session is created or replaced
3. invoice summary is produced
4. caption text is interpreted within the same turn

Duplicate “analyze this pdf” captions are suppressed so the bot does not ask for a file that was already uploaded.

The summary itself is the primary answer for simple analyze captions.

## Risk policy

### Ready to pay

Payment review can open immediately.

### Review required

Payment review does not open automatically.

The user must explicitly override with phrasing like:

- `pay it anyway`
- `I reviewed it, continue`
- `go ahead despite that`

### High risk

Payment preparation stays blocked.

## Typical flow

1. upload invoice
2. review extracted fields
3. ask `is this safe?`
4. ask `why is this risky?`
5. explicitly override if review is required
6. open payment review
7. confirm with `yes`
8. session closes after success

## Post-pay cleanup

After successful confirmation:

- the invoice session closes
- stale `pay this invoice` turns no longer reopen the old invoice
- the bot asks for a new invoice upload instead

## Important guarantees

- only one active invoice session exists per chat
- a new upload replaces the old active session
- stale `lastInvoice` memory is recall-only
- once payment review is open, later invoice text should point back to `yes` or `cancel`
