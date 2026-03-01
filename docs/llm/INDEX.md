# INDEX.md

This is the landing page for the **LLM packet + onboarding docs** generated from `all_ts_dump.txt` (TS-only snapshot of the repo). Use it as your map, your reading plan, and your “where do I look?” cheat sheet.

---

## 1) What this packet is for

* **New-dev onboarding**: understand the simulator without spelunking 600+ files
* **Refactor safety**: know the invariants and dependency boundaries before changing core logic
* **Replay/debug work**: event schemas, checkpoints, and timing windows
* **LLM context**: give another model a clean, structured overview of the codebase

---

## 2) Recommended reading paths

### Path A: New dev, Day 1 (fastest ramp)

1. `QUICKSTART.md`
2. `SYSTEMS_OVERVIEW.md`
3. `PROJECT_MAP.md`
4. `CORE_LOGIC_FLOWS.md`
5. `TRIGGERS_AND_TIMING.md`
6. `GLOSSARY.md`

### Path B: Engine contributor (changing combat logic)

1. `ARCHITECTURE.md`
2. `CORE_LOGIC_FLOWS.md`
3. `TRIGGERS_AND_TIMING.md`
4. `RULES_LAYERING.md`
5. `DATA_MODEL.md`
6. `DEPENDENCY_RULES.md`

### Path C: Card implementer (adding or fixing card behaviors)

1. `PROJECT_MAP.md`
2. `DATA_MODEL.md`
3. `TRIGGERS_AND_TIMING.md`
4. `RULES_LAYERING.md`
5. `TYPEDEFS.ts` (reference types for hook inputs)

### Path D: Replay and telemetry (events, checkpoints, determinism)

1. `EVENTS.md`
2. `EVENT_CATALOG.md`
3. `TRIGGERS_AND_TIMING.md`
4. `CORE_LOGIC_FLOWS.md`
5. `DEPENDENCY_GRAPH.md` (know the coupling)

---

## 3) The docs, at a glance

### Orientation and navigation

* `SYSTEMS_OVERVIEW.md`
  The major subsystems and how they interact.
* `PROJECT_MAP.md`
  “Where do I go to change X?” guide for onboarding.
* `DIRECTORY_MAP.md`
  TS-only directory tree and what each folder does.
* `GLOSSARY.md`
  Canonical vocabulary (entity, phase, SoC, death batch, seq, etc).

### Architecture and runtime behavior

* `ARCHITECTURE.md`
  Big picture architecture and core design choices.
* `CORE_LOGIC_FLOWS.md`
  End-to-end runtime flow: simulateBattle → SoC → attack loop → deaths → results.
* `TRIGGERS_AND_TIMING.md`
  The timing model: when hooks fire, ordering, and “do not break” invariants.
* `RULES_LAYERING.md`
  Where rules live, which layer owns what, and where to implement new behavior.

### Data contracts and types

* `DATA_MODEL.md`
  Inputs, internal runtime state, outputs, telemetry payloads.
* `TYPEDEFS.ts`
  Consolidated typedefs for quick reference (LLM-friendly).

### Telemetry and replay

* `EVENTS.md`
  Thin event schema, checkpoints, phases, invariants.
* `EVENT_CATALOG.md`
  Enumerated event types, meaning, emission points, replay behavior.

### Dependencies and boundaries

* `DEPENDENCY_GRAPH.md`
  What depends on what, hubs, cycles, fan-in/fan-out hotspots.
* `DEPENDENCY_RULES.md`
  Allowed dependency directions and enforcement guidelines.

### Getting started

* `QUICKSTART.md`
  Install, run tests, run a simulation, determinism tips, debugging workflow.

---

## 4) Key “source of truth” code entrypoints

If you only open a handful of files:

### Simulation outer loop

* `src/simulate-bgs-battle.ts`
  Lambda handler + `simulateBattle(...)` Monte Carlo generator.

### Core runtime state

* `src/simulation/internal-game-state.ts`
  `FullGameState`, `GameState`, `PlayerState`.

### Single-combat conductor

* `src/simulation/simulator.ts`
  SoC + attack loop + termination + damage.

### Attack and deaths

* `src/simulation/attack.ts`
  Attack selection, damage exchange, trigger windows.
* `src/simulation/minion-death.ts`
  Death detection and removal.
* `src/simulation/deathrattle-orchestration.ts`
  Deathrattle ordering, avenge, reborn, post-death effects.

### Spawns and board mutation

* `src/simulation/spawns.ts`
  Spawn execution, placement, attackImmediately.
* `src/simulation/add-minion-to-board.ts`
  Board insertion and side effects.
* `src/simulation/remove-minion-from-board.ts`
  Clean removal.

### Hook contracts and registry

* `src/cards/card.interface.ts`
  Hook interfaces + type guards.
* `src/cards/impl/_card-mappings.ts`
  Registry: cardId → implementation.

### Telemetry and replay

* `src/simulation/spectator/spectator.ts`
  Event emission + samples + checkpoints.
* `src/simulation/replay/apply-event.ts`
  Replay reducer for thin events.

---

## 5) “Where do I change X?” quick map

* **Fix incorrect attack targeting**
  `src/simulation/attack.ts` (+ utilities in `simulation/utils/entity-utils.ts`)
* **Fix deathrattle ordering or reborn weirdness**
  `src/simulation/deathrattle-orchestration.ts`, `deathrattle-*.ts`, `reborn.ts`
* **Spawn placement / board full edge cases**
  `src/simulation/spawns.ts`, `add-minion-to-board.ts`, `spawn-fail.ts`
* **SoC ordering or recompute-first-attacker logic**
  `src/simulation/start-of-combat/start-of-combat.ts`
* **Add a new card behavior**
  `src/cards/impl/<category>/...` + `_card-mappings.ts`
* **Add a new hook timing window**
  `src/cards/card.interface.ts` + call site in `src/simulation/*`
* **Replay mismatch / event log completeness**
  `src/simulation/spectator/*` + `src/simulation/replay/*`

---

## 6) Invariants worth memorizing

These show up again and again in the docs:

1. **Damage does not remove entities**. Removal happens in the **death pipeline**.
2. **Use helpers**:

   * stats via stats helpers
   * keywords via keyword update helpers
   * spawns via spawn/add-minion helpers
3. **Replay depends on explicit boundaries**:

   * `minion-death` for removals
   * `spawn` for topology changes
   * `entity-upsert` for state sync
4. **Determinism depends on RNG discipline** (many sites still use `Math.random()` unless patched).

---

## 7) Maintenance notes

This packet was generated from `all_ts_dump.txt`, which is a concatenation of `.ts` files. If the repo changes, regenerate the dump and refresh these docs.

Suggested “refresh order” when the code changes a lot:

1. `DIRECTORY_MAP.md`
2. `PROJECT_MAP.md`
3. `DATA_MODEL.md` + `TYPEDEFS.ts`
4. `CORE_LOGIC_FLOWS.md` + `TRIGGERS_AND_TIMING.md`
5. `EVENTS.md` + `EVENT_CATALOG.md`
6. `DEPENDENCY_GRAPH.md` + `DEPENDENCY_RULES.md`

---

## 8) Optional: doc placement convention

If you want a tidy structure:

```
docs/llm/
  INDEX.md
  QUICKSTART.md
  SYSTEMS_OVERVIEW.md
  ARCHITECTURE.md
  PROJECT_MAP.md
  DIRECTORY_MAP.md
  DATA_MODEL.md
  TYPEDEFS.ts
  CORE_LOGIC_FLOWS.md
  TRIGGERS_AND_TIMING.md
  RULES_LAYERING.md
  EVENTS.md
  EVENT_CATALOG.md
  GLOSSARY.md
  DEPENDENCY_GRAPH.md
  DEPENDENCY_RULES.md
```
