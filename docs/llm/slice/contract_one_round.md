It’s **not complete yet** as a “CONTRACTS_ONE_ROUND” contract set.

What you *do* already have in code that clearly supports “one round” contracts:

* A clean **single-simulation mode** via `options.numberOfSimulations: 1` (your “one round” knob).
* A **sample pipeline** gated by `options.includeOutcomeSamples`, with **hard cap** `MAX_SAMPLES = 1` and **checkpoint cadence** `CHECKPOINT_EVERY_N_EVENTS = 200`.
* A **stable, event-based replay shape** (`events[]` + `checkpoints[]`) being emitted at runtime by `Spectator` (even though the TS `GameSample` interface still only declares `actions/anomalies`).
* Compatibility intentions (migration away from `actions`, away from `targetEntityId`).

What’s still missing for “contracts-first” completeness:

* **Seed policy** (client-supplied vs server-generated, and echo-back).
* **Hard sizing rules** (max events, truncation behavior, max payload bytes).
* **Error contract** (status codes + structured validation/runtime errors).
* **Versioning rules** for request/response (not just `CombatLog.version`) and **deprecation timelines** (how long `actions` is tolerated).
* **Unit conventions** written down as normative rules.

Below is a **`contracts.md`** you can drop in now. It’s written as a **normative JSON contract** (required vs optional, defaults, example payloads), plus explicit “one round” semantics.

````markdown
# CONTRACTS_ONE_ROUND.md

Prevents API/UI/kernel schema mismatch by defining the exact JSON contract for **one round** of gameplay simulation.

## 0) Definitions

### One Round (Operational Meaning)
A **round** is a single deterministic resolution of a Battlegrounds combat:
- Input: two boards (player and opponent), their hero state, and combat-relevant game state.
- Execution: run the combat engine from **start-of-combat** through **end-of-combat** until a terminal outcome is reached.
- Output: one outcome bucket is populated (`won` OR `lost` OR `tied`), plus a replay log (`events`, `checkpoints`) when enabled.

**Contract requirement:** “one round” MUST be invoked with:
- `options.numberOfSimulations = 1`
- `options.intermediateResults = 0` (no intermediate streaming)

### One Simulation vs One Round
- **One simulation** is one execution of the combat engine.
- In CONTRACTS_ONE_ROUND, **one simulation == one round**.

---

## 1) Endpoint Contract

### HTTP
- Method: `POST`
- Path: implementation-defined (example: `/bgs/simulate`)
- Request `Content-Type`: `application/json`
- Response `Content-Type`: `application/json`

### Versioning
- Request MUST include `contractVersion`.
- Response MUST echo the same `contractVersion`.
- Backward compatibility rules are defined in §7.

---

## 2) Request JSON Contract

### Root Object: `OneRoundRequest`
| Field | Type | Required | Default | Notes |
|---|---|---:|---:|---|
| `contractVersion` | integer | ✅ | none | Current: `1` |
| `gameState` | object | ✅ | none | See `BgsGameState` |
| `playerBoard` | object | ✅ | none | See `BgsSide` |
| `opponentBoard` | object | ✅ | none | See `BgsSide` |
| `playerTeammateBoard` | object \| null | ❌ | `null` | Duos support |
| `opponentTeammateBoard` | object \| null | ❌ | `null` | Duos support |
| `heroHasDied` | boolean | ❌ | `false` | If true, engine may treat hero as dead |
| `options` | object | ✅ | none | See `SimOptions` |

> Unknown fields: MUST be rejected (400) in contractVersion 1.

---

### `SimOptions`
| Field | Type | Required | Default | Notes |
|---|---|---:|---:|---|
| `numberOfSimulations` | integer | ✅ | none | MUST be `1` for CONTRACTS_ONE_ROUND |
| `intermediateResults` | integer | ❌ | `0` | MUST be `0` for CONTRACTS_ONE_ROUND |
| `includeOutcomeSamples` | boolean | ❌ | `true` | If false, omit `outcomeSamples` |
| `damageConfidence` | number | ❌ | `0.9` | Range `(0, 1]` |
| `maxAcceptableDuration` | integer | ❌ | `8000` | Milliseconds |
| `hideMaxSimulationDurationWarning` | boolean | ❌ | `false` | Logging-only |
| `skipInfoLogs` | boolean | ❌ | `true` | Logging-only |
| `seed` | integer \| string | ❌ | none | See §5 (Determinism) |
| `maxEventLogEvents` | integer | ❌ | `10000` | Hard cap, truncation rules in §4 |
| `maxEventLogBytes` | integer | ❌ | `1_000_000` | Approx serialized bytes cap |

---

### `BgsGameState`
| Field | Type | Required | Default | Notes |
|---|---|---:|---:|---|
| `currentTurn` | integer | ❌ | `0` | Used by some effects |
| `anomalies` | string[] | ❌ | `[]` | Anomaly cardIds |
| `validTribes` | integer[] | ❌ | `[]` | Race ids |

---

### `BgsSide`
Represents one combatant’s board and hero.

| Field | Type | Required | Default | Notes |
|---|---|---:|---:|---|
| `board` | BoardEntity[] | ✅ | none | Combat board (left-to-right order) |
| `player` | BgsPlayerEntity | ✅ | none | Hero / controller state |
| `hand` | BoardEntity[] | ❌ | `[]` | Minions-in-hand if relevant |

---

### `BoardEntity`
(Combat-relevant minion representation)

| Field | Type | Required |
|---|---|---:|
| `entityId` | integer | ✅ |
| `cardId` | string | ✅ |
| `attack` | integer | ✅ |
| `health` | integer | ✅ |
| `friendly` | boolean | ❌ |

Optional combat flags (all boolean, default false if absent):
`taunt`, `divineShield`, `strongDivineShield`, `poisonous`, `venomous`, `reborn`, `windfury`, `stealth`, `cleave`, `cantAttack`, `locked`, `attackImmediately`, `definitelyDead`, `gildedInCombat`, etc.

Optional numeric/script fields:
`maxHealth`, `maxAttack`, `scriptDataNum1..scriptDataNum6`, `tavernTier`, `damageMultiplier`, etc.

Optional arrays/objects:
- `enchantments`: BoardEnchantment[]
- `pendingAttackBuffs`: integer[]
- `tags`: object `{ [tagNumber: integer]: integer }`
- `additionalCards`: string[] \| null

> Unit convention: `attack`, `health`, and all stat numbers are integers.

---

### `BoardSecret`
| Field | Type | Required | Default |
|---|---|---:|---:|
| `entityId` | integer | ✅ | none |
| `cardId` | string | ✅ | none |
| `triggered` | boolean | ❌ | `false` |
| `triggersLeft` | integer | ❌ | none |
| `scriptDataNum1` | integer | ❌ | none |
| `scriptDataNum2` | integer | ❌ | none |

---

### `BoardTrinket`
| Field | Type | Required |
|---|---|---:|
| `cardId` | string | ✅ |
| `entityId` | integer | ✅ |
| `scriptDataNum1` | integer | ✅ |
| `scriptDataNum2` | integer | ❌ |
| `scriptDataNum6` | integer | ❌ |
| `rememberedMinion` | BoardEntity | ❌ |
| `avengeDefault` | integer | ❌ |
| `avengeCurrent` | integer | ❌ |

---

### `BgsPlayerEntity` (contract-minimum)
This is the hero/controller state needed for combat + event context.

| Field | Type | Required | Default |
|---|---|---:|---:|
| `entityId` | integer | ✅ | none |
| `cardId` | string | ✅ | none |
| `tavernTier` | integer | ✅ | none |
| `heroPowers` | BgsHeroPower[] | ❌ | `[]` |
| `heroPowerUsed` | boolean | ❌ | `false` |
| `heroPowerId` | string \| null | ❌ | `null` |
| `questRewardEntities` | BoardEntity[] | ❌ | `[]` |
| `questRewards` | string[] | ❌ | `[]` |
| `trinkets` | BoardTrinket[] | ❌ | `[]` |
| `secrets` | BoardSecret[] | ❌ | `[]` |

---

### `BgsHeroPower` (contract-minimum)
| Field | Type | Required |
|---|---|---:|
| `cardId` | string | ✅ |
| `entityId` | integer | ❌ |
| `used` | boolean | ❌ |

---

## 3) Response JSON Contract

### Root Object: `OneRoundResponse`
| Field | Type | Required | Notes |
|---|---|---:|---|
| `contractVersion` | integer | ✅ | Echo request |
| `result` | SimulationResult | ✅ | Aggregate + samples |

### `SimulationResult`
All fields below are REQUIRED unless explicitly marked optional.

Counts:
- `wonLethal` (int)
- `won` (int)
- `tied` (int)
- `lost` (int)
- `lostLethal` (int)

Damage aggregates:
- `damageWon` (number)
- `damageLost` (number)
- `averageDamageWon` (number)
- `averageDamageLost` (number)
- `damageWonRange` `{ min: number, max: number }` OR `null`
- `damageLostRange` `{ min: number, max: number }` OR `null`

Percents (0..100):
- `wonLethalPercent` (number)
- `wonPercent` (number)
- `tiedPercent` (number)
- `lostPercent` (number)
- `lostLethalPercent` (number)

Samples:
- `outcomeSamples` (OutcomeSamples) OPTIONAL
  - Present IFF `options.includeOutcomeSamples = true`

> NOTE: Some implementations clear `damageWons` and `damageLosts` arrays before returning to reduce payload size.  
> In contractVersion 1: `damageWons` and `damageLosts` are OPTIONAL and SHOULD be omitted. If present, they MUST be arrays of numbers (possibly empty).

---

### `OutcomeSamples`
| Field | Type | Required | Notes |
|---|---|---:|---|
| `won` | GameSample[] | ✅ | length 0..1 |
| `lost` | GameSample[] | ✅ | length 0..1 |
| `tied` | GameSample[] | ✅ | length 0..1 |

**CONTRACTS_ONE_ROUND invariant:** exactly one of these arrays MUST have length 1 (the realized outcome), the other two MUST be empty.

---

### `GameSample`
A single replayable battle.

| Field | Type | Required | Notes |
|---|---|---:|---|
| `anomalies` | string[] | ✅ | Echo gameState anomalies |
| `events` | GameEvent[] | ✅ | Ordered by sequence |
| `checkpoints` | SpectatorCheckpoint[] | ✅ | Sparse snapshots |
| `actions` | GameEvent[] | ❌ (deprecated) | See §7. MUST NOT be relied on |

---

### `GameEvent` (event-based replay stream)
Each event MUST include the full `GameEventContext` plus event-specific fields.

#### `GameEventContext` fields (all REQUIRED)
- `playerBoard`: BoardEntity[]
- `playerHand`: BoardEntity[]
- `playerSecrets`: BoardSecret[]
- `playerTrinkets`: BoardTrinket[]
- `opponentBoard`: BoardEntity[]
- `opponentHand`: BoardEntity[]
- `opponentSecrets`: BoardSecret[]
- `opponentTrinkets`: BoardTrinket[]
- `playerCardId`: string
- `playerEntityId`: integer
- `playerHeroPowerCardId`: string \| null
- `playerHeroPowerEntityId`: integer
- `playerHeroPowerUsed`: boolean \| null
- `playerHeroPowers`: BgsHeroPower[]
- `opponentCardId`: string
- `opponentEntityId`: integer
- `opponentHeroPowerCardId`: string \| null
- `opponentHeroPowerEntityId`: integer
- `opponentHeroPowerUsed`: boolean \| null
- `opponentHeroPowers`: BgsHeroPower[]
- `playerRewardCardId`: string \| null
- `playerRewardEntityId`: integer \| null
- `playerRewardData`: integer \| null
- `opponentRewardCardId`: string \| null
- `opponentRewardEntityId`: integer \| null
- `opponentRewardData`: integer \| null

#### Event union (`type`)
1) `start-of-combat`
```json
{ "type": "start-of-combat", "...context": "..." }
````

2. `attack`

```json
{ "type": "attack", "attackerEntityId": 123, "defenderEntityId": 456, "...context": "..." }
```

3. `player-attack`

```json
{ "type": "player-attack", "damage": 7, "...context": "..." }
```

4. `opponent-attack`

```json
{ "type": "opponent-attack", "damage": 7, "...context": "..." }
```

5. `damage`

```json
{
  "type": "damage",
  "damages": [{ "sourceEntityId": 1, "targetEntityIds": [2], "damage": 3 }],
  "...context": "..."
}
```

Rules:

* `targetEntityIds` MUST be an array (even if length 1).
* `targetEntityId` is deprecated and MUST NOT appear in contractVersion 1 responses.

6. `power-target`

```json
{ "type": "power-target", "sourceEntityId": 200000001, "targetEntityIds": [2,3], "...context": "..." }
```

7. `spawn`

```json
{ "type": "spawn", "sourceEntityId": 1, "spawned": [{ "entityId": 9, "cardId": "X", "attack": 1, "health": 1 }], "insertIndexes": [3], "...context": "..." }
```

8. `minion-death`

```json
{ "type": "minion-death", "deadEntityIds": [9,10], "deadMinionsPositionsOnBoard": [2,5], "...context": "..." }
```

---

### `SpectatorCheckpoint`

| Field      | Type      | Required | Notes                                                                                |
| ---------- | --------- | -------: | ------------------------------------------------------------------------------------ |
| `seq`      | integer   |        ✅ | Last event sequence covered (inclusive)                                              |
| `reason`   | string    |        ✅ | One of: `SOC_START`, `SOC_END`, `ATTACK_END`, `DEATH_BATCH_END`, `EVERY_N`, `MANUAL` |
| `snapshot` | GameEvent |        ✅ | A full context snapshot event                                                        |

---

## 4) Limits + Sizing Rules

### Outcome samples

* `MAX_SAMPLES_PER_BUCKET = 1`
* For one round: only one bucket contains one sample.

### Checkpoints

* Engine SHOULD auto-checkpoint every `CHECKPOINT_EVERY_N_EVENTS = 200`.
* Engine MAY also checkpoint at phase boundaries (`SOC_END`, `ATTACK_END`, `DEATH_BATCH_END`).

### Event log caps (normative)

To prevent runaway payloads:

* If `events.length` would exceed `options.maxEventLogEvents` (default 10000), server MUST:

  1. stop recording further events,
  2. set `result.outcomeSamples.<bucket>[0].truncated = true` (boolean),
  3. include `truncationReason = "MAX_EVENTS"`.

* If serialized sample size would exceed `options.maxEventLogBytes` (default 1_000_000), server MUST truncate similarly with `"MAX_BYTES"`.

> Implementation note: if truncation fields are not yet present, add them before declaring contractVersion 1 “done”.

---

## 5) Determinism + Seed Policy

### Goal

Given the same request payload + same seed, the server SHOULD return identical `events` and identical result.

### Policy

* Client MAY provide `options.seed`.
* If `options.seed` is omitted, server MUST generate a seed and return it in:

  * `result.meta.seed` (new field)
* Response MUST echo the effective seed used:

  * `result.meta.seed` (integer or string)

### RNG streams

If multiple RNG streams exist internally, they MUST be derived from the seed in a documented way (example: `seed + streamId` hashing).

---

## 6) Error Contract

Errors MUST be JSON with a stable shape.

### Status Codes

* `400` Invalid JSON / missing required top-level fields
* `422` Schema validation error (types, ranges, invariants)
* `500` Runtime error during simulation
* `503` Timeouts / maxAcceptableDuration exceeded

### Error Body: `ErrorResponse`

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Human readable message",
    "requestId": "uuid-or-trace-id",
    "details": [
      { "path": "options.numberOfSimulations", "issue": "MUST_EQUAL", "expected": 1, "actual": 8000 }
    ]
  }
}
```

`details` is OPTIONAL for non-validation errors.

---

## 7) Versioning + Deprecation Rules

### Version negotiation

* Request MUST provide `contractVersion`.
* Response MUST echo it.
* Server MUST reject unknown major versions with `422` + `UNSUPPORTED_VERSION`.

### Deprecations

* `GameSample.actions` is deprecated.

  * Tolerated through contractVersion 1.
  * MUST be removed in contractVersion 2.
* `targetEntityId` (singular) is deprecated.

  * Responses in contractVersion 1 MUST use `targetEntityIds` only.
  * If older producers emit `targetEntityId`, server MUST migrate to `targetEntityIds` before returning.

---

## 8) Unit Conventions

* Percent fields: **0..100** (not 0..1).
* Damage: integers where representing discrete damage; aggregates may be floats (`averageDamageWon`).
* Entity stats (`attack`, `health`): integers.
* IDs (`entityId`): integers.
* Board order is left-to-right as provided in `board[]`.

---

## 9) Example Payloads

### Example Request (one round)

```json
{
  "contractVersion": 1,
  "gameState": { "currentTurn": 10, "anomalies": [], "validTribes": [15, 20] },
  "playerBoard": {
    "board": [{ "entityId": 1, "cardId": "BG_EXAMPLE_001", "attack": 3, "health": 2, "taunt": true }],
    "player": { "entityId": 100, "cardId": "BG_HERO_001", "tavernTier": 4, "heroPowers": [], "trinkets": [], "secrets": [] },
    "hand": []
  },
  "opponentBoard": {
    "board": [{ "entityId": 2, "cardId": "BG_EXAMPLE_002", "attack": 2, "health": 3 }],
    "player": { "entityId": 200, "cardId": "BG_HERO_002", "tavernTier": 4, "heroPowers": [], "trinkets": [], "secrets": [] },
    "hand": []
  },
  "options": {
    "numberOfSimulations": 1,
    "intermediateResults": 0,
    "includeOutcomeSamples": true,
    "damageConfidence": 0.95,
    "maxAcceptableDuration": 5000,
    "seed": 42
  }
}
```

### Example Response (one round, tied)

```json
{
  "contractVersion": 1,
  "result": {
    "wonLethal": 0,
    "won": 0,
    "tied": 1,
    "lost": 0,
    "lostLethal": 0,
    "damageWon": 0,
    "damageLost": 0,
    "damageWonRange": null,
    "damageLostRange": null,
    "wonLethalPercent": 0,
    "wonPercent": 0,
    "tiedPercent": 100,
    "lostPercent": 0,
    "lostLethalPercent": 0,
    "averageDamageWon": 0,
    "averageDamageLost": 0,
    "meta": { "seed": 42 },
    "outcomeSamples": {
      "won": [],
      "lost": [],
      "tied": [
        {
          "anomalies": [],
          "events": [
            { "type": "start-of-combat", "playerBoard": [], "playerHand": [], "playerSecrets": [], "playerTrinkets": [], "opponentBoard": [], "opponentHand": [], "opponentSecrets": [], "opponentTrinkets": [], "playerCardId": "BG_HERO_001", "playerEntityId": 100, "playerHeroPowerCardId": null, "playerHeroPowerEntityId": 200000001, "playerHeroPowerUsed": null, "playerHeroPowers": [], "opponentCardId": "BG_HERO_002", "opponentEntityId": 200, "opponentHeroPowerCardId": null, "opponentHeroPowerEntityId": 200000002, "opponentHeroPowerUsed": null, "opponentHeroPowers": [], "playerRewardCardId": null, "playerRewardEntityId": null, "playerRewardData": null, "opponentRewardCardId": null, "opponentRewardEntityId": null, "opponentRewardData": null }
          ],
          "checkpoints": []
        }
      ]
    }
  }
}
```
