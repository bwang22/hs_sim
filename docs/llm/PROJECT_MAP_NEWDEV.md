Perfect. For new-dev onboarding, you want a map that feels like a subway diagram: few lines, clear stations, and “transfer points” called out. Here’s a **new-dev friendly** `PROJECT_MAP.md` you can drop into `docs/llm/PROJECT_MAP.md` (or repo root).

---

# PROJECT_MAP.md (New-Dev Onboarding)

Welcome! This repo is a **Battlegrounds combat simulator** (Monte Carlo). Given two boards (and hero/trinket/quest context), it simulates combat many times to estimate **win/tie/loss** and **damage distributions**, and can optionally record **combat events** for replay/debug.

---

## 1) How to get oriented in 15 minutes

### The “golden path” (read in this order)

1. **Entrypoint + outer loop:** `src/simulate-bgs-battle.ts`
   The Monte Carlo loop, card DB initialization, and overall orchestration.
2. **State shapes:** `src/simulation/internal-game-state.ts`
   `FullGameState`, `GameState`, `PlayerState` and what lives where.
3. **Single-combat engine:** `src/simulation/simulator.ts`
   Start-of-combat, attack loop, deaths, winner/damage computation.
4. **Start of Combat pipeline:** `src/simulation/start-of-combat/*`
   Ordering rules, SoC triggers (hero powers, secrets, trinkets, minions).
5. **Card hooks and registry:**

   * `src/cards/card.interface.ts` (hook interfaces + type guards)
   * `src/cards/impl/_card-mappings.ts` (wiring from cardId → implementation)

If you read only these, you’ll be productive quickly.

---

## 2) Repo layout (what lives where)

### Top-level

* `src/`
  Simulator library code + Lambda-style handler
* `test/`
  Deterministic runners + full-game snapshot-ish tests

### The major “districts” inside `src/`

* `src/simulation/**`
  The combat engine: phases, targeting, damage, deaths, spawns, telemetry.
* `src/cards/**`
  Card behavior system: hook interfaces + implementation modules.
* `src/services/**`
  Card IDs, utility functions, external-facing “data service” glue.
* `src/keywords/**`
  Centralized helpers for keyword states (taunt, stealth, reborn, etc).
* `src/mechanics/**`
  Cross-cutting mechanics bigger than a card, smaller than the engine.
* `src/lib/**`
  Low-level utilities (notably deterministic RNG helpers).

---

## 3) The simulator’s “call stack” (mental model)

### Input → normalize → simulate many times

1. **Input**: `BgsBattleInfo` (boards + gameState + options)
2. **Normalize**: `buildFinalInput(...)` in `src/input-sanitation.ts`
3. **Repeat N times**:

   * clone input (`src/input-clone.ts`)
   * create `FullGameState`
   * run `Simulator.simulateSingleBattle(...)`
4. **Aggregate** into `SimulationResult`

**File you start with when debugging**:
`src/simulate-bgs-battle.ts`

---

## 4) Key modules by purpose

### A) Entrypoints / orchestration

* `src/simulate-bgs-battle.ts`
  Main API: sets up services, sanitizes input, runs Monte Carlo, aggregates output.
* `src/input-sanitation.ts`
  Fixes/normalizes “real-world” inputs so combat logic can assume consistency.
* `src/input-clone.ts`
  Efficient cloning of battle input per iteration (important because entities are mutable).

### B) Combat engine (core)

* `src/simulation/simulator.ts`
  Runs a **single combat**:

  * chooses initial attacker
  * Start of Combat
  * loops attacks until resolution
  * computes winner and damage
* `src/simulation/attack.ts`
  Attack resolution and targeting helpers.
* `src/simulation/minion-death.ts` + `src/simulation/deathrattle-*.ts`
  Death detection and deathrattle sequencing / spawns / reborn.

### C) Start of Combat

Folder: `src/simulation/start-of-combat/`

* `start-of-combat.ts`
  Top-level SoC pipeline and ordering logic.
* `soc-*.ts` modules
  Hero powers, trinkets, secrets, anomalies, minion SoC triggers, etc.

### D) Board mutation invariants (very important)

* `src/simulation/add-minion-to-board.ts`
* `src/simulation/remove-minion-from-board.ts`
* `src/simulation/spawns.ts`
* `src/simulation/summon-when-space.ts`

If you are adding summon logic or board manipulation, try to route through these.

### E) Cross-cutting mechanics used everywhere

* `src/simulation/auras.ts`
  Aura bookkeeping and “missing aura” repair.
* `src/simulation/enchantments.ts`
* `src/simulation/battlecries.ts`
* `src/simulation/magnetize.ts`
* `src/simulation/avenge.ts`
* `src/simulation/secrets.ts`
* `src/simulation/quest.ts`

### F) Telemetry, debug, and replay

* `src/simulation/spectator/*`
  Records combat events/checkpoints (useful for viewer/debugging).
* `src/simulation/replay/*`
  Reconstructs state using checkpoints + events.

### G) Cards system (where 80% of gameplay changes happen)

* `src/cards/card.interface.ts`
  Hook interfaces + type guards like `hasStartOfCombat(...)`.
* `src/cards/cards-data.ts`
  Derived BG values (tribes, tiers, tokens, some defaults).
* `src/cards/impl/_card-mappings.ts`
  Registry cardId → implementation object(s).
* `src/cards/impl/**`
  The actual card behavior implementations (minions, trinkets, hero powers, spells…).

---

## 5) “Where do I change X?” (common tasks)

### I want to fix a broken simulation outcome

Start here:

1. `src/simulation/simulator.ts`
2. `src/simulation/attack.ts` (targeting, damage application)
3. `src/simulation/minion-death.ts` and `deathrattle-*` (death chains)

### I want to adjust Start of Combat ordering or add a new SoC rule

* `src/simulation/start-of-combat/start-of-combat.ts`
* Add/modify a `soc-*.ts` step module

### I want to add/change a card

1. Find or create file under `src/cards/impl/<category>/...`
2. Add cardId mapping in `src/cards/impl/_card-mappings.ts`
3. Ensure the needed hook exists in `src/cards/card.interface.ts`

### I want to add a new trigger timing window

* Add a new hook interface + type guard in `src/cards/card.interface.ts`
* Call that hook from the correct place in `src/simulation/*`

### I want deterministic test runs

* Look at `src/lib/rng.ts` (seeded PRNG)
* Look at `test/full-game/seeded-runner.ts` (patches randomness)

---

## 6) Folder cheat sheet (fast navigation)

### `src/simulation/` (engine)

If you’re not sure:

* `simulator.ts` = conductor
* `attack.ts` = swing logic
* `minion-death.ts` + `deathrattle-orchestration.ts` = death pipeline
* `spawns.ts` = summoning + “attack immediately”
* `auras.ts` = aura bookkeeper
* `spectator/*` = event logging

### `src/cards/impl/` (content)

By category:

* `minion/` = most BG minions
* `trinket/` = trinket effects
* `hero-power/` = hero power behaviors
* `bg-spell/`, `spellcraft/` = spells and spellcraft
* `quest-reward/`, `anomaly/` = specialty mechanics

---

## 7) Conventions and “gotchas”

### Mutation is the default

Entities are mutated in place during simulation. That’s why:

* input cloning matters (`input-clone.ts`)
* spectator sanitization matters (`spectator-sanitize.ts`)

### Ordering is sometimes randomized

Some timing/order rules use randomness (coin toss behavior). For strict reproducibility, use seeded RNG patching as tests do.

### “copy.ts” files exist

You’ll see `* copy.ts` variants. Treat them as legacy/experiments unless referenced by imports.

---

## 8) New-dev onboarding exercises (recommended)

1. **Run a seeded test** (verify determinism)
2. Add a trivial log emission in `Spectator` and confirm it appears in replay
3. Pick one simple card and trace its hook from `_card-mappings.ts` → hook call site in `simulation/*` → behavior implementation

---

## 9) If you only remember 3 files

1. `src/simulate-bgs-battle.ts` (outer loop)
2. `src/simulation/simulator.ts` (single combat brain)
3. `src/cards/impl/_card-mappings.ts` (where card behavior is wired)

---

If you want, I can also produce a **“Day 1 onboarding checklist”** (commands to run, what to expect, and 3 tiny starter tasks that teach the architecture without risking a big refactor).
