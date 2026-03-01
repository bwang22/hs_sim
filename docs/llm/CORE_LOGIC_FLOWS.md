# CORE_LOGIC_FLOWS.md

This doc is the “how the machine breathes” guide: the **major execution paths** through the simulator, in the order they happen at runtime, plus the **timing boundaries and invariants** that keep everything from turning into spaghetti soup.

It is derived from the repo snapshot contained in `all_ts_dump.txt` (674 TS files) and focuses on the **engine**, not individual card behavior files.

---

## 0) Legend

* **Board**: `BoardEntity[]` (ordered left-to-right)
* **Hero**: `BgsPlayerEntity`
* **GameState**: `FullGameState` (contains cards services + spectator + shared counters + player/opponent `PlayerState`)
* **SoC**: Start of Combat
* **DR**: Deathrattle
* **“Friendly”**: `entity.friendly === true` side (player)

---

## 1) Top-level flow: request → Monte Carlo → result

### 1.1 Lambda entry (service mode)

`src/simulate-bgs-battle.ts` exports a default async handler that:

1. Parses `lambdaEvent.body` into `BgsBattleInfo`
2. Initializes card DB (`AllCardsService.initializeCardsDb()`)
3. Builds `CardsData` and initializes it with:

   * `validTribes` from `battleInput.gameState.validTribes` (fallback to `options.validTribes` for legacy)
   * `anomalies` from `battleInput.gameState.anomalies`
4. Calls `simulateBattle(...)` generator until `done`
5. Returns JSON serialized `SimulationResult`

### 1.2 The Monte Carlo driver (`simulateBattle`)

Also in `src/simulate-bgs-battle.ts`.

**Core steps:**

1. Read options:

   * `numberOfSimulations` (default 8000)
   * `maxAcceptableDuration` (default 8000ms)
   * `intermediateResults` (default 200 iterations)
   * `damageConfidence` (default 0.9)
   * `includeOutcomeSamples` (default true)
2. Construct one `Spectator` (shared across iterations in this call)
3. `buildFinalInput(...)` once to normalize raw input into “sim-ready”
4. Loop i = 0..N:

   * clone normalized input (`cloneInput3`) twice:

     * one for actual sim
     * one kept as `playerInitial/opponentInitial`
   * build `FullGameState` with:

     * `sharedState = new SharedState()`
     * `gameState.player/opponent` + `playerInitial/opponentInitial`
   * `new Simulator(gameState).simulateSingleBattle(...)`
   * aggregate win/tie/loss + damage arrays
   * `spectator.commitBattleResult(...)`
   * if time exceeded, warn and break
   * every `intermediateResults`, compute percents/ranges and `yield`
5. Finalize:

   * `spectator.prune()` (limit sample payload)
   * build + normalize outcome samples (legacy `actions` renamed to `events`, migrate `targetEntityId` to `targetEntityIds`)
   * clear raw `damageWons/damageLosts` arrays before returning

**Invariants:**

* Input normalization is done once, then cloning provides isolation per iteration.
* The simulator is **stateful per iteration** (new `SharedState`, new `Simulator`).

---

## 2) Single combat flow: `Simulator.simulateSingleBattle`

Entry: `src/simulation/simulator.ts`

This is the “one combat run” conductor. It handles:

* SoC exactly once per hero
* Attack loop until one side loses or deadlocks
* Duos teammate swap (if present)
* End-of-combat hero damage computation
* Spectator end markers

### 2.1 Pre-run setup: entity ID allocator

Before combat starts, simulator computes `sharedState.currentEntityId` as:

> `max(all entityIds and enchantment.originEntityId in both boards + hands) + 1`

This makes spawns deterministic *within the run* given a deterministic RNG stream, because all new entities draw from a single monotonically increasing ID source.

### 2.2 Outer loop (duos aware)

`simulateSingleBattle` loops while:

* either hero has not completed SoC (`!startOfCombatDone`)
* or both boards still have minions (`board.length > 0`)

This loop enables duos behavior:

* if a side is “defeated” (board empty OR hero hp <= 0), it swaps to teammate board/hero if available
* it also updates `gameState.gameState.player/opponent` to always refer to the currently active side
* it filters `sharedState.deaths` to remove deaths belonging to the swapped-out side (so death bookkeeping does not bleed between teammates)

### 2.3 Tie / deadlock handling

At the end, it declares a tie if:

* both boards are empty, OR
* both boards are still non-empty (common deadlock case, like both sides have only 0-attack units)

Special-case:

* inside the duos loop, it checks if *both* boards have only 0-attack minions, and if so clears both boards (forces tie).

### 2.4 Win/loss and damage

If player loses:

* damage = `sum(techLevel of surviving opponent minions + teammate spillover) + opponentHero.tavernTier`
* spectator emits `opponent-attack`

If player wins:

* symmetrical calculation
* spectator emits `player-attack`

---

## 3) SoC flow: `handleStartOfCombat(...)`

Entry: `src/simulation/start-of-combat/start-of-combat.ts`
Called from `Simulator.simulateSingleBattlePass(...)`.

### 3.1 High-level steps

1. **(Optional) recompute first attacker** by board size (random tie-break)
2. Define ordered SoC phases:

   1. QuestReward
   2. Anomalies
   3. Trinket
   4. PreCombatHeroPower
   5. IllidanHeroPower
   6. HeroPower
   7. Secret
   8. Minion
3. Capture `playerBoardBefore` and `opponentBoardBefore` snapshots (shallow copy objects)
4. For each phase:

   * run the phase handler
   * update `currentAttacker` if returned
   * if Illidan phase forces attacker, track `forcedAttacker`
   * after `PreCombatHeroPower`, refresh “before” boards again (so the Minion phase can compare against the post-precombat baseline)
5. Mark `startOfCombatDone = true` for both heroes
6. `applyAfterStatsUpdate(gameState)` (clears per-entity `pendingAttackBuffs`)
7. Return `forcedAttacker ?? currentAttacker`

### 3.2 Why SoC takes “boardBefore”

Minion SoC effects sometimes depend on “who was present before” (or need stable references despite spawns). The engine explicitly passes `playerBoardBefore/opponentBoardBefore` into the Minion phase handler.

### 3.3 SoC ordering is intentionally conservative

There are explicit comments in SoC about ordering uncertainty and using randomness where exact order is unclear. Treat SoC as a pipeline whose order may be season dependent.

---

## 4) Attack loop flow: `simulateSingleBattlePass(...)`

This is where combat becomes a treadmill with teeth.

### 4.1 Start: announce SoC boundary

At the start of `simulateSingleBattlePass`:

* spectator logs `start-of-combat` and creates a `SOC_START` checkpoint snapshot.

### 4.2 Choose first attacker

Before SoC is processed, the engine chooses first attacker by board size (random tie-break). After SoC, the SoC return value becomes the authoritative attacker for the first attack.

### 4.3 Per-attack iteration

While both boards and heroes are alive:

1. `handleSummonsWhenSpace(...)`
   Passive “fill empty slots” summons that can occur between attacks.
2. `clearStealthIfNeeded(...)`
   Stealth housekeeping so entities are targetable at correct timing.
3. Determine `currentSpeedAttacker`:

   * if *any* entity has `attackImmediately` on player board => speed attacker = player
   * else if any on opponent board => speed attacker = opponent
   * else = -1 (normal alternation)
4. If both sides have no attack-capable minions (all attack <= 0), break.
5. Execute one attack:

   * If speed attacker is set, that side attacks.
   * Else use `currentAttacker` (alternates each normal attack).
6. After the attack:

   * Re-evaluate `attackImmediately` presence.
   * If none, flip `currentAttacker = (currentAttacker + 1) % 2`
7. Safety valve: if counter > 400 attacks, warn and short-circuit (prevents infinite loops from bugged boards).

---

## 5) One attack, end-to-end: `simulateAttack(...)`

Entry: `src/simulation/attack.ts`
This function is *the* core timing window. It decides:

* who attacks
* who is targeted
* what triggers fire and when
* death processing and deathrattles
* post-attack effects and cleanup

### 5.1 High-level “attack pipeline”

Conceptual order:

```mermaid
flowchart TD
  A[Pick attacker] --> B[Pick defender]
  B --> C[Spectator: attack]
  C --> D[onBeingAttacked buffs]
  D --> E[onAttack effects]
  E --> F[performAttack: damage exchange + cleave + keywords]
  F --> G[afterAttack (minion effects)]
  G --> H[processMinionDeath recursion]
  H --> I[afterAttack trinkets]
  I --> J[applyAfterStatsUpdate]
```

### 5.2 What happens in code (key calls)

Inside `simulateAttack`:

1. `getAttackingEntity(...)` chooses the next attacker using board order and `canAttack(...)`.
2. Target selection happens (taunt rules, random among valid, and special forced target via options).
3. spectator: `registerAttack(attacker, defender, ...)`
4. Apply “pre-damage” triggers:

   * `applyOnBeingAttackedBuffs(...)` first
     (comment notes this appears to occur before on-attack)
   * `applyOnAttackEffects(...)` second
5. `performAttack(...)`

   * applies the actual combat damage exchange
   * calls spectator `registerDamageDealt(...)` for minion damage instances
   * handles divine shield and venomous updates via keyword helpers
   * may call `onEntityDamaged(...)` for effect-driven triggers
6. `applyAfterAttackEffects(...)`
   Minion after-attack triggers like “Macaw-style” behaviors, intentionally before trinket after-attack.
7. `processMinionDeath(...)`
   Full death pipeline and chained resolutions (see next section)
8. `applyAfterAttackTrinkets(...)`
9. `applyAfterStatsUpdate(gameState)`
10. Decrement `immuneWhenAttackCharges` for the attacker.

**Invariant:**

* Attack damage does not directly delete entities. Removal is handled by the death pipeline.

---

## 6) Death pipeline: `processMinionDeath(...)`

Entry: `src/simulation/attack.ts` (internal helper)

This is the “no loose ends” recursion that keeps running until there are no more dead entities to process.

### 6.1 Step-by-step

1. Call `makeMinionsDie(board1, ...)`
2. Call `makeMinionsDie(board2, ...)`
3. If no dead entities on both, return
4. spectator: `registerDeadEntities(...)`
   Thin event `minion-death` plus fat snapshot action.
5. Push dead entities into `sharedState.deaths` as “death records”:

   * restore health to `maxHealth`
   * clear `definitelyDead`
   * store `indexFromLeftAtTimeOfDeath`
   * add implied mechanics (normalizes fields for downstream effects)
6. Call `onDeath(...)` hooks on each dead entity (if implemented)
7. Update some hero `globalInfo` counters (example: Eternal Knights dead)
8. Call `orchestrateMinionDeathEffects(...)`
   This is where DR, avenge, reborn, post-death effects occur.
9. **Recurse:** call `processMinionDeath(...)` again
   This catches deaths caused by deathrattles, reborn interactions, and effect damage during the death phase.
10. If not skipping summon-when-space, call `handleSummonsWhenSpace(...)`
11. Call “after death batch” effects:

* `handleAfterMinionsDeaths(...)` which runs `onAfterDeath(...)` hooks for trinkets and entities

12. Remember deathrattles for “Fish-like” entities:

* `rememberDeathrattles(...)` for survivors that store dead entities’ DR as enchantments

### 6.2 Why recursion exists

Deathrattles and reborns can cause:

* spawns
* immediate attacks
* damage effects
* more deaths

Rather than trying to compute a full “death closure” in one pass, the code repeatedly:

* deletes dead units
* resolves downstream effects
* then checks again for new deaths

**Invariant:**

* The function must terminate when no new deaths exist. Safety valves exist elsewhere (attack loop count).

---

## 7) Deathrattle orchestration flow: `orchestrateMinionDeathEffects(...)`

Entry: `src/simulation/deathrattle-orchestration.ts`

This is the “conductor” that tries to match Battlegrounds timing:

### 7.1 The intended ordering (as documented in code comments)

* Minions die left to right
* For each minion:

  * natural deathrattle
  * then added deathrattles (enchantments)
  * then all avenge counters progress and trigger
* After all deathrattles and avenges are done:

  * reborn triggers
* Then special followups (Feathermane-style effects, post-deathrattle effects)

### 7.2 Actual orchestration steps (implementation)

1. `handleAfterMinionsKillEffects(...)`
2. `handleWheneverMinionsDieEffects(...)`
3. Save `playerBoardBefore` and `opponentBoardBefore`
4. `processDeathrattles(...)`

   * chooses which side processes first with random coin flip
   * processes dead entities “left to right” per side
   * within each entity: natural DR first, then enchantments
   * spawns are produced via `spawnEntitiesFromDeathrattle(...)` and executed via `performEntitySpawns(...)`
5. `handleAfterMinionsDieEffects(...)`
   Handles effects where damage occurs before new DR chains fully resolve (explicitly mentioned in comments).
6. **Index correction hack**
   If spawns happened during deathrattle resolution, it adjusts `deadEntityIndexesFromRight` so reborn spawn indices align.
7. If `processReborn`: `processReborns(...)`
8. `processFeathermaneEffects(...)`
9. `handlePostDeathrattleEffects(...)` with the union of spawned entities

### 7.3 Spawn execution during DR

Spawns generally flow through:

* `deathrattle-spawns.ts` (select what to spawn)
* `spawns.ts` `performEntitySpawns(...)` (actually insert into board)

…and can trigger **attackImmediately** behavior (next section).

---

## 8) Spawn flow (including “attack immediately”)

Entry: `src/simulation/spawns.ts` `performEntitySpawns(...)`

### 8.1 Spawn algorithm

For each candidate entity:

1. If board is full (>= 7), call `onMinionFailedToSpawn(...)` for remaining candidates and stop.
2. Compute spawn index:

   * use `newMinion.spawnIndexFromRight` if present, else use `spawnSourceEntityIndexFromRight`
   * `indexToSpawnAt = max(0, board.length - spawnIndexFromRight)`
3. `addMinionToBoard(...)` with:

   * `applySelfAuras` control
   * and `applySelfAuras` influences aura bookkeeping for spawns
4. If `newMinion.attackImmediately`:

   * call `simulateAttack(...)` immediately (forceTarget optional)
   * clear `attackImmediately` on the actual attacker (or on `newMinion` if no attack occurred)
5. Collect survived spawned entities (health > 0 and not definitelyDead)
6. spectator: `registerMinionsSpawn(sourceEntity, board, spawnedEntities)`

### 8.2 Interaction with the attack loop

The main simulator loop has a “speed attacker” concept so that if a minion exists with `attackImmediately`, the same side may keep attacking until the speed phase is over.

Also, `processMinionDeath(...)` can be called with `skipSummonWhenSpace` during attackImmediately phases to avoid mid-speed passive summons creating ordering weirdness.

**Invariant:**

* `attackImmediately` must be cleared after the immediate attack to avoid repeated “free attacks.”

---

## 9) Avenge, quests, and counters: where they update

### 9.1 `makeMinionsDie(...)` updates counters early

`src/simulation/minion-death.ts` removes dead entities and then, for each dead entity:

* updates avenge counters immediately (`updateAvengeCounters(board, hero)`)
* triggers hero power and quest progress updates (`onMinionDeadHeroPower`, `onMinionDeadQuest`)
* does this early because waiting can cause spawned entities to receive counters they should not have

### 9.2 Why “early update” matters

If deaths are processed in batches, a deathrattle spawn could appear before counters are updated, and then incorrectly count as “present at time of death.” This is explicitly called out in comments as a known issue category.

---

## 10) Telemetry flow: Spectator events, actions, checkpoints

Entry: `src/simulation/spectator/spectator.ts`

### 10.1 Two outputs exist

* **Thin stream**: `SpectatorEvent[]` with `seq` and minimal payload
* **Fat actions**: `GameAction[]` snapshot style, includes boards/hands/secrets/trinkets context

### 10.2 Core event emission points

* SoC start:

  * emit thin `{type:'start-of-combat', phase:'START_OF_COMBAT'}`
  * add fat `start-of-combat` action snapshot
  * add checkpoint `SOC_START`
* Each attack:

  * thin `attack`
  * fat `attack` action
* Each minion damage instance:

  * thin `damage` (currently phase ATTACK and kind combat)
  * fat `damage` action (array of one or more)
* Target selection:

  * thin `power-target`
  * optional thin `entity-upsert` for the target entity state after selection
  * fat `power-target` action snapshot
* Death batch:

  * thin `minion-death` includes `deadEntityIds`
  * fat `minion-death` includes full dead entity snapshots
* Spawn batch:

  * thin `spawn` includes sanitized spawned entities and optional insert indexes
  * fat `spawn` includes spawned entities snapshots
* End of combat:

  * thin `player-attack` or `opponent-attack`
  * fat `player-attack`/`opponent-attack` action

### 10.3 Auto checkpoints

Every `CHECKPOINT_EVERY_N_EVENTS` (200) emitted thin events, spectator attempts an `EVERY_N` checkpoint snapshot using last-known context.

**Invariant:**

* Replay correctness assumes: checkpoint snapshot + apply events forward reproduces state.

---

## 11) Core safety valves and failure modes

### 11.1 Runtime stop (Monte Carlo)

In `simulateBattle`, stop early if runtime exceeds `maxAcceptableDuration` unless warnings are hidden.

### 11.2 Infinite combat guard (single run)

In `simulateSingleBattlePass`, stop if > 400 attack iterations (short circuit).

### 11.3 0-attack deadlock

If both boards have minions but none have attack > 0, break out and treat as tie.

### 11.4 Large entity explosion diagnostics

Simulator logs warnings if entity lists become huge (thousands of entity ids), hinting at infinite token loops or broken removal.

---

## 12) “Follow the flow” onboarding exercises (pick one)

To make this stick in your head, pick **one** and trace it in code:

1. **Attack timing**: find where `applyOnBeingAttackedBuffs` happens relative to `applyOnAttackEffects` and `performAttack`.
2. **Death recursion**: put a breakpoint/log in `processMinionDeath` and watch it recurse on a DR-heavy fight.
3. **SoC ordering**: trace `handleStartOfCombat` phases and note where board snapshots reset.
