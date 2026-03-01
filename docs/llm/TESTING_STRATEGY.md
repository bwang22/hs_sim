According to a document from an **undated snapshot** of `all_ts_dump.txt`, here’s a comprehensive **`TESTING_STRATEGY.md`** draft you can drop into `docs/llm/` (or your repo root) and iterate on. 🧬

---

# TESTING_STRATEGY.md

## 0) Why this exists

This repo is a combat simulator where **correctness is inseparable from determinism**. A “passing test suite” means:

* Same input + same seed → same results (and ideally same event log)
* Refactors don’t silently change outcomes
* Replay tooling (events + checkpoints) stays trustworthy as it evolves

You already have the ingredients:

* A seeded RNG (`mulberry32`) with deterministic smoke tests. 
* A “seeded runner” that patches `Math.random` before loading the full run. 
* A spectator event log + periodic checkpoints (and a reconstruction path). 
* Defensive normalization for legacy `actions` → `events` and `targetEntityId` → `targetEntityIds`. 

This document turns those into a **repeatable test pyramid**.

---

## 1) North-star invariants (what we must never regress)

### Determinism invariants

1. **RNG determinism**

   * `mulberry32(seed)` produces a stable known sequence (authoritative vector tests exist). 
   * Optional: `Math.random` can be patched process-wide to that seeded RNG (smoke test exists). 

2. **Order-of-operations determinism**

   * Any code path that uses `Math.random` must be “under seed” in tests. You already have combat-critical randomness like:

     * start-of-combat attacker selection (`Math.random() < 0.5`). 
     * attacker recomputation / tie-breakers (`Math.round(Math.random())`). 

3. **Replay determinism**

   * Given checkpoints + events sorted by `seq`, reconstructing state at `targetSeq` should be well-defined. 
   * Spectator events include sufficient “replay relevant” info (SanitizedEntity fields, spawn payloads). 

### Output compatibility invariants

4. **Spectator output schema stability**

   * Your output normalizer must keep old payloads readable by migrating `actions → events`, plus `targetEntityId → targetEntityIds`. 
   * You even strip `actions` defensively from multiple places. 

### Safety invariants

5. **Time budget**

   * Simulation stops if it exceeds `maxAcceptableDuration` (protects users from infinite boards/bugs). 

---

## 2) Test pyramid (what to test, where)

### Layer A: Micro unit tests (fast, pure, surgical)

**Goal:** Prove the smallest “physics constants” of the engine.

**Must-have:**

* `test/rng-smoke.ts`: Known vector outputs for seed 42; same-seed equivalence; different-seed divergence. 
* `test/rng-patch-smoke.ts`: Patching `Math.random` produces the seeded sequence. 

**Add next (recommended):**

* Utility determinism tests for any “shuffle/pickRandom” helpers (ensure they only depend on `Math.random`, not time or iteration order).
* “No Date.now” policy tests in hot paths (if applicable). (You already use `Date.now()` for duration checks; keep it out of logic decisions.)

---

### Layer B: Component tests (still fast, but stateful)

**Goal:** Validate a subsystem with minimal scaffolding.

Candidates:

* **Spectator schema normalization**

  * Given a sample payload containing `actions`, assert output contains `events` and removed `actions`.
  * Given events with `targetEntityId`, assert it migrates to `targetEntityIds`. 

* **Checkpoint cadence**

  * Assert the spectator’s checkpoint policy (ex: every N events) doesn’t crash and produces monotonic `seq`. Your constant is `CHECKPOINT_EVERY_N_EVENTS = 200`. 

---

### Layer C: Full integration (slowest, highest value)

**Goal:** “Run the whole machine,” seeded, with realistic data.

You already have this shape in `test/full-game/full-test.ts`:

* Load `game.json`, set options, init cards, patch RNG, run simulation, then inspect spectator telemetry. 

And a clean “seeded entrypoint” in `test/full-game/seeded-runner.ts`:

* Patch `Math.random`
* Import full-test after patch so everything is seeded. 

**Add next (recommended):**

* Make integration tests assert **something concrete**, not just print telemetry:

  * `events.length > 0`, `checkpoints.length > 0`
  * `first checkpoint seq <= last checkpoint seq`
  * “Schema checks” on a sample event (must include `seq`, `type`, `phase`) using the `SpectatorEvent` union. 

---

### Layer D: Replay equivalence tests (the “trust contract”)

**Goal:** Prove replay tooling is faithful.

You already have reconstruction code that:

* Chooses latest checkpoint at or before `targetSeq`
* Creates state from checkpoint
* Applies subsequent events in order via `applyEvent`. 

And replay state types that intentionally keep it **small and serializable**. 

**Recommended test suite:**

1. **Checkpoint seek test**

   * For a recorded sample: pick a `targetSeq`, reconstruct, and assert `state.seq == targetSeq`.

2. **Monotonicity test**

   * Reconstruct at `k`, then reconstruct at `k+1`, assert only allowed deltas occur (e.g., a single event’s effect).

3. **Snapshot consistency test**

   * For a checkpoint snapshot, ensure `playerBoard/opponentBoard` are present and use the SanitizedEntity field-set. 

> Note: you have comments indicating future `stateHash` / RNG cursor support in checkpoints. When you add those, replay tests should immediately start asserting them. 

---

## 3) Debugging hooks that should be test-aware

### Forced face-offs and deterministic reproduction

There’s a `debugState` that supports:

* forcing current attacker
* forcing specific attacker/defender matchups (“forcedFaceOff”) and resetting on battle start 

**Testing strategy:**

* Keep `debugState.active = false` by default in automated runs.
* Add a dedicated “repro harness” test that can load a failing seed and enable forced face-offs to stabilize reproduction.

---

## 4) Performance and stability tests

### Time budget (non-flaky)

The simulator has an explicit “stop if too slow” safety valve. 

**Testing strategy:**

* One test where `maxAcceptableDuration` is intentionally tiny and you assert it stops early.
* One “budget sanity” test where a known scenario completes under a typical budget.

> Keep these assertions coarse (e.g., “did not exceed X seconds”) to avoid CI variance.

---

## 5) What to run locally (and in CI)

### Local quick loop

* Run RNG suite first (instant signal):

  * `test/rng-smoke.ts`
  * `test/rng-patch-smoke.ts` 

* Then run full seeded integration:

  * `test/full-game/seeded-runner.ts` (patches RNG then imports the full run) 

### CI gating (suggested)

Minimum gate:

1. RNG unit tests
2. 1 seeded full-run integration test
3. 1 replay reconstruction test (at least one `targetSeq`)

Optional nightly:

* A small battery of seeds (e.g., 10 seeds) to catch accidental nondeterminism.

---

## 6) Adding a new test case (workflow)

When you fix a bug or add a mechanic:

1. **Capture**

   * Save minimal input (`game.json` style)
   * Record the seed used
   * If possible, store a single outcome sample with `events` + `checkpoints`

2. **Assert**

   * Decide the smallest “observable truth”:

     * final outcome (won/lost/tied)
     * a specific event must happen
     * replay reconstruction at `seq=k` yields expected board snapshot

3. **Lock determinism**

   * Ensure the test runs under seeded `Math.random` (use the seeded runner pattern). 

4. **Keep it small**

   * Prefer checking a handful of high-signal fields (e.g., entity IDs, attack/health) over massive deep-equals dumps.

---

## 7) Known evolving areas (mark as TODOs in your test backlog)

* **State hash** on checkpoints for fast equivalence checks (commented as future). 
* **RNG cursor/streams** for replay resume (design sketches exist in the codebase). 
* **Phase boundary events** as explicit replay anchors, enabling cleaner “bridge” tests. 

---

## 8) Failure triage playbook (fast diagnosis)

If a deterministic test fails:

1. **Confirm seed discipline**

   * Did `Math.random` get patched before importing the engine entrypoint? 

2. **Check for new randomness**

   * Search for new `Math.random()` usage in logic (SOC selection, attacker recompute, etc.). 

3. **Inspect spectator telemetry**

   * Compare event counts and the first/last event shapes to see where divergence begins (your full-test already prints this). 

4. **Bisect with replay**

   * Pick a `targetSeq` near divergence and reconstruct state using the nearest checkpoint. 

---

## 9) Open decisions (fill these in)

* What is your “golden” assertion target for CI?

  * A) final board state
  * B) spectator event stream (stronger)
  * C) both

* How many seeds should the nightly battery run?

* Should the replay test enforce strict event-by-event equivalence, or tolerate “cosmetic” differences?
