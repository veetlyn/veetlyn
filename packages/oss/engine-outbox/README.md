# @opmodel/engine-outbox

Pure state transitions for transactional-outbox deliveries: exponential-backoff retries, attempt caps and idempotency keys. Bring your own transport; this package never touches one.

## Install

```bash
npm install @opmodel/engine-outbox
```

## Quickstart

```typescript
import { computeNextAttemptAt, deliveryDedupeKey, recordDeliveryFailure, recordDeliverySuccess } from "@opmodel/engine-outbox";

// Backoff ladder: 1 min, 5 min, 15 min, 1 h, 6 h — then no more attempts.
computeNextAttemptAt(0, now); // now + 1 min
computeNextAttemptAt(5, now); // null

const dedupeKey = deliveryDedupeKey("ob_1", "email_client", "buyer@example.com");

const retried = recordDeliveryFailure(delivery, "smtp timeout", now); // pending, next attempt in 1 min
const sent = recordDeliverySuccess(retried, "re_abc", now); // sent, providerMessageId kept
```

## Semantics

- A delivery is keyed by `(outboxId, channel, recipient)` — deliver at most once per key.
- `MAX_ATTEMPTS = 5`: the fifth failure marks the record `failed` with no next attempt.
- Transitions are pure: they return a new record and never mutate.
