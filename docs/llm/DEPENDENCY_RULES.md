# DEPENDENCY_RULES.md

This document defines **how modules are allowed to depend on each other** in this codebase, and how to keep the simulator maintainable as it grows (more cards, more mechanics, more telemetry).
Source dump: 

---

## 1) Goals

1. **Make onboarding predictable**: new devs can guess where code lives and what it’s allowed to import.
2. **Reduce refactor pain**: avoid “touch one file, rebuild the universe” cascades.
3. **Keep determinism and replay sane**: isolate RNG, state mutation, and telemetry boundaries.
4. **Prevent new cycles**: cycles already exist; the rule is “don’t make it worse”.

---

## 2) Canonical layers (mental model)

Even if the repo currently has cycles, we enforce an **intended direction**.

### Layer 0: Contracts (types only)

**What belongs**

* Data model types and “input structs” that define hook signatures
* Pure enums and interfaces

**Examples in repo today**

* `src/board-entity.ts`, `src/bgs-player-entity.ts`, `src/bgs-battle-info.ts`
* Many hook input types currently live under `src/simulation/*` and are imported by `src/cards/card.interface.ts` (that is a big cycle driver)

**Dependency rule**

* Contracts import nothing except other contracts and external type-only packages.

---

### Layer 1: Services and pure utilities

**What belongs**

* Stable constants like `CardIds`
* Small pure helpers: random selection utilities (if they are RNG-injected), grouping, transforms

**Examples**

* `src/services/card-ids.ts`
* `src/services/utils.ts`
* `src/lib/rng.ts`

**Dependency rule**

* Can depend on Layer 0.
* Must not depend on simulation, spectator, or card implementations.

---

### Layer 2: Engine (simulation core)

**What belongs**

* Combat orchestration and mechanics: SoC, attacks, deaths, spawns, auras, stats
* Internal runtime state: `FullGameState`, `SharedState`

**Examples**

* `src/simulation/*`

**Dependency rule**

* Can depend on Layer 0 and Layer 1.
* Can depend on card *interfaces* (the hook contracts) but must not depend on card implementations.

---

### Layer 3: Card system (registry + derived card metadata)

**What belongs**

* Hook interfaces and type guards
* Derived card pools and metadata (`CardsData`)
* Registry mapping cardId -> implementation

**Examples**

* `src/cards/card.interface.ts`
* `src/cards/cards-data.ts`
* `src/cards/impl/_card-mappings.ts`

**Dependency rule**

* Can depend on Layer 0 and Layer 1.
* Card interfaces should depend only on **contract-level** hook input types, not on concrete engine modules.

---

### Layer 4: Card implementations (content)

**What belongs**

* Individual card behaviors: minions, trinkets, spells, hero powers

**Examples**

* `src/cards/impl/**`

**Dependency rule**

* Can depend on Layers 0-3.
* Should call engine helpers through stable “engine API” functions, not by reaching into deep internal state.

---

### Layer 5: Telemetry and replay (observer tools)

**What belongs**

* Spectator, event log schemas, checkpoints, replay reducer

**Examples**

* `src/simulation/spectator/*`
* `src/simulation/replay/*`

**Dependency rule**

* Telemetry can depend on Layer 0 and Layer 2 (engine types) but must not be required to run core combat logic.
* Card implementations must not import replay code.

---

### Tests

**What belongs**

* Anything under `test/**`

**Dependency rule**

* Tests may import from anywhere in `src/`.
* `src/` must never import from `test/`.

---

## 3) Allowed dependency directions (table)

| From \ To       | Contracts (0) | Services (1) |                Engine (2) |     Card System (3) | Card Impl (4) |  Telemetry (5) |
| --------------- | ------------: | -----------: | ------------------------: | ------------------: | ------------: | -------------: |
| Contracts (0)   |             ✅ |            ❌ |                         ❌ |                   ❌ |             ❌ |              ❌ |
| Services (1)    |             ✅ |            ✅ |                         ❌ |                   ❌ |             ❌ |              ❌ |
| Engine (2)      |             ✅ |            ✅ |                         ✅ | ✅ (interfaces only) |             ❌ | ✅ (types only) |
| Card System (3) |             ✅ |            ✅ |       ⚠️ (contracts only) |                   ✅ |             ✅ |              ❌ |
| Card Impl (4)   |             ✅ |            ✅ | ✅ (public engine helpers) |                   ✅ |             ✅ |              ❌ |
| Telemetry (5)   |             ✅ |            ✅ |                         ✅ |                   ❌ |             ❌ |              ✅ |

Legend:

* ✅ allowed
* ❌ forbidden
* ⚠️ allowed only if it’s contract-level imports (types), not concrete engine modules

---

## 4) Concrete rules by directory

### `src/board-entity.ts`, `src/bgs-*.ts` (Contracts)

**Rules**

* No imports except external types and other contract files.
* Avoid “helper” functions here. Keep it type-only.

**Why**

* These are imported everywhere. Keeping them pure reduces blast radius.

---

### `src/services/*` and `src/lib/*`

**Rules**

* Pure utilities only. No engine imports.
* Randomness utilities must be **seedable** or **injectable** (don’t hardcode `Math.random()` inside “services utils”).

**Why**

* Services should be stable. Engine changes should not force services changes.

---

### `src/simulation/*` (Engine)

**Rules**

* Engine may import:

  * contract types
  * stable utilities (`services/utils`, `lib/rng`)
  * card interfaces and type guards
* Engine must not import:

  * `src/cards/impl/**` directly
  * `_card-mappings.ts` (except in one clearly designated “registry boundary” module)

**Recommended pattern**

* Engine calls `getCardImpl(cardId)` from a single adapter, not by importing the entire registry everywhere.

---

### `src/cards/card.interface.ts` (Card hook contracts)

**Rules**

* This file should not import from concrete engine modules (`src/simulation/attack.ts`, etc).
* It should import hook input types from a **contract location**, for example:

  * `src/contracts/hooks/on-attack.ts`
  * `src/contracts/hooks/start-of-combat.ts`

**Why**

* Today, card.interface pulls types from simulation modules, which drags in engine dependencies and creates cycles.

---

### `src/cards/cards-data.ts` (Derived metadata)

**Rules**

* Must not import `_card-mappings.ts`.
* If it needs to know “is this card implemented?”, accept a predicate injected at construction:

  * `new CardsData(allCards, { isImplemented: (id) => registry.has(id) })`

**Why**

* `CardsData -> _card-mappings -> impl -> simulation -> CardsData` is a classic mega-cycle.

---

### `src/cards/impl/_card-mappings.ts` (Registry)

**Rules**

* This is the **only file** allowed to import many card implementations.
* It should export a small API:

  * `getCardImpl(cardId): Card | undefined`
  * `hasCardImpl(cardId): boolean`
  * optionally `allImplementedCardIds(): string[]`

**Why**

* Contain the fan-out. Keep the rest of the repo from importing hundreds of modules.

---

### `src/cards/impl/**` (Implementations)

**Rules**

* Allowed imports:

  * `CardIds`, small utilities, contract types, stable engine helper functions (stats/spawns/etc)
* Forbidden imports:

  * spectator/replay modules
  * `_card-mappings.ts` (no self-registry access)
* Prefer:

  * `input.gameState.spectator.registerPowerTarget(...)` (using the spectator instance injected in `FullGameState`)
  * rather than importing spectator classes

**Why**

* Implementations should be “content scripts,” not wiring or infrastructure.

---

### `src/simulation/spectator/*` + `src/simulation/replay/*`

**Rules**

* Telemetry should only depend on sanitized or contract-level representations.
* Replay reducer should not need to import simulation core logic.
* Keep event schema stable and versioned.

**Why**

* If replay imports engine logic, you get “replay must simulate” coupling, which defeats its purpose.

---

## 5) Import hygiene rules

### 5.1 No deep relative spaghetti

Prefer path aliases (tsconfig paths) for stable boundaries:

* `@core/*` for contracts
* `@services/*`
* `@engine/*`
* `@cards/*`
* `@telemetry/*`

**Rule**

* Relative imports are fine within a folder.
* Cross-folder imports should use aliases to make boundaries obvious.

---

### 5.2 Type-only imports

**Rule**

* Use `import type { X } from '...'` when you only need types.

**Why**

* Prevents accidental runtime dependency edges.

---

### 5.3 One-way adapters

Where cycles are “functionally needed,” isolate them behind adapters:

* Engine should call registry through `cards/registry.ts`
* Cards should call engine helpers through `engine/api.ts`

This turns “a million imports everywhere” into “one import in one place.”

---

## 6) Exceptions policy (when it’s OK to break a rule)

Exceptions are allowed, but must be:

1. **Local** (one file, not a pattern)
2. **Documented** at the top of the file:

```ts
// DEPENDENCY EXCEPTION:
// Reason: <why it must import X>
// Exit plan: <how to remove later>
// Owner: <name/team>
// Date: <yyyy-mm-dd>
```

Common legitimate exceptions:

* A narrow telemetry call site that needs a small engine type
* A one-off migration module

---

## 7) Enforcement (how to keep this from being a wish poem)

### 7.1 ESLint

Enable and fail CI on:

* `import/no-cycle`
* `import/no-restricted-paths` (define forbidden edges)
* `@typescript-eslint/consistent-type-imports`

### 7.2 Boundary lint rules (recommended)

Set explicit constraints like:

* `src/services/**` cannot import from `src/simulation/**`
* `src/cards/impl/**` cannot import from `src/simulation/spectator/**`
* `src/simulation/**` cannot import from `src/cards/impl/**`

### 7.3 “One registry” rule

A grepable rule in CI:

* Only `_card-mappings.ts` can import from `src/cards/impl/**`

---

## 8) Recipes (how to refactor without pain)

### Recipe A: Break a cycle involving `CardsData` and registry

1. Remove `import { cardMappings } from './impl/_card-mappings'` from `cards-data.ts`
2. Add constructor param: `isImplemented: (cardId: string) => boolean`
3. Pass it from entrypoint (`simulate-bgs-battle.ts`) where both are already wired

Result: `CardsData` becomes pure and stops pulling the entire implementation universe into itself.

---

### Recipe B: Move hook input types out of engine

1. Create `src/contracts/hooks/*` and copy input interfaces there
2. Update `card.interface.ts` to import from contracts, not engine
3. Update engine to import from contracts too

Result: engine and card interface share contracts without importing each other.

---

### Recipe C: Stop “utils.ts” from becoming a kitchen junk drawer

Rule of thumb:

* If a helper touches `FullGameState` or `Spectator`, it belongs in engine.
* If a helper touches `CardIds` and simple transforms only, it belongs in services.
* If a helper is “card-like behavior,” it belongs in cards.

---

## 9) Quick onboarding summary

If you remember nothing else:

* **Types live in contracts and must stay pure.**
* **Only `_card-mappings.ts` imports all card impl files.**
* **Engine never imports card implementations directly.**
* **Telemetry observes, it does not drive combat logic.**
* **Prefer type-only imports and boundary aliases.**

---
