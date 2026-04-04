# Long-Term Testing

## After 24h+ Uptime

### Memory
- [ ] Conversation memory does not grow unbounded (max 100 messages, overflow summarized)
- [ ] FlowState resets after payment completion
- [ ] Multiple users do not interfere with each other
- [ ] Tool call records (role: "tool") are stored but not leaked to LLM output
- [ ] RichContextProvider returns fresh wallet balance each turn

### Services
- [ ] Scheduler fires within ~10s of due time
- [ ] Watcher detects incoming payments within ~30s
- [ ] Alerter fires within ~60s of threshold crossing
- [ ] All three recover from RPC errors without crashing

### Persistence
- [ ] Pending payments survive restart
- [ ] Submitted TXs reconciled on startup
- [ ] Payment logs accumulate correctly
- [ ] LLM keys survive restart

### Error Recovery
- [ ] RPC timeout → watcher logs warning, continues
- [ ] Circle API error → error sent to user, state cleaned up
- [ ] LLM API error → "Something went wrong", no dirty state
- [ ] Invalid PDF → helpful error message, no crash

## Known Limitations

- SQLite: single-instance only. Use PostgreSQL for multi-instance.
- OCR quality depends on image resolution.
- CoinGecko rate limits may affect heavy price alert load.
- Arc Testnet RPC may have higher latency than mainnet.
