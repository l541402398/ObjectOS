# ADR-0064 — Heartbeat tolerance, and the runtime stall it exposed

- Status: Accepted (heartbeat change); the underlying stall is **OPEN**
- Related: ADR-0059/0060 (evidence retry, idempotent start), delivery attempts 6–8

## Context

Three real delivery attempts were interrupted with `Runtime 进程已退出`. The desktop log shows the exact
chain:

```
runtime heartbeat slow; extending grace {"missed":1,"pendingRequests":27}
runtime heartbeat slow; extending grace {"missed":1,"pendingRequests":56}
runtime heartbeat missed twice; restarting {"missed":2,"pendingRequests":39}
killing runtime {"reason":"heartbeat timeout"}
```

Before this ADR a single missed pong (12s) killed the runtime. That is too aggressive: any short burst of
synchronous work restarts the runtime mid-run. The window was moved offscreen for attempt 8, so "the user
closed it" is ruled out.

## Decision (shipped)

1. A missed pong no longer restarts immediately. `shouldRestartOnMissedPong({missed, pendingRequests})`
   tolerates the first miss (logging `heartbeat slow; extending grace` with the in-flight count) and only
   restarts after **two consecutive** misses.
2. Counters reset on pong, (re)start and exit; both kill and grace paths log the miss count and pending
   requests so the next investigation has data.
3. Unit test `tests/p29-runtime-heartbeat.test.ts` pins the policy.

## Open problem (not fixed, not hidden)

The same log proves the runtime **event loop is blocked for ~30s or more** while agent runs complete:
pending requests grew 27 → 56 while no pong was processed. The supervisor restart is a *symptom*; the
blocking work is the defect. A dedicated performance investigation is required (profile the runtime around
`agent run finished` / completion evidence collection, look for synchronous git/sqlite/hash work on the
main loop). Until that is fixed, `deliveryStatus=verified` remains unproven: every attempt so far was cut
short by this stall, not by business-gate logic.

## Consequences

- Short stalls (≤ ~27s) no longer kill a healthy runtime; real hangs still restart it after two misses.
- The delivery claim stays open and is recorded as OPEN in the evidence file.
