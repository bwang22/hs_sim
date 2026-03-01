# EVENT_CATALOG.md

This is the canonical catalog of **combat telemetry events** in the repo, based on the event schemas and emission code in:

* `src/simulation/spectator/spectator-types.ts` (thin event union + checkpoint schema)
* `src/simulation/spectator/spectator.ts` (when/why events are emitted)
* `src/simulation/replay/apply-event.ts` (how replay applies thin events)
* `src/simulation/spectator/game-action.ts` (fat “snapshot action” event types)
* **Spec-only / unused today** (but present in dump):

  * `src/simulation/spectator/combat-log.ts`
  * `src/simulation/spectator/combat-log.types.ts`

---

## 0) Why this exists

The simulator mutates entities in place. Telemetry exists to:

1. **Debug** (“what happened?”) with full-board snapshots (`GameAction`)
2. **Replay/seek** quickly with a **thin** event stream (`SpectatorEvent`) plus periodic **checkpoints**
3. Eventually enable determinism tests like “checkpoint equivalence” (replay matches snapshot)

---

## 1) Event families

### Family A: Thin replay events (CURRENT)

* Type: `SpectatorEvent[]`
* Minimal payload, uses `entityId` references and a **sanitized entity subset**
* Applied by `replay/apply-event.ts`

### Family B: Fat snapshot actions (CURRENT)

* Type: `GameAction[]` (alias of `GameEvent`)
* Each action carries a **GameEventContext** containing boards, hands, secrets, trinkets, hero power metadata, etc.
* Great for viewer/debug, expensive to store

### Family C: CombatLog specs (PRESENT BUT UNUSED)

Two alternate schemas exist in the tree:

* `combat-log.ts` (SOC_MARKER/ATTACK/DAMAGE/… with a `CombatLog {version:'1.0', seed, events, checkpoints}`)
* `combat-log.types.ts` (more formal “ATTACK_DECLARED”, “FLAG_CHANGED”, “PHASE_BOUNDARY”, optional RNG event)

These appear to be design docs or future direction. Nothing else imports `CombatLog` today.

---

## 2) Core shared concepts (thin stream)

### 2.1 `seq` (sequence number)

* Every thin event has a monotonically increasing `seq`.
* `Spectator.emitEvent(...)` sets `seq` by calling `nextSeq()`.

**Invariant:** Within one combat, `seq` strictly increases by 1 per emitted thin event.

### 2.2 `phase`

Thin events carry a `phase` from:

```ts
type CombatPhase = 'START_OF_COMBAT' | 'ATTACK' | 'DEATHS' | 'END_OF_COMBAT';
```

**Invariant:** Phase is descriptive, not a strict FSM. Replay uses it mainly for UI/debug.

### 2.3 Sanitized entities

Thin events never store full `BoardEntity`. Instead they store a “replay-relevant” subset:

```ts
type SanitizedEntity = Pick<BoardEntity,
  'entityId' | 'cardId' | 'friendly' |
  'attack' | 'health' | 'maxHealth' |
  'taunt' | 'divineShield' | 'poisonous' | 'venomous' |
  'reborn' | 'windfury' | 'stealth'
>;
```

**Invariant:** If your replay UI needs more fields, add them here and update both emitter + replayer.

---

## 3) Family A: Thin event catalog (SpectatorEvent)

Source of truth: `src/simulation/spectator/spectator-types.ts`
Emission sites: `src/simulation/spectator/spectator.ts`
Replay reducer: `src/simulation/replay/apply-event.ts`

### 3.1 `start-of-combat`

**Type**

```ts
{ seq; type:'start-of-combat'; phase:'START_OF_COMBAT' }
```

**Emitted by**

* `Spectator.registerStartOfCombat(...)`

**Meaning**

* Boundary marker: SoC window begins.
* Thin event does not carry a board snapshot.

**Replay behavior**

* Clears `lastAttack`, `lastPowerTarget`, `endDamage` bookkeeping.
* Boards come from checkpoints, not this event.

**Typical ordering**

* First significant marker in a battle’s log, often near seq 1.

---

### 3.2 `attack`

**Type**

```ts
{ seq; type:'attack'; phase:'ATTACK'; attackerEntityId; defenderEntityId }
```

**Emitted by**

* `Spectator.registerAttack(...)`

**Meaning**

* Announces attacker and defender selection for an attack step.

**Replay behavior**

* Sets `state.lastAttack = { attackerEntityId, defenderEntityId }`

**Invariant**

* Should occur before the `damage` events that describe that attack’s damage.

---

### 3.3 `damage`

**Type**

```ts
{
  seq; type:'damage'; phase:'ATTACK'|'DEATHS';
  sourceEntityId?; targetEntityId; damage; kind:'combat'|'effect'
}
```

**Emitted by**

* `Spectator.registerDamageDealt(...)`

  * Current emission uses `phase:'ATTACK'` and `kind:'combat'` (effect damage is supported by schema but not emitted by this method).

**Meaning**

* A damage instance applied to a minion.

**Replay behavior**

* Finds the target entity on either board and reduces `health`.
* Does **not** remove entities when health hits 0.

**Critical invariant**

* **Deletion is only via `minion-death`.**
* Damage can reduce health to 0 and the entity can still remain until a later death batch.

---

### 3.4 `power-target`

**Type**

```ts
{
  seq; type:'power-target'; phase:'START_OF_COMBAT'|'ATTACK'|'DEATHS';
  sourceEntityId; targetEntityIds:[...]
}
```

**Emitted by**

* `Spectator.registerPowerTarget(...)` (single target)
* `Spectator.registerPowerTargets(...)` (multi target)

Current emission uses `phase:'ATTACK'`.

**Meaning**

* “Something” (minion, hero, secret, trinket) selected one or more targets.

**Replay behavior**

* Stores `state.lastPowerTarget` for UI/debug.
* No guaranteed state change (that’s why `entity-upsert` often follows).

**Common companion event**

* Often followed by one or more `entity-upsert` events for the targeted entities (see below).

---

### 3.5 `entity-upsert`

**Type**

```ts
{
  seq; type:'entity-upsert'; phase:'START_OF_COMBAT'|'ATTACK'|'DEATHS';
  entity: SanitizedEntity
}
```

**Emitted by**

* `registerPowerTarget(...)`: upsert for the targeted entity after it is found on the board
* `registerPowerTargets(...)`: upsert for each target id found

**Meaning**

* Patch-style update: “here is the latest replay-relevant state for this entity.”

**Replay behavior**

* Merges fields into existing entity with same `entityId`
* If missing, inserts it onto the board based on `entity.friendly`

**Invariant**

* Upserts should always carry `friendly`. Replay uses it to choose which board to place the entity on.

**Note**

* Upsert emission is currently opportunistic, not comprehensive. Many state changes are not upserted unless they pass through these power-target helpers.

---

### 3.6 `spawn`

**Type**

```ts
{
  seq; type:'spawn'; phase:'DEATHS';
  sourceEntityId?;
  spawned: SanitizedEntity[];
  insertIndexes?: number[];
}
```

**Emitted by**

* `Spectator.registerMinionsSpawn(...)`

**Meaning**

* One or more entities were spawned/summoned.

**Insert position**

* `insertIndexes` is computed by finding each spawned entity’s `entityId` in the target board **at time of logging**.
* If no valid indexes are found, `insertIndexes` is omitted.

**Replay behavior**

* Inserts each spawned entity into the correct board using `friendly`
* Uses `insertIndexes[i]` when valid, otherwise appends

**Invariants**

* Spawn events are emitted in `DEATHS` phase today.
* Spawn does not delete anything; deletion is separate (`minion-death`).

---

### 3.7 `minion-death`

**Type**

```ts
{
  seq; type:'minion-death'; phase:'DEATHS';
  deadEntityIds: number[];
  deadMinionsPositionsOnBoard?: number[];
}
```

**Emitted by**

* `Spectator.registerDeadEntities(...)`

**Meaning**

* Declares the set of minion entity IDs removed in a death batch.

**Positions field**

* `deadMinionsPositionsOnBoard` is computed as `(board.length - indexFromLeft)`, effectively a **1-based “position from right”** hint.

**Replay behavior**

* Removes any entities whose `entityId` is in `deadEntityIds` from both boards.

**Critical invariant**

* If an entity disappears from replay, it must be explained by `minion-death`.

---

### 3.8 `player-attack` / `opponent-attack`

**Types**

```ts
{ seq; type:'player-attack'; phase:'END_OF_COMBAT'; damage:number }
{ seq; type:'opponent-attack'; phase:'END_OF_COMBAT'; damage:number }
```

**Emitted by**

* `Spectator.registerPlayerAttack(...)`
* `Spectator.registerOpponentAttack(...)`

**Meaning**

* Final hero damage markers at end-of-combat.

**Replay behavior**

* Stores `endDamage.toOpponent` for `player-attack`
* Stores `endDamage.toPlayer` for `opponent-attack`

---

## 4) Checkpoints catalog (SpectatorCheckpoint)

Source of truth: `src/simulation/spectator/spectator-types.ts`
Created by: `src/simulation/spectator/spectator.ts`

### 4.1 Schema

```ts
interface SpectatorCheckpoint {
  seq: number;
  reason: CheckpointReason;
  snapshot: GameAction; // fat snapshot
}

type CheckpointReason =
  'SOC_START' | 'SOC_END' | 'ATTACK_END' | 'DEATH_BATCH_END' | 'EVERY_N' | 'MANUAL';
```

### 4.2 When checkpoints happen today

* **Every N events** (`CHECKPOINT_EVERY_N_EVENTS = 200`): auto checkpoint with reason `EVERY_N` if enough last-context exists.
* `checkpointNow(reason)` exists but is not widely wired in the engine in this dump.
* SoC start is not a dedicated checkpoint reason in `spectator.ts` today; instead, `registerStartOfCombat` emits thin `start-of-combat` and builds a fat action. Auto-checkpoints are primarily cadence-based, plus manual.

### 4.3 Snapshot structure (important quirk)

`spectator.ts` builds checkpoint snapshots as a `GameAction` with `type:'start-of-combat'`, and adds `(snapshot as any).checkpointReason = reason`.

So “checkpoint snapshots” reuse an existing action type as a container.

---

## 5) Family B: Fat action event catalog (GameAction / GameEvent)

Source of truth: `src/simulation/spectator/game-action.ts`
Emission site: `Spectator.register*` methods build actions via `buildGameAction(...)`

### 5.1 Context payload (always present)

Every `GameAction` extends `GameEventContext`, which contains (viewer/debug focus):

* Boards and hands:

  * `playerBoard`, `opponentBoard`
  * `playerHand`, `opponentHand`
* Hidden info:

  * `playerSecrets`, `opponentSecrets` (typically filtered for `!triggered`)
* Hero attachments:

  * `playerTrinkets`, `opponentTrinkets`
  * `playerHeroPowers`, `opponentHeroPowers`
* Hero identity:

  * `playerCardId`, `playerEntityId`, plus hero power cardId/entityId/used
  * `opponentCardId`, `opponentEntityId`, plus hero power cardId/entityId/used
* Quest reward metadata fields (present even when null)

### 5.2 Action types (mirror the thin stream)

`GameEventType` includes:

* `start-of-combat`
* `attack`
* `player-attack`
* `opponent-attack`
* `damage` (with `damages: Damage[]`)
* `spawn` (with `spawns: BoardEntity[]`)
* `minion-death` (with `deaths: BoardEntity[]`)
* `power-target`

**Mapping**

* Each thin event type generally has a fat action counterpart emitted from the same `register*` method.

**Important difference**

* Fat actions store full sanitized boards/hands, so they can stand alone for debugging.
* Thin events rely on checkpoints + upsert/spawn/death to reconstruct.

---

## 6) Family C: Spec-only / unused schemas (but in the dump)

These are useful if you plan to evolve the event system, but they are not currently wired.

### 6.1 `combat-log.ts` (SOC_MARKER/ATTACK/…)

Defines a different thin event taxonomy:

* `SOC_MARKER` with `marker:'SOC_START'|'SOC_END'`
* `ATTACK`
* `DAMAGE` with `amount` and `kind:'combat'|'effect'`
* `HERO_DAMAGE` with `to:'player'|'opponent'`
* `POWER_TARGETS`
* `SPAWN` with minimal spawned identity (`entityId/cardId/friendly`)
* `DEATHS` with `entityIds`

And a container:

```ts
interface CombatLog {
  version:'1.0';
  seed: string|number;
  events: CombatEvent[];
  checkpoints: CombatCheckpoint[];
}
```

### 6.2 `combat-log.types.ts` (ATTACK_DECLARED/FLAG_CHANGED/PHASE_BOUNDARY/…)

Adds optional features:

* `RNG` event to record RNG pulls
* `FLAG_CHANGED` for keyword toggles
* `PHASE_BOUNDARY` for explicit boundaries and checkpoint cadence
* `SPAWNED` includes `controller` and `boardPosition`

These would be the cleanest place to go if you want a more formal “spec-first” event contract.

---

## 7) Cross-family mapping (practical)

| Concept          | Thin (current)                      | Fat action (current)      | Spec idea                        |
| ---------------- | ----------------------------------- | ------------------------- | -------------------------------- |
| SoC boundary     | `start-of-combat`                   | `start-of-combat` action  | `SOC_MARKER` or `PHASE_BOUNDARY` |
| Attack declared  | `attack`                            | `attack`                  | `ATTACK_DECLARED`                |
| Minion damage    | `damage`                            | `damage` (array)          | `DAMAGE`                         |
| Target selection | `power-target`                      | `power-target`            | `POWER_TARGETS`                  |
| State patch      | `entity-upsert`                     | (implicit in full boards) | `FLAG_CHANGED` / `entity patch`  |
| Spawns           | `spawn`                             | `spawn`                   | `SPAWN` / `SPAWNED`              |
| Death removal    | `minion-death`                      | `minion-death`            | `DEATHS` / `MINION_DIED`         |
| Hero damage      | `player-attack` / `opponent-attack` | same                      | `HERO_DAMAGE`                    |

---

## 8) Invariants (the “don’t break these” list)

### 8.1 Ordering invariants

* `attack` should precede the `damage` events it causes.
* `damage` should precede `minion-death` that removes the damaged entity.
* `spawn` typically occurs during `DEATHS` resolution.

### 8.2 Identity invariants

* `entityId` is the stable handle for replay and correlations.
* A spawned entity should always have a deterministic `entityId` assignment if you want deterministic replays.

### 8.3 Board topology invariants

* Entities are only removed via `minion-death`.
* `spawn` adds entities; it should not implicitly delete others.

### 8.4 Sanitization invariants

* Thin stream must only contain `SanitizedEntity` payloads (never raw mutable entities).

### 8.5 Checkpoint invariants

* A checkpoint snapshot must reflect the exact state at its `seq`.
* Replay correctness relies on: `checkpoint + applyEvent(events) == reconstructed state`.

---

## 9) Adding a new thin event safely

If you add a new event type to the thin stream:

1. Extend the union in `spectator-types.ts`
2. Emit it in `spectator.ts`
3. Update `replay/apply-event.ts` to apply it (or explicitly ignore it with documented behavior)
4. Decide whether it also needs a fat action counterpart in `game-action.ts` (usually yes for debugging)

Tip: prefer “patch-style” updates (`entity-upsert`) over adding many specialized micro-events, unless you need strict causality for determinism tests.
