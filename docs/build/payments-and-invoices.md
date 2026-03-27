# Payments and Invoices

## Direct payment flow

Examples:

- `send 5 usdc to aws`
- `pay 10 usdc to 0x...`
- `actually make that 3 instead`
- `cancel that payment`

Internal flow:

1. interpreter frames the request
2. deterministic boundary validates the lane
3. payment engine resolves beneficiary, balance, reserve, and approval
4. review opens
5. Circle submission still requires explicit confirmation

## Invoice flow

Examples:

- upload PDF + `is this safe?`
- `why is this risky?`
- `pay this invoice`
- `pay it anyway`
- `yes`

Internal flow:

1. upload creates the active invoice session
2. invoice summary is produced
3. risk explanations come from session state
4. `REVIEW` requires explicit override
5. invoice-derived payment source metadata is attached
6. post-pay cleanup closes the session

## Important runtime behavior

- invoice review does not reopen once payment review is already waiting for confirmation
- natural caption follow-ups are handled in the same composed invoice turn
- explicit address requests should beat stale invoice context

## Real live validation

The project already validates:

- tiny real USDC transfers
- invoice-based live payment confirmation
- post-pay cleanup
- short and ultra phrasing suites

## Intentionally unsupported

- autonomous invoice autopay without user confirmation
- reopening a paid invoice by stale memory alone
- planner-controlled money movement
