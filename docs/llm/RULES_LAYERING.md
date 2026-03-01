# RULES_LAYERING.md

This document explains **how “rules” are layered** in this Battlegrounds combat simulator: what counts as a rule, where it lives, which layer “wins” when multiple things interact, and how to add new behavior without summoning a dependency hydra 🐉.

It’s based on the code structure and trigger choreography in the `all_ts_dump.txt` snapshot.

---

## 1) What “rules” mean in this repo

A “rule” is **any logic that changes combat state** (boards, heroes, keywords, counters) or decides outcomes (target selection, ordering, damage/deaths, spawns).

Rules come from four sources:

1. **Engine physics** (universal combat mechanics)
2. **Rule hooks** (engine-defined timing windows where “content” can run)
3. **Content implementations** (card / trinket / hero power / secret behaviors)
4. **Cross-cutting controllers** (stats/keywords/auras/enchantments that enforce invariants)

A key theme: the engine is procedural and stateful. It prefers **explicit timing windows** over a single monolithic “resolver”.

---

## 2) The canonical rule layers

Think of the codebase as these layers, from “most fundamental” to “most specific”.

### Layer A: Data contracts and identity

**Responsibility**

* Define the shapes and identity anchors used everywhere: `BoardEntity`, `BgsPlayerEntity`, `BoardEnchantment`, `BoardSecret`, `BoardTrinket`, `FullGameState`, etc.
* Provide stable handles (`entityId`, `cardId`, `friendly`) that the engine and telemetry can rely on.

**Invariants**

* `entityId` is the stable identity within a combat run.
* Board order is meaningful (left-to-right adjacency, spawn placement, attack ordering).

**Where**

* `src/board-entity.ts`, `src/bgs-player-entity.ts`, `src/simulation/internal-game-state.ts`, etc.

---

### Layer B: Cross-cutting state controllers (invariant enforcers)

These modules are “rule engines inside the rule engine”. They exist because **mutating raw fields directly is unsafe**.

#### B1) Stats controller

**What it does**

* Applies stat changes consistently (`modifyStats`, `setEntityStats`, etc)
* Tracks enchantments for stat sources
* Notifies watchers via hooks like `OnStatsChanged`

**Where**

* `src/simulation/stats.ts`

**Rule**

* If you want “+X/+Y”, use stats helpers, not `entity.attack += X` unless you are explicitly doing an aura-style adjustment.

---

#### B2) Keyword controllers

Keywords are not just booleans. Toggling them can:

* trigger watchers (`OnDivineShieldUpdated`, `OnTauntUpdated`, etc)
* apply special rule side effects (some keywords have meta-effects)
* maintain “historical” flags (example: `hadDivineShield`)

**Where**

* `src/keywords/divine-shield.ts`, `reborn.ts`, `taunt.ts`, `stealth.ts`, `venomous.ts`, `windfury.ts`

**Rule**

* If you want to add/remove a keyword, call `updateX(...)`, not `entity.taunt = true`.

---

#### B3) Enchantments controller

**What it does**

* Keeps enchantment lists sane and consistent
* Enables “enchantments as rule objects” (many hooks can be implemented by enchantments, not just minions)

**Where**

* `src/simulation/enchantments.ts`

---

#### B4) Auras controller

Auras are “continuous effects”, but implemented as **periodic recomputation / repair** at key boundaries:

* input sanitation (“missing auras”)
* on spawn/despawn
* during combat steps (stealth housekeeping)

**Where**

* `src/simulation/auras.ts`
* also called from spawn/add/remove helpers

**Rule**

* Spawns/despawns should route through helpers that apply aura effects so auras don’t drift.

---

### Layer C: Engine orchestration (timing windows)

This layer defines “the physics timeline” and calls into hooks.

The three big orchestrators:

#### C1) Start of Combat pipeline

**Where**

* `src/simulation/start-of-combat/*`

**What it does**

* Runs ordered SoC phases (quests/anomalies/trinkets/hero powers/secrets/minions)
* Allows SoC to request “recompute first attacker” when board topology changes

---

#### C2) Attack pipeline (one attack step)

**Where**

* `src/simulation/attack.ts` (plus `on-being-attacked.ts`, `on-attack.ts`, `after-attack.ts`)

**Canonical order (high level)**

1. declare `attack` (telemetry)
2. **on-being-attacked window**
3. **on-attack window**
4. apply combat damage
5. “after attack” (minion-level)
6. death batching and death effects
7. “after attack” (trinket-level)
8. cleanup (`applyAfterStatsUpdate`)

This order is intentionally explicit in `doFullAttack(...)`.

---

#### C3) Death pipeline (closure and recursion)

**Where**

* `src/simulation/minion-death.ts`
* `src/simulation/deathrattle-orchestration.ts` + `deathrattle-*` modules

**What it does**

* Removes dead entities in batches
* Orchestrates deathrattles, avenge, reborn, post-death followups
* Recurses until stable

**Core invariant**

* Damage reducing health to 0 does not delete minions.
* Deletion happens in the death pipeline.

---

### Layer D: Hook dispatch (the “plug-in slots”)

This is the bridge between engine timing windows and per-card behavior.

**Where**

* `src/cards/card.interface.ts` (hook interfaces + type guards)
* `src/cards/impl/_card-mappings.ts` (registry `cardId -> impl`)
* called from engine modules (`on-attack`, `on-being-attacked`, `stats`, `keywords`, `spawns`, etc)

**Important detail**
Hooks do not live only in one “event bus”. They are invoked from multiple controllers:

* stats changes invoke `OnStatsChanged`
* keyword updates invoke `OnXUpdated`
* attack windows invoke `OnMinionAttacked`, `OnWheneverAnotherMinionAttacks`, `Rally`
* death windows invoke `OnDeath`, `DeathrattleSpawn`, `OnAfterDeath`, etc

This means: **“hook” is a vocabulary for timing slots, not a single centralized dispatcher.**

---

### Layer E: Content implementations (card scripts)

This is the giant library of behaviors.

**Where**

* `src/cards/impl/**` (minion/trinket/hero-power/spellcraft/bg-spell/anomaly/etc)

**Rule**

* Implementations should treat engine helpers as the only safe way to change shared state:

  * stats via `modifyStats`
  * keywords via `updateX`
  * spawns via `spawnEntities` / `performEntitySpawns` / `addMinionToBoard`

---

### Layer F: “Inline patches” (engine-level special casing)

There are places where the engine includes **explicit `switch (cardId)` logic** inside “generic” modules (notably spawn/add-minion flows). This is a pragmatic escape hatch for:

* effects that are awkward to express as a hook
* performance shortcuts
* legacy or incomplete refactors

**Where you’ll see it**

* `src/simulation/add-minion-to-board.ts` contains hard-coded cases for some cardIds and also handles quest/hero power/trinket edge effects during spawn.

**Rule**

* Treat inline patches as debt. Prefer migrating them into hook-based implementations when feasible.

---

### Layer G: Observability (spectator + replay)

Not “rules” in the outcome sense, but a layer that *must* remain consistent with rule execution order.

**Where**

* `src/simulation/spectator/*`
* `src/simulation/replay/*`

**Rule**

* Telemetry is an observer. It should not be required for combat logic to be correct.
* Replay assumes key invariants (especially: “deaths remove entities”, not damage).

---

## 3) Rule ordering: the places where “layering” is visible

This section is the “why layering exists” part: concrete examples of how one layer wraps another.

### Example 1: Attack step layering (engine + hooks + controllers)

In `doFullAttack(...)`:

1. **Engine declares the event**: `spectator.registerAttack(...)`
2. **Defender-side pre-attack window**: `applyOnBeingAttackedBuffs(...)`

   * secrets resolve first (engine-level secret logic)
   * then `OnMinionAttacked` hooks fire for defending board entities
3. **Attacker-side pre-damage window**: `applyOnAttackEffects(...)`

   * trinket hooks `OnWheneverAnotherMinionAttacks`
   * then other friendly minions (and their enchantments) `OnWheneverAnotherMinionAttacks`
   * then `triggerRally(...)` (which itself dispatches `RallyCard.rally(...)` possibly multiple times)
4. **Physics**: `performAttack(...)` applies damage exchange, divine shield consumption, venomous, etc
5. **Post-attack**:

   * `applyAfterAttackEffects(...)` (minion-level)
   * `processMinionDeath(...)` (death closure)
   * `applyAfterAttackTrinkets(...)` (late observer)
6. **Cleanup**: `applyAfterStatsUpdate(...)`

That’s layering in action: orchestrator → hook windows → controllers → closure → cleanup.

---

### Example 2: Spawning layering (spawn engine + aura/stats/quest side-effects + hooks)

A spawn typically flows like:

1. **Spawner decides what to spawn**

   * deathrattle spawns via `deathrattle-spawns.ts` + `spawnEntities(...)`
2. **Spawner executes placement**

   * `performEntitySpawns(...)` computes indices and calls `addMinionToBoard(...)`
3. **Add-to-board enforces invariants**

   * `handleAddedMinionAuraEffect(...)` (hero powers / quest rewards / trinket side effects + aura handling)
   * `onMinionSummoned(...)` (quest progress updates need to see “attackImmediately” minions)
   * `handleSpawnEffect(...)` (spawn-time special effects)
   * `handleAfterSpawnEffects(...)` (AfterOtherSpawned hooks)

     * trinkets first
     * then existing board entities
4. **If spawned has `attackImmediately`**

   * it may immediately call back into `simulateAttack(...)` (nested combat action)
   * then clears `attackImmediately` to prevent repeat

This demonstrates why spawns must route through the engine helpers: there’s a lot of “side bookkeeping” that must happen at the right time.

---

### Example 3: Keyword update layering (divine shield)

`updateDivineShield(...)` is not just `entity.divineShield = true`.

It:

* updates history (`hadDivineShield`)
* handles special shield variant (`strongDivineShield`)
* applies a special aura-like attack bonus for certain board state cases
* then notifies watchers:

  * trinket implementations that implement `OnDivineShieldUpdated`
  * board entities that implement `OnDivineShieldUpdated`

So the layering is: keyword controller → direct field update → special-case mechanics → hook notifications.

---

### Example 4: Stats layering (`modifyStats`)

When you call `modifyStats(...)`:

* it updates stats and (usually) creates an enchantment record
* then it triggers `OnStatsChanged` watchers across the board (and sometimes trinkets), passing:

  * target, source, delta, board, heroes, gameState

So “stats change” becomes a mini timing window that other cards can react to.

---

## 4) “Which layer should I put this rule in?”

### Put it in content (card impl) if:

* It’s specific to a card/trinket/hero power/secret
* It naturally fits an existing hook (SoC, OnAttack, OnDeath, etc)
* It can be implemented by calling existing controllers (stats/keywords/spawn)

### Put it in a controller (stats/keywords/auras/enchantments) if:

* It’s an invariant (“keyword toggles must notify watchers”)
* It’s cross-cutting and reused by many cards
* It needs to centralize tricky side effects (like tracking history flags)

### Put it in engine orchestration if:

* It defines the global timeline (SoC order, attack window ordering, death batching)
* It is a rule about sequencing, not a specific effect

### Only put it as an inline patch if:

* You have no reasonable hook surface yet
* It’s a temporary migration step
* You document it and plan to lift it into content later

---

## 5) Layering invariants (the “do not break” list)

1. **Death pipeline is the only remover**

   * entities disappear from boards in death batching, not at damage time.
2. **Keyword updates must go through keyword controllers**

   * otherwise OnXUpdated hooks don’t fire and replay/debug drifts.
3. **Stat updates must go through stats helpers**

   * otherwise enchantment bookkeeping and OnStatsChanged hooks drift.
4. **Spawns must go through spawn/add-minion helpers**

   * otherwise aura application, quest updates, and spawn hooks drift.
5. **Enchantments are rule objects**

   * many triggers run both on entities and on enchantments. If you manipulate enchantments, keep them valid.

---

## 6) A practical checklist for adding a new mechanic

When adding something new, ask in order:

1. **What timing window is it in?**

   * SoC? On being attacked? On attack? On damaged? On death? After death? End of combat?
2. **Does a hook exist already?**

   * If yes, implement in card content.
3. **Does it require “special mutation”?**

   * If it touches stats/keywords/spawns, use the controllers.
4. **Does telemetry need a new event?**

   * Prefer reusing `power-target` + `entity-upsert` before inventing new micro-events.
5. **Will it create cycles?**

   * Avoid importing spectator/replay from content.
   * Avoid importing card impls from engine.

---

## 7) Where layering is currently “leaky”

This is not blame, just map-reading:

* Some engine modules import `cardMappings` and do cardId-specific logic directly.
* `card.interface.ts` imports hook input types from simulation modules, which contributes to dependency cycles.
* Some aura-like changes are applied via direct stat mutations (intentionally) to avoid firing certain “stats changed” triggers.

These are tradeoffs. The layering rules above help you avoid making it worse.
