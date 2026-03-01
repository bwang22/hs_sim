# DATA_MODEL.md

This document describes the **core data structures** used by the Battlegrounds combat simulator, as defined in `all_ts_dump.txt`. It’s meant to answer:

* What objects exist (inputs, runtime state, outputs, telemetry)?
* How do IDs, boards, and flags behave?
* What invariants should new devs assume?

---

## 1) Data flow overview

**Public API input** (`BgsBattleInfo`) is normalized (`buildFinalInput`) and cloned per iteration, then the **single-combat engine** mutates entities in place inside a `FullGameState`. The Monte Carlo loop aggregates many `SingleSimulationResult` runs into a `SimulationResult`. Optional telemetry is emitted via `Spectator` as events and checkpoints.

---

## 2) Public API inputs (contract-ish)

### 2.1 `BgsBattleInfo` (`src/bgs-battle-info.ts`)

Represents one “matchup” to simulate.

```ts
export interface BgsBattleInfo {
  readonly playerBoard: BgsBoardInfo;
  readonly playerTeammateBoard?: BgsBoardInfo;
  readonly opponentBoard: BgsBoardInfo;
  readonly opponentTeammateBoard?: BgsBoardInfo;
  readonly options: BgsBattleOptions;
  readonly gameState: BgsGameState;
  readonly heroHasDied?: boolean;
}

export interface BgsGameState {
  readonly currentTurn: number;
  readonly validTribes?: readonly Race[];
  readonly anomalies?: readonly string[];
}
```

**Notes**

* Duos support is modeled via optional `*TeammateBoard`.
* `gameState.validTribes` and `gameState.anomalies` are global combat context inputs.

---

### 2.2 `BgsBattleOptions` (`src/bgs-battle-options.ts`)

Simulation knobs.

Key fields:

* `numberOfSimulations: number` (required)
* `maxAcceptableDuration?: number` (ms, early stop safety valve)
* `intermediateResults?: number` (yield cadence)
* `includeOutcomeSamples?: boolean` (collect sample combats)
* `damageConfidence?: number` (used for damage interval logic)
* `skipInfoLogs: boolean`

Deprecated:

* `validTribes?: readonly Race[]` (now on `BgsGameState`)

---

### 2.3 `BgsBoardInfo` (`src/bgs-board-info.ts`)

A side’s hero + current combat board.

```ts
export interface BgsBoardInfo {
  readonly player: BgsPlayerEntity;
  readonly board: BoardEntity[];
  /** @deprecated */
  readonly secrets?: BoardSecret[];
}
```

**Invariant**

* `board` is ordered **left to right** (index = board position). Many mechanics depend on adjacency.

---

## 3) Core entities

### 3.1 `BoardEntity` (`src/board-entity.ts`)

A combat unit (minion-like). This is the most mutated object during simulation.

Core fields:

* `entityId: number` (unique identifier for referencing in events)
* `cardId: string` (card identifier)
* `attack: number`
* `health: number`

Common optional combat state:

* `maxHealth?: number`, `maxAttack?: number`
* keywords: `taunt?`, `divineShield?`, `poisonous?`, `venomous?`, `reborn?`, `windfury?`, `stealth?`
* simulation flags: `cantAttack?`, `hasAttacked?`, `attackImmediately?`, `definitelyDead?`
* counters: `avengeCurrent?`, `avengeDefault?`, `frenzyChargesLeft?`
* wiring: `enchantments?: BoardEnchantment[]`
* scripting scratchpads: `scriptDataNum1..6?: number`, `tags?: { [tag: number]: number }`
* “memory” fields used by specific mechanics:

  * `rememberedDeathrattles?: BoardEnchantment[]`
  * `originalCardId?: string`
  * `memory?: any`

**BoardEntity gotchas**

* This object is **mutable** and is cloned/sanitized when needed for replays.
* `friendly?: boolean` indicates controller side (true = player, false = opponent) and is used in telemetry and logic.
* `scriptDataNum*` and `tags` are generalized “payload channels”, not stable across all cards.

---

### 3.2 `BoardEnchantment` (`src/board-entity.ts`)

Represents an enchantment or remembered effect.

Fields:

* `cardId: string` (source of the enchantment)
* `originEntityId?: number` (who applied it)
* `timing: number` (ordering bucket)
* optional: `repeats?`, `value?`, `memory?`
* optional tag payload: `tagScriptDataNum1?`, `tagScriptDataNum2?`

**Invariant**

* Enchantments are frequently used as “effect carriers” and may outlive the origin entity.

---

### 3.3 `BoardSecret` (`src/board-secret.ts`)

A secret on a hero.

Fields:

* `entityId: number`
* `cardId: string`
* `triggered?: boolean`
* script fields: `scriptDataNum1?`, `scriptDataNum2?`
* `triggersLeft?: number` (multi-use secrets)

---

## 4) Player and hero-side model

### 4.1 `BgsPlayerEntity` (`src/bgs-player-entity.ts`)

Hero-side container plus inventory-like state.

Core:

* `cardId: string` (hero card id)
* `hpLeft: number`
* `tavernTier: number`
* `heroPowers: readonly BgsHeroPower[]`
* `questEntities: BgsQuestEntity[]`

Common optional runtime state:

* `friendly?: boolean`
* `entityId?: number`
* `hand?: BoardEntity[]`
* `secrets?: BoardSecret[]`
* `trinkets?: BoardTrinket[]`
* `globalInfo?: BgsPlayerGlobalInfo`
* `startOfCombatDone?: boolean`

Special-case scratch:

* `rapidReanimationMinion?`, `rapidReanimationIndexFromLeft?`, `rapidReanimationIndexFromRight?`

Deprecated hero power compatibility fields:

* `heroPowerId?`, `heroPowerEntityId?`, `heroPowerUsed?`, `heroPowerInfo?`, `heroPowerInfo2?`, etc.
* deprecated `avengeCurrent?`, `avengeDefault?`, `heroPowerActivated?`

**Invariants**

* Some fields exist only for backwards compatibility with older consumers. Prefer `heroPowers[]` over deprecated single hero power fields.

---

### 4.2 `BgsHeroPower` (`src/bgs-player-entity.ts`)

A hero power entity plus mutable state.

Fields:

* `cardId: string`
* `entityId: number`
* `used: boolean`
* `info: number | string | BoardEntity`
* `info2..info6: number`
* optional score: `scoreValue1..3?`
* avenge: `avengeCurrent?`, `avengeDefault?`
* `locked?: number`
* runtime-only: `ready?: boolean`, `activated?: boolean`

---

### 4.3 `BoardTrinket` (`src/bgs-player-entity.ts`)

Trinkets are modeled similarly to hero powers.

Fields:

* `cardId: string`
* `entityId: number`
* `scriptDataNum1: number`
* optional: `scriptDataNum2?`, `scriptDataNum6?`
* optional: `rememberedMinion?: BoardEntity`
* optional avenge: `avengeDefault?`, `avengeCurrent?`

---

### 4.4 `BgsQuestEntity` (`src/bgs-player-entity.ts`)

Quest progress representation.

Fields:

* `CardId: string`
* `RewardDbfId: number`
* `ProgressCurrent: number`
* `ProgressTotal: number`

---

### 4.5 `BgsPlayerGlobalInfo` (`src/bgs-player-entity.ts`)

A bag of counters used by various mechanics.

Examples (non-exhaustive):

* `SpellsCastThisGame?`, `TavernSpellsCastThisGame?`
* `BeastsSummonedThisGame?`, `BeastsSummonedThisCombat?`
* `MagnetizedThisGame?`, `GoldSpentThisGame?`
* various per-archetype attack/health bonuses

**Note**

* This is a “feature flag garden” of counters. New mechanics often add new optional counters here.

---

## 5) Internal runtime state (single combat)

These types describe the mutable engine state for one simulation iteration.

### 5.1 `FullGameState` (`src/simulation/internal-game-state.ts`)

Top-level runtime state container:

* `allCards: AllCardsService` (card DB)
* `cardsData: CardsData` (derived BG metadata)
* `spectator: Spectator` (telemetry sink)
* `sharedState: SharedState` (global counters for the run)
* `currentTurn: number`
* `validTribes: readonly Race[]`
* `anomalies: readonly string[]`
* `gameState: GameState` (mutable player/opponent state)

### 5.2 `GameState` and `PlayerState`

```ts
export interface GameState {
  player: PlayerState;
  opponent: PlayerState;
  playerInitial: PlayerState;
  opponentInitial: PlayerState;
}

export interface PlayerState {
  board: BoardEntity[];
  player: BgsPlayerEntity;
  teammate?: PlayerState;
}
```

**Why the `*Initial` fields exist**

* Used for baseline comparisons, some replay/debug workflows, and logic that needs access to the untouched starting configuration.

### 5.3 `SharedState` (`src/simulation/shared-state.ts`)

A small mutable “globals” holder.

Fields:

* `currentEntityId: number` (ID generator)
* `currentAttackerEntityId: any` (tracks current attacker)
* `deaths: BoardEntity[]` (working list)
* debug flags and anomalies mirror

---

## 6) Public API outputs

### 6.1 `SingleSimulationResult` (`src/single-simulation-result.ts`)

Per-run outcome:

* `result: 'won' | 'lost' | 'tied'`
* `damageDealt: number`

### 6.2 `SimulationResult` (`src/simulation-result.ts`)

Aggregated Monte Carlo output.

Includes:

* counts: `won`, `tied`, `lost`, plus lethal variants
* percents: `wonPercent`, `tiedPercent`, `lostPercent`, plus lethal percents
* damage stats:

  * `damageWon`, `damageLost` (sum)
  * `averageDamageWon`, `averageDamageLost`
  * `damageWonRange`, `damageLostRange`
  * `damageWons`, `damageLosts` (raw arrays)
* optional `outcomeSamples?: OutcomeSamples` when enabled

`OutcomeSamples` contains arrays of `GameSample` for won/lost/tied buckets.

---

## 7) Telemetry and replay data models

There are two related “logging models” in the repo:

### 7.1 Spectator thin event log (`src/simulation/spectator/spectator-types.ts`)

This is the lightweight event union used for replay-style reconstruction.

Key definitions:

* `CombatPhase = 'START_OF_COMBAT' | 'ATTACK' | 'DEATHS' | 'END_OF_COMBAT'`
* `SanitizedEntity`: a `Pick<BoardEntity, ...>` subset considered replay-relevant
* `SpectatorEvent`: union of events like:

  * `start-of-combat`
  * `attack` (attackerEntityId, defenderEntityId)
  * `damage` (kind: combat|effect)
  * `power-target`
  * `entity-upsert` (SanitizedEntity)
  * `spawn` (list of spawned SanitizedEntity)
  * `minion-death` (deadEntityIds)
* `SpectatorCheckpoint`:

  * `seq: number`
  * `reason: CheckpointReason`
  * `snapshot: GameAction` (full snapshot event)

**Practical meaning**

* The thin log references entities by `entityId`.
* “Upsert” events update the reconstructed state for one entity.

---

### 7.2 Snapshot-style “GameAction” events (`src/simulation/spectator/game-action.ts`)

This model captures full board context on each event (viewer-friendly).

* `GameEventContext` includes full:

  * player/opponent boards, hands, secrets, trinkets
  * hero ids and hero power ids
  * quest reward ids/data fields
* Event union includes:

  * `start-of-combat`, `attack`, `damage`, `spawn`, `minion-death`, `power-target`, plus end-of-combat damage markers.

**Why two models?**

* `GameAction` is heavy but great for viewing/debugging.
* `SpectatorEvent` is smaller and more replay-oriented.

---

### 7.3 Experimental “combat-log.types.ts”

There’s also a more formalized event/checkpoint schema (`CombatEvent`, `CombatCheckpoint`, `CombatSnapshot`) under `src/simulation/spectator/combat-log.types.ts`. It looks like a planned or alternate logging contract.

If you are standardizing telemetry, this file is the cleanest “spec template” in the codebase.

---

## 8) Identity and indexing rules (important invariants)

### 8.1 `entityId`

* Treated as the stable handle for entities during a combat.
* Used heavily by telemetry (`attack`, `damage`, `death`, `upsert`).
* New spawns must receive deterministic `entityId` assignment for replay fidelity.

### 8.2 `cardId`

* String identifier for the card.
* Card implementations are mapped by `cardId` in `src/cards/impl/_card-mappings.ts`.

### 8.3 Board order

* `board: BoardEntity[]` is left-to-right order.
* Effects like cleave, adjacency buffs, and spawn insertion rely on this ordering.

### 8.4 Side ownership

* `friendly?: boolean` exists on `BoardEntity` and `BgsPlayerEntity`.
* Convention: `true` = player side, `false` = opponent side.

### 8.5 Script payload fields

* `scriptDataNum1..6` and `tags` are generalized channels used by many cards.
* They are not uniformly interpreted, so treat them as “card-defined meaning”.

---

## 9) Backward compatibility fields (what to ignore first)

New code should prefer:

* `BgsPlayerEntity.heroPowers[]` over deprecated single hero power fields.
* `BgsBoardInfo.player.secrets` over deprecated `BgsBoardInfo.secrets`.
* `BgsGameState.validTribes/anomalies` over `BgsBattleOptions.validTribes`.

---

## 10) Minimal example payload (for intuition)

```ts
const input: BgsBattleInfo = {
  playerBoard: {
    player: {
      cardId: "HERO_01",
      hpLeft: 40,
      tavernTier: 5,
      heroPowers: [],
      questEntities: [],
      friendly: true,
    },
    board: [
      { entityId: 1, cardId: "MINION_A", attack: 3, health: 2, friendly: true },
    ],
  },
  opponentBoard: {
    player: {
      cardId: "HERO_02",
      hpLeft: 40,
      tavernTier: 5,
      heroPowers: [],
      questEntities: [],
      friendly: false,
    },
    board: [
      { entityId: 2, cardId: "MINION_B", attack: 2, health: 3, friendly: false },
    ],
  },
  options: {
    numberOfSimulations: 1000,
    skipInfoLogs: true,
  },
  gameState: {
    currentTurn: 10,
    anomalies: [],
    validTribes: [],
  },
};
```

---

## 11) Where new fields usually belong

* **New per-minion persistent state**: `BoardEntity`
* **New per-hero counters**: `BgsPlayerGlobalInfo`
* **New combat-wide state**: `SharedState` (if truly global), or hang it off `FullGameState`
* **New viewer/debug info**: `GameEventContext` or add a dedicated telemetry event type

