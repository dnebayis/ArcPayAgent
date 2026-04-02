# Payments and Invoices

## Payment Encoding

### Approve TX

```typescript
data = tokens.encodeApprove("USDC", routerAddress, amount)
// approve(routerAddress, amount)
circle.submitTx(walletId, usdcAddress, data, idempotencyKey)
```

### Pay TX

```typescript
proofHash = keccak256(solidityPacked(["string"], [memo]))
data = router.encodePay(beneficiary, amount, memo)
// pay(beneficiary, amount, proofHash, memo)
circle.submitTx(walletId, routerAddress, data, idempotencyKey)
```

## Invoice Parsing

```typescript
// utils/parser.ts
async function extractText(buffer: Buffer, mimeType: string): Promise<string>
// PDF  → PDFParse().load(buffer) → getPageText() per page
// Image → tesseract.createWorker("eng") → worker.recognize(buffer)
```

## Invoice Fields

LLM JSON completion extracts:
```json
{
  "vendor": "Acme Corp",
  "amount": "1250.00",
  "currency": "USD",
  "invoiceNumber": "INV-2024-001",
  "date": "2024-01-15"
}
```

## Risk Scoring

| Flag | Score |
|------|-------|
| Amount > $10,000 | +40 |
| Amount > $1,000 | +15 |
| No invoice number | +10 |
| No date | +5 |
| Uncommon currency | +10 |

Score ≥ 40 → HIGH_RISK (blocked), Score 15-39 → REVIEW, Score < 15 → SAFE
