# Invoice Session Lifecycle

## Status Machine

```
[File upload]
     ↓
  analyzed
     ├── SAFE + vendor matched     → ready_to_prepare
     ├── REVIEW + vendor matched   → review_required
     ├── HIGH_RISK                 → blocked
     └── vendor not found          → review_required
     ↓
  review_required
     └── "pay it anyway"           → awaiting_override → ready_to_prepare
     ↓
  ready_to_prepare
     └── [Pay Invoice]             → awaiting_payment
     ↓
  awaiting_payment
     └── PaymentEngine.prepare()   → payment flow
     ↓
  paid / cancelled
```

## Risk Levels

| Level | Condition | Can Pay |
|-------|-----------|---------|
| SAFE | No flags | Yes |
| REVIEW | Score 15-39 | Yes, after override |
| HIGH_RISK | Score ≥ 40 | No |

Risk flags: `HIGH_AMOUNT` (>$10k), `ELEVATED_AMOUNT` (>$1k), `NO_INVOICE_NUMBER`, `NO_DATE`, `UNCOMMON_CURRENCY`

## Parsing

`utils/parser.ts`:
- PDF → PDFParse class from pdf-parse library
- Image → tesseract.js OCR (English)
- Text file → raw UTF-8

`engines/invoice.ts` → LLM JSON completion to extract: vendor, amount, currency, invoiceNumber, date

## Settlement

- USD / USDC → USDC
- EUR / EURC → EURC
- Other → USDC + UNCOMMON_CURRENCY flag

## Session Rules

- One active session per user
- New upload replaces old session
- Session expires after 30 min
- After payment: status → paid
