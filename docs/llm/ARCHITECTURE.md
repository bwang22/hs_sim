This codebase is a Hearthstone Battlegrounds combat simulator: given a snapshot of two boards (and associated hero state like hero powers, trinkets, quests, secrets, anomalies), it simulates combat many times to estimate win/tie/loss odds and damage distributions.

1) Big picture
Primary data flow

Input: BgsBattleInfo describing player and opponent boards (plus teammate boards for duos), game state context, and simulation options.

Sanitize/normalize: buildFinalInput(...) cleans boards, fills implicit data, applies missing auras, etc. (so sim logic can assume a consistent shape).



Monte Carlo loop: simulateBattle(...) clones the sanitized input for each iteration, constructs a FullGameState, then runs a single combat via Simulator.simulateSingleBattle(...). Results are aggregated into a SimulationResult.



Optional telemetry: Spectator collects outcome samples plus event/checkpoint data that can be used for replay/debugging.


Architecture diagram (conceptual)
flowchart TD
  A[BgsBattleInfo] --> B[input-sanitation/buildFinalInput]
  B --> C[simulateBattle Monte Carlo]
  C --> D[FullGameState]
  D --> E[Simulator.simulateSingleBattle]
  E --> F[Start of Combat pipeline]
  E --> G[Attack loop]
  G --> H[Death processing + spawns]
  E --> I[Damage / winner computation]
  E --> J[Spectator telemetry]
  C --> K[Aggregate SimulationResult]

  2) Core domain model
State containers
FullGameState

A single simulation run holds global references (card DB, derived card data, shared counters) and the mutable per-side combat state in gameState.


Key fields:

allCards: card database service

cardsData: battlegrounds-specific computed data (tiers, avenge values, defaults)

sharedState: shared mutable counters and ids used across the sim

spectator: telemetry sink for “what happened”

anomalies, validTribes, currentTurn

gameState: the mutable combat state per side


GameState and PlayerState

GameState has:

player, opponent: current mutable combat state

playerInitial, opponentInitial: a baseline snapshot used for some logic/debug/replay scenarios


PlayerState has:

board: BoardEntity[]

player: BgsPlayerEntity

optional teammate?: PlayerState (duos support)


Entities

BoardEntity: a minion-like combat unit (attack/health/keywords/enchantments, plus simulator-only fields).

BgsPlayerEntity: hero-side container (hpLeft, tavernTier, trinkets, hero powers, quests/rewards, secrets, globalInfo counters).

A design choice here is mutation: the simulator updates these entity objects in place, which is why input cloning and spectator sanitization matter.

3) Entrypoints and runtime modes
3.1 Monte Carlo API (simulateBattle)

simulateBattle is a generator that:

reads simulation options (numberOfSimulations, maxAcceptableDuration, etc),

builds a single sanitized “ready” input,

loops N times:

clones input,

creates a FullGameState,

runs Simulator.simulateSingleBattle,

aggregates outcomes,

stops early if runtime exceeds maxAcceptableDuration (safety valve).




It also initializes Spectator(includeOutcomeSamples) once and reuses it across runs for sample collection.


3.2 AWS Lambda handler

There is a default export that looks like an AWS Lambda handler:

parses lambdaEvent.body,

initializes card services,

runs simulateBattle to completion,

returns statusCode: 200 with the final simulation result.


This makes the repo usable both as a library and as a deployed service endpoint.

4) Combat engine: phases and responsibilities

The combat engine is built from a set of modules under src/simulation/*. The central coordinator is Simulator, which calls specialized helpers for different phases and effect types.

4.1 Start of Combat (SoC)

Start of combat is modularized under src/simulation/start-of-combat/* and stitched together via handleStartOfCombat(...) (called from the simulator).

Key traits:

Order is sometimes randomized (coin toss logic) to match uncertain or game-specific ordering rules (for example, which side’s secrets/trinkets/hero powers resolve first).



SoC may recompute the current attacker if effects spawn minions and change board sizes, via handleSummonsWhenSpace(...) and a size-based rule with a random tie-breaker.


SoC operates on a SoCInput bundle containing both sides’ boards/heroes, plus currentAttacker and the FullGameState.


SoC participants commonly include:

anomalies

hero powers (including special Illidan handling)

quest rewards

secrets

trinkets

minions on board and “from hand” start-of-combat effects

A notable implementation detail: minion SoC supports hand triggers before board triggers by building attacker lists from hand.filter(hasStartOfCombatFromHand(...)) then appending board entities.


4.2 Attack loop (main combat)

Simulator establishes the initial attacker based on board sizes (random tie-break), then calls handleStartOfCombat(...), then enters a while loop until a side is dead or empty. This loop performs repeated cleanup and attack simulation steps.


Inside the loop you will typically see:

“summon when space” upkeep (ensures passive summons fill empty slots)

stealth clearing logic

attacker selection and forced-attack handling (including “attack immediately” patterns)

per-attack resolution

death resolution (including deathrattle orchestration and reborn)

post-attack effects

Even though many of these helpers live in different files, the mental model is: choose attacker → resolve attack → resolve deaths/spawns → repeat.

4.3 Deaths, spawns, and “attack immediately”

Spawning is handled via functions like spawnEntities(...) and performEntitySpawns(...), and there is explicit logic for spawned minions that must “attack immediately”. When that happens, the code calls back into simulateAttack(...) during spawn resolution, then clears the attackImmediately flag to prevent repeated immediate attacks.



This cross-calling is one of the big reasons the engine is written as mutable procedures rather than a strict step-by-step reducer: combat effects can cause nested combat actions.

5) “Rules engine” pattern: card implementations + hook interfaces
5.1 Card interface and typed hooks

Card behavior is expressed through a large Card interface and a family of “hasX” type guards (hasStartOfCombat, hasAfterDealDamage, hasOnDeath, etc). Each hook has a typed input struct that carries everything needed to implement the effect. Example: the base Card interface includes an optional startOfCombat(...) hook that can return either a boolean or a richer object including shouldRecomputeCurrentAttacker.


This approach lets core sim logic do:

lookup implementation by cardId,

check whether it supports a hook,

call it with a well-scoped input.

5.2 cardMappings

cardMappings is the registry mapping cardId -> implementation object (living under src/cards/impl/_card-mappings.ts). Most gameplay changes are implemented by adding a new card module and wiring it into this mapping.

5.3 Layout of card implementations

Card implementations dominate the repository:

src/cards/impl/minion/*

src/cards/impl/trinket/*

src/cards/impl/hero-power/*

src/cards/impl/bg-spell/*, spellcraft/*, etc.

Each module exports a typed object (for example StartOfCombatCard, DeathrattleSpawnCard) containing:

cardIds: [...]

one or more hook functions (ex: startOfCombat, deathrattleSpawn, endOfTurn)

That makes it easy to add new cards without touching the simulator core, as long as you can express the behavior via existing hooks.

6) Randomness and determinism
6.1 Current reality: lots of Math.random()

Many ordering decisions and random target selections are made via Math.random() (coin toss to choose which side resolves first, tie-breakers, etc). You can see this in SoC modules and elsewhere.



6.2 Deterministic runs: patching Math.random

Tests demonstrate a pragmatic determinism strategy: patch Math.random globally with a seeded PRNG (mulberry32).



This allows full deterministic replays and stable test expectations without refactoring every random call site to accept an injected RNG.

If you want deterministic behavior in production, you can adopt the same approach:

choose a seed per simulation run,

patch Math.random while simulating,

restore after.

7) Telemetry, debugging, and replay
7.1 Spectator (recording what happened)

A Spectator instance is created in simulateBattle and stored in FullGameState. It collects:

traditional “actions” (GameAction snapshots)

a newer “thin” event log (attack, damage, spawn, death, etc)

periodic checkpoints for reconstruction


Because simulation entities are mutable, spectator code sanitizes entity snapshots before storing them, to avoid later mutations corrupting recorded history.


7.2 Replay state reconstruction

There is a replay module that reconstructs viewer-grade state at a given sequence number (seq) using:

the latest checkpoint at or before targetSeq,

then applying events forward until targetSeq.


This is the basis for:

debugging “how did we get here?”

building a combat viewer

validating event emission correctness

7.3 Event vocabulary (thin log)

The spectator event union includes items like:

attack (attackerEntityId, defenderEntityId)

damage (targetEntityId, amount, kind)

spawn (sanitized spawned entities)

minion-death (deadEntityIds)

power-target

end-of-combat damage markers


The event set is intentionally “viewer-relevant” rather than “rules-complete”, with the option to expand later.

8) Input sanitation and normalization

Before simulation begins, the input is normalized so core rules can assume consistent structures:

hero power normalization

ghost handling (hpLeft <= 0)

clamping hpLeft to at least 1 in some scenarios

applying missing auras

setting implicit per-hero data (avenge/globalInfo, ids)


This is a critical boundary: buggy or incomplete input sanitation leaks complexity into every combat rule.

9) Testing strategy

The test folder includes:

full game scenario tests (using a stored game.json snapshot)

deterministic seeded runner that patches Math.random before importing the full test harness


RNG smoke tests validating mulberry32 determinism and patch correctness


A practical pattern used here is: stabilize randomness first, then assert that the simulator emits consistent telemetry and/or outcomes.

10) Extension guide: adding or changing behavior
Add a new card behavior

Create a module under the correct src/cards/impl/<type>/....

Export an implementation typed to the hooks you need (ex: StartOfCombatCard, DeathrattleSpawnCard).

Add its cardIds and implementation into src/cards/impl/_card-mappings.ts.

If you need a new “hook category” (ex: a new timing window), extend cards/card.interface.ts with:

a new interface type,

a new type guard (hasX),

an input struct under src/simulation/* if needed.

Add a new simulation mechanic

Prefer the pattern already used in src/simulation/*:

implement a helper that takes (board, hero, otherBoard, otherHero, gameState, ...),

mutate entities in place,

emit spectator events at key boundaries (targets, damage, spawns, deaths),

keep “who goes first” decisions explicit, and deterministic when possible.

11) Known sharp edges (design tradeoffs)

Mutation-heavy core: fast and straightforward, but requires careful cloning and sanitization boundaries.

Ordering uncertainty: several places use Math.random() as a proxy for unknown or version-dependent ordering rules. This is realistic for BGs, but makes strict reproducibility depend on seeding/patching.

Nested actions: “attack immediately” and deathrattle chains can cause nested combat steps, which complicates pure functional designs but is handled naturally by procedural calls.


12) Repository map (high level)

src/simulate-bgs-battle.ts: Lambda handler + simulateBattle Monte Carlo generator.


src/input-sanitation.ts: input normalization, implicit data, missing aura fixes.


src/simulation/simulator.ts: orchestrates a single combat (SoC + attack loop + outcome).

src/simulation/internal-game-state.ts: FullGameState, GameState, PlayerState definitions.


src/simulation/start-of-combat/*: SoC pipeline modules and timings.

src/simulation/spectator/*: action/event logging, checkpoints, sanitizers, and types.

src/simulation/replay/*: apply-event + reconstruction helpers.


src/cards/impl/*: card behaviors by category (minion/trinket/hero-power/spells).

13) If you’re reading this to onboard

Here’s a “follow the bouncing potato” reading order 🥔:

simulate-bgs-battle.ts to see the outer loop and FullGameState construction.


simulation/internal-game-state.ts to learn the state shapes.


simulation/simulator.ts to understand combat orchestration (SoC → loop).

simulation/start-of-combat/* to see ordering, timings, recompute logic.

cards/card.interface.ts + _card-mappings.ts to understand the hook registry model.