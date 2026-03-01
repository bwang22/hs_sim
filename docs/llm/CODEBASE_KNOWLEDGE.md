According to a document from an **undated code snapshot** (`all_ts_dump.txt`), this codebase is a TypeScript, Node-oriented Battlegrounds combat simulation engine built to answer one question at scale: **“Given two boards, what are the odds and damage ranges of each outcome?”** It does this by running many deterministic (or semi-deterministic) combat simulations, while optionally emitting a spectator-friendly event log and checkpoints to support debugging and replay. 

Below is a **Codebase Knowledge Packet** intended to let a new lead developer (or another LLM) understand the system end-to-end without spelunking every file.

---

# Codebase Knowledge Packet

## 1) Executive Summary & Mission

### Mission

This system simulates **Hearthstone Battlegrounds combat** (including modern mechanics like anomalies, trinkets, quests, and specialized hero-power timing) and returns **probabilistic outcomes** (win/tie/loss, lethal chances, and damage distributions). The code is engineered for:

* **Monte Carlo throughput**: run thousands of simulated combats per request.
* **Correctness under complicated rules**: handle start-of-combat ordering, deathrattle chains, triggers, and stateful hero/trinket effects.
* **Debuggability**: provide “spectator” telemetry and replay scaffolding to understand *why* a particular run unfolded the way it did.

### Core value proposition

Most BG engines are either:

* fast but opaque (hard to debug),
* or explainable but too slow for high-volume probability queries.

This codebase aims to be both: it keeps the hot path mutation-heavy and allocation-light, while layering on an optional observability channel (events + checkpoints) that can be sampled and replayed later. The “spectator” subsystem and replay reducer are explicit proof of that design intent. 

---

## 2) High-Level Architecture

### Architectural pattern

This is a **modular monolith** (single codebase, single deployable library/service entrypoint) with a **layered design**:

1. **API/Entry Layer**

   * AWS Lambda-style handler that accepts a JSON battle input and returns a JSON result. 
2. **Preparation Layer**

   * Input sanitation and cloning to create a safe-to-mutate per-simulation state. 
3. **Simulation Core**

   * A `Simulator` object runs the combat loop, calling into subsystems (start-of-combat, attack resolution, deaths, spawns, stats, auras). The simulation mutates state in place for speed.
4. **Telemetry/Replay Layer**

   * A `Spectator` collects thin events and periodic checkpoints, capped to a small number of samples. 
   * A replay reducer can reconstruct viewer-grade state from checkpoints + events. 

### Why a generator shows up

The simulation is exposed via a generator (`simulateBattle`) that can yield intermediate results before the final result is returned by the Lambda wrapper. In the handler, the generator is simply drained to completion. This is a “future-proofing” choice: it allows streaming intermediate results or progress updates later without rewriting the engine. 

---

## 3) Tech Stack Deep-Dive

### Languages

* **TypeScript** is the implementation language across the engine.

  * You see heavy use of interfaces to define stable state shapes (`FullGameState`, `PlayerState`, input entities).
  * TS is also used for exhaustiveness guards in event reducers (a good move for replay stability). 

### Runtime and execution model

* **Node.js** execution is implied. The entrypoint is written as an AWS Lambda async handler, with a comment referencing Node 8.10 runtime. 

### Major libraries and why they exist

* `@firestone-hs/reference-data`

  * Provides card data primitives (`AllCardsService`, types like `Race`, `ReferenceCard`, etc.).
  * The simulator depends on reference cards being loaded; it explicitly refuses to simulate if the card DB is empty. 

### Internal “libraries”

* A locally implemented PRNG (`mulberry32`) exists (referenced in tests in the snapshot), and the test harness patches `Math.random` for determinism. While not shown in every excerpt, the architecture is clearly aware of deterministic needs, and many core ordering decisions still call `Math.random()` directly (start-of-combat tie breaks, SOC minion sequencing). 

---

## 4) Module-by-Module Breakdown (Functional Clusters)

Below are the major clusters you should treat as “subsystems,” with what they own, key files, and what makes them tricky.

### 4.1 Entry & Orchestration: “Run a simulation request”

**Responsibility**

* Accept input, ensure reference data is ready, run N simulations, aggregate outputs, and return a response.

**Key files**

* `src/simulate-bgs-battle.ts`

  * Lambda handler: checks for missing body, parses input, initializes card DB, creates `CardsData`, then drains `simulateBattle` generator and returns JSON. 
  * `simulateBattle` generator: sets parameters (duration cap, number of sims, confidence), initializes `Spectator`, builds sanitized `inputReady`, then loops N times running `Simulator.simulateSingleBattle`. 

**Notable logic**

* **Duration gate**: stops if total wall time exceeds `maxAcceptableDuration` to avoid infinite boards or bugs. 
* **Monte Carlo aggregation**:

  * Updates win/tie/loss counters and damage distributions.
  * Tracks lethal counts based on opponent/player HP. 

**Pseudo-code sketch**

```ts
function* simulateBattle(battleInput):
  assert cardsDbLoaded
  spectator = new Spectator(includeOutcomeSamples)
  inputReady = buildFinalInput(battleInput)

  for i in 0..N:
    input = cloneInput3(inputReady)
    inputClone = cloneInput3(inputReady)

    gameState = makeFullGameState(input, inputClone, spectator)
    battleResult = new Simulator(gameState).simulateSingleBattle(player, opponent)

    if timeExceeded(): break
    if !battleResult: continue

    accumulate(simulationResult, battleResult, battleInput)
    spectator.commitBattleResult(battleResult.result)

    yield intermediate if requested
  return finalize(simulationResult)
```

Grounding: full `FullGameState` construction and aggregation are visible in the loop excerpt. 

---

### 4.2 Input Modeling & Contracts: “What is a battle?”

**Responsibility**

* Define stable input and internal entity schemas: hero entity, minion entities, trinkets, secrets, etc.

**Key files**

* `src/bgs-battle-info.ts`, `src/bgs-board-info.ts`, `src/bgs-player-entity.ts`, `src/board-entity.ts` (referenced by imports throughout)
* `src/simulation/internal-game-state.ts`

  * Defines `FullGameState`, `GameState`, and `PlayerState`. 

**Key design choice**

* `FullGameState` is the “root object” passed around everywhere. It packages:

  * reference data (`allCards`, `cardsData`)
  * telemetry (`spectator`)
  * mutable scratch (`sharedState`)
  * configuration (`currentTurn`, `validTribes`, `anomalies`)
  * the actual player/opponent live state plus initial clones. 

This is pragmatic: it makes function signatures shorter, at the cost of tighter coupling (everything can reach everything).

---

### 4.3 Input Sanitation & Cloning: “Make it safe to mutate and consistent”

**Responsibility**

* Normalize inputs into a combat-ready shape and create cloneable copies for repeated simulations.

**Key files**

* `src/input-sanitation.ts`

  * `buildFinalInput` calls `buildFinalInputForPlayer` repeatedly for player/opponent and optional teammates, then returns an `inputReady` object designed to be cloned for each simulation. 
  * Uses helpers to fix enchantments, set implicit hero data, and set missing auras. 

**Notable design choice**

* The comment explicitly states the reason: run the simulation with mutated objects while starting each sim from a fresh copy. 

**Cloning conventions**

* Clone functions clear or re-initialize certain transient fields (like `pendingAttackBuffs`, remembered deathrattles lists, etc.). You see the same pattern in `copyEntity` utility: it deep-copies enchantments and resets transient state. 

---

### 4.4 Simulation Core: “Make combat happen”

This is the “physics engine.” It is split into subsystems, but the important thing to grok is: **combat is mutation-driven**. Entities and boards are modified in place for speed, and correctness relies on the order and completeness of mutation passes.

#### 4.4.1 Start of Combat (SOC)

**Responsibility**

* Execute start-of-combat triggers in the correct phase order, including hero powers, secrets, minions, trinkets, anomalies, and quest rewards.

**Key files**

* `src/simulation/start-of-combat/start-of-combat.ts`

  * Computes initial attacker with a size-based rule and a random tie-break. 
  * Defines explicit SOC phases:

    * QuestReward → Anomalies → Trinket → PreCombatHeroPower → IllidanHeroPower → HeroPower → Secret → Minion 
  * Marks SOC as done by setting `startOfCombatDone` on both heroes and runs `applyAfterStatsUpdate`. 

**Why this is hard**

* SOC ordering is notoriously rule-sensitive, and the code contains an explicit “not sure about ordering” note, plus comments referencing external evidence and patch changes. That’s a strong sign the ordering is a moving target and a frequent source of regressions. 

**SOC Minions micro-loop**

* `soc-minion.ts` is effectively its own state machine:

  * Picks which side starts via coin flip (`Math.random() < 0.5`)
  * Builds attacker queues including hand triggers first, then board minions
  * Loops while either queue has items, attempting to process alternating sides (with a comment suggesting the real game may resolve one side completely). 

This is a “high leverage” file: subtle changes here can dramatically change outcomes.

#### 4.4.2 Attack and Damage Resolution

**Responsibility**

* Declare attacks, select targets, apply on-attack effects, deal damage, and resolve after-attack effects.
* Ensure all resulting deaths are processed, including chained spawns and triggers.

**Key observation from code patterns**
Even when not shown as a single file excerpt, you can infer the “shape” from how many mechanics call into:

* `dealDamageToMinion`
* registering power targets in spectator
* and relying on post-damage death processing (often commented as a follow-up step). 

Example: Soul Juggler effect picks targets and deals damage, registering telemetry as it does so. 

#### 4.4.3 Stats, Keywords, Auras, and “Maintenance passes”

**Responsibility**

* Keep derived state coherent: buffs, keywords like divine shield, tribe calculations, and auras.

**Evidence**

* Many card implementations call `modifyStats` or `setEntityStats`.
* Tribe resolution helpers like `hasCorrectTribe` and `getEffectiveTribesForEntity` are used to target effects. 

**Design choice**

* Rather than modeling all mechanics declaratively, the system uses:

  * common utility helpers for shared semantics (buffing, tribe checks, spawns),
  * plus per-card imperative logic in implementations.

This is a pragmatic “engine + content scripts” approach.

---

### 4.5 Card System: “Data-driven hooks via a registry”

**Responsibility**

* Provide per-card behavior in small modules and wire them through a centralized mapping.

**Key files**

* `src/cards/card.interface.ts` (hook contract)
* `src/cards/impl/_card-mappings.ts` (registry)
* `src/cards/impl/**` (content implementations)

**How it works**

* A `cardMappings` object maps `cardId` → implementation object.
* Each implementation conforms to a hook interface: `StartOfCombatCard`, `DeathrattleSpawnCard`, `OnBattlecryTriggeredCard`, `EndOfTurnCard`, etc.
* Engine subsystems query `cardMappings` and call hooks when appropriate.

**Concrete examples**

* A battlecry-driven minion (Kalecgos) buffs dragons when a battlecry triggers. 
* A deathrattle spawn card (Kangor’s Apprentice) spawns based on items in `sharedState.deaths`, showing deep coupling between death processing and card logic. 

**Why this pattern was chosen**
It is effectively a **Strategy + Registry** pattern:

* Strategy: each card provides a behavior implementation.
* Registry: `cardMappings` selects the strategy by `cardId`.
  This avoids massive switch statements and makes new content easy to add.

---

### 4.6 Spectator Telemetry: “Event log + checkpoints”

**Responsibility**

* Record a minimal-but-useful trace of what happened in a combat.
* Cap samples so production requests don’t become “logging DDOS.”

**Key files**

* `src/simulation/spectator/spectator-types.ts`

  * `MAX_SAMPLES = 1` and `CHECKPOINT_EVERY_N_EVENTS = 200` establish strict caps and safety valve behavior. 
* `src/simulation/spectator/spectator-sanitize.ts`

  * Sanitizes board entities into a replay-relevant subset (IDs, stats, keywords). 
  * Sanitizes trinkets similarly. 

**Design choice**
This is “observability by controlled sampling”:

* You can collect rich logs for one (or a few) representative simulations, rather than every simulation run.
* That’s essential in Monte Carlo engines.

**Important nuance**
Sanitization is described as mandatory because entities are mutable. That tells you the engine mutates the same objects that spectator might otherwise store by reference, so a deep-ish copy is required for correctness. 

---

### 4.7 Replay: “Rebuild state without rerunning the engine”

**Responsibility**

* Support “seek + replay” for a given `seq` using checkpoints and thin events.

**Key files**

* `src/simulation/replay/apply-event.ts`

  * Defines `CombatReplayState` (small, serializable).
  * Has helpers to initialize from checkpoint snapshots and apply checkpoints. 
* There is also an older or experimental “viewer-grade” replay state with richer zones (board + hand) shown in a `copy` file, plus a `reconstructAt` helper that finds the latest checkpoint and applies events forward. 

**Key algorithm**
The replay strategy is classic:

1. Find the latest checkpoint where `checkpoint.seq <= targetSeq`.
2. Initialize state from that checkpoint snapshot.
3. Apply events with `seq` in `(checkpoint.seq, targetSeq]`. 

**Why this matters**
Replay is the foundation for your validation gates:

* checkpoint equivalence (“bridge test”)
* full replay equivalence (“from zero”)

Even if you’re not “done” with replay, this is the architectural trajectory.

---

### 4.8 Testing & Harnesses: “Seeded full-game runs”

**Responsibility**

* Provide deterministic harnesses and debugging knobs.

**Evidence**

* Tests load a local `cards_enUS.json` with `AllCardsLocalService`, assign it globally, patch RNG, run the Lambda handler, and then print or write spectator telemetry. 

**Debug state**

* `apply-debug-state.ts` activates a global `debugState` and forces an attacker and a sequence of face-offs. That’s a powerful repro tool but also a global side effect to treat carefully. 

---

## 5) Data Flow & State Management (A “day in the life”)

Let’s trace the primary object: **`BgsBattleInfo`** from ingestion to result.

### Step 1: Ingestion at the Lambda handler

* Handler checks for a body, parses JSON into `battleInput`, initializes cards DB and `CardsData`, then delegates to `simulateBattle`. 

### Step 2: Sanitize into `inputReady`

* `buildFinalInput` produces a normalized battle input, calling per-player builders and applying:

  * enchantment fixes
  * implicit hero data
  * missing auras
  * implied mechanics
    This creates a stable baseline for repeated cloning. 

### Step 3: Monte Carlo loop clones per simulation

Each iteration:

* `input = cloneInput3(inputReady)`
* `inputClone = cloneInput3(inputReady)` (used to preserve initial state snapshot)
  This is a key speed choice: clone once per run, mutate in place in the simulator. 

### Step 4: Construct `FullGameState`

Per run, the engine builds a `FullGameState` with:

* reference data (`allCards`, `cardsData`)
* `spectator` (shared across runs)
* new `SharedState()` (per run scratch)
* configuration (`currentTurn`, `validTribes`, `anomalies`)
* `gameState.player/opponent` and `playerInitial/opponentInitial` using input and inputClone. 

This is the root object passed throughout combat subsystems.

### Step 5: Run the combat simulation

* `Simulator.simulateSingleBattle(playerState, opponentState)` runs the combat loop and returns a `SingleSimulationResult` with `{ result: 'won'|'lost'|'tied', damageDealt }`. 

### Step 6: Aggregate results + telemetry sampling

* Update `SimulationResult` counters and damage arrays.
* Decide lethal by comparing `damageDealt` to hero HP.
* Commit the battle outcome to spectator: `spectator.commitBattleResult(...)`. 

### Step 7: Early stop gate

If the simulation exceeds `maxAcceptableDuration`, it breaks out and returns partial aggregation. This protects users and prevents infinite combat loops from hanging the process. 

### Step 8: Return final JSON payload

Handler wraps final result as `{ statusCode, body: JSON.stringify(simulationResult) }`. 

---

## 6) Design Patterns & Coding Standards

### 6.1 Registry + Strategy (Card implementations)

* `cardMappings` acts as a registry keyed by `cardId`.
* Each implementation is a “strategy object” implementing one or more hook interfaces.
* This pattern keeps content additions localized and avoids massive conditional logic. Evidence is widespread via imports of `cardMappings` and per-card modules. 

### 6.2 Layered “engine helpers” approach

The code pushes common operations into helpers:

* `modifyStats`, `setEntityStats`
* tribe checks and effective tribe computation
* random selection / shuffle utilities
* spawn utilities
  This avoids re-implementing core semantics in every card.

### 6.3 Generator-based orchestration

* `simulateBattle` is a generator, enabling intermediate yields in principle even if the handler drains it today. 

### 6.4 Event-sourcing aspiration (Spectator + Replay)

* Thin events plus checkpoint snapshots is an event-sourcing flavored approach.
* Replay reducer uses checkpoint seek + event fold. 

### 6.5 TypeScript quality signals

Positive signs:

* explicit interfaces for key state (`FullGameState`, `PlayerState`) 
* exhaustiveness guards in reducers (`const _never: never = event`) 

Watch-outs:

* “copy” files in production paths (`simulate-bgs-battle copy.ts`, replay apply-event copy) suggest experimentation not fully cleaned up. 

---

## 7) Integration & Infrastructure

### External services

* No databases or network APIs are evident in the snapshot.
* Primary external dependency is **reference card data** from `@firestone-hs/reference-data`, loaded at runtime by `AllCardsService.initializeCardsDb()`. 

### Deployment shape

* The default export looks like an AWS Lambda handler receiving `{ body }` and returning `{ statusCode, isBase64Encoded, body }`. 
* In practice, this code can also be used as a library: tests import `runSimulation` and call it directly. 

### Global dependency injection choice

* `assignCards(cards)` sets a module-level `globalCards` that the handler uses.
* Tests use that to inject `AllCardsLocalService` created from a fixture JSON file. 

This is simple and practical, but it is a global mutable singleton, so concurrency and parallelism need care.

---

## 8) Potential Technical Debt & Growth Areas

### 8.1 RNG determinism is half-in, half-out

* Many high-impact ordering decisions call `Math.random()` directly:

  * SOC attacker tie-breaks and SOC minion sequencing. 
* Tests patch `Math.random`, which is workable but brittle: adding a new RNG call earlier changes the entire deterministic universe.

**Growth path**

* Move toward explicit RNG streams in `SharedState` or `FullGameState`, and optionally log semantic RNG decisions into spectator events.

### 8.2 “Copy files” and dual replay implementations

* `simulate-bgs-battle copy.ts` and replay `apply-event copy.ts` indicate experimentation.
* That’s fine during active development, but it becomes onboarding poison if not pruned or clearly marked as non-production. 

### 8.3 Tight coupling via `FullGameState`

Everything can access everything. It speeds development, but it also:

* makes it harder to reason about ownership and side effects,
* increases risk of cross-subsystem interference.

A possible long-term improvement is slicing `SharedState` into scoped sub-stores (death processing state, RNG state, targeting state).

### 8.4 Start-of-Combat ordering uncertainty

There are explicit TODOs and comments referencing real-game evidence and patch behavior changes. SOC ordering is historically one of the hardest BG mechanics to keep correct. This suggests a need for:

* golden fixtures,
* replay-based validation gates,
* and documentation of ordering rules with references. 

### 8.5 Telemetry contract evolution

You already sanitize boards and trinkets for replay relevance and cap samples. 
The risk is “drift”: engine changes that affect state but are not captured by events/checkpoints sufficiently for replay to match.

Your replay reducer is a great forcing function: whenever replay fails, it tells you which facts must be logged.

---

## 9) Onboarding Roadmap (24 hours to productivity)

Here’s a concrete “touch this first” plan.

### Hour 0–2: Run the harness and see output once

* Run the full-game test harness (seeded if you have it), generate a sample, inspect events and checkpoints.
* Goal: build intuition for the telemetry shape and the combat phases.

Grounding: tests demonstrate the workflow: load cards JSON, assign cards, patch RNG, run simulation, print telemetry. 

### Hour 2–6: Understand the orchestration spine

Read in this order:

1. `src/simulate-bgs-battle.ts` handler + `simulateBattle` loop. 
2. `src/input-sanitation.ts` to understand how raw inputs become canonical. 
3. `src/simulation/internal-game-state.ts` to internalize the state graph. 

### Hour 6–12: Start-of-Combat and why ordering is everything

* Read `start-of-combat.ts` and the phase ordering.
* Then read `soc-minion.ts` and note its RNG ordering and queue mechanics. 

At this point, you can safely modify SOC rules without being blind.

### Hour 12–18: Card system mental model

* Scan `card.interface.ts` and `_card-mappings.ts` to see how hooks are registered.
* Read 3 representative card impls:

  * one SOC card (hero power or trinket),
  * one deathrattle spawn card,
  * one battlecry-driven scaling card.
    Examples in the snapshot are enough to see the style. 

### Hour 18–24: Replay and validation gates mindset

* Read spectator types and sanitization rules. 
* Read replay `apply-event.ts` and understand checkpoint seek + event fold. 

Then you can add meaningful validation tests:

* checkpoint equivalence
* replay-to-seq invariants

