# M11: mirror Retry-After handling

Date: 23 October 2026. Branch: `feature/m11-retry-after`.

## What changed

The mirror breaker previously applied a fixed 10-minute cooldown after three
consecutive failures and ignored upstream rate-limit hints. It now parses
`Retry-After` on 429/5xx/403 responses and uses it in `MirrorHealth`:

- delta-seconds (`Retry-After: 1800`) and HTTP-date forms are accepted;
- invalid, malformed, negative and non-finite values are ignored;
- a valid hint blocks the mirror immediately, even before the three-failure
  threshold;
- the default 10-minute cooldown remains the minimum once the threshold trips;
- a longer hint can extend an existing block, and a later shorter hint never
  shortens it;
- values are capped at 24 hours so a buggy or hostile header cannot pin a
  mirror indefinitely;
- map-specific 404s still do not count as provider failures.

This remains a **per-isolate** breaker. It is not a global/durable Cloudflare
breaker and makes no claim about cross-data-centre coordination.

## Files

- `worker/src/mirror-health.ts` — `parseRetryAfter`, `MAX_MIRROR_COOLDOWN_MS`,
  Retry-After-aware `recordFailure`
- `worker/src/mirrors.ts` — reads the header on failing responses
- `worker/test/mirror-health.test.ts` — parser, immediate block, extension,
  cap and real 429 fallback tests

## Verification

- 46 worker tests passed
- worker typecheck passed
- web/worker CI runs are authoritative for the full project

## Still open

- durable/global breaker across isolates and data centres
- production upstream verification against each real mirror’s current
  rate-limit headers
- load/security testing of the full Worker path
