````md
# TESTING.md
How to test this combat simulator so it stays **correct, deterministic, and replayable** 🔬🎲

This repo’s tests are mostly **script-style TypeScript files** (run via `ts-node` or an equivalent runner). The tests fall into three big buckets:
1) **RNG determinism smoke** (unit-level)
2) **Full-game seeded integration** (end-to-end)
3) **Replay tooling** (events + checkpoints → reconstructed state)

This document is grounded in what exists in `all_ts_dump.txt` (not a wish list), and then adds a minimal set of conventions so the suite scales.

---

## 1) Principles (what “passing” should mean)

### 1.1 Determinism is a first-class correctness signal
A combat engine can be “correct” on one run and wrong on the next if nondeterminism creeps in. Your current approach is:
- Use a deterministic PRNG (`mulberry32`)
- Patch `Math.random` in tests so all combat randomness is seeded

You have explicit smoke tests proving both of these work.

### 1.2 Replay is how you debug, not just how you show animations
You already store:
- **thin events** (`events`)
- **fat snapshots** (`checkpoints`)

And you have a reducer-style replayer that can rebuild state from a checkpoint and apply events forward.

So testing should treat replay as a contract:
- “Can I reconstruct to seq N?”
- “Does replay behave monotonically and sanely?”
- “Do event schemas stay compatible?”

---

## 2) Test layout (what exists today)

### RNG smoke tests
- `test/rng-smoke.ts`
  - Validates mulberry32 output for seed 42 (first 10 u32 values)
  - Confirms same-seed streams match and different seeds diverge
- `test/rng-patch-smoke.ts`
  - Patches `Math.random` and asserts it matches a mulberry32 stream step-for-step

### Full-game harness
- `test/full-game/full-test.ts`
  - Loads `test/full-game/game.json`
  - Loads card DB JSON `test/full-game/cards_enUS.json` via `AllCardsLocalService`
  - Calls the Lambda-style entry `runSimulation({ body: JSON.stringify(input) })`
  - Enables `includeOutcomeSamples: true` and prints spectator telemetry
  - Writes a JSON string to `base64.txt` (despite the name, it is JSON in the file)
  - Contains a local replay stepper (but see “Gotchas” below)

- `test/full-game/seeded-runner.ts`
  - Patches `Math.random = mulberry32(42)` **before importing** `./full-test`
  - Restores Math.random afterward (optional)

- `test/full-game/apply-debug-state.ts`
  - Turns on `debugState.active`
  - Forces `forcedCurrentAttacker` and a small `forcedFaceOffBase` list

### Replay tooling
- `test/full-game/replay-base64.ts`
  - Reads `base64.txt` and finds `{events, checkpoints}`
  - Picks the latest checkpoint `<= targetSeq`
  - Replays forward with `replayToSeq(...)`
  - Optional `--trace=1` prints per-event boards to a file

### “Copies”
- `test/full-game/full-test copy.ts`
- `test/full-game/full-test copy 2.ts`
These look like experimental forks. Treat them as scratchpads, not CI sources of truth.

---

## 3) How to run tests (practical commands)

These are script-style TS tests. Common patterns:

### 3.1 RNG smoke
```bash
npx ts-node test/rng-smoke.ts
npx ts-node test/rng-patch-smoke.ts
````

### 3.2 Seeded full-game run (recommended entrypoint)

Use the seeded runner so patching happens before any import-time RNG calls:

```bash
npx ts-node test/full-game/seeded-runner.ts
```

### 3.3 Replay a captured sample

First generate `base64.txt` (from full-test). Then:

```bash
# replay full log
npx ts-node test/full-game/replay-base64.ts

# replay to a specific seq
npx ts-node test/full-game/replay-base64.ts --seq=200

# trace every event step into a file
npx ts-node test/full-game/replay-base64.ts --seq=200 --trace=1 --out=replay_verbose.txt
```

---

## 4) Determinism rules (the stuff that keeps you sane)

### 4.1 Seed discipline

* Default seed used in tests is `42`
* Patch `Math.random` before importing combat entrypoints (seeded-runner already does this)

Why the “import after patch” pattern matters:

* If any module executes randomness at import time, patching inside the test function is too late.
* `test/full-game/seeded-runner.ts` explicitly imports `./full-test` only after patching.

### 4.2 “Accidental RNG consumption” is the silent killer

Even if everything stays deterministic, adding one new `Math.random()` earlier in the pipeline shifts the entire universe. That is why the best high-signal integration tests usually assert:

* Event log shape + counts
* A small set of key sentinel events
* Or a stable hash (if you add hashing later)

---

## 5) Full-game integration test harness (what it actually does)

### Inputs and fixtures

`test/full-game/full-test.ts` expects:

* `test/full-game/game.json` (battle input fixture)
* `test/full-game/cards_enUS.json` (reference card DB for `AllCardsLocalService`)

It forces:

* `numberOfSimulations: 1`
* `includeOutcomeSamples: true`
* `maxAcceptableDuration: 5000`

So it is explicitly “one deterministic battle run with spectator output enabled”.

### Output shape gotcha

`runSimulation(...)` returns a Lambda-like object with `body`, which might be:

* a JSON string, or
* an already-parsed object

The test handles both.

### Legacy field cleanup

Full-test deletes `actions` from:

* top-level
* per-sample

This aligns with the production normalizer in `src/simulate-bgs-battle.ts` that:

* converts `actions -> events` when needed
* migrates `targetEntityId -> targetEntityIds` inside events

Testing implication:

* Prefer asserting against `events` + `checkpoints`
* Treat `actions` as legacy and potentially verbose/noisy

---

## 6) Replay tests (how to trust events + checkpoints)

### What exists today

You have a reducer-driven replay engine:

* Initialize from checkpoint snapshot
* Apply events in order
* Optionally trace each step

`test/full-game/replay-base64.ts` already demonstrates the intended workflow:

1. pick target sequence
2. choose nearest checkpoint at or before that sequence
3. replay forward

### What you should assert (minimal but powerful)

Add these as “real assertions” (not only logs):

**A) Checkpoint selection sanity**

* Must find at least one checkpoint
* Picked checkpoint `seq <= targetSeq`

**B) Replay monotonicity**

* After each applied event, `state.seq === event.seq`

**C) Board schema sanity**

* Entities in replay state conform to the sanitized subset (attack/health/keywords)
* No undefined entityId/cardId

**D) Boundary coverage**

* Ensure you see at least one event in each phase across a “rich” fixture:

  * `START_OF_COMBAT`, `ATTACK`, `DEATHS`, `END_OF_COMBAT`

---

## 7) What to test next (high ROI additions)

### 7.1 Contract tests for spectator output normalization

Production already normalizes samples:

* `actions -> events`
* `targetEntityId -> targetEntityIds`

Add a focused test that feeds a legacy-shaped sample into `normalizeOutcomeSamplesToEvents(...)` (in `src/simulate-bgs-battle.ts`) and asserts the migrated shape.

### 7.2 “Golden” seeded integration assertions

Right now full-test prints and writes files. Add one assertion target:

* Option 1: **event stream equality** (strongest)
* Option 2: **final replay snapshot equality** (simpler)
* Option 3: **both** (best, but heavier)

Start small:

* Assert first event is `start-of-combat`
* Assert there is at least one checkpoint
* Assert last event is either hero damage or battle end marker (depending on your fixture)

### 7.3 Bridge test (checkpoint equivalence)

You already have the pieces to do:

* start from checkpoint A snapshot
* apply events until checkpoint B
* compare reconstructed snapshot against checkpoint B snapshot (or compare stable fields)

This is the fastest path to “replay is trustworthy”.

### 7.4 Smoke test for sample caps

`spectator-types.ts` sets `MAX_SAMPLES = 1` and `CHECKPOINT_EVERY_N_EVENTS = 200`.
Add a test that runs multiple battles and asserts you never exceed the cap and that pruning happens.

---

## 8) Debug harnesses (how to reproduce tricky bugs)

### debugState

`test/full-game/apply-debug-state.ts` shows how to force:

* current attacker
* specific face-offs (attacker vs defender entity IDs)

Use this pattern when:

* a bug only appears in one branch of targeting
* you want to “pin” combat to a sequence of face-offs while debugging

Rule:

* Keep `debugState.active = false` by default in CI.
* Enable it only inside explicit repro tests or local harnesses.

---

## 9) Common failure modes and how to triage

### “Seeded test changed output after refactor”

Likely cause: an extra RNG call changed the sequence consumption.
Fix approach:

* Use replay trace to find first divergent event
* If divergence is “harmless” (log-only), decide whether your golden assertion should be looser or whether you should log semantic RNG decisions explicitly

### “Replay fails because no checkpoints”

Root cause: spectator might not have enough context to snapshot at that time, or samples not enabled.
Check:

* `includeOutcomeSamples: true`
* checkpoints exist and are attached to the sample

### “Full-test cannot find apply-event module”

In the dump, the replay reducer lives at `src/simulation/replay/apply-event.ts`.
If any test imports from a different path, align imports to the replay module that actually exists.

### “No samples found”

Spectator sampling is gated by `includeOutcomeSamples`.
Also sample caps are small (`MAX_SAMPLES = 1`), so don’t expect many.

---

## 10) Conventions for adding new tests (keep it scalable)

### Naming

* `rng-*` for pure RNG behaviors
* `full-game/*` for end-to-end harnesses
* `replay-*` for event/checkpoint reducers and reconstruction

### Fixtures

* Keep fixtures minimal
* Prefer a single “rich” `game.json` that exercises SOC + attack + deaths + hero damage

### Assertions

* Favor small, stable, high-signal assertions:

  * event counts
  * phase boundaries
  * specific sentinel entity ids/stats
  * replay seq monotonicity

### Avoid flakiness

* Do not assert on performance timings
* Do not assert on console output text
* Seed everything

---

## 11) Suggested CI gate (minimum viable)

If you want a tight CI signal without a huge runtime:

1. `test/rng-smoke.ts`
2. `test/rng-patch-smoke.ts`
3. `test/full-game/seeded-runner.ts` (with a couple of real assertions added)
4. One replay test that replays to a mid-seq and asserts monotonicity

