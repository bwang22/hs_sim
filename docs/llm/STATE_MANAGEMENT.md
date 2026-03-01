```md
# STATE_MANAGEMENT.md
How combat state is represented, mutated, observed, and reset in this simulator 🎛️🧠

This doc is a practical map of state, not a theory essay. It answers:
- What “state” exists (input, runtime, scratchpads, telemetry)
- Who owns each piece
- How mutation happens safely (and where it is easy to shoot yourself in the foot)
- What invariants must hold for correctness + determinism + replay

---

## 1) State layers (the onion)

### Layer A: External input (immutable contract)
**Types:** `BgsBattleInfo`, `BgsBoardInfo`, `BgsPlayerEntity`, `BoardEntity`

This is the shape the simulator receives. Treat it as a *contract*, not as working memory.

Key idea: the simulator does not rely on the caller’s objects staying stable, so it sanitizes and clones (next layers).

---

### Layer B: Sanitized “ready-to-sim” input (normalized but still data-shaped)
**Builder:** `buildFinalInput(...)`

Responsibilities:
- Normalize missing/null fields
- Fix enchantments
- Add implied mechanics (flags and tags derived from card data)
- Add missing auras (important: input may not have aura enchantments applied)
- Initialize hero implicit state and counters

This step produces an `inputReady` that can be cloned repeatedly for Monte Carlo.

---

### Layer C: Per-simulation cloned input (fresh, mutation-safe copies)
**Cloner:** `cloneInput3(...)`

For each simulation run:
- Clone the sanitized input into a fresh object graph
- Ensure no arrays or nested objects are shared across runs
- Reset ephemeral per-run arrays (example: `pendingAttackBuffs`, `rememberedDeathrattles`)

There is also an “initial clone” kept alongside the run clone to store a pristine baseline snapshot for the `FullGameState` (`playerInitial`, `opponentInitial`).

---

### Layer D: Internal runtime root store (what every system reads/writes)
**Type:** `FullGameState`

`FullGameState` contains:
- Read-only services: `allCards`, `cardsData`
- Telemetry: `spectator`
- Combat scratch: `sharedState`
- Current turn + tribes/anomalies
- `gameState` object holding `player`, `opponent`, and their initial copies

This is the primary dependency passed around to subsystems.

---

### Layer E: Combat scratchpad (cross-cutting mutable state)
**Type:** `SharedState`

`SharedState` is a shared mutable “blackboard” used across subsystems. Examples:
- `currentEntityId` (spawn id allocator)
- `currentAttackerEntityId` (tracks attacker for bookkeeping)
- `deaths` (staging list for death resolution)
- `debug` flags

If `FullGameState` is the “world”, `SharedState` is the notebook everyone scribbles in.

---

### Layer F: Local, loop-owned control state
**Owner:** `Simulator` instance

Examples:
- `currentAttacker`
- `currentSpeedAttacker`
- safety guard counters (short-circuit warnings)

These are not global state. They are part of the engine’s control flow.

---

### Layer G: Observability and replay state (telemetry store)
**Owner:** `Spectator`

The spectator tracks:
- Monotonic `seq`
- A thin event log (`eventsForCurrentBattle`)
- Periodic checkpoints (`checkpointsForCurrentBattle`)
- Legacy “actions” snapshots (`actionsForCurrentBattle`)
- Last-known context for building snapshots without needing to be passed every object every time

This state resets between battles but persists across Monte Carlo runs until pruned.

---

## 2) The canonical runtime state graph

### FullGameState
```

FullGameState
allCards: AllCardsService                 (read-only service)
cardsData: CardsData                      (read-only service)
spectator: Spectator                      (telemetry, per-battle buffers)
sharedState: SharedState                  (mutable scratch)
currentTurn, validTribes, anomalies       (runtime parameters)
gameState:
player: PlayerState  -> (board[], player entity, optional teammate)
opponent: PlayerState -> (...)
playerInitial: PlayerState              (baseline copy)
opponentInitial: PlayerState            (baseline copy)

```

### PlayerState
- `board: BoardEntity[]` is the primary battlefield array
- `player: BgsPlayerEntity` holds hero-ish state (HP, hero powers, secrets, trinkets, quest state, globalInfo counters)
- optional `teammate` exists for duo inputs (used mainly for damage math)

---

## 3) Mutation model (how state actually changes)

### 3.1 Everything in combat is mutated in place
During simulation, the engine mutates:
- `BoardEntity` objects directly (attack/health/flags/enchantments)
- `BgsPlayerEntity` directly (hpLeft, flags like `startOfCombatDone`, global counters)
- board arrays via insertion/removal/spawn positioning

This is intentional for performance in Monte Carlo loops.

**Rule of thumb:** the only “immutable” objects are the service layers (`allCards`, `cardsData`) and the high-level input contract before cloning.

---

### 3.2 Ephemeral fields must be cleared or re-initialized
Some fields are “scratch per phase”:
- `pendingAttackBuffs` is cleared in `applyAfterStatsUpdate(...)`
- `rememberedDeathrattles` is created empty in cloning and filled during combat
- `startOfCombatDone` is set once per hero after SOC finishes

If you add a new ephemeral field, you must decide:
- cleared every stats tick?
- cleared at start of battle?
- persistent across the combat?

Then implement that reset in the right layer (sanitation, cloning, applyAfterStatsUpdate, or spectator reset).

---

### 3.3 Derived state is recomputed by dedicated passes
There are “maintenance” passes whose job is to keep state coherent:
- `setMissingAuras(...)` in sanitation
- `addImpliedMechanics(...)` in sanitation and death staging
- `clearStealthIfNeeded(...)` in the combat loop
- `applyAfterStatsUpdate(...)` after Start-of-Combat (and as needed elsewhere)

The mental model: mutation happens constantly, then periodic “sweeps” restore invariants.

---

## 4) State lifecycle (from API call to final result)

### 4.1 One API call runs many simulations
`simulateBattle(...)` performs a Monte Carlo loop:
1) Build `inputReady` via sanitation
2) For each run:
   - deep clone `inputReady` into `input`
   - deep clone again into `inputClone` for baseline
   - assemble `FullGameState` (new `SharedState`, shared `Spectator`)
   - run `Simulator.simulateSingleBattle(...)`
   - update aggregate stats and commit spectator sample
3) Prune spectator samples, normalize outcome sample format, return results

Important state boundaries:
- `SharedState` is per-run
- `Spectator` is shared across runs (but buffers are reset per battle)

---

### 4.2 Simulator state flow (single combat)
Within `simulateSingleBattle(...)`:
- Establish a safe entityId allocator by scanning all entity ids and enchantment origin ids, then setting `sharedState.currentEntityId = max + 1`
- Run a top-level loop that continues until:
  - both heroes have completed Start-of-Combat AND
  - one board is empty (combat resolved)

Inside:
- Register SOC with spectator, compute initial attacker
- Execute Start-of-Combat phases (which can also cause deaths)
- Enter the attack loop:
  - run “maintenance” (`handleSummonsWhenSpace`, `clearStealthIfNeeded`)
  - pick attacker (including “attack immediately” speed logic)
  - execute `simulateAttack(...)`
  - rotate attacker or maintain speed attacker
  - guard against infinite loops (iteration counter)

---

## 5) Deaths are a re-entrant mini engine (and a big state hotspot)

### 5.1 Death detection and removal
`processMinionDeath(...)`:
- detects dead minions and removes them from boards (via helpers)
- registers death metadata to spectator
- pushes enriched “dead entities” into `sharedState.deaths` (with implied mechanics and position-at-death info)
- calls `onDeath` hooks for dead entities
- updates hero global counters (example: Eternal Knights)
- orchestrates deathrattle and related effects via `orchestrateMinionDeathEffects(...)`
- recursively calls itself to ensure all chained deaths are processed
- triggers “summon when space” effects unless suppressed
- applies “after minion death” effects
- updates fish remembered deathrattles at the end of a fully resolved batch

**Why this matters for state management:** deaths touch boards, heroes, shared scratch, and spectator all at once. If state gets corrupted, it usually shows up here.

---

## 6) Observability state (Spectator) and why it matters

### 6.1 Spectator has its own internal state machine
Spectator maintains:
- `seq` counter (monotonic per battle)
- event list and checkpoints
- last-known board/hero context for snapshotting

It records:
- thin events like `start-of-combat`, `attack`, `damage`, `spawn`, `minion-death`
- checkpoints at key boundaries and every N events (a safety valve)

### 6.2 Snapshot content is intentionally sanitized
Sanitization reduces entity shape down to “replay relevant” fields: id, cardId, friendly, stats, and key keywords.

This is a contract. If you need a field for replay, you add it to the sanitized entity and also ensure the engine actually maintains it correctly.

### 6.3 State reset boundary
After committing a battle sample, spectator calls `resetCurrentBattle()` which clears action/event/checkpoint buffers and resets seq to 0.

This is critical to prevent state bleed across runs.

---

## 7) Debug state (extra state that can override the engine)

### 7.1 `debugState` global
There is a global `debugState` object that can:
- force `currentAttacker`
- force specific face-offs (attacker/defender pairs)
- reset its scripted plan at battle start

This is powerful and dangerous. If you use it, treat it as “test-only wiring” and avoid relying on it in core logic.

### 7.2 `SharedState.debugEnabled`
`SharedState` has a static `debugEnabled` that seeds per-run `sharedState.debug`. That means you can flip debug behavior without threading flags everywhere.

---

## 8) Invariants (things that should always be true)

### Entity identity and ownership
- `entityId` values must be unique within a battle
- `sharedState.currentEntityId` must always point to an unused id
- `friendly` must match board ownership consistently
- enchantment `originEntityId` ids must not collide or drift into nonsense

### Board constraints
- board size constraints (usually max 7) must be enforced by spawn/add helpers
- insert indexes must be valid at time of insertion

### Phase flags and resets
- `startOfCombatDone` should only flip to true once SOC completes
- ephemeral arrays like `pendingAttackBuffs` must not accumulate across phases unless explicitly intended

### Telemetry coherence
- spectator `seq` must be monotonic within a battle
- checkpoints should be buildable from last context, otherwise they silently don’t exist

---

## 9) “Where should new state live?” (decision checklist)

When you add a new state field, answer these in order:

1) Is it part of the public input contract?  
   - If yes: update input types and sanitation.

2) Is it derived from card data and should exist at combat start?  
   - Put it in sanitation (`buildFinalInput*`, implied mechanics, missing auras).

3) Is it purely per-run scratch used by multiple subsystems?  
   - Put it in `SharedState`.

4) Is it hero-level persistent counters (across combats) or per-combat progress?  
   - Put it in `BgsPlayerEntity.globalInfo` or a dedicated hero field, and initialize it in `setImplicitDataHero(...)`.

5) Does it need to be replayable/observable?  
   - Add to spectator sanitization and/or emit it as an event.

6) Does it need clearing?  
   - Implement reset in cloning, `applyAfterStatsUpdate`, or spectator reset.

---

## 10) Common failure modes (state bugs that look like “randomness”)

- Shallow copies in cloning cause cross-simulation contamination.
- A new field added to `BoardEntity` is not cloned, so it leaks or stays undefined.
- A maintenance sweep (like `applyAfterStatsUpdate`) does not reset new ephemeral fields.
- A hook mutates state without emitting a spectator update, so replay diverges.
- Time-based early stop truncates Monte Carlo samples, making results “unstable” even with seeded RNG.

---

## 11) Suggested next hardening steps (optional, but high ROI)

1) Consolidate “reset points” into named boundaries:
   - battle start, SOC end, attack end, death batch end, battle end.

2) Make RNG a first-class member of state (instead of global `Math.random`):
   - store RNG stream cursor in `SharedState` or a dedicated RNG object,
   - optionally record RNG decisions as events.

3) Tighten the replay contract:
   - add a “state hash” at checkpoints,
   - ensure all state transitions emit minimal events needed to replay.

---

## Appendix: Key files
- Input contract: `src/bgs-battle-info.ts`, `src/bgs-board-info.ts`, `src/bgs-player-entity.ts`, `src/board-entity.ts`
- Sanitation: `src/input-sanitation.ts`
- Cloning: `src/input-clone.ts`
- Runtime root: `src/simulation/internal-game-state.ts`, `src/simulation/shared-state.ts`
- Core engine: `src/simulation/simulator.ts`, `src/simulation/attack.ts`, `src/simulation/stats.ts`
- Death engine: `processMinionDeath(...)` in `src/simulation/attack.ts`
- Observability: `src/simulation/spectator/*`
- Debug: `src/debug-state.ts`
```

### Grounding references (from `all_ts_dump.txt`)

* Input contract shapes: `BgsBattleInfo` and `BgsGameState` are defined in `src/bgs-battle-info.ts` (lines 7-27).
* Deep clone strategy and field resets (`options: null`, `pendingAttackBuffs: []`, `rememberedDeathrattles: []`): `src/input-clone.ts` (lines 21470-21517, especially 21482 and 21508-21516).
* Sanitation adds missing auras and hero implicit data: `setMissingAuras(...)` and `setImplicitDataHero(...)` are called in `buildFinalInputForPlayer(...)` in `src/input-sanitation.ts` (lines 21685-21692).
* Sanitation marks entities as `inInitialState: true` and applies `addImpliedMechanics(...)`: `buildFinalInputBoard(...)` in `src/input-sanitation.ts` (around lines 21718-21735, including line 21726).
* Monte Carlo loop builds `FullGameState` with a fresh `SharedState` per run and preserves initial clones: `src/simulate-bgs-battle.ts` (lines 57116-57148, including 57123 and 57138).
* `FullGameState` and `PlayerState` definitions: `src/simulation/internal-game-state.ts` (lines 66214-66247).
* `SharedState` fields (`currentEntityId`, `deaths`, debug flags): `src/simulation/shared-state.ts` (lines 68243-68262).
* `simulateSingleBattle(...)` sets `currentEntityId = max + 1` and runs while SOC not done or boards non-empty: `src/simulation/simulator.ts` (lines 68291-68320).
* Combat loop maintenance and attack dispatch (`handleSummonsWhenSpace`, `clearStealthIfNeeded`, `simulateAttack`): `src/simulation/simulator.ts` (lines 68510-68558).
* Death processing pushes into `sharedState.deaths`, emits spectator death events, calls `orchestrateMinionDeathEffects`, and recursively drains deaths: `processMinionDeath(...)` in `src/simulation/attack.ts` (lines 59703-59860, especially recursion at ~59841).
* `applyAfterStatsUpdate(...)` clears `pendingAttackBuffs`: `src/simulation/stats.ts` (lines 74329-74343).
* Spectator state buffers, checkpoints, and auto-checkpoint every N events: `src/simulation/spectator/spectator.ts` (lines 72095-72140 and 72552-72570).
* Spectator event schema and checkpoint cadence constants (`CHECKPOINT_EVERY_N_EVENTS`, phases): `src/simulation/spectator/spectator-types.ts` (lines 71985-72035).