According to a document (date not provided in the dump), here’s a **comprehensive `VALIDATION_GATES.md`** that matches what your codebase is already doing (and cleanly names the missing “next gates” you’re clearly building toward). Source dump: 

---

# VALIDATION_GATES.md

## What this document is

This repo is a combat simulator that’s trying to become *provably replayable*.

So “validation gates” are the bouncers at every doorway:

* **Input gate**: reject malformed or incomplete requests.
* **Runtime gate**: stop infinite or runaway simulations.
* **Determinism gate**: make randomness controllable and testable.
* **Telemetry gate**: ensure logs are replay-relevant.
* **Replay gate**: guarantee a replayed state matches a snapshotted state.

The code already contains several of these gates (hard and soft), plus scaffolding for more.

---

## Gate severity levels

### HARD_FAIL (stop the world)

Use when continuing would produce meaningless output or corrupt invariants.

* Example: missing request body in the Lambda wrapper causes an early return. 
* Example: reference card DB is empty, simulation cannot proceed. 

### SOFT_FAIL (stop this simulation run, return partial)

Use when the run is “probably broken or infinite”, but the caller can still get partial results.

* Example: the main simulation loop stops if duration exceeds `maxAcceptableDuration`, with an explicit warning that this can happen for infinite boards or a bug. 

### WARN_ONLY (flag, continue)

Use when results may be suspicious but still potentially valid.

* Example: sanity warnings on average damage relative to tavern tier. 

### NORMALIZE (convert legacy or messy data into canonical form)

Use when you want to accept older formats but “upgrade in place.”

* Example: outcome samples are defensively normalized from legacy `actions` to `events`, and deprecated `targetEntityId` is migrated to `targetEntityIds`. 

### AUDIT (record for later, do not block)

Use when you need observability to diagnose issues (especially determinism/replay).

* Example: tests print spectator telemetry, including event count and checkpoint reasons. 

---

## Where the gates live today (and what they enforce)

### 1) Request / entry gates (API boundary)

**Gate: “Do we even have an input?”**

* `simulate-bgs-battle.ts` (Lambda wrapper) checks `lambdaEvent.body?.length`, warns, then returns. 

**Recommended expansion**

* Parse guard: catch JSON parse failures and return a structured error (today it assumes parse success). (Recommend, not observed in snippet.)

---

### 2) Dependency gates (cards DB, core prerequisites)

**Gate: “Can we simulate without reference data?”**

* If `cards.getCards()` is empty, log error and return `null`. 

**Why it matters**
Everything else (tribes, tech levels, pools, mechanics) depends on reference cards. If they’re empty, every downstream “random pick from pool” becomes garbage.

---

### 3) Runtime budget gates (infinite loops, runaway boards)

**Gate: “Stop hogging the user’s computer.”**

* In the core simulation loop, if `Date.now() - start > maxAcceptableDuration` and warnings aren’t disabled, log a warning and `break`. 

**Configuration surface**

* `maxAcceptableDuration` and `hideMaxSimulationDurationWarning` are read from `battleInput.options`. 

**This is a key design choice**
You’ve chosen a “SOFT_FAIL with partial results” model rather than hard failing. That’s good for production UX, but it implies you need **validation gates on the output** so callers know results are partial (recommend adding a `wasCutShort: true` flag).

---

### 4) Output normalization gates (shape contracts)

**Gate: “No matter what Spectator emits, return canonical output.”**

* Output samples are normalized to event-based format:

  * prefer `events` over legacy `actions`
  * migrate `targetEntityId` to `targetEntityIds` inside each event
  * intentionally defensive so it works whether spectator emits events or actions 

**Related helper**

* There’s logic that collapses consecutive `power-target` actions with same source into one, preserving updated board/hand/secret/trinket snapshots. This reduces log spam without losing meaning. 

---

### 5) Telemetry correctness gates (Spectator: events + checkpoints)

This is where your replay ambitions become concrete.

#### 5.1 Monotonic sequence gate

* Combat log defines `CombatSeq` as a monotonic sequence number; every event and checkpoint is anchored to a `seq`. 

This is the backbone: if `seq` is not monotonic and stable, you cannot do “replay to seq N”.

#### 5.2 Checkpoint cadence gate (safety valve)

* There’s an explicit safety valve: auto checkpoint every `CHECKPOINT_EVERY_N_EVENTS = 200`. 

This is a pragmatic gate against “log too large to replay from zero every time”.

#### 5.3 Checkpoint API gate

* `Spectator.checkpointNow(reason)` exists so the simulator can checkpoint at phase boundaries (`SOC_END`, `ATTACK_END`, `DEATH_BATCH_END`, etc.). It uses “last known context” to build a snapshot. 

This gate is critical: it’s how you move from “pretty log” to “replayable log”.

#### 5.4 Replay-relevant sanitation gate

To make replay feasible, you sanitize entities down to a minimal-but-sufficient set.

* `sanitizeBoard` maps each entity to a replay-relevant subset (entityId/cardId/friendly plus stats and key keywords like taunt, divine shield, poisonous/venomous, reborn, windfury, stealth). 
* `sanitizeTrinkets` similarly reduces trinkets to a small stable subset. 
* Your `SanitizedEntity` type explicitly defines what “replay-relevant” means. 

#### 5.5 Spawn event completeness gate

Spawn events now include full sanitized stats so `apply-event` can reconstruct reliably, and optionally include insertion indexes to preserve board position. 

This is the kind of subtle validation gate that prevents “replay drift”.

---

### 6) Determinism gates (RNG, ordering, tie-breaks)

#### 6.1 RNG patch gate (tests)

You have explicit tests that:

* patch `Math.random` to `mulberry32(seed)`
* assert the patched random stream matches an independent `mulberry32(seed)` instance
* verify expected outputs for seed 42, plus same-seed equality and different-seed divergence 

You also have a runner that patches Math.random before importing the full test to ensure everything uses seeded randomness. 

#### 6.2 RNG usage reality check (engine)

The simulator still uses `Math.random()` directly in core logic for ordering decisions:

* e.g., which side processes death-related effects first. 
* e.g., start-of-combat logic selecting attacker with `Math.round(Math.random())` in a tie. 

This is fine only if:

1. Math.random is always seeded for deterministic modes, and
2. the number of RNG pulls is stable under replay.

#### 6.3 RNG event logging (optional future gate)

There’s already a spec for optionally recording RNG consumption as an event, only needed if you cannot restore RNG state via checkpoints. 

That’s a clean “escape hatch” gate: if RNG state cannot be reconstructed, log RNG pulls explicitly.

---

### 7) Replay gates (the “proof you didn’t hallucinate combat”)

You have tooling that can “replay to a seq” and dump a verbose trace showing event payload and boards at each step. 

This is the seed of two high-value gates:

#### Gate A: Checkpoint equivalence (“Bridge test”)

* Start from checkpoint at seq A.
* Apply events A+1..B.
* Compare to checkpoint at seq B (or reconstructed snapshot).

You’ve already shaped your telemetry to make this possible:

* monotonic `seq` 
* checkpoint reasons and snapshot API 
* sanitized entity payloads for reconstruction 

#### Gate B: Full replay equivalence (“From zero”)

* Start from initial state.
* Apply every event.
* Final state must match the engine’s final board.

Your current gates reduce drift, but full replay equivalence usually also needs:

* stable entityId creation
* stable RNG state or explicit RNG events
* stable ordering of simultaneous triggers (deathrattles, avenge, etc.)

---

## Proposed “Gate Checklist” for CI (aligned to what exists)

### Required on every PR

1. **Typecheck + build** (implied by TS project, not cited here).
2. **RNG smoke tests**

   * `test/rng-patch-smoke.ts` and `test/rng-smoke.ts` validate seeded RNG and expected outputs. 
3. **Seeded full test runner**

   * Patch Math.random then run full-test import. 
4. **Runtime budget guard doesn’t regress**

   * Ensure maxAcceptableDuration gate still breaks runaway runs. 

### Recommended nightly

5. **Replay trace spot checks**

   * Use replay-to-seq tooling and compare snapshots at multiple checkpoints. 
6. **Checkpoint cadence invariants**

   * Ensure checkpoints appear at boundaries and/or every N events. 

---

## Practical guidance: how to add a new validation gate (house style)

When adding a gate, write down:

1. **Trigger condition**: what exact bad thing you detect
2. **Severity**: HARD_FAIL, SOFT_FAIL, WARN_ONLY, NORMALIZE, AUDIT
3. **Message**: actionable, includes enough context to debug
4. **Recovery**: what happens next (return null, break loop, continue, normalize)
5. **Test**: at least one deterministic test that proves the gate fires (or doesn’t)

You’re already doing this pattern in a few places:

* warn and return on missing body 
* error and return null on missing cards 
* warn and break on duration cap 
* normalize output samples defensively 

---

## “Next gates” you’re set up to implement (but not fully enforced yet)

### 1) Replay integrity hash gate (recommended)

Your checkpoint type hints at future `stateHash` and “rng cursor” style fields. 

Add:

* `stateHash` (hash of canonicalized state)
* `rngCursor` (count of RNG pulls, or RNG state)

Then gate:

* replayed state hash must match checkpoint hash at the same seq.

### 2) RNG consumption stability gate (recommended)

If replay drift happens due to changing RNG pull count, you have two options:

* store RNG state/cursor in checkpoints, or
* emit RNG events (you already have the event interface idea). 

### 3) Event completeness gate (recommended)

You’ve made spawn events “reconstruct reliably” by including sanitized stats. 

Extend similarly for other drift-prone areas:

* entity-upsert events already exist in spectator types 
* ensure every stat or keyword mutation that affects future rules is either:

  * derivable from deterministic rules, or
  * captured in `entity-upsert` / equivalent events.
