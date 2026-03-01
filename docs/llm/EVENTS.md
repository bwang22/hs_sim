# EVENTS.md

This document defines the **combat event log** produced by `Spectator`, including:

* **Thin event stream** (`SpectatorEvent[]`) for replay/debug
* **Checkpoints** (`SpectatorCheckpoint[]`) for fast seeking
* **Fat snapshot actions** (`GameAction[]`) for viewer-friendly inspection
* **Phases** and **invariants** that make the log reliable

> Two parallel logs exist:
>
> * **Thin stream** = minimal, reducer-friendly, small payloads
> * **Actions** = full context snapshots (boards, hands, secrets, trinkets, hero power info) per “interesting moment”

---

## 1) Core concepts

### 1.1 `seq` (sequence number)

Every emitted thin event gets a monotonically increasing `seq`.

* `Spectator.nextSeq()` increments `seq` and assigns it to events.
* `GameAction` entries also get the current `seq` attached (`(action as any).seq = this.seq`).
* Checkpoints store `seq` as well.

**Invariant:** within a single battle, `seq` starts at `0` and increases by `1` for each thin event emitted.

### 1.2 “Friendly” side

Thin replay state chooses which board an entity belongs to using the entity’s `friendly` flag.

**Invariant:** `friendly: true` means player-side, `friendly: false` means opponent-side.

### 1.3 Sanitized entities

To avoid mutation hazards (the sim mutates entities in place), telemetry snapshots use a **sanitized subset** of entity fields:

```ts
type SanitizedEntity = Pick<BoardEntity,
  'entityId' | 'cardId' | 'friendly'
| 'attack' | 'health' | 'maxHealth'
| 'taunt' | 'divineShield'
| 'poisonous' | 'venomous'
| 'reborn' | 'windfury' | 'stealth'
>;
```

**Invariant:** the thin log and replay reducer must never depend on non-sanitized fields.

---

## 2) Phases

### 2.1 Coarse combat phases (telemetry)

Used by thin events:

```ts
type CombatPhase = 'START_OF_COMBAT' | 'ATTACK' | 'DEATHS' | 'END_OF_COMBAT';
```

Recommended interpretation:

* **START_OF_COMBAT**: all SoC triggers and pre-attack setup
* **ATTACK**: attacker selection and attack resolution (including combat damage events)
* **DEATHS**: death detection, deathrattles, spawns, reborns, cleanup
* **END_OF_COMBAT**: hero damage summary (player-attack/opponent-attack)

### 2.2 Start-of-combat subphases (engine-level)

The SoC pipeline has finer-grain steps:

```ts
type StartOfCombatPhase =
  | 'QuestReward'
  | 'Anomalies'
  | 'Trinket'
  | 'PreCombatHeroPower'
  | 'IllidanHeroPower'
  | 'HeroPower'
  | 'Secret'
  | 'Minion';
```

This is **not** currently emitted as part of the thin log schema, but it’s the canonical breakdown if you later add SoC-step events.

---

## 3) Thin event log schema (replay-friendly)

### 3.1 Event union

```ts
type SpectatorEvent =
  | { seq: number; type: 'start-of-combat'; phase: 'START_OF_COMBAT' }
  | { seq: number; type: 'attack'; phase: 'ATTACK'; attackerEntityId: number; defenderEntityId: number }
  | { seq: number; type: 'damage'; phase: 'ATTACK' | 'DEATHS';
      sourceEntityId?: number; targetEntityId: number; damage: number; kind: 'combat' | 'effect' }
  | { seq: number; type: 'player-attack'; phase: 'END_OF_COMBAT'; damage: number }
  | { seq: number; type: 'opponent-attack'; phase: 'END_OF_COMBAT'; damage: number }
  | { seq: number; type: 'power-target'; phase: 'START_OF_COMBAT' | 'ATTACK' | 'DEATHS';
      sourceEntityId: number; targetEntityIds: readonly number[] }
  | { seq: number; type: 'entity-upsert'; phase: 'START_OF_COMBAT' | 'ATTACK' | 'DEATHS'; entity: SanitizedEntity }
  | { seq: number; type: 'spawn'; phase: 'DEATHS';
      sourceEntityId?: number; spawned: readonly SanitizedEntity[]; insertIndexes?: readonly number[] }
  | { seq: number; type: 'minion-death'; phase: 'DEATHS';
      deadEntityIds: readonly number[]; deadMinionsPositionsOnBoard?: readonly number[] };
```

### 3.2 Meaning of each event type

#### `start-of-combat`

Boundary marker indicating the SoC window has begun.

* Thin event carries no board snapshot itself.
* A checkpoint is created at SoC start (see checkpoints section).

#### `attack`

Declares an attack: who is attacking whom.

* `attackerEntityId`, `defenderEntityId` refer to minion entities.

**Invariant:** an `attack` event should appear before the corresponding `damage` events for that attack.

#### `damage`

Represents damage dealt to a minion (not hero).

* `kind: 'combat'` means normal attack damage
* `kind: 'effect'` is reserved for effect-based damage (schema supports it even if current emission is mostly combat)

**Important replay invariant:** the replay reducer **does not delete entities** when damage reduces health to 0. Deletion happens only on `minion-death`.

This split is intentional so replay can match the engine’s death batching.

#### `power-target`

Represents an effect selecting targets (hero power, minion ability, trinket, secret, etc).

* Often emitted right before or after a state change.
* Can include multiple targets (`targetEntityIds`).

In current `Spectator`, `power-target` is typically emitted during ATTACK (even though schema allows SoC/Deaths too).

#### `entity-upsert`

A minimal “state sync” for one entity.

Semantics: **merge** new data into the entity with the same `entityId`. If absent, insert onto the side implied by `entity.friendly`.

This is how the thin log can represent buffs, keyword changes, or health/attack updates without shipping full boards each time.

Today, `Spectator` emits `entity-upsert` opportunistically after `power-target` to keep the replay viewer accurate for targeted effects.

#### `spawn`

Represents one or more spawned entities.

* `spawned`: list of sanitized entities
* `insertIndexes`: optional positions where each spawned entity should be inserted

Replay logic:

* Choose side by each spawned entity’s `friendly` flag
* Insert at `insertIndexes[i]` if valid, else append

**Invariant:** `spawn` events occur in the **DEATHS** phase (after damage and death detection) because spawns frequently arise from deathrattles/reborn.

#### `minion-death`

Declares which entities are removed from boards.

* `deadEntityIds` must include every entity that should be removed in that death batch.
* Optional `deadMinionsPositionsOnBoard` is a viewer hint (positions from right are used in current emission).

Replay logic:

* Remove entities from both boards where `entityId` is in `deadEntityIds`.

**Invariant:** if an entity disappears from the board in replay, it must be explained by a `minion-death` event (not by `damage`).

#### `player-attack` / `opponent-attack`

End-of-combat hero damage markers.

Replay stores this as `endDamage`:

* `player-attack` contributes `toOpponent`
* `opponent-attack` contributes `toPlayer`

---

## 4) Checkpoints (fast seek + bounded replay)

### 4.1 Checkpoint schema

```ts
type CheckpointReason = 'SOC_START' | 'SOC_END' | 'ATTACK_END' | 'DEATH_BATCH_END' | 'EVERY_N' | 'MANUAL';

interface SpectatorCheckpoint {
  seq: number;
  reason: CheckpointReason;
  snapshot: GameAction; // full snapshot event (fat)
}
```

### 4.2 When checkpoints are created today

Current `Spectator` creates checkpoints in two ways:

1. **At SoC start**

* `registerStartOfCombat(...)` emits the thin `start-of-combat` event and adds a `SOC_START` checkpoint snapshot.

2. **Periodic “EVERY_N” safety valve**

* Every `CHECKPOINT_EVERY_N_EVENTS` emitted events (default 200), it creates a snapshot from last-known context.

There is also a `checkpointNow(reason)` API for manual boundary checkpoints, but in the current dump it has no call sites, so it’s effectively dormant until wired into the engine.

### 4.3 Snapshot contents

Checkpoints store a **fat** `GameAction` snapshot (currently built using `type: 'start-of-combat'` as a generic “snapshot container”) including sanitized boards and hands.

This means: seeking works even if the thin log is incomplete, as long as you have recent checkpoints.

---

## 5) Fat actions (viewer-friendly snapshots)

Actions live in `GameAction[]` (alias of `GameEvent`), and each action includes a **GameEventContext**:

* `playerBoard`, `opponentBoard`
* `playerHand`, `opponentHand`
* `playerSecrets`, `opponentSecrets`
* `playerTrinkets`, `opponentTrinkets`
* hero cardIds, entityIds
* hero power cardIds, entityIds, used flags
* quest reward info

Action event types mirror the thin types:

```ts
type GameEventType =
  | 'start-of-combat' | 'attack'
  | 'player-attack' | 'opponent-attack'
  | 'damage' | 'spawn'
  | 'minion-death' | 'power-target';
```

Actions are heavier but great for debugging because they carry full context at each step.

There is also `collapseActions(...)` which merges consecutive damage events and some repeated context to keep samples compact.

---

## 6) Replay reducer (how the thin log is applied)

Replay state (minimal) looks like:

```ts
interface CombatReplayState {
  seq: number;
  playerBoard: SanitizedEntity[];
  opponentBoard: SanitizedEntity[];
  lastAttack?: { attackerEntityId: number; defenderEntityId: number };
  lastPowerTarget?: { sourceEntityId: number; targetEntityIds: readonly number[] };
  endDamage?: { toPlayer?: number; toOpponent?: number };
}
```

Replay algorithm:

1. Initialize from a checkpoint snapshot:

   * `playerBoard = snapshot.playerBoard`
   * `opponentBoard = snapshot.opponentBoard`
2. Apply events in ascending `seq` order, skipping anything `<= checkpoint.seq`, stop at `targetSeq`.

Reducer rules (high-impact invariants):

* `damage` subtracts from `health` but does **not** remove entities
* `minion-death` is the only event that removes entities
* `spawn` inserts or appends entities based on `insertIndexes`
* `entity-upsert` merges fields by `entityId`, inserts if missing
* `start-of-combat` resets some “last known” helpers but does not change boards

---

## 7) Invariants you should keep sacred

If you change the event schema or emission sites, keep these invariants intact:

### 7.1 Ordering and causality

* `attack` must come before the damage that attack produces.
* `damage` must come before `minion-death` that removes the damaged entity.
* `spawn` usually occurs after `minion-death` within the DEATHS phase batch, but if you change that, make it consistent and update the replay reducer accordingly.

### 7.2 Entity identity

* `entityId` must be stable within a battle.
* If an entity is replaced (rare), represent it as:

  * `minion-death` of old id
  * `spawn` of new id
  * optional `entity-upsert` after

### 7.3 Board membership

* The replay system relies on `friendly` to route entities to the correct board.
* If `friendly` is missing or wrong on spawned entities, replay will drift.

### 7.4 Sanitization boundary

* Never emit raw `BoardEntity` into the thin stream.
* Thin stream should remain “small and serializable”.

### 7.5 Checkpoints and seeking

* Checkpoints must be true “authoritative snapshots” of the board state at their `seq`.
* If you add RNG cursor or state hash later, store it on the checkpoint (not the thin stream) so seeking remains O(1).

---

## 8) Recommended emission guidelines (engine-side)

If you’re wiring more events, here’s a clean pattern:

### 8.1 At SoC start

* Emit `start-of-combat` thin event
* Add `SOC_START` checkpoint snapshot

### 8.2 Per attack

1. Emit `attack`
2. Emit one or more `damage` events (combat damage)
3. If any effects select targets: emit `power-target` (+ `entity-upsert` if stats changed)
4. When deaths are resolved: emit `minion-death`
5. If deathrattles/reborn summon: emit `spawn` (with insertIndexes)

### 8.3 End of combat

* Emit either/both:

  * `player-attack` (damage to opponent hero)
  * `opponent-attack` (damage to player hero)

---

## 9) Example thin log snippet

```json
[
  { "seq": 1, "type": "start-of-combat", "phase": "START_OF_COMBAT" },

  { "seq": 2, "type": "attack", "phase": "ATTACK", "attackerEntityId": 7706, "defenderEntityId": 8857 },

  { "seq": 3, "type": "damage", "phase": "ATTACK", "sourceEntityId": 7706, "targetEntityId": 8857, "damage": 11, "kind": "combat" },
  { "seq": 4, "type": "damage", "phase": "ATTACK", "sourceEntityId": 8857, "targetEntityId": 7706, "damage": 33, "kind": "combat" },

  { "seq": 5, "type": "minion-death", "phase": "DEATHS", "deadEntityIds": [7706], "deadMinionsPositionsOnBoard": [7] },

  { "seq": 6, "type": "spawn", "phase": "DEATHS", "sourceEntityId": 7706,
    "spawned": [{ "entityId": 9001, "cardId": "TOKEN_X", "friendly": true, "attack": 1, "health": 1 }],
    "insertIndexes": [0]
  },

  { "seq": 7, "type": "opponent-attack", "phase": "END_OF_COMBAT", "damage": 6 }
]
```

---

## 10) Extending the schema safely

If you add new thin event types:

* Update the `SpectatorEvent` union in `spectator-types.ts`
* Update the replay reducer `applyEvent(...)` in `replay/apply-event.ts`
* Keep payloads minimal and serializable
* Prefer:

  * `entity-upsert` for state changes
  * `spawn` + `minion-death` for topology changes
