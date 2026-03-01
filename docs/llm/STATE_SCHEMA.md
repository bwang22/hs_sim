````md
# STATE_SCHEMA.md
Canonical schemas for **input**, **runtime**, **telemetry**, and **outputs** in the BG combat simulator.

This repo has multiple “state shapes” that look similar but are used for different jobs:
- **Input State**: what callers provide
- **Sanitized/Cloned State**: safe-to-mutate copies per simulation
- **Runtime State**: the engine’s live world model + scratchpads
- **Telemetry State**: spectator events + checkpoints for debugging/replay
- **Result State**: aggregated Monte Carlo outcome stats (+ optional samples)

This doc describes the *schemas* and the *rules* around them (mutability, invariants, compatibility).

---

## 0) TL;DR: the important contracts

If you only remember five things:

1) `BgsBattleInfo` is the **public input contract** (`playerBoard`, `opponentBoard`, options, and `gameState`).  
2) `BoardEntity` is the **universal minion-like entity shape** used everywhere (input, runtime, telemetry snapshots).  
3) `FullGameState` is the **runtime root**, holding services + `SharedState` + `gameState` (player/opponent).  
4) The **Spectator** emits a thin union `SpectatorEvent` and stores periodic `SpectatorCheckpoint` snapshots.  
5) `SimulationResult` is the **public output contract**, optionally including `OutcomeSamples` (spectator samples).

---

## 1) Schema layering

### Layer A: Public Input Schema
**Source files**
- `src/bgs-battle-info.ts`
- `src/bgs-battle-options.ts`
- `src/bgs-board-info.ts`
- `src/bgs-player-entity.ts`
- `src/board-entity.ts`
- `src/board-secret.ts`

### Layer B: Runtime Schema
**Source files**
- `src/simulation/internal-game-state.ts`
- `src/simulation/shared-state.ts`
- `src/debug-state.ts` (test/debug overrides)

### Layer C: Telemetry / Replay Schema
**Source files**
- `src/simulation/spectator/spectator-types.ts`
- `src/simulation/spectator/spectator.ts`
- `src/simulation/spectator/game-action.ts`
- `src/simulation/spectator/game-sample.ts`
- `src/simulation/spectator/combat-log.types.ts` (experimental / future-friendly replay schema)

### Layer D: Output Schema
**Source files**
- `src/simulation-result.ts`
- `src/single-simulation-result.ts`

---

## 2) Public Input Schema

### 2.1 `BgsBattleInfo`
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
````

**Notes**

* Duo support exists via optional teammate boards.
* `heroHasDied` is optional; consumers should treat it as a hint.

---

### 2.2 `BgsGameState`

```ts
export interface BgsGameState {
  readonly currentTurn: number;
  readonly validTribes?: readonly Race[];
  readonly anomalies?: readonly string[];
}
```

**Notes**

* `validTribes` is optional here; `options.validTribes` is deprecated in favor of gameState-level configuration.

---

### 2.3 `BgsBattleOptions`

```ts
export interface BgsBattleOptions {
  readonly numberOfSimulations: number;
  readonly maxAcceptableDuration?: number;
  readonly hideMaxSimulationDurationWarning?: boolean;
  readonly intermediateResults?: number;
  readonly includeOutcomeSamples?: boolean;
  readonly damageConfidence?: number;
  /** @deprecated */
  readonly validTribes?: readonly Race[];
  readonly skipInfoLogs: boolean;
}
```

**Semantics**

* The simulator can stop early based on duration (`maxAcceptableDuration`). This affects *output stability* even when RNG is seeded.

---

### 2.4 `BgsBoardInfo`

```ts
export interface BgsBoardInfo {
  readonly player: BgsPlayerEntity;
  readonly board: BoardEntity[];
  /** @deprecated */
  readonly secrets?: BoardSecret[];
}
```

**Notes**

* Secrets are now typically on the hero (`BgsPlayerEntity.secrets`) but this legacy field exists.

---

### 2.5 `BgsPlayerEntity`

This is the hero-like state. It includes:

* identity (`cardId`, optional `entityId`)
* combat state (`hpLeft`, `tavernTier`)
* hero powers (new array-based model + deprecated legacy fields)
* quest and reward state
* hand, secrets, trinkets
* global counters (`globalInfo`)
* some per-combat flags (`startOfCombatDone`)
* a few card-specific scratch fields (Rapid Reanimation, etc.)

Core shape (abridged for readability):

```ts
export interface BgsPlayerEntity {
  cardId: string;
  hpLeft: number;
  readonly tavernTier: number;
  heroPowers: readonly BgsHeroPower[];

  /** legacy/deprecated hero power fields omitted here **/

  friendly?: boolean;
  entityId?: number;

  questEntities: BgsQuestEntity[];
  questRewards?: string[];
  questRewardEntities?: { cardId: string; entityId: number; scriptDataNum1: number; /* ... */ }[];

  hand?: BoardEntity[];
  secrets?: BoardSecret[];
  trinkets?: BoardTrinket[];
  globalInfo?: BgsPlayerGlobalInfo;

  startOfCombatDone?: boolean;

  // compatibility with BoardEntity
  enchantments?: BoardEnchantment[];

  // card-specific extras (non-exhaustive)
  deadEyeDamageDone?: number;
  rapidReanimationMinion?: BoardEntity;
  rapidReanimationIndexFromLeft?: number;
  rapidReanimationIndexFromRight?: number;
}
```

#### 2.5.1 `BgsHeroPower`

```ts
export interface BgsHeroPower {
  cardId: string;
  entityId: number;
  used: boolean;
  info: number | string | BoardEntity;
  info2: number;
  info3: number;
  info4: number;
  info5: number;
  info6: number;
  scoreValue1?: number;
  scoreValue2?: number;
  scoreValue3?: number;
  avengeCurrent?: number;
  avengeDefault?: number;
  locked?: number;
  ready?: boolean;
  activated?: boolean;
}
```

#### 2.5.2 `BgsPlayerGlobalInfo`

A “bag of counters” used by many card effects. It’s intentionally sparse and optional:

```ts
export interface BgsPlayerGlobalInfo {
  EternalKnightsDeadThisGame?: number;
  SpellsCastThisGame?: number;
  BeastsSummonedThisCombat?: number;
  /* ... many more ... */
  AdditionalAttack?: number;
}
```

#### 2.5.3 `BgsQuestEntity`

```ts
export interface BgsQuestEntity {
  CardId: string;
  RewardDbfId: number;
  ProgressCurrent: number;
  ProgressTotal: number;
}
```

#### 2.5.4 `BoardTrinket`

```ts
export interface BoardTrinket {
  cardId: string;
  entityId: number;
  scriptDataNum1: number;
  scriptDataNum2?: number;
  scriptDataNum6?: number;
  rememberedMinion?: BoardEntity;
  avengeDefault?: number;
  avengeCurrent?: number;
}
```

---

### 2.6 `BoardEntity`

This is the **core unit schema** used everywhere (board, hand, spawns, deaths, snapshots).

```ts
export interface BoardEntity {
  entityId: number;
  cardId: string;
  attack: number;
  health: number;

  maxHealth?: number;
  maxAttack?: number;
  avengeCurrent?: number;
  avengeDefault?: number;
  frenzyChargesLeft?: number;

  definitelyDead?: boolean;

  taunt?: boolean;
  divineShield?: boolean;
  strongDivineShield?: boolean;
  poisonous?: boolean;
  venomous?: boolean;
  reborn?: boolean;
  rebornFromEntityId?: number;
  cleave?: boolean;
  windfury?: boolean;
  stealth?: boolean;

  enchantments?: BoardEnchantment[];
  pendingAttackBuffs?: number[];

  scriptDataNum1?: number;
  scriptDataNum2?: number;
  scriptDataNum3?: number;
  scriptDataNum4?: number;
  scriptDataNum5?: number;
  scriptDataNum6?: number;

  inInitialState?: boolean;

  additionalCards?: readonly string[] | null;
  dynamicInfo?: readonly any[] | null;
  tags?: { [tag: number]: number };

  // remembered deathrattle / fish-style mechanics
  originalCardId?: string;
  rememberedDeathrattles?: BoardEnchantment[];
  deathrattleRepeats?: number;

  damageMultiplier?: number;
  locked?: boolean;

  friendly?: boolean;
  cantAttack?: boolean;
  hasAttacked?: number;
  immuneWhenAttackCharges?: number;
  attackImmediately?: boolean;

  previousAttack?: number;
  lastAffectedByEntity?: BoardEntity;

  hadDivineShield?: boolean;

  abiityChargesLeft?: number;

  indexFromLeftAtTimeOfDeath?: number;
  spawnIndexFromRight?: number;

  tavernTier?: number;

  memory?: any;
  gildedInCombat?: boolean;

  // ⚠️ NOT SERIALIZABLE: runtime-only hook
  onCanceledSummon?: () => void;
}
```

#### 2.6.1 `BoardEnchantment`

```ts
export interface BoardEnchantment {
  cardId: string;
  originEntityId?: number;
  tagScriptDataNum1?: number;
  tagScriptDataNum2?: number;
  timing: number;
  repeats?: number;
  value?: number;
  memory?: any;
}
```

**Important**

* `onCanceledSummon` and other function-valued fields are *runtime-only* and must never be assumed to exist in persisted state, telemetry, or replay payloads.

---

### 2.7 `BoardSecret`

```ts
export interface BoardSecret {
  entityId: number;
  cardId: string;
  triggered?: boolean;
  scriptDataNum1?: number;
  scriptDataNum2?: number;
  triggersLeft?: number;
}
```

---

## 3) Runtime State Schema

### 3.1 `FullGameState` (runtime root)

```ts
export interface FullGameState {
  allCards: AllCardsService;
  cardsData: CardsData;
  spectator: Spectator;
  sharedState: SharedState;

  currentTurn: number;
  validTribes: readonly Race[];
  anomalies: readonly string[];

  gameState: GameState;
}
```

### 3.2 `GameState` and `PlayerState`

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

**Why `playerInitial/opponentInitial` exist**

* They are baseline snapshots for “reset / compare / debug / telemetry” use cases, separate from the mutated live combat state.

---

### 3.3 `SharedState` (cross-cutting scratchpad)

```ts
export class SharedState {
  public anomalies: readonly string[] = [];
  public currentEntityId = 1;
  public currentAttackerEntityId = null;
  public deaths: BoardEntity[] = [];
  public debug = false;
}
```

**Critical invariants**

* `currentEntityId` must always point to an unused entity id.
* `deaths` is a staging list and should be drained deterministically (death batch boundaries matter for replay).

---

### 3.4 Debug override state (`debugState`)

```ts
export const debugState = {
  active: false,
  forcedCurrentAttacker: null as number | null,
  forcedFaceOff: [] as { attacker: ForcedFaceOffEntity; defender: ForcedFaceOffEntity }[],
  forcedFaceOffBase: [] as { attacker: ForcedFaceOffEntity; defender: ForcedFaceOffEntity }[],
  isCorrectEntity: (proposedEntity: ForcedFaceOffEntity, actualEntity: BoardEntity) => boolean,
  onBattleStart: () => void,
};

export interface ForcedFaceOffEntity {
  entityId?: number;
  cardId?: string;
  attack?: number;
  health?: number;
}
```

**Rule**

* Treat `debugState` as test harness wiring. It is not part of any persisted or public schema.

---

## 4) Telemetry / Replay Schema

There are **two** parallel telemetry shapes in the repo:

1. **Thin events + checkpoints** (`SpectatorEvent`, `SpectatorCheckpoint`)
2. A more explicit “combat log” model (`CombatEventBase`, `CombatCheckpoint`, etc.) that looks like a future replay target.

### 4.1 Spectator thin event schema (`SpectatorEvent`)

Defined as a union. Every event includes:

* `seq` (monotonic per combat)
* `type`
* `phase` (one of `START_OF_COMBAT | ATTACK | DEATHS | END_OF_COMBAT`)
* type-specific payload

Phases and reasons:

```ts
export type CombatPhase = 'START_OF_COMBAT' | 'ATTACK' | 'DEATHS' | 'END_OF_COMBAT';
export type CheckpointReason = 'SOC_START' | 'SOC_END' | 'ATTACK_END' | 'DEATH_BATCH_END' | 'EVERY_N' | 'MANUAL';
```

Replay-relevant entity subset:

```ts
export type SanitizedEntity = Pick<BoardEntity,
  'entityId'|'cardId'|'friendly'|'attack'|'health'|'maxHealth'|
  'taunt'|'divineShield'|'poisonous'|'venomous'|'reborn'|'windfury'|'stealth'
>;
```

Event shapes (schematic):

```ts
type SpectatorEvent =
  | { seq; type:'start-of-combat'; phase:'START_OF_COMBAT' }
  | { seq; type:'attack'; phase:'ATTACK'; attackerEntityId; defenderEntityId }
  | { seq; type:'damage'; phase:'ATTACK'|'DEATHS'; targetEntityId; damage; kind:'combat'|'effect'; sourceEntityId? }
  | { seq; type:'power-target'; phase:'START_OF_COMBAT'|'ATTACK'|'DEATHS'; sourceEntityId; targetEntityIds }
  | { seq; type:'entity-upsert'; phase:'START_OF_COMBAT'|'ATTACK'|'DEATHS'; entity: SanitizedEntity }
  | { seq; type:'spawn'; phase:'DEATHS'; spawned: SanitizedEntity[]; sourceEntityId?; insertIndexes? }
  | { seq; type:'minion-death'; phase:'DEATHS'; deadEntityIds; deadMinionsPositionsOnBoard? }
  | { seq; type:'player-attack'; phase:'END_OF_COMBAT'; damage }
  | { seq; type:'opponent-attack'; phase:'END_OF_COMBAT'; damage };
```

### 4.2 Spectator checkpoints (`SpectatorCheckpoint`)

```ts
export interface SpectatorCheckpoint {
  seq: number;
  reason: CheckpointReason;
  snapshot: GameAction; // full snapshot event (GameAction)
}
```

**Meaning**

* A checkpoint is a “thick” snapshot built from the last known context (boards/heroes/secrets/trinkets), meant for replay jump-in and debugging.

---

### 4.3 Snapshot schema (`GameAction` / `GameEventContext`)

The “snapshot” payload is a full context blob with:

* player/opponent board, hand, secrets, trinkets
* hero identity + hero powers
* quest reward identifiers (legacy-friendly)

```ts
export interface GameEventContext {
  playerBoard: readonly BoardEntity[];
  playerHand: readonly BoardEntity[];
  playerSecrets: readonly BoardSecret[];
  playerTrinkets: readonly BoardTrinket[];

  opponentBoard: readonly BoardEntity[];
  opponentHand: readonly BoardEntity[];
  opponentSecrets: readonly BoardSecret[];
  opponentTrinkets: readonly BoardTrinket[];

  playerCardId: string;
  playerEntityId: number;
  playerHeroPowerCardId: string;
  playerHeroPowerEntityId: number;
  playerHeroPowerUsed: boolean;
  playerHeroPowers: readonly BgsHeroPower[];

  opponentCardId: string;
  opponentEntityId: number;
  opponentHeroPowerCardId: string;
  opponentHeroPowerEntityId: number;
  opponentHeroPowerUsed: boolean;
  opponentHeroPowers: readonly BgsHeroPower[];

  playerRewardCardId: string;
  playerRewardEntityId: number;
  playerRewardData: number;

  opponentRewardCardId: string;
  opponentRewardEntityId: number;
  opponentRewardData: number;
}
```

Events that extend the context add minimal deltas:

* `attack` adds `{ attackerEntityId, defenderEntityId }`
* `damage` adds `{ damages: Damage[] }`
* etc.

---

### 4.4 Outcome samples (`GameSample`)

```ts
export interface GameSample {
  readonly actions: readonly GameAction[];
  readonly anomalies: readonly string[];
}
```

**Note**

* Samples contain *actions* (snapshots/events) and anomalies.
* Sample count is capped by spectator configuration constants (e.g., `MAX_SAMPLES`).

---

### 4.5 Experimental replay-first schema (`combat-log.types.ts`)

This file defines a more explicit replay log model (event types like `ATTACK_DECLARED`, `DAMAGE`, `MINION_DIED`, `SPAWNED`) plus a `CombatCheckpoint` that can optionally record RNG cursors.

Key pieces:

```ts
export interface CombatEventBase {
  readonly seq: number;
  readonly type: string;
  readonly phase?: CombatPhase;
  readonly parents?: readonly number[];
}

export interface CombatCheckpoint {
  readonly seq: number;
  readonly reason: 'SOC_END' | 'ATTACK_END' | 'DEATH_BATCH_END' | 'EVERY_N' | 'MANUAL';
  readonly stateHash?: string;
  readonly snapshot: CombatSnapshot;
  readonly rng?: { readonly streams?: readonly { readonly stream:'combat'|'discover'|'other'; readonly index:number }[] };
}

export interface CombatSnapshot { /* same shape as GameEventContext */ }
```

**Interpretation**

* This is a blueprint for “replay robustness”: the log can survive refactors better if it records *decisions* (or RNG cursors) rather than relying on implicit RNG call order.

---

## 5) Output Schema

### 5.1 `SingleSimulationResult`

```ts
export interface SingleSimulationResult {
  readonly result: 'won' | 'lost' | 'tied';
  readonly damageDealt: number;
}
```

### 5.2 `SimulationResult`

```ts
export interface SimulationResult {
  wonLethal: number;
  won: number;
  tied: number;
  lost: number;
  lostLethal: number;

  damageWon: number;
  damageWons: number[];
  damageWonRange: { min: number; max: number; };

  damageLost: number;
  damageLosts: number[];
  damageLostRange: { min: number; max: number; };

  wonLethalPercent: number;
  wonPercent: number;
  tiedPercent: number;
  lostPercent: number;
  lostLethalPercent: number;

  averageDamageWon: number;
  averageDamageLost: number;

  outcomeSamples?: OutcomeSamples;
}

export interface OutcomeSamples {
  won: readonly GameSample[];
  lost: readonly GameSample[];
  tied: readonly GameSample[];
}
```

**Notes**

* `damageWons/damageLosts` are arrays that appear to store per-run damage outcomes for distribution/ranges.
* `outcomeSamples` is optional and only produced when `includeOutcomeSamples` is enabled.

---

## 6) Serialization rules (what’s safe to persist)

### 6.1 Safe-to-persist

* `BgsBattleInfo` (input)
* `SimulationResult` (output)
* `OutcomeSamples` (if produced)
* `SpectatorEvent[]` and `SpectatorCheckpoint[]` (telemetry, with sanitized entities)

### 6.2 NOT safe to persist (runtime-only)

* Any object containing function fields (`BoardEntity.onCanceledSummon`)
* Service instances (`allCards`, `cardsData`)
* Debug wiring (`debugState`)
* Anything relying on object identity / references rather than value

### 6.3 “Mostly safe but you should be careful”

* Full `BoardEntity` objects: they include loose fields (`memory`, `dynamicInfo`, `tags`) that may not be stable across versions.
* Prefer sanitized entities for cross-version replay.

---

## 7) Compatibility and evolution guidelines

### 7.1 Additive changes preferred

For public-ish schemas (`BgsBattleInfo`, spectator events, checkpoints, simulation result):

* Add fields
* Avoid renames/removals
* If you must change meaning: keep old field and introduce a new one

### 7.2 Deprecated fields: keep input-tolerant

`BgsPlayerEntity` contains many deprecated hero power fields. Sanitation and snapshot builders already try to infer boards/hands from multiple legacy property names in some places. Keep that “tolerant reader” posture.

### 7.3 Make “branch decisions” explicit if replay matters

If you aim for deterministic replay:

* log key choices (targets, spawns, coin flips), or
* store RNG cursor(s) in checkpoints and ensure RNG consumption is stable.

---

## 8) Minimal JSON examples

### 8.1 Minimal `BgsBattleInfo`

```json
{
  "playerBoard": {
    "player": { "cardId": "HERO_X", "hpLeft": 40, "tavernTier": 6, "heroPowers": [], "questEntities": [] },
    "board": []
  },
  "opponentBoard": {
    "player": { "cardId": "HERO_Y", "hpLeft": 40, "tavernTier": 6, "heroPowers": [], "questEntities": [] },
    "board": []
  },
  "options": { "numberOfSimulations": 1, "skipInfoLogs": true },
  "gameState": { "currentTurn": 10 }
}
```

### 8.2 Example spectator thin event

```json
{ "seq": 12, "type": "attack", "phase": "ATTACK", "attackerEntityId": 7706, "defenderEntityId": 8857 }
```

### 8.3 Example `SimulationResult` (abridged)

```json
{
  "won": 1456, "tied": 1455, "lost": 1625,
  "wonPercent": 32.1, "tiedPercent": 32.1, "lostPercent": 35.8,
  "averageDamageWon": 6.2, "averageDamageLost": 12.1
}
```

---

## 9) Schema “pressure points” (things that bite refactors)

1. **Entity identity**

   * `entityId` uniqueness is sacred. Spawns must consume `SharedState.currentEntityId` correctly.

2. **Friendly/controller**

   * Many systems rely on `BoardEntity.friendly` to interpret ownership; sanitized entities include it explicitly.

3. **Death batch semantics**

   * Telemetry has explicit phase `DEATHS` and checkpoints include `DEATH_BATCH_END`. If you reorder death resolution, update both engine invariants and telemetry boundaries.

4. **Non-serializable runtime fields**

   * Function fields and direct object references (`lastAffectedByEntity?: BoardEntity`) are runtime conveniences, not replay contracts.

---

## 10) Suggested companion docs

* `STATE_MACHINE.md` (phase transitions and boundaries)
* `STATE_MANAGEMENT.md` (who mutates what, when, and why)
* `RNG.md` (determinism + RNG strategy)
* `TYPEDEFS.ts` / `TYPEDEFS.py` (canonical types for LLM + tooling)

```
