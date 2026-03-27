# State Model

## Conversation memory

Conversation memory is now secondary context, not execution truth.

It helps with:

- conversational recall
- planner context
- recent entity references

## Session runtime

Session runtime owns:

- pending payment confirmation
- pending intent slot collection
- pending references
- last resolved entities

This is the main owner for product follow-ups.

Examples:

- payment waiting for confirmation
- pending intent slot collection
- recent payment index for referential history turns
- pending reference target

## Task runtime

Task runtime tracks broader conversational progress, especially where planner or runtime needs to know whether a follow-up is still in scope.

## Invoice session

Invoice session is the execution truth for invoice-specific behavior:

- risk state
- review requirement
- override requirement
- readiness to prepare payment
- post-pay closure

## Persistence

The current runtime persists key transactional surfaces such as:

- wallets
- vendors
- schedules
- payment logs
- pending payments
- submitted Circle transactions

It also persists agent identity state, including the last known validation status. When that local state is lost, the identity engine now re-derives the canonical KYC validation request hash from the registered `agentId` and recovers the onchain validation result.

Default backend is SQLite. PostgreSQL is enabled through `DATABASE_URL`.
