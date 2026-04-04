# Payment Lifecycle

## Steps

### 1. Prepare

```
paymentEngine.prepare(chatId, beneficiary, amount, token, memo, source?)
```

- Wallet existence check
- Vendor resolution (fuzzy match if not a `0x` address)
- Self-payment guard
- PendingPayment stored
- FlowState → `awaiting_confirmation`
- Payment Review card sent: [Confirm] [Cancel]

### 2. User Review

User sees the card. Two choices:
- `[Cancel]` → pending cleared, FlowState → idle
- `[Confirm]` → execute()
- Text confirm/cancel → redirected to use buttons

### 3. Execute

`executeAction()` validates parameters with Zod schemas (type coercion + error feedback) before calling the handler. Returns `ActionResult { success, error? }`.

1. Balance check: wallet ≥ amount + gas reserve
2. "Processing payment..." sent
3. **Approve TX**: encodeApprove → circle.submitTx() → pollTx()
4. **Pay TX**: router.encodePay() → circle.submitTx() → pollTx()
5. On success: payment log written, vendor stats updated, success message

### 4. Poll

`circle.pollTx()` polls 15× at 2000ms. Terminal states: COMPLETE, FAILED, CANCELLED, DENIED.

### 5. Cleanup

After any outcome: pending cleared, submitted TX cleared, FlowState → idle.

## Restart Recovery

`paymentEngine.reconcile()` at startup:
- Checks all submitted_txs
- Calls circle.getTx() once per TX
- Logs completed payments
- Clears all records

## Payment Sources

| source.type | Triggered by |
|-------------|-------------|
| `user` | Direct message |
| `schedule` | SchedulerService |
| `invoice` | InvoiceEngine |
| `request` | PaymentRequest deep link |
