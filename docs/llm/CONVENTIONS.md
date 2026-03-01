# CONVENTIONS.md

A practical style guide for this repo, based on patterns visible in `all_ts_dump.txt` and tuned for **new-dev onboarding + safe changes**. It has two parts:

* **Observed conventions** (what the repo already does)
* **Enforced conventions** (what we should do to keep the codebase healthy)

---

## 1) Naming and file layout

### 1.1 File naming

**Observed**

* Most content files are **kebab-case**: `bird-buddy.ts`, `blazing-skyfin.ts`
* “Aggregator/registry” files use leading underscore: `_card-mappings.ts`
* Legacy variants sometimes appear as `* copy.ts` (example: `apply-event copy.ts`, `spectator copy.ts`)

**Convention**

* Use **kebab-case** for feature/content modules.
* Avoid creating new `* copy.ts` files. If you need variants:

  * prefer `*.legacy.ts` (explicit) or put experiments under `tools/` or `scratch/`.

### 1.2 Directory ownership

**Observed major boundaries**

* `src/simulation/*` owns combat physics and timing windows.
* `src/cards/card.interface.ts` defines hook contracts and type guards.
* `src/cards/impl/**` holds per-card behavior (“content scripts”).
* `src/simulation/spectator/*` and `src/simulation/replay/*` own telemetry + reconstruction.
* `src/keywords/*` owns keyword toggling logic.
* `src/services/*` owns stable constants like `CardIds` and utility helpers.

**Convention**

* Put logic where it belongs:

  * Engine timeline and state machines: `src/simulation/`
  * Card-specific logic: `src/cards/impl/`
  * Cross-cutting mutation rules: `src/simulation/stats.ts`, `src/keywords/*`, `src/simulation/spawns.ts`
  * Logging and replay: `src/simulation/spectator/*`, `src/simulation/replay/*`

---

## 2) TypeScript style and module hygiene

### 2.1 Imports

**Convention**

* Prefer `import type { ... }` for types only.
* Avoid deep relative “../../../..” imports across subsystems. If possible, use consistent relative depth within a subsystem.
* Do not import from `test/**` in `src/**`.

### 2.2 Types as contracts

**Convention**

* Treat `BoardEntity`, `BgsPlayerEntity`, `FullGameState`, and telemetry types as contracts.
* When changing them, assume wide blast radius (hundreds of importers).

### 2.3 Small, explicit functions over cleverness

**Convention**

* Favor readable, stepwise logic in timing-sensitive code.
* Avoid “one function that does everything” in combat orchestration. Use small helpers with explicit inputs and outputs.

---

## 3) Content implementation conventions (cards, trinkets, hero powers)

### 3.1 File template

**Observed pattern**
A content module exports a typed constant implementing one hook interface:

```ts
export const BirdBuddy: AvengeCard = {
  cardIds: [CardIds.BirdBuddy_BG21_002, CardIds.BirdBuddy_BG21_002_G],
  baseAvengeValue: () => 1,
  avenge: (minion, input) => { ... },
};
```

**Convention**

* One file usually defines one implementation object (unless variants are tightly coupled).
* Always include **all variants** in `cardIds` (normal, golden, seasonal variants if present).
* Name the exported constant in **PascalCase**.
* Export a **const**, not a class.

### 3.2 Registering content

**Convention**

* Every new implementation must be added to `src/cards/impl/_card-mappings.ts`.
* Do not dynamically register at runtime. This repo is compile-time wired by design.

### 3.3 Content must use engine helpers

**Hard rule**
Do not mutate core state directly unless you know exactly what invariants you are bypassing.

Use:

* Stats: `simulation/stats.ts` helpers (`modifyStats`, `setEntityStats`, etc)
* Keywords: `keywords/*` (`updateTaunt`, `updateDivineShield`, etc)
* Spawns: `simulation/spawns.ts` + `add-minion-to-board.ts`
* Enchantments: `simulation/enchantments.ts`

Avoid:

* `entity.attack += x` (bypasses stats-change hooks and enchantment bookkeeping)
* `entity.taunt = true` (bypasses keyword updated hooks)
* `board.splice(...)` (bypasses spawn/despawn hooks, aura maintenance, telemetry placement)

### 3.4 Content should be pure-ish “script”

**Convention**

* No file I/O, no global state, no reliance on time (`Date.now()`).
* If you need randomness, it must come from the same RNG story as the engine (today: `Math.random()` patched in seeded tests).

---

## 4) Engine conventions (combat physics)

### 4.1 Timing windows are sacred

**Convention**
Do not reorder trigger windows casually. The engine’s choreography is intentional.

Canonical ordering for an attack step:

1. Declare attack (telemetry)
2. On-being-attacked window (defender secrets first, then defensive hooks)
3. On-attack window (attacker-side hooks, then rally)
4. Damage exchange (`performAttack`)
5. After-attack (minion effects)
6. Death pipeline (batch removal + DR/avenge/reborn closure)
7. After-attack (trinket effects)
8. Cleanup (`applyAfterStatsUpdate`)

If you change ordering:

* update docs (`TRIGGERS_AND_TIMING.md`)
* update replay assumptions if telemetry depends on it
* add a regression test case

### 4.2 Death pipeline owns removals

**Hard rule**

* Damage can reduce health to 0.
* Minions are removed only by the death pipeline (death batching).

Never “remove on damage” inside attack code. If you do, you will break:

* deathrattle ordering
* avenge semantics
* replay and state reconstruction assumptions

### 4.3 Spawns must go through spawn helpers

**Hard rule**
New entities should be added through `performEntitySpawns(...)` or `addMinionToBoard(...)` so:

* board size rules are enforced
* aura bookkeeping happens
* spawn hooks fire
* “attackImmediately” behavior is handled consistently

### 4.4 “Attack immediately” discipline

**Convention**

* If a spawned minion has `attackImmediately`, it must be cleared after its immediate attack.
* The engine’s “speed attacker” logic depends on this to avoid endless loops.

### 4.5 Keep engine and content decoupled

**Convention**

* Engine imports card interfaces and the registry, but should not import individual implementations.
* Content can call engine helpers, but should not import spectator/replay modules directly.

---

## 5) Keyword and stats conventions

### 5.1 Keyword toggles must use keyword helpers

**Hard rule**
Use `updateDivineShield`, `updateTaunt`, `updateReborn`, `updateStealth`, `updateVenomous`, `updateWindfury`.

Reason:

* these functions track previous value
* trigger OnXUpdated hooks
* maintain extra bookkeeping flags (like “hadDivineShield”)

### 5.2 Stats changes must use stats helpers

**Hard rule**
Prefer `modifyStats` or other stats module entrypoints for changes that should be observable.

Reason:

* stats changes often create enchantment records
* OnStatsChanged hooks may fire
* downstream logic relies on consistent bookkeeping

---

## 6) Telemetry and replay conventions

### 6.1 Two logs exist: thin and fat

**Convention**

* Thin stream (`SpectatorEvent[]`) is replay-friendly.
* Fat actions (`GameAction[]`) are viewer/debug-friendly.

Avoid mixing concerns:

* combat logic should not depend on telemetry
* telemetry should sanitize mutable entities before storing

### 6.2 When to emit telemetry

**Convention**

* Attacks: log attacker/defender IDs
* Damage: log minion damage instances
* Deaths: log `minion-death` with dead IDs
* Spawns: log spawned entities and placement indexes if available
* Targeting: log `power-target` and, when state changes matter, `entity-upsert`

### 6.3 Replay invariants you must preserve

* Only `minion-death` removes entities in replay.
* `spawn` adds entities.
* `entity-upsert` patches state.
* Checkpoints are authoritative snapshots for seeking.

If you add a new thin event type:

* update the union schema
* update `applyEvent(...)` in replay reducer
* keep payload minimal and serializable

---

## 7) Determinism and randomness

### 7.1 Current strategy

**Observed**

* Many code paths use `Math.random()`.
* Seeded tests patch `Math.random()` using a deterministic PRNG (Mulberry32).

**Convention**

* Never introduce new nondeterminism sources like `Date.now()` in combat logic.
* When debugging replay mismatches, always run under the seeded runner first.

### 7.2 If you add randomness

**Convention**

* Use the same RNG story the engine uses (today: `Math.random()`).
* Avoid object key iteration as a randomness source. Use arrays with stable ordering.

---

## 8) Testing conventions

### 8.1 Seeded tests are the truth serum

**Convention**

* Add regression cases to deterministic runs whenever you change:

  * attack ordering
  * deathrattle orchestration
  * spawn placement
  * keyword update logic
  * replay event semantics

### 8.2 Favor “scenario + assertions”

**Convention**

* Tests should be expressed as:

  * input scenario (boards, heroes, options)
  * deterministic run
  * assert on end state and, when relevant, on event log checkpoints

---

## 9) Legacy and “copy.ts” policy

**Observed**

* The repo contains `* copy.ts` files, usually older iterations.

**Convention**

* Do not create new `copy.ts` files.
* If you need to keep an older version temporarily:

  * move it under `archive/` or `tools/`
  * or name it `*.legacy.ts` with a comment header:

```ts
// LEGACY FILE
// Reason: <why it exists>
// Replacement: <where new logic lives>
// Remove by: <date or milestone>
```

---

## 10) Documentation conventions (keeping the packet fresh)

Whenever you change any of these areas, update the corresponding doc:

* Timing windows, ordering: `TRIGGERS_AND_TIMING.md`
* Engine flow: `CORE_LOGIC_FLOWS.md`
* Event schema or replay: `EVENTS.md`, `EVENT_CATALOG.md`, `REPLAY_SPEC.md`
* Data shapes: `DATA_MODEL.md`, `TYPEDEFS.ts`
* Boundaries: `DEPENDENCY_RULES.md`, `DEPENDENCY_GRAPH.md`
* High-level structure: `SYSTEMS_OVERVIEW.md`, `PROJECT_MAP.md`

---

## 11) Quick “Do / Don’t” table

| Topic     | Do                           | Don’t                                 |
| --------- | ---------------------------- | ------------------------------------- |
| Stats     | use stats helpers            | mutate `attack/health` directly       |
| Keywords  | use `updateX(...)`           | flip keyword booleans directly        |
| Spawns    | use spawn/add-minion helpers | splice boards manually                |
| Deaths    | let death pipeline remove    | remove on damage                      |
| Telemetry | log as observer              | make combat logic depend on logs      |
| RNG       | run seeded for debugging     | use `Date.now()` or hidden randomness |
| Registry  | add to `_card-mappings.ts`   | rely on dynamic imports               |

---

If you want, I can also generate a `PULL_REQUEST_CHECKLIST.md` that turns these conventions into a 10-item “did you break an invariant?” gate for reviewers.
