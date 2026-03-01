# REPLAY_SPEC.md

A spec for the **combat replay system** in this codebase: how we record a battle as an event stream + checkpoints, how we reconstruct state at any point, what invariants must hold, and how to validate replay correctness.

This is grounded in the implementation patterns present in `all_ts_dump.txt`, including:

* `src/simulation/spectator/*` (recording)
* `src/simulation/replay/*` (reconstruction)
* `src/simulation/spectator/game-action.ts` (fat snapshot actions)

---

## 1) Scope and goals

### 1.1 What “replay” means here

Replay is the ability to reconstruct a **viewer-grade combat state** over time, for debugging, validation, or UI playback.

This system is **not** a full re-simulation engine. It should never need to run combat logic to replay.

### 1.2 Primary goals

1. **Seek** quickly to any sequence point (`seq`) using checkpoints.
2. **Replay** forward deterministically using a thin event stream.
3. **Debug** with human-friendly snapshots and context (fat actions).
4. **Validate** determinism with robust tests (checkpoint equivalence, full-run equivalence).

### 1.3 Non-goals (current)

* Perfectly capturing every internal field of `BoardEntity` (we use a sanitized subset).
* Recording RNG pulls explicitly (not yet canonical in current implementation).
* Guaranteeing that the thin stream alone is complete without checkpoints (today it is “best effort”, trending toward completeness).

---

## 2) Core artifacts

There are two parallel logging products.

### 2.1 Thin replay log (canonical for reconstruction)

* Type: `SpectatorEvent[]`
* Properties:

  * Minimal payload
  * `seq` anchored ordering
  * Includes explicit topology events: `spawn`, `minion-death`
  * Includes patch-style state sync: `entity-upsert`
* Used by:

  * `replay/apply-event.ts` and reconstruction helpers

### 2.2 Fat snapshot actions (canonical for debugging)

* Type: `GameAction[]` (alias of `GameEvent`)
* Properties:

  * Heavy payload with full `GameEventContext`
  * Stores full-ish boards/hands/secrets/trinkets, etc at each event
  * Great for humans and audits
* Used by:

  * Outcome samples
  * Checkpoint snapshots (as a container)

### 2.3 Checkpoints (bridge between both)

* Type: `SpectatorCheckpoint[]`
* Properties:

  * Anchored to a `seq`
  * Stores a **fat action snapshot** as the authoritative state
* Used by:

  * Fast seeking and bounded replay

---

## 3) Identity model and sanitization

### 3.1 Stable identity: `entityId`

Replay correlates everything by `entityId`. This is the stable handle across:

* attack declarations
* damage events
* upserts
* deaths
* spawns

**Rule:** Within one combat, an `entityId` must never refer to two different entities at the same time.

### 3.2 Side ownership: `friendly`

Replay decides which board an entity belongs to using `friendly`:

* `true` -> player board
* `false` -> opponent board

**Rule:** Every sanitized entity payload must include `friendly`.

### 3.3 Sanitized entity subset

Thin log uses `SanitizedEntity` rather than `BoardEntity` to avoid mutation hazards and keep payload small.

Recommended sanitized fields (current baseline):

* identity: `entityId`, `cardId`, `friendly`
* stats: `attack`, `health`, `maxHealth`
* keywords: `taunt`, `divineShield`, `poisonous`, `venomous`, `reborn`, `windfury`, `stealth`

**Rule:** Replay must not depend on non-sanitized fields.

---

## 4) Sequencing model

### 4.1 `seq` (sequence number)

Every thin event has:

* `seq: number`, monotonically increasing by 1

The spectator owns `seq` generation and assigns it at emission time.

### 4.2 Coarse phases

Thin events carry a `phase` in:

* `START_OF_COMBAT`
* `ATTACK`
* `DEATHS`
* `END_OF_COMBAT`

**Rule:** `phase` is descriptive. Ordering is defined by `seq`.

---

## 5) Event schema (thin stream)

### 5.1 Event types (canonical set)

The thin stream is a union of:

* `start-of-combat`
* `attack`
* `damage`
* `power-target`
* `entity-upsert`
* `spawn`
* `minion-death`
* `player-attack` (hero damage to opponent)
* `opponent-attack` (hero damage to player)

### 5.2 Meaning and constraints

#### `start-of-combat`

Boundary marker. Does not carry boards.

Constraints:

* Should occur before the first `attack` of a combat segment.
* Replay uses this to reset per-step viewer helpers (like last attack markers).

#### `attack`

Declares attacker and defender.

Constraints:

* Must precede the damage it implies.
* Should be emitted even if the attacker does no damage (so the viewer can show declared targeting).

#### `damage`

Represents damage applied to a minion, with:

* `targetEntityId`
* `damage` amount
* optional `sourceEntityId`
* `kind: 'combat' | 'effect'`
* `phase: 'ATTACK' | 'DEATHS'`

Constraints:

* Damage updates `health`, but never removes entities.
* If an entity reaches 0 health, it still remains until a subsequent `minion-death`.

#### `power-target`

Records target selection.

Constraints:

* This event does not guarantee a state change.
* If a state change happened, it should be followed by `entity-upsert` for affected entities (or a checkpoint soon after).

#### `entity-upsert`

Patch or insert of one sanitized entity.

Constraints:

* Must include `friendly`.
* Merge semantics, not replace semantics (unless you explicitly define replacement).

#### `spawn`

Adds entities to boards.

Constraints:

* Payload includes a list of `spawned` sanitized entities.
* Optional `insertIndexes[]` indicates where each spawn landed.
* This is a topology change but not a removal.

#### `minion-death`

Removes entities from boards.

Constraints:

* This is the only removal mechanism for replay state.
* Must list all `deadEntityIds` removed in this batch.
* Optional `deadMinionsPositionsOnBoard` is a viewer hint.

#### `player-attack` / `opponent-attack`

Hero damage summary.

Constraints:

* Emitted at `END_OF_COMBAT`.
* Replay records end damage separately and does not attempt to apply it to hp totals unless the viewer wants hp accounting.

---

## 6) Checkpoint schema and semantics

### 6.1 Schema

A checkpoint is:

* `seq: number`
* `reason: CheckpointReason`
* `snapshot: GameAction` (fat snapshot)

Checkpoint reasons include:

* `SOC_START`, `SOC_END`, `ATTACK_END`, `DEATH_BATCH_END`, `EVERY_N`, `MANUAL`

### 6.2 What a checkpoint snapshot must contain

At minimum, a checkpoint snapshot must include:

* player board snapshot (sanitized or full `BoardEntity`, but consistent)
* opponent board snapshot
* ideally, hands, secrets, trinkets for UI context (fat actions already carry these)

### 6.3 Checkpoint frequency

Current system uses:

* a cadence-based checkpoint every N events (`EVERY_N`)
* optional manual checkpoints (API exists, wiring may be partial)

**Rule:** Checkpoints are a performance tool, not a correctness tool. Correctness still depends on event semantics.

---

## 7) Replay state model (what we reconstruct)

A minimal replay state should include:

* `seq` (current position)
* `playerBoard: SanitizedEntity[]`
* `opponentBoard: SanitizedEntity[]`
* optional viewer helpers:

  * `lastAttack?: { attackerEntityId, defenderEntityId }`
  * `lastPowerTarget?: { sourceEntityId, targetEntityIds }`
  * `endDamage?: { toPlayer?: number, toOpponent?: number }`

**Rule:** Replay state is a projection for viewing and validation, not the full simulation state.

---

## 8) Reconstruction algorithm

### 8.1 Core function: `reconstructAt(targetSeq)`

Inputs:

* `checkpoints: SpectatorCheckpoint[]`
* `events: SpectatorEvent[]`
* `targetSeq: number`

Algorithm:

1. Find `cp = latest checkpoint with cp.seq <= targetSeq`
2. Initialize state from `cp.snapshot`:

   * load `playerBoard` and `opponentBoard`
   * set `state.seq = cp.seq`
3. Apply events in increasing `seq` where `cp.seq < event.seq <= targetSeq`:

   * `state = applyEvent(state, event)`
4. Return `state`

### 8.2 Complexity

* Seek: O(#checkpoints) unless indexed (recommended to index by seq)
* Replay: O(#events between cp.seq and targetSeq)

### 8.3 Recommended indexing

For performance in a UI:

* index checkpoints by `seq` in an array
* binary search for nearest checkpoint
* store events in an array already sorted by `seq`

---

## 9) Event application semantics (applyEvent reducer)

This section is the “hard spec” that must match `replay/apply-event.ts`.

### 9.1 Helper functions

* `findEntity(board, entityId)` returns entity + index or null
* `upsertEntity(board, entity)`:

  * if exists: shallow merge fields
  * else: insert (default append unless a boardPosition mechanism exists)
* `removeEntities(board, deadEntityIds)`:

  * filter out matching ids

### 9.2 Per-event rules

#### start-of-combat

* `state.lastAttack = undefined`
* `state.lastPowerTarget = undefined`
* `state.endDamage = undefined`
* no board mutation

#### attack

* `state.lastAttack = { attackerEntityId, defenderEntityId }`

#### power-target

* `state.lastPowerTarget = { sourceEntityId, targetEntityIds }`

#### entity-upsert

* decide board by `entity.friendly`
* upsert into that board
* if an entity exists on the opposite board with same id, that is a data error (see invariants)

#### damage

* locate target on either board
* `target.health -= damage`
* do not delete entity here

#### spawn

For each spawned entity:

* choose board by `spawned.friendly`
* if `insertIndexes` exists and index is valid:

  * insert at index
* else:

  * append

#### minion-death

* remove all `deadEntityIds` from both boards

#### player-attack / opponent-attack

* store hero damage summary:

  * `player-attack` -> `state.endDamage.toOpponent = damage`
  * `opponent-attack` -> `state.endDamage.toPlayer = damage`

---

## 10) Correctness invariants

These invariants define “valid logs”.

### 10.1 Identity and ownership invariants

1. **Unique entity IDs**: An `entityId` must not exist on both boards simultaneously.
2. **Stable ownership**: If an entity moves sides (rare), it must be represented as death + spawn with new id, or with an explicit “transfer” event type. Do not silently flip `friendly` via upsert.

### 10.2 Ordering invariants

3. `attack` must come before its resulting `damage`.
4. `damage` must come before `minion-death` removal of the damaged entity.
5. `spawn` and `minion-death` ordering within the death batch must match the engine’s actual sequence. If you change engine ordering, you must update replay expectations.

### 10.3 Topology invariants

6. Only `spawn` adds entities.
7. Only `minion-death` removes entities.

### 10.4 Snapshot invariants

8. A checkpoint snapshot must reflect the exact board state at its `seq`.
9. The thin log must be applicable on top of a checkpoint snapshot without needing hidden context.

### 10.5 Sanitization invariants

10. Thin stream must only carry sanitized entities, never mutable live objects.

---

## 11) Determinism considerations

Replay can be correct even if the sim is stochastic, but validation tests usually require determinism.

### 11.1 Current approach

* Many decisions use `Math.random()`
* Deterministic tests patch `Math.random()` with a seeded RNG

### 11.2 Recommended future approach (optional)

If you want strict replay equivalence tests to be bulletproof:

* thread a `rng()` function through engine helpers instead of using `Math.random()`
* record RNG seed and optionally RNG “draw count” in checkpoints
* add an optional thin event type:

  * `rng-draw { seq, phase, value }` for forensic debugging (not required for normal replay)

---

## 12) Validation tests (what to enforce)

These are the two killer tests for replay fidelity. They map cleanly onto the current design.

### Test A: Bridge Test (Checkpoint equivalence)

Goal: ensure replay from checkpoint matches a later checkpoint.

Process:

1. Take `Checkpoint_A` at seq `s1`
2. Apply events `(s1+1)..s2` using `applyEvent`
3. Compare resulting replay state to `Checkpoint_B` snapshot at seq `s2`

Assertion:

* `hash(reconstructedState) == hash(checkpointBState)`

Recommended hash:

* stable JSON stringify of `{ playerBoard, opponentBoard }` with sorted keys

### Test B: Full Run Test (Replay equivalence)

Goal: total replay correctness from the beginning.

Process:

1. Start from earliest checkpoint (or an explicit initial snapshot at seq 0)
2. Apply all events forward
3. Compare final reconstructed board state to:

   * a final checkpoint snapshot, or
   * the simulator’s final board state snapshot captured at end of combat

Assertion:

* states equal under the sanitized projection

---

## 13) Debug workflow (how to use replay to find bugs)

When combat output looks wrong:

1. Run a deterministic scenario (seeded RNG patch).
2. Capture:

   * thin events
   * checkpoints
   * a few fat actions (optional)
3. Binary search for divergence:

   * pick a mid `seq`
   * reconstruct at that seq
   * compare to the fat action snapshot at nearby seq (or checkpoint)
4. When you find the first diverging seq:

   * inspect the event type
   * check whether the engine emitted the corresponding upsert/spawn/death event
   * fix emission or reducer semantics accordingly

---

## 14) Completeness levels (roadmap-style)

Today, thin logs often include:

* attacks
* damage
* deaths
* spawns
* some targeted upserts

To reach “thin log is fully canonical”, aim for:

### Level 1: Topology complete

* Every spawn is logged
* Every removal is logged
* Every attack is logged

### Level 2: State sync complete

* Every stat/keyword change that affects viewer output emits `entity-upsert`
* especially after:

  * modifyStats calls
  * keyword updates
  * enchantment application

### Level 3: Boundary complete

* Add explicit boundary events:

  * `phase-boundary` or `death-batch-end`
* Add more checkpoints at meaningful boundaries (SoC end, attack end, death batch end)

### Level 4: Determinism forensic (optional)

* record seed in log header
* optionally record RNG draws or draw count

---

## 15) Versioning and compatibility

### 15.1 Event schema version

Even if not implemented today, the spec recommends a version header for stored logs:

* `schemaVersion: '1.x'`

### 15.2 Backward compatibility rules

* Adding optional fields to events is non-breaking.
* Adding new event types is non-breaking if replay reducer ignores unknown events safely.
* Removing fields or changing semantics is breaking and must bump major schema version.

---

## 16) Implementation checklist (for future changes)

If you change combat logic or add a new mechanic, ask:

1. Does it change board topology?

   * ensure spawn/death events cover it
2. Does it change replay-visible state?

   * ensure an `entity-upsert` or a checkpoint captures it
3. Does it introduce a new timing window?

   * consider adding a boundary event and a checkpoint reason
4. Does it rely on randomness?

   * ensure seeded runs remain reproducible

