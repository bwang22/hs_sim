# API_CONTRACTS.md

This doc specifies the **public API contracts** and “boundary shapes” for this combat simulator, based on the TypeScript snapshot in `all_ts_dump.txt`. It focuses on what external callers should send/receive, what is stable vs legacy, and what invariants a caller can rely on.

It also documents the “secondary contracts” used for debugging and replay output when enabled.

---

## 1) Overview: what the API does

Given a `BgsBattleInfo` payload that describes:

* player board + hero state
* opponent board + hero state
* optional teammate boards (duos)
* simulation options
* global combat context (turn, valid tribes, anomalies)

…the simulator runs `N` combats and returns a `SimulationResult`:

* win/tie/loss odds (with lethal variants)
* damage distributions (average + range)
* optional outcome samples (representative combats) if enabled

Execution modes:

* **Library mode**: call `simulateBattle(battleInfo)` (generator)
* **Lambda mode**: default export handler expects JSON `event.body` and returns JSON `body`

---

## 2) Primary input contract: `BgsBattleInfo`

### 2.1 Type definition (caller-facing)

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
```

### 2.2 Semantics

* `playerBoard` and `opponentBoard` are required.
* `*TeammateBoard` enables duos behavior (board swap when one side is defeated).
* `heroHasDied` is an optional hint used for edge-case handling (e.g., ghost states).

### 2.3 Invariants callers must honor

* Each `BoardEntity` should have a unique `entityId` within the input.
* Board order is left-to-right: position matters.
* `friendly` flags should be consistent:

  * player side `friendly: true`
  * opponent side `friendly: false`
  * (sanitation may fill missing values, but callers should provide them)

---

## 3) `BgsGameState` (global combat context)

```ts
export interface BgsGameState {
  readonly currentTurn: number;
  readonly validTribes?: readonly Race[];
  readonly anomalies?: readonly string[];
}
```

### Semantics

* `currentTurn` is required.
* `validTribes` restricts tribe pools (e.g., BG tribe rotation).
* `anomalies` describes global anomaly modifiers active for the combat.

### Compatibility note

There is a legacy field `BgsBattleOptions.validTribes` marked deprecated. Callers should prefer `gameState.validTribes`.

---

## 4) `BgsBattleOptions` (simulation configuration)

### 4.1 Type definition

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

### 4.2 Semantics of key fields

* `numberOfSimulations`
  Iterations to run (accuracy vs speed). Required.
* `maxAcceptableDuration`
  Wall-clock safety stop (ms). Simulator may stop early and return partial aggregate.
* `intermediateResults`
  Yield cadence for generator usage (library mode).
* `includeOutcomeSamples`
  If true, simulator retains representative combats with event/action logs.
* `damageConfidence`
  Controls confidence bounds for damage range computation.
* `skipInfoLogs`
  If true, suppresses verbose info logs.

### 4.3 Caller guarantees

* If the simulator stops early due to time limit, percents are computed from completed iterations.
* Output still conforms to `SimulationResult` schema, but accuracy is reduced.

---

## 5) `BgsBoardInfo` (one side’s hero + board)

```ts
export interface BgsBoardInfo {
  readonly player: BgsPlayerEntity;
  readonly board: BoardEntity[];
  /** @deprecated */
  readonly secrets?: BoardSecret[];
}
```

### Semantics

* `player` stores hero-side state (hp, tavern tier, trinkets, hero powers, quests, secrets).
* `board` is an ordered list of minion entities.

### Compatibility note

Older consumers may provide secrets at board-level via deprecated `secrets`. Prefer `player.secrets`.

---

## 6) `BoardEntity` (minion-like unit)

### 6.1 Minimum required fields

For simulation correctness, callers should provide at least:

```ts
{
  entityId: number;
  cardId: string;
  attack: number;
  health: number;
  friendly: boolean;
}
```

### 6.2 Common optional fields (caller can provide)

* `maxHealth`, `maxAttack`
* keywords: `taunt`, `divineShield`, `poisonous`, `venomous`, `reborn`, `windfury`, `stealth`
* `enchantments?: BoardEnchantment[]`
* `tags?: { [tag: number]: number }`
* `scriptDataNum1..6` (card-specific state channels)
* special runtime flags (normally engine-owned): `attackImmediately`, `definitelyDead`, etc

### 6.3 Strong guidance

* Treat `scriptDataNum*` and `tags` as “card-defined.” If you don’t know them, omit them.
* Avoid sending engine-only flags (`attackImmediately`, `hasAttacked`, etc) unless you intentionally want those behaviors.

---

## 7) `BgsPlayerEntity` (hero-side unit)

### 7.1 Required subset for callers

At minimum:

```ts
{
  cardId: string;
  hpLeft: number;
  tavernTier: number;
  heroPowers: BgsHeroPower[];
  questEntities: BgsQuestEntity[];
  friendly: boolean;
}
```

### 7.2 Common optional fields

* `hand?: BoardEntity[]` (some SoC-from-hand effects exist)
* `secrets?: BoardSecret[]`
* `trinkets?: BoardTrinket[]`
* `globalInfo?: BgsPlayerGlobalInfo` (counters used by many mechanics)
* quest rewards and reward entities (varies by season)
* multiple deprecated single-hero-power fields (avoid; keep compatibility only)

### 7.3 Compatibility guidance

Prefer:

* `heroPowers: BgsHeroPower[]`
  over deprecated:
* `heroPowerId`, `heroPowerEntityId`, `heroPowerUsed`, etc.

---

## 8) Primary output contract: `SimulationResult`

### 8.1 Type definition (logical)

A `SimulationResult` includes:

* outcome counts:

  * `won`, `tied`, `lost`
  * `wonLethal`, `lostLethal`
* outcome percents:

  * `wonPercent`, `tiedPercent`, `lostPercent`
  * `wonLethalPercent`, `lostLethalPercent`
* damage aggregates:

  * `damageWon`, `damageLost` (sum)
  * `averageDamageWon`, `averageDamageLost`
  * `damageWonRange`, `damageLostRange` (min/max)
  * `damageWons`, `damageLosts` (raw arrays, usually cleared before final return)
* optional samples:

  * `outcomeSamples?: OutcomeSamples`

### 8.2 Semantics

* Win/tie/loss are computed from the perspective of `playerBoard`.
* Damage is “hero damage dealt” at end of combat (tavern tier + tech levels, etc).

### 8.3 Guarantees

* Percent fields are always present.
* Ranges always present (even if min=max).
* Samples appear only when enabled and may be pruned.

---

## 9) Optional debug output contract: Outcome samples

### 9.1 `OutcomeSamples`

```ts
export interface OutcomeSamples {
  won: readonly GameSample[];
  lost: readonly GameSample[];
  tied: readonly GameSample[];
}
```

### 9.2 `GameSample`

A sample is a representative combat narrative. In practice, the sample includes:

* a list of actions/events (viewer/debuggable)
* anomaly list (context)

The codebase has some migration logic that renames or reshapes fields for backward compatibility.

### 9.3 What callers should expect

* Samples are not exhaustive; they’re a limited set for “what a typical win looks like.”
* Payload size can be large. Don’t enable samples for latency-sensitive production unless needed.

---

## 10) Telemetry contracts (secondary, internal-facing)

These are mainly for replay tooling, not external callers, but they are useful if you build a UI.

### 10.1 Thin event stream (`SpectatorEvent[]`)

* Minimal, `seq` ordered
* Types: start-of-combat, attack, damage, spawn, minion-death, power-target, entity-upsert, hero-damage markers
* Uses `SanitizedEntity` subsets

### 10.2 Checkpoints (`SpectatorCheckpoint[]`)

* `seq`, reason, and a fat snapshot action
* Used for fast seek and bounded replay

### 10.3 Fat actions (`GameAction[]`)

* Includes full `GameEventContext` (boards/hands/secrets/trinkets/hero powers)
* Best for inspection and debugging

**Important contract invariant:**
Replay removal uses explicit death events; damage alone does not remove entities.

---

## 11) Lambda handler contract (service boundary)

### 11.1 Request

* Event must have `body` containing JSON stringified `BgsBattleInfo`.

### 11.2 Response

Returns:

```ts
{
  statusCode: number;
  body: string; // JSON stringified SimulationResult
}
```

### 11.3 Errors

If JSON parsing fails or required fields are missing, expect runtime error behavior (no strict schema validation layer is present in the code snapshot).

**Recommendation:** If exposing as a service, add a thin validation layer before calling the simulator.

---

## 12) Validation rules (recommended, not strictly enforced today)

If you want your API boundary to be robust, validate:

### 12.1 Entity validation

* `entityId` unique within each board + hand
* `attack` and `health` are finite numbers
* `cardId` is non-empty
* `friendly` matches which board it’s on

### 12.2 Player validation

* `hpLeft >= 0`
* `tavernTier` within expected range (1..6 typical)
* `heroPowers` array present (empty ok)

### 12.3 Options validation

* `numberOfSimulations >= 1`
* `maxAcceptableDuration` reasonable (> 0)
* `damageConfidence` in (0, 1]

---

## 13) Backward compatibility and deprecations

### Deprecated inputs

* `BgsBattleOptions.validTribes` → use `BgsGameState.validTribes`
* `BgsBoardInfo.secrets` → use `BgsPlayerEntity.secrets`
* Single hero power fields on `BgsPlayerEntity` → use `heroPowers[]`

### Compatibility behavior

The simulator attempts to accommodate older shapes by:

* reading legacy fields when the new ones are absent
* normalizing the inputs (`buildFinalInput`) before running simulation

---

## 14) Stability guidance: what you can treat as stable

### Stable for external callers

* `BgsBattleInfo` and its primary nested shapes (`BgsBoardInfo`, `BoardEntity`, `BgsPlayerEntity`)
* `BgsBattleOptions` key knobs
* `SimulationResult` win/tie/loss and damage aggregates

### Less stable / internal

* Telemetry shapes (`SpectatorEvent`, checkpoint reasons)
* Exact sample payload fields (migration code exists, suggests evolution)
* Many optional fields on entities/heroes (they change with BG seasons)

---

## 15) Minimal “contract examples”

### 15.1 Smallest valid input

```json
{
  "playerBoard": {
    "player": { "cardId":"HERO_01","hpLeft":40,"tavernTier":5,"heroPowers":[],"questEntities":[],"friendly":true },
    "board": []
  },
  "opponentBoard": {
    "player": { "cardId":"HERO_02","hpLeft":40,"tavernTier":5,"heroPowers":[],"questEntities":[],"friendly":false },
    "board": []
  },
  "options": { "numberOfSimulations": 1000, "skipInfoLogs": true },
  "gameState": { "currentTurn": 10 }
}
```

### 15.2 Typical output shape (abridged)

```json
{
  "won": 321,
  "tied": 310,
  "lost": 369,
  "wonPercent": 32.1,
  "tiedPercent": 31.0,
  "lostPercent": 36.9,
  "averageDamageWon": 7.2,
  "averageDamageLost": 10.8,
  "damageWonRange": { "min": 4, "max": 11 },
  "damageLostRange": { "min": 6, "max": 16 }
}
```
