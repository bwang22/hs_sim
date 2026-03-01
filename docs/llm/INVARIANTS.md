# INVARIANTS.md

This document is the **“laws of physics”** for this Battlegrounds combat simulator, derived from the architecture and timing patterns in `all_ts_dump.txt`. If you violate these invariants, you’ll get bugs that look like:

* “minion died twice”
* “deathrattle order feels wrong”
* “replay diverges from sim”
* “infinite combat loop”
* “stats/keywords drift”
* “seeded run still changes”

Think of this as both:

* a **developer guide** (what not to break), and
* a **test spec** (what we should assert continuously).

---

## 0) Invariant levels

* **Hard invariants**: must always hold, otherwise correctness breaks.
* **Soft invariants**: generally true but may have deliberate exceptions (document them).
* **Debug invariants**: not required for game correctness, but required for observability/replay.

---

## 1) Identity and topology invariants (Hard)

### 1.1 Entity identity: `entityId` is unique within a combat

**Rule**

* No two live entities may share the same `entityId` at the same time.
* Spawned entities must receive fresh IDs (typically from `sharedState.currentEntityId++`).

**Why**

* Telemetry, replay, targeting references, and death lists rely on entityId uniqueness.

**Test idea**

* After every spawn and death batch, assert:

  * `set(allEntityIds).size === allEntityIds.length`

---

### 1.2 Ownership: `friendly` correctly indicates side

**Rule**

* Player-side entities: `friendly === true`
* Opponent-side entities: `friendly === false`

**Why**

* Replay uses `friendly` to choose which board to patch/insert into.
* Many helpers use it to route side-specific effects.

**Soft exception**

* Very early sanitation might temporarily omit it, but it must be correct by the time combat starts.

---

### 1.3 Board capacity never exceeds the limit

**Rule**

* Board size ≤ 7 (Battlegrounds rule) at all times.

**Why**

* Many spawns assume a full board cancels spawns instead of expanding capacity.
* Violating this breaks targeting adjacency, cleave logic, and spawn placement.

**Test idea**

* Assert `board.length <= 7` after any call to `addMinionToBoard` and after deathrattle spawn resolution.

---

### 1.4 Board order is meaningful and must be stable

**Rule**

* The array order of `BoardEntity[]` is the authoritative “left-to-right” order.
* Index-based logic (neighbors, cleave, spawn insertion) depends on it.

**Why**

* Many rule decisions reference “neighbors” or “leftmost/rightmost”.
* Spawn insertion uses “index from right” conversions.

**Soft exception**

* Some rare “shuffle board” effects may reorder explicitly, but must do so intentionally and deterministically.

---

## 2) Core combat semantic invariants (Hard)

### 2.1 Damage does not remove entities

**Rule**

* Damage reduces health and can mark flags, but does not remove minions from boards.

**Removal happens only in the death pipeline.**

**Why**

* Death batching is fundamental to BG ordering (deathrattles, avenge, reborn).
* Replay correctness assumes deletion is explained by explicit death events, not by a health reaching 0.

**Test idea**

* After damage application, allow entities with `health <= 0` to still exist until the death batch.

---

### 2.2 Only the death pipeline removes entities

**Rule**

* Entities disappear from boards only through the death processing functions (death batch).

**Why**

* Prevents “silent removals” that skip deathrattles, avenge, after-death hooks, and telemetry.
* Keeps engine and replay in sync.

**What violates it**

* `board.splice(...)` removing entities directly in card code or attack code.

---

### 2.3 Death processing reaches a fixed point

**Rule**

* The death pipeline must terminate: after enough iterations, no new deaths remain.

**Why**

* Deathrattle chains and reborn can spawn and kill recursively; the code handles this via recursion.
* Infinite loops indicate broken state transitions (e.g., repeated reborn, attackImmediately never cleared).

**Test idea**

* Track recursion depth or number of death batches; assert it stays below a reasonable threshold for seeded regression cases.

---

### 2.4 “Attack immediately” must be cleared after use

**Rule**

* If an entity spawns with `attackImmediately`, the engine must clear it after executing its immediate attack (or determining it can’t attack).

**Why**

* The simulator uses a “speed attacker” mode; stale `attackImmediately` leads to repeated forced attacks and infinite loops.

---

### 2.5 “Can attack” checks are the single source of truth

**Rule**

* Attacker selection and immediate attacks must use the same `canAttack(...)` / eligibility logic.

**Why**

* Otherwise you get contradictory behavior:

  * a minion attacks in one mode but is “not attack-capable” in another.

---

## 3) Timing and ordering invariants (Hard)

These govern “who fires first” and are the most common source of subtle bugs.

### 3.1 Attack-step ordering

**Rule**
Within one attack step, the intended order is:

1. attack declared (telemetry)
2. defender secrets + on-being-attacked hooks
3. attacker “whenever another minion attacks” hooks (trinkets, allies, enchantments)
4. rally triggers (attacker and rally enchantments)
5. combat damage exchange (including cleave)
6. after-attack minion effects
7. death batches + deathrattles + avenge + reborn closure
8. after-attack trinket effects
9. cleanup (`applyAfterStatsUpdate`)

**Why**

* Matches documented engine choreography.
* Keeps triggers consistent and predictable.

**Soft exception**

* Some content effects are implemented in “after attack” even though they feel like “after deaths”; this is a known subtlety but should be documented if changed.

---

### 3.2 Deathrattle ordering inside a death batch

**Rule**
For each dead entity:

1. its natural deathrattle (if any)
2. its deathrattle enchantments (if any)

Across entities:

* processed in a stable order (commonly left-to-right proxy)

Across sides:

* some parts choose side order via a coin flip; under seeded RNG this becomes deterministic.

**Why**

* Captures Battlegrounds semantics and is consistent across the engine.

---

### 3.3 Avenge triggers before reborn (as designed)

**Rule**
Within the death orchestration flow, Avenge is intended to resolve before Reborn.

**Why**

* This affects whether reborned minions contribute to or receive avenge progress.

---

### 3.4 Start-of-combat runs once per active board

**Rule**

* For a given hero board entering combat, SoC effects run once.
* In duos, if the board swaps to a teammate mid-combat, SoC for that teammate may run when they become active.

---

## 4) Mutation safety invariants (Hard)

### 4.1 Use controllers for stats

**Rule**

* Stat changes that should be “real” must go through stats helpers (`modifyStats`, etc).

**Why**

* Stats helpers maintain enchantments and notify `OnStatsChanged`.
* Direct mutation can bypass watchers and break other effects.

**Soft exception**

* Aura recalculations sometimes do direct stat sets by design. If so, keep it inside aura modules and document it.

---

### 4.2 Use keyword update helpers

**Rule**

* Keyword toggles must use `updateDivineShield`, `updateTaunt`, `updateReborn`, etc.

**Why**

* These helpers:

  * compute previous vs new values
  * fire OnXUpdated hooks
  * maintain extra bookkeeping flags

---

### 4.3 Use spawn/add-minion helpers for insertion

**Rule**

* All new entity insertions must route through spawn helpers (`performEntitySpawns`, `addMinionToBoard`).

**Why**

* These enforce board limit, aura application, spawn hooks, and telemetry placement.

---

### 4.4 Never store live mutable entities in logs

**Rule**

* Telemetry must sanitize entities before storing them.

**Why**

* Entities mutate after logging; keeping references makes historical logs “change in the past.”

---

## 5) Telemetry and replay invariants (Debug invariants, but critical for tooling)

### 5.1 Thin event stream is `seq`-ordered and monotonic

**Rule**

* Each emitted thin event increments `seq`.
* Events are applied in increasing `seq` order for replay.

---

### 5.2 Replay topology events are explicit

**Rule**

* `spawn` adds entities
* `minion-death` removes entities
* `damage` never removes entities
* `entity-upsert` patches visible state

**Why**

* Replay reducer depends on these semantics.

---

### 5.3 Checkpoints are authoritative snapshots

**Rule**
A checkpoint snapshot must match the actual combat state at its `seq`.

**Why**

* Replay seek and bridge tests assume checkpoint correctness.

---

### 5.4 If replay-visible state changes, it must be captured

**Rule**
If a state change affects replay-visible fields (sanitized stats/keywords), it must be captured by at least one of:

* an `entity-upsert`
* a subsequent checkpoint snapshot

**Why**

* Without it, replay drifts even when combat is correct.

---

## 6) Determinism invariants (Hard for tests, soft for production)

### 6.1 Seeded runs must not use time sources

**Rule**

* No combat logic may depend on `Date.now()` or other time sources.
* Time may be used only as an outer-loop safety stop (max duration), and should not affect the simulated outcome.

---

### 6.2 Randomness must be patchable

**Rule**

* All stochastic decisions must flow through a patchable RNG story.
* Today: `Math.random()` is acceptable because tests patch it.
* Avoid introducing new random sources that bypass patching.

---

### 6.3 Stable iteration order

**Rule**
Any random selection should operate on a list with stable ordering. Avoid basing randomness on unordered object key iteration.

---

## 7) API and compatibility invariants (Soft)

### 7.1 Input compatibility

**Rule**

* The simulator should accept both new and legacy fields:

  * `gameState.validTribes` preferred, `options.validTribes` deprecated
  * `player.secrets` preferred, `boardInfo.secrets` deprecated
  * `heroPowers[]` preferred, single hero power fields deprecated

**Why**

* Consumers may lag behind and still need to work.

---

### 7.2 Output stability

**Rule**

* `SimulationResult` must always have win/tie/loss counts and percents, plus damage ranges.
* Samples are optional and may be pruned.

---

## 8) “Invariant-first” debugging checklist

When you see a bug, ask:

1. Did an entity disappear without a death batch?
   → violates 2.2 / 5.2
2. Did a minion “attack forever” or speed attacker never ends?
   → violates 2.4
3. Did a keyword change not trigger expected behavior?
   → violates 4.2
4. Did stats drift or not trigger watchers?
   → violates 4.1
5. Does replay diverge from checkpoint?
   → violates 5.3 / 5.4
6. Do seeded runs differ?
   → violates 6.1 / 6.2 / 6.3

---

## 9) Recommended invariant assertions to add (high ROI)

If you want to turn invariants into guardrails, add assertions in these places:

* After `performEntitySpawns(...)`:

  * board size <= 7
  * unique entityIds
  * `attackImmediately` cleared after use
* After each death batch:

  * dead entities removed
  * no entity exists on both boards
* After each attack step:

  * no NaN stats
  * no negative maxHealth
* On checkpoint creation:

  * canonical hash computed (if you implement hashing)
* In seeded tests:

  * transcript hash stable
