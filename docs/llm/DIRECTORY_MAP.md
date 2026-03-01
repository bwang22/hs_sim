# DIRECTORY_MAP.md

This directory map is derived from the concatenated TypeScript dump **`all_ts_dump.txt`** (674 `.ts` files). It reflects the **TS-only** view of the repo, so non-TS assets (package.json, configs, etc.) are not represented here. 

---

## 1) Repo shape at a glance

* **Total TS files:** 674
* **`src/`**: 666 files (library + simulator implementation)
* **`test/`**: 8 files (determinism + full-game runners)

Biggest weight class:

* `src/cards/impl/minion/` = **451** files (card-by-card implementations)

---

## 2) High-level tree (onboarding-friendly)

```text
.
├── src/  (666)
│   ├── [entry + core types] (15 files at src root)
│   ├── cards/  (575)
│   │   ├── card.interface.ts
│   │   ├── cards-data.ts
│   │   └── impl/  (573)
│   │       ├── _card-mappings.ts
│   │       ├── anomaly/      (2)
│   │       ├── bg-spell/     (28)
│   │       ├── hero-power/   (21)
│   │       ├── minion/       (451)
│   │       ├── quest-reward/ (4)
│   │       ├── spell/        (1)
│   │       ├── spellcraft/   (25)
│   │       └── trinket/      (40)
│   ├── keywords/   (6)
│   ├── lib/        (1)
│   ├── mechanics/  (3)
│   ├── services/   (2)
│   └── simulation/ (64)
│       ├── [engine files] (36 files at simulation root)
│       ├── replay/         (2)
│       ├── spectator/      (12)
│       ├── start-of-combat/(12)
│       └── utils/          (2)
└── test/ (8)
    ├── rng-patch-smoke.ts
    ├── rng-smoke.ts
    └── full-game/ (6)
```

---

## 3) `src/` root (entrypoints, types, and “outer loop”)

These 15 files are the “front door” and core shared models:

* `simulate-bgs-battle.ts`
  Main entrypoint: sets up services, sanitizes input, runs Monte Carlo, aggregates results.
* `simulate-bgs-battle copy.ts`
  Legacy/alternate entrypoint variant.
* `input-sanitation.ts`
  Normalizes raw inputs so combat logic can assume consistent state.
* `input-clone.ts`
  Efficient cloning per iteration (important because entities are mutated during sim).
* **Core types**

  * `bgs-battle-info.ts`, `bgs-board-info.ts`, `bgs-battle-options.ts`
  * `bgs-player-entity.ts`, `board-entity.ts`, `board-secret.ts`
* **Results**

  * `simulation-result.ts`, `single-simulation-result.ts`
* **Debug helpers**

  * `debug-state.ts`
* **Grab bag utilities**

  * `utils.ts`
  * `temp-card-ids.ts` (temporary or transitional card ID definitions)

---

## 4) `src/simulation/` (the combat engine)

### 4.1 Simulation root files (36)

Think of these as the engine’s “organs”:

**Orchestration and state**

* `simulator.ts` (single-combat conductor)
* `internal-game-state.ts` (FullGameState/GameState/PlayerState)
* `shared-state.ts` (shared counters, currentEntityId, etc.)

**Attack loop and timing windows**

* `attack.ts`
* `on-attack.ts`
* `on-being-attacked.ts`
* `after-attack.ts`

**Damage, deaths, deathrattles**

* `damage-effects.ts`
* `damage-to-hero.ts`
* `minion-death.ts`
* `minion-kill.ts`
* `death-effects.ts`
* `deathrattle-orchestration.ts`
* `deathrattle-effects.ts`
* `deathrattle-on-trigger.ts`
* `deathrattle-spawns.ts`
* `deathrattle-utils.ts`
* `remembered-deathrattle.ts`
* `reborn.ts`
* `frenzy.ts`

**Board mutation + spawns**

* `add-minion-to-board.ts`
* `remove-minion-from-board.ts`
* `spawns.ts`
* `spawn-fail.ts`
* `summon-when-space.ts`

**Common mechanics**

* `auras.ts`
* `enchantments.ts`
* `magnetize.ts`
* `battlecries.ts`
* `blood-gems.ts`
* `avenge.ts`
* `secrets.ts`
* `quest.ts`
* `discover.ts`
* `cards-in-hand.ts`
* `stats.ts`

### 4.2 `src/simulation/start-of-combat/` (12)

Start-of-combat is a dedicated mini-pipeline:

* `start-of-combat.ts` (main SoC wiring + ordering)
* `start-of-combat-input.ts` (SoCInput shape)
* `phases.ts`
* `soc-action-processor.ts`
* `soc-anomalies.ts`
* `soc-hero-power.ts`
* `soc-pre-combat-hero-power.ts`
* `soc-illidan-hero-power.ts`
* `soc-minion.ts`
* `soc-quest-reward.ts`
* `soc-secret.ts`
* `soc-trinket.ts`

### 4.3 `src/simulation/spectator/` (12)

Telemetry and replay-friendly logging:

* `spectator.ts` (main recorder)
* `spectator-sanitize.ts` (clone/sanitize mutated entities before storing)
* `spectator-types.ts`
* `combat-log.ts`, `combat-log.types.ts`
* `game-action.ts`, `game-sample.ts`
* `spectator-collapse-actions.ts`
* `spectator copy*.ts`, `game-action copy.ts` (legacy variants)

### 4.4 `src/simulation/replay/` (2)

State reconstruction from events/checkpoints:

* `apply-event.ts`
* `apply-event copy.ts` (legacy variant)

### 4.5 `src/simulation/utils/` (2)

* `entity-utils.ts` (ex: `canAttack`-type helpers)
* `golden.ts` (golden logic like make/identify)

---

## 5) `src/cards/` (hook system + card content)

### 5.1 Core card plumbing (2)

* `card.interface.ts`
  Defines hook interfaces (Start of Combat, Deathrattle, Rally, etc.) and type guards (`hasStartOfCombat(...)`, etc.).
* `cards-data.ts`
  Derived battlegrounds pools and helper lookups (spawn pools, tier pools, keyword pools, etc.).

### 5.2 `src/cards/impl/` registry (1)

* `_card-mappings.ts`
  The wiring layer: maps `cardId -> implementation`.

### 5.3 `src/cards/impl/*` content categories (573 total)

Each subfolder contains many small files, typically one implementation per file, in kebab-case naming.

* `minion/` (451)
  Most gameplay logic lives here.
* `trinket/` (40)
* `bg-spell/` (28)
* `spellcraft/` (25)
* `hero-power/` (21)
* `quest-reward/` (4)
* `anomaly/` (2)
* `spell/` (1)

**Naming convention:**
`some-card-name.ts` exports a typed object (ex: `StartOfCombatCard`, `BattlecryCard`, `DeathrattleSpawnCard`) and lists `cardIds: [...]`.

---

## 6) Smaller but important supporting folders

### `src/keywords/` (6)

Centralizes keyword state updates and any side effects:

* `divine-shield.ts`
* `reborn.ts`
* `stealth.ts`
* `taunt.ts`
* `venomous.ts`
* `windfury.ts`

### `src/mechanics/` (3)

Cross-cutting mechanics that don’t belong to a single card file:

* `cast-tavern-spell.ts`
* `player-global-effects.ts`
* `rally.ts`

### `src/services/` (2)

Shared services and constants:

* `card-ids.ts` (huge CardIds enum)
* `utils.ts` (pickRandom, shuffle, grouping, helpers)

### `src/lib/` (1)

* `rng.ts` (seeded PRNG utilities used by tests and optional determinism)

---

## 7) `test/` (determinism + “full game” harness)

### Test root (2)

* `rng-smoke.ts`
* `rng-patch-smoke.ts` (patches randomness, validates stability)

### `test/full-game/` (6)

* `seeded-runner.ts` (patches RNG, runs full tests deterministically)
* `full-test.ts` (+ `full-test copy*.ts`)
* `apply-debug-state.ts`
* `replay-base64.ts`

---

## 8) “Where should a new dev look first?”

If they are touching:

* **Core sim behavior:** `src/simulation/simulator.ts`, `attack.ts`, `minion-death.ts`, `deathrattle-orchestration.ts`
* **Start-of-combat ordering:** `src/simulation/start-of-combat/start-of-combat.ts`
* **A card:** `src/cards/impl/<category>/...` plus `_card-mappings.ts`
* **Debug/replay:** `src/simulation/spectator/*` and `src/simulation/replay/*`
* **Determinism:** `src/lib/rng.ts` + `test/full-game/seeded-runner.ts`
