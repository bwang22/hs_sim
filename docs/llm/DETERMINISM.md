# DETERMINISM.md

This document explains how determinism works (and fails) in this combat simulator, based on patterns in `all_ts_dump.txt`. It is both:

* a **how-to** (make runs reproducible for debugging/tests/replay), and
* a **spec** (what we mean by “deterministic” and what invariants must hold).

---

## 1) Why determinism matters here

This codebase has three properties that make determinism non-negotiable for serious debugging:

1. **Stochastic branching**: target selection and ordering sometimes use randomness.
2. **Mutation-heavy state**: entities are mutated in place; debugging depends on stable reproduction.
3. **Chained resolution**: deaths → deathrattles → spawns → attackImmediately can cause deep cascading.

Determinism enables:

* stable regression tests
* replay equivalence checks
* binary search of “first divergence” in event logs
* confidence that a fix actually fixes the same bug

---

## 2) Definitions: what “deterministic” means

### 2.1 Determinism of outcomes

Given:

* the same normalized input state
* the same RNG stream
* the same code version

…the simulator should produce:

* the same single combat outcome (win/tie/loss, damage)
* the same final board state (under a chosen projection)
* the same telemetry stream (thin events + checkpoints), modulo any intentionally non-deterministic logging

### 2.2 Determinism of distributions (Monte Carlo)

Monte Carlo aggregates should be deterministic **given the same RNG stream and iteration count**.
But note: the current system often patches RNG globally, so “RNG stream” means the exact sequence of `Math.random()` calls across the entire run.

### 2.3 Replay determinism

Replay determinism means:

* checkpoints are authoritative snapshots
* applying events from checkpoint A produces checkpoint B
* full run from start produces final snapshot

This is the foundation of bridge tests and full-run tests.

---

## 3) Current determinism strategy in this repo

### 3.1 The reality: `Math.random()` is used directly

Many engine modules and content files call `Math.random()` for:

* coin flips
* tie-breaks (who attacks first, equal board sizes)
* random target selection among valid candidates
* random ordering decisions (some SoC/deathrattle side ordering choices)

### 3.2 The stabilizer: patching `Math.random()` with a seeded PRNG

Tests use a seeded PRNG (Mulberry32) and patch `Math.random` so every call becomes deterministic.

Key places:

* `src/lib/rng.ts` defines Mulberry32 (seeded RNG)
* `test/full-game/seeded-runner.ts` patches randomness for deterministic runs
* `test/rng-smoke.ts` and `test/rng-patch-smoke.ts` validate the patch is stable

**Practical implication:** determinism today is achieved by “global RNG patching” rather than RNG injection.

---

## 4) Determinism boundaries (what must be fixed to make runs reproducible)

Determinism requires more than a seeded RNG. You need:

### 4.1 Stable input normalization

`buildFinalInput(...)` must normalize the same raw input into the same sim-ready state every time.

Common pitfalls:

* filling defaults based on object iteration order
* missing fields that are patched in inconsistently
* dependency on external data that changes (card DB version mismatch)

### 4.2 Stable entity identity allocation

Spawns get new `entityId`s from `SharedState.currentEntityId`, which is initialized to be higher than any existing entityId in the input.

If entity ID allocation differs, then:

* replay references break
* spawn ordering comparisons break
* debugging becomes confusing

**Invariant:** if the same combat path occurs, the same spawned entities should receive the same `entityId`s.

### 4.3 Stable list iteration order

This engine iterates heavily over:

* `board[]` arrays
* `hand[]` arrays
* `secrets[]`, `trinkets[]`, `heroPowers[]`
* lists of dead entities, spawned entities, candidate targets

Determinism assumes these sequences are stable.

**Avoid:** using `Object.keys()` on un-ordered objects to choose targets or ordering.

### 4.4 Stable “side ordering” rules

Several places choose “which side resolves first” via randomness (coin flips). Under seeded RNG this becomes deterministic, but it is still a key branching point.

Examples:

* start-of-combat ordering ambiguity
* deathrattle side ordering

If you later replace these with fixed ordering rules, you’ll change deterministic behavior and must update regression expectations.

---

## 5) Determinism failure modes (the usual suspects)

### 5.1 Unpatched randomness

Symptoms:

* seeded runs still differ
* replay diverges between runs

Causes:

* `Math.random` patch applied too late (after modules already executed)
* another randomness source exists (`crypto`, `Date.now`, unseeded RNG helper)

Fix:

* patch RNG at process start (seeded-runner does this)
* audit for other randomness sources

### 5.2 Time-based behavior

Any use of:

* `Date.now()`
* performance timers (outside the intended max duration stop)

will break determinism if it affects logic.

A known pattern in prior debugging: tests printing where `Date.now()` is called indicates nondeterministic behavior seeped in.

Fix:

* never use time inside combat logic
* keep time checks only in outer Monte Carlo loop (early stop)

### 5.3 Mutation bleed across iterations

If input is not properly cloned, one iteration can modify entities used by the next iteration.

Fix:

* ensure per-iteration cloning (`cloneInput3`) is used
* never reuse entity objects across iterations

### 5.4 Order drift due to non-canonical sorting

If you build lists like:

* “all dead entities”
* “all candidate targets”

and then iterate without a defined order, insertion order might differ across runs if upstream operations differ.

Fix:

* define canonical ordering when list order matters (entityId order, board position order, etc.)

### 5.5 Event log incompleteness (replay determinism failure)

Even if the sim is deterministic, replay may not be if:

* state changes aren’t emitted as `entity-upsert`
* spawn insert indexes are missing or wrong
* deaths are not emitted consistently

Fix:

* expand emission coverage or increase checkpoint frequency
* tighten replay reducer semantics

---

## 6) Determinism tiers (what you can realistically guarantee)

### Tier 0: “Same outcome distribution” (weak)

* With seeded RNG patching and stable iteration count, you get same aggregated result.
* But intermediate logs might differ if instrumentation changes.

### Tier 1: “Same single combat transcript” (useful)

* Same input + seed produces identical:

  * attack sequence
  * target selection
  * death/spawn ordering
  * final board state
* This is the level you want for most debugging.

### Tier 2: “Replay equivalence” (strong)

* Thin events + checkpoints reconstruct the same board projection at any `seq`.
* Bridge test and full-run test pass.

### Tier 3: “Deterministic-by-design RNG” (ideal future)

* No global patching needed.
* RNG is injected explicitly through engine and recorded as part of log headers or checkpoints.

---

## 7) How to run deterministically (practical recipes)

### 7.1 Use the seeded test runner

```bash
npm run test-seeded
```

### 7.2 Patch RNG in your own script

At the very top of your script (before importing simulation code if possible):

```ts
import { mulberry32 } from "../src/lib/rng";

const seed = 12345;
const rng = mulberry32(seed);

// patch global Math.random
(Math as any).random = rng;

// now import and run simulation...
```

Recommended:

* patch first
* import later
* run
* restore if your environment needs the original RNG afterward

### 7.3 Freeze the input

When debugging:

* log or serialize the normalized input after `buildFinalInput(...)`
* reuse that exact blob for repeats

This isolates bugs to combat logic, not input sanitation.

---

## 8) Determinism design rules (what to enforce in reviews)

### Rule 1: No new nondeterminism sources

* no `Date.now()`, `Math.random()` is okay but must be patchable
* no unordered object iteration for ordering logic
* no reliance on hash map ordering for target selection

### Rule 2: Any randomness must flow through the “RNG story”

Today that means:

* `Math.random()` is acceptable because it is patched by seeded runner
  Future:
* inject `rng()` in `FullGameState` or `SharedState`

### Rule 3: Deterministic identity assignment

* spawns must allocate `entityId`s via `sharedState.currentEntityId++`
* do not “reuse” entity IDs
* do not derive entity IDs from random sources

### Rule 4: Stable ordering for rule resolution

When selecting among multiple candidates, define ordering clearly:

* board position order when relevant
* entityId order for stable tie-breakers if needed

### Rule 5: Deterministic replay contracts

If you change a rule that affects:

* topology (spawns/deaths)
* visible state changes (stats/keywords)

ensure replay emission stays consistent:

* spawn/death events fire
* upserts or checkpoints capture state changes

---

## 9) Determinism tests (recommended)

### 9.1 Seeded single-run snapshot test

Given a fixed input and seed:

* run 1 simulation
* assert final sanitized board state matches a snapshot

### 9.2 Seeded transcript hash test

Given a fixed input and seed:

* run 1 simulation
* hash the thin event stream (seq/type/ids/damage)
* assert it matches a stored hash

This catches subtle ordering changes.

### 9.3 Bridge replay test (checkpoint equivalence)

* pick checkpoints A and B
* replay A→B via events
* compare reconstructed board projection to checkpoint B snapshot

### 9.4 Full replay test

* replay from earliest checkpoint to end
* compare to final snapshot

These last two are the “killer tests” for replay determinism.

---

## 10) Future improvements (optional roadmap)

If you want determinism to be less fragile and less dependent on global patching:

### 10.1 Inject RNG into `FullGameState`

Add `rng()` function to `FullGameState` or `SharedState`.
Replace internal `Math.random()` calls with `gameState.sharedState.rng()` or similar.

### 10.2 Record seed and draw count in logs

Add to combat log header / checkpoint:

* `seed`
* `drawCount`

Even if you don’t record every RNG draw, drawCount helps detect divergence early.

### 10.3 Reduce “coin flip ambiguity”

Replace randomness used to approximate unknown orderings with:

* explicit rules (e.g., always player first)
* or a configuration flag (strict vs approximate mode)

---

## 11) Quick checklist: when determinism breaks

1. Are you running under seeded runner?
2. Is `Math.random` patched before imports execute?
3. Any `Date.now()` used in logic?
4. Any object-key iteration used for ordering?
5. Is input normalized and cloned correctly?
6. Are spawn IDs allocated deterministically?
7. Are death/spawn events emitted consistently for replay?
