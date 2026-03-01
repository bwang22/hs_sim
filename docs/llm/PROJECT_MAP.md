# PROJECT_MAP.md

This is a navigation guide for the TypeScript codebase captured in `all_ts_dump.txt` (674 TS files total). It’s meant to answer: **“Where do I go to change X?”** and **“How is the project laid out?”** 🧭

---

## 1) Repo at a glance

### Top-level folders

* `src/` (666 files): the simulator library + Lambda-style entrypoint
* `test/` (8 files): deterministic runners + full-game snapshot tests

### Biggest buckets inside `src/`

* `src/cards/**` (575 files)

  * `src/cards/impl/**` (573 files): the actual per-card logic
* `src/simulation/**` (64 files): combat engine + SoC + telemetry/replay
* A few supporting modules: `keywords/`, `mechanics/`, `services/`, `lib/`

---

## 2) “If I want to…” quick pointers

* **Run a combat simulation**
  Start at `src/simulate-bgs-battle.ts` (Lambda handler + `simulateBattle(...)` generator).

* **Fix weird input edge cases (ghosts, missing auras, inconsistent fields)**
  Go to `src/input-sanitation.ts` and `src/input-clone.ts`.

* **Change core combat rules (attacks, targeting, death handling)**
  Start at `src/simulation/simulator.ts`, then jump into:

  * `src/simulation/attack.ts`
  * `src/simulation/minion-death.ts`, `deathrattle-*`, `reborn.ts`
  * `src/simulation/damage-effects.ts`

* **Change Start of Combat ordering or add a new SoC step**
  `src/simulation/start-of-combat/start-of-combat.ts` and friends.

* **Add or modify a single card’s behavior**

  1. Implement in `src/cards/impl/<category>/...`
  2. Register in `src/cards/impl/_card-mappings.ts`
  3. Ensure a hook exists in `src/cards/card.interface.ts` (or add one)

* **Understand/debug “what happened” in a combat**
  `src/simulation/spectator/*` (event log + samples) and `src/simulation/replay/*`.

* **Make runs deterministic**
  The project uses `Math.random()` in many places; tests patch it with a seeded RNG.
  See `src/lib/rng.ts` + `test/full-game/seeded-runner.ts`.

---

## 3) Core domain types (the vocabulary)

These are the “shapes” everything else manipulates.

### Input model

* `src/bgs-battle-info.ts`

  * `BgsBattleInfo`: contains boards for player/opponent (+ teammate boards in duos), options, and `gameState`.
* `src/bgs-board-info.ts`

  * `BgsBoardInfo`: `{ player: BgsPlayerEntity, board: BoardEntity[] }`
* `src/bgs-battle-options.ts`

  * `BgsBattleOptions`: simulation runtime knobs (iterations, time limits, etc)

### Entities

* `src/bgs-player-entity.ts`

  * `BgsPlayerEntity`: hero-side container (hpLeft, tavernTier, hero powers, trinkets, quests, secrets, global counters)
  * Note: lots of `/** @deprecated */` fields exist for backwards compatibility
* `src/board-entity.ts`

  * `BoardEntity`: the minion-like unit with stats, keywords, enchantments, and sim-only flags
* `src/board-secret.ts`

  * `BoardSecret`: secret payloads

### Outputs

* `src/simulation-result.ts`

  * `SimulationResult`: aggregated win/tie/loss + damage ranges + optional outcome samples
* `src/single-simulation-result.ts`

  * `SingleSimulationResult`: winner + damage for one simulated combat

---

## 4) Entrypoints and “outer loop”

### `src/simulate-bgs-battle.ts`

What it does:

* Parses input (`BgsBattleInfo`)
* Initializes card DB (`AllCardsService`) + derived battlegrounds data (`CardsData`)
* Normalizes input (`buildFinalInput`)
* Runs the Monte Carlo iterator (`simulateBattle(...)`)
* Returns aggregated `SimulationResult`

Also present:

* `src/simulate-bgs-battle copy.ts` (legacy/alternate version, similar role)

### Input cloning and sanitation

* `src/input-clone.ts`

  * `cloneInput3(...)`: structured deep-ish clone tuned for sim performance
* `src/input-sanitation.ts`

  * `buildFinalInput(...)`: fixes/normalizes “real world” inputs so combat code can assume consistency

---

## 5) Simulation engine layout (`src/simulation/`)

Think of this folder as the “physics engine” of combat. It’s split into:

1. orchestration (`simulator.ts`)
2. phase pipelines (Start of Combat, attack loop, death loop)
3. utility mechanics (auras, enchantments, battlecries, magnetize, etc)
4. telemetry/replay (spectator + replay)

### 5.1 Orchestration

* `src/simulation/simulator.ts`

  * Main coordinator for a single combat:

    * decides initial attacker
    * runs Start of Combat
    * loops attacks until resolution
    * computes winner and damage

### 5.2 State containers

* `src/simulation/internal-game-state.ts`

  * `FullGameState`, `GameState`, `PlayerState`
* `src/simulation/shared-state.ts`

  * `SharedState`: shared counters like `currentEntityId`, misc global mutable scratch

### 5.3 Start of Combat pipeline

Folder: `src/simulation/start-of-combat/` (12 files)

Key files:

* `start-of-combat.ts`: entrypoint, wiring, high-level ordering
* `phases.ts`: phase enum/type
* `start-of-combat-input.ts`: SoC input bundle
* `soc-*.ts`: specific SoC modules (hero powers, anomalies, secrets, trinkets, minions, quests)
* `soc-action-processor.ts`: runs discrete SoC actions

### 5.4 Combat resolution building blocks (selected)

Below is the “combat toolbox” you’ll bounce between when changing engine rules.

#### Attacks and targeting

* `src/simulation/attack.ts`

  * `simulateAttack(...)`, target selection helpers, neighbor/cleave helpers, damage application entrypoints
* `src/simulation/on-attack.ts`

  * triggers that occur when an attack is declared/performed
* `src/simulation/on-being-attacked.ts`

  * triggers reacting to being attacked
* `src/simulation/after-attack.ts`

  * post-attack effects (including trinkets)

#### Damage, deaths, and deathrattles

* `src/simulation/damage-effects.ts`

  * “after deal/take damage” style hooks
* `src/simulation/minion-death.ts`

  * resolving death detection and sequencing
* `src/simulation/death-effects.ts`

  * death-related hooks that are not strictly deathrattle spawns
* `src/simulation/deathrattle-orchestration.ts`

  * the “conductor” for multiple deathrattles firing in correct order
* `src/simulation/deathrattle-effects.ts`, `deathrattle-spawns.ts`, `deathrattle-utils.ts`, `deathrattle-on-trigger.ts`

  * specialized helpers for deathrattle mechanics
* `src/simulation/reborn.ts`

  * reborn processing
* `src/simulation/remembered-deathrattle.ts`

  * “fish-like” memory mechanics

#### Spawning and board management

* `src/simulation/spawns.ts`

  * core spawn resolution
* `src/simulation/summon-when-space.ts`

  * passive/continuous “fill empty slots” summons
* `src/simulation/add-minion-to-board.ts`

  * the canonical “put entity on board” entrypoint (and aura side effects)
* `src/simulation/remove-minion-from-board.ts`

  * remove entity cleanly, preserving invariants
* `src/simulation/spawn-fail.ts`

  * what happens when a summon cannot occur

#### Other common mechanics

* `src/simulation/auras.ts`

  * applying missing auras and maintaining aura consistency
* `src/simulation/enchantments.ts`

  * applying/removing enchantments
* `src/simulation/magnetize.ts`
* `src/simulation/battlecries.ts`
* `src/simulation/blood-gems.ts`
* `src/simulation/avenge.ts`
* `src/simulation/secrets.ts`
* `src/simulation/quest.ts`
* `src/simulation/discover.ts`
* `src/simulation/cards-in-hand.ts`

  * hand entities that have SoC-from-hand behaviors

#### Utilities

* `src/simulation/utils/entity-utils.ts`

  * `canAttack(...)` and related checks
* `src/simulation/utils/golden.ts`

  * `makeMinionGolden(...)`, `isMinionGolden(...)`

### 5.5 Compact index of `src/simulation/*.ts`

| File                                                        | What you usually go there for                    |
| ----------------------------------------------------------- | ------------------------------------------------ |
| `attack.ts`                                                 | attack resolution, targeting, damage to minions  |
| `simulator.ts`                                              | the main combat loop coordinator                 |
| `minion-death.ts`                                           | detecting and processing deaths                  |
| `deathrattle-orchestration.ts`                              | ordering and execution of multiple deathrattles  |
| `spawns.ts`                                                 | spawning entities and “attack immediately” flows |
| `add-minion-to-board.ts` / `remove-minion-from-board.ts`    | board mutation invariants + aura side effects    |
| `damage-effects.ts`                                         | after-damage triggers and hooks                  |
| `after-attack.ts` / `on-attack.ts` / `on-being-attacked.ts` | timing windows around attacks                    |
| `auras.ts`                                                  | aura bookkeeping and fixes                       |
| `enchantments.ts`                                           | enchant application logic                        |
| `reborn.ts`                                                 | reborn behavior                                  |
| `secrets.ts`                                                | secret activation logic                          |
| `quest.ts`                                                  | quest reward triggers                            |
| `blood-gems.ts`                                             | blood gem application                            |
| `battlecries.ts`                                            | battlecry multipliers + triggers                 |
| `magnetize.ts`                                              | magnetize resolution                             |
| `avenge.ts`                                                 | avenge counters and triggers                     |
| `damage-to-hero.ts`                                         | hero damage computation                          |
| `stats.ts`                                                  | stat modifications and helper logic              |
| `summon-when-space.ts`                                      | filling boards with passive summons              |

---

## 6) Cards system (`src/cards/`)

### 6.1 Hook definitions and type guards

* `src/cards/card.interface.ts`

  * Defines the big `Card` interface plus many specialized hook interfaces:

    * `StartOfCombatCard`, `OnAttackCard`, `DeathrattleSpawnCard`, etc
  * Provides type guards like `hasStartOfCombat(...)`, `hasOnSpawned(...)` so engine code can safely call hooks.

### 6.2 Derived battlegrounds data

* `src/cards/cards-data.ts`

  * `CardsData`: battlegrounds-specific derived values and pools (tribes, avenge values, token pools, etc)

### 6.3 Implementation registry

* `src/cards/impl/_card-mappings.ts`

  * Central registry mapping cardId -> implementation object(s)
  * If “a card does nothing”, this is one of the first places to verify wiring.

### 6.4 Implementation categories (573 files total)

* `src/cards/impl/minion/*` (451)
* `src/cards/impl/trinket/*` (40)
* `src/cards/impl/bg-spell/*` (28)
* `src/cards/impl/spellcraft/*` (25)
* `src/cards/impl/hero-power/*` (21)
* `src/cards/impl/quest-reward/*` (4)
* `src/cards/impl/anomaly/*` (2)
* `src/cards/impl/spell/*` (1)

**Common pattern inside an impl file**

* Export a `const` named after the card, typed as one (or several) hook interfaces.
* Include `cardIds: [...]` list.
* Implement hook functions that receive:

  * the acting `BoardEntity` (or trinket/hero power entity)
  * a typed `input` bundle (board, heroes, `FullGameState`, etc)

---

## 7) Keywords (`src/keywords/`)

These are “keyword update” helpers that centralize granting/removing statuses:

* `divine-shield.ts`
* `reborn.ts`
* `stealth.ts`
* `taunt.ts`
* `venomous.ts`
* `windfury.ts`

If you find keyword logic duplicated across cards, this folder is usually the consolidation target.

---

## 8) Cross-cutting mechanics (`src/mechanics/`)

These are larger-than-a-card but smaller-than-the-engine features:

* `cast-tavern-spell.ts`: casting and spell-cast triggers
* `player-global-effects.ts`: global counter-based buffs (example: volumizer-type scaling)
* `rally.ts`: rally mechanic trigger wiring

---

## 9) Low-level utilities and shared constants

* `src/services/card-ids.ts`

  * `CardIds` enum: enormous mapping of all card id strings
* `src/services/utils.ts`

  * `pickRandom`, `shuffleArray`, base64 encode/decode, grouping helpers
* `src/lib/rng.ts`

  * deterministic PRNG (`mulberry32`) used in tests (and can be used in prod if you want)

---

## 10) Telemetry and replay (`src/simulation/spectator` + `replay`)

### Spectator (recording what happened)

Folder: `src/simulation/spectator/`

* `spectator.ts`: main recorder
* `spectator-sanitize.ts`: clones/sanitizes mutable entities before storing
* `game-sample.ts`: sample payload stored for outcome examples
* `combat-log*.ts`: event model for “thin log”
* `spectator-collapse-actions.ts`: post-processing/compression of action logs
* Several `copy*.ts` files: older versions kept around

### Replay (reconstruct state from events)

Folder: `src/simulation/replay/`

* `apply-event.ts`: apply a single event to a reconstructed state
* `apply-event copy.ts`: older/alternate implementation

---

## 11) Tests (`test/`)

* `test/full-game/full-test.ts` (+ a few `copy` variants)

  * snapshot-style “full combat” test harness
* `test/full-game/seeded-runner.ts`

  * patches randomness for deterministic test runs
* `test/rng-smoke.ts`, `test/rng-patch-smoke.ts`

  * verifies seeded RNG works and that patching is stable
* `test/full-game/replay-base64.ts`, `apply-debug-state.ts`

  * helpers for replay/debug workflows

---

## 12) “Copy.ts” files (why they matter)

You’ll see multiple `* copy.ts` variants in `src/` and `test/`. These typically fall into:

* older iterations kept for reference
* experimental debugging harnesses
* transitional versions during refactors

If you’re cleaning the repo, these are prime candidates for:

* deleting, or
* moving under `archive/` or `tools/`, or
* converting into documented scripts.

---

## 13) How to find code fast (practical recipes)

* **Find a card implementation**: search `cardIds: [` inside `src/cards/impl/**`
* **Find where a hook is called**: search for the type guard, e.g. `hasStartOfCombat(` or `hasOnSpawned(`
* **Find where a game event is emitted**: search `spectator.` in `src/simulation/**`
* **Find board mutation entrypoints**: start with `addMinionToBoard` / `removeMinionFromBoard`
