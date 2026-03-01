```md
# OWNERSHIP.md
A map of “who owns what” in this repo, plus the rules of engagement for changes that can explode the combat engine into confetti 🎲⚔️

> **How to use this doc**
> 1) Find the path you’re changing in **Ownership Map**  
> 2) Pull in the **Primary Owner** (and follow the review rules)  
> 3) If you’re touching an interface or output contract, read **Change Playbooks** first

---

## Purpose

This repository implements a Battlegrounds combat simulation pipeline: it takes a battle input, sanitizes it, runs many simulated combats via a core simulator, and optionally emits a spectator-friendly event log (events + checkpoints) that can be replayed deterministically.

Ownership exists to ensure:
- **Correctness** (rules match game behavior as best we can),
- **Determinism & debuggability** (repro + replay),
- **Stability of contracts** (input and spectator output),
- **Velocity** (the right people review the right diffs).

---

## Ownership model

### Roles (lightweight but strict)
- **Primary Owner**: accountable for correctness, reviews, and long-term health of an area.
- **Backup Owner**: can review/merge when primary is unavailable.
- **Shepherd (per PR)**: the person driving a change across multiple owned areas. They coordinate reviewers.

### “Owner” means
Owners are responsible for:
- Reviewing and approving changes to their area.
- Maintaining invariants and keeping docs/tests up to date.
- Triage and guidance on bug reports related to their area.

### Default review rule
If you touch a file in an owned area, request review from that area’s Primary Owner.
If a PR touches multiple areas, request review from **all** impacted owners.

### Severity tiers for review
- **Tier 0 (Contract / Core determinism)**: must be reviewed by **2 owners**, including the relevant contract owner.
- **Tier 1 (Core rules engine)**: must be reviewed by **1 core owner** (plus any affected adjacent owners).
- **Tier 2 (Content / card implementations)**: must be reviewed by **1 content owner**.
- **Tier 3 (Tests / tooling)**: **1 owner** of the affected infra/test area.

---

## Architecture at 10,000 feet

### Execution pipeline
1) **Input sanitation**: normalize/repair incoming battle data, add implied mechanics, fix auras/enchantments, and clone into a mutation-safe format.
2) **Simulation loop**: create a per-run game state (shared state + spectator), then run the simulator for one combat; repeat for many runs to produce outcome statistics.
3) **Spectator telemetry**: optionally record thin events plus periodic checkpoints to support replay and debugging.
4) **Replay (optional)**: reconstruct state from checkpoints + events and apply events forward.

---

## Ownership Map

> Replace the placeholder handles below with your real GitHub users/teams.
> Example: `@firestone/sim-core`, `@firestone/content-bgs`, etc.

### Core teams (placeholders)
- **SIM-CORE**: `@team/sim-core`
- **SIM-OBSERVABILITY** (spectator, events, replay): `@team/sim-observability`
- **CONTENT** (cards, anomalies, hero powers, trinkets): `@team/content`
- **DATA-INTEGRATION** (card ids, reference data wiring, sanitation): `@team/data-integration`
- **QA / TESTS**: `@team/qa`
- **TOOLING** (build/lint/ci): `@team/tooling`

---

## Owned areas (by path)

| Area | Paths | Primary | Backup | Review tier | Notes |
|---|---|---:|---:|---:|---|
| Public entrypoint / API wrapper | `src/simulate-bgs-battle*.ts` | DATA-INTEGRATION | SIM-CORE | Tier 0 | Defines runtime envelope (options, duration, loops). |
| Input cloning & sanitation | `src/input-*.ts` | DATA-INTEGRATION | SIM-CORE | Tier 0 | Changes here can silently alter outcomes for *every* sim. |
| Debug controls | `src/debug-state.ts` | SIM-CORE | QA / TESTS | Tier 1 | Debug hooks must never leak into production defaults. |
| Core simulator loop | `src/simulation/simulator.ts` | SIM-CORE | SIM-CORE | Tier 0 | Heartbeat of combat. Performance + determinism sensitive. |
| Shared mutable state | `src/simulation/shared-state.ts` | SIM-CORE | SIM-CORE | Tier 1 | Entity id counters, death queues, debug toggles. |
| Combat resolution (attack/damage/death) | `src/simulation/attack*.ts`, `src/simulation/death*`, `src/simulation/spawn*`, `src/simulation/stats*`, `src/simulation/**/utils/*.ts` | SIM-CORE | SIM-CORE | Tier 1 | High-risk for correctness regressions. |
| Start of combat engine | `src/simulation/start-of-combat/**` | SIM-CORE | CONTENT | Tier 0 | Ordering-sensitive; touches many content triggers. |
| Keyword state updaters | `src/keywords/**` | SIM-CORE | CONTENT | Tier 1 | Keyword toggles are rule glue between engine and cards. |
| Card contract (hook interfaces) | `src/cards/card.interface.ts` | SIM-CORE | CONTENT | Tier 0 | Contract changes ripple to every card impl. |
| Card mapping registry | `src/cards/impl/_card-mappings.ts` | CONTENT | SIM-CORE | Tier 1 | Registry correctness determines which impls run. |
| Card implementations (all) | `src/cards/impl/**` | CONTENT | CONTENT | Tier 2 | Content correctness, balance of complexity, avoid side effects. |
| Cards data layer | `src/cards/cards-data.ts` | DATA-INTEGRATION | CONTENT | Tier 1 | Tavern tiers, tribe resolution, lookups. |
| Card ids and constants | `src/services/card-ids.ts`, `src/temp-card-ids.ts` | DATA-INTEGRATION | CONTENT | Tier 1 | Prefer additive changes; avoid renames. |
| Shared utilities | `src/utils.ts`, `src/services/utils.ts` | SIM-CORE | DATA-INTEGRATION | Tier 1 | RNG usage and helper semantics matter. |
| Spectator output: types/sanitize/logging | `src/simulation/spectator/**` | SIM-OBSERVABILITY | SIM-CORE | Tier 0 | Output contract: events, checkpoints, snapshots, migrations. |
| Replay engine | `src/simulation/replay/**` | SIM-OBSERVABILITY | SIM-CORE | Tier 0 | Must stay aligned with spectator schema. |
| Replay (legacy or experimental) | `src/simulation/*apply-event*` | SIM-OBSERVABILITY | SIM-CORE | Tier 1 | Keep “copy” files clearly marked and not imported in prod. |
| Tests: full-game harness | `test/full-game/**` | QA / TESTS | SIM-OBSERVABILITY | Tier 3 | Determinism harness and regression fixtures live here. |

---

## Review requirements (quick matrix)

### Tier 0: Contract & determinism
Requires **2 approvals**, including the contract owner.

Examples:
- Changing spectator event schema, checkpoint cadence, or sanitation fields.
- Changing `Card` hook interfaces.
- Changing input sanitation that affects entity ids, stats, or implied mechanics.
- Changes that alter determinism assumptions (RNG, ordering, tie-breakers).

### Tier 1: Engine rules
Requires **1 SIM-CORE** approval, plus impacted adjacent owners if applicable.

Examples:
- Attack selection rules, death processing, spawn insertion, aura application.

### Tier 2: Content
Requires **1 CONTENT** approval.

Examples:
- Add or adjust a minion/trinket/hero power behavior.

### Tier 3: Tests/tooling
Requires **1 owner** of tests/tooling area.

---

## Change playbooks

### 1) Adding or modifying a card implementation (`src/cards/impl/**`)
**Owner:** CONTENT (loop in SIM-CORE if you touch shared engine utilities)

Checklist:
- [ ] Identify the correct hook type (start-of-combat, end-of-turn, deathrattle, after spell cast, etc.).
- [ ] Implement behavior in the correct category folder (minion, trinket, hero-power, anomaly, quest-reward, spells…).
- [ ] Register card ids in `_card-mappings.ts`.
- [ ] Use engine helpers (stats, spawns, keywords) instead of duplicating rule logic.
- [ ] If behavior emits spectator targets/events, ensure it uses the spectator API consistently.
- [ ] Add or update a regression test (prefer `test/full-game/**` for high-impact cards).

Red flags that require SIM-CORE review:
- You introduce new “mini engines” inside a card impl.
- You manipulate entity id counters directly.
- You change ordering expectations (especially start-of-combat).

---

### 2) Changing start-of-combat ordering (`src/simulation/start-of-combat/**`)
**Owner:** SIM-CORE (CONTENT as co-review)

Checklist:
- [ ] Document the intended ordering in code comments (why this order).
- [ ] Verify with at least one replay or fixture (ideally a known tricky scenario).
- [ ] Confirm whether the change affects hero powers, trinkets, quest rewards, anomalies, or minions.

Rule:
- This is **Tier 0** because ordering changes can shift outcomes across the entire meta.

---

### 3) Changing spectator output (events, checkpoints, snapshots)
**Owner:** SIM-OBSERVABILITY (SIM-CORE as co-review)

Golden rules:
- **Never break consumers silently.** Prefer additive changes.
- Treat the spectator payload like an API: versioning and migrations matter.

Checklist:
- [ ] Add fields instead of renaming whenever possible.
- [ ] If you must rename: implement a migration layer that accepts legacy shapes.
- [ ] Keep sanitation aligned with replay needs (stats + keywords needed to reconstruct).
- [ ] Update replay code to handle new event types (exhaustiveness checks are your friend).
- [ ] Update the full-game telemetry test output expectations if needed.

---

### 4) Input model changes (`BgsBattleInfo`, `BgsBoardInfo`, player entities)
**Owner:** DATA-INTEGRATION (SIM-CORE co-review)

Checklist:
- [ ] Sanitation: support both old and new inputs when feasible.
- [ ] Cloning: ensure new fields are clone-safe (no shared references across sim runs).
- [ ] Ensure defaults do not alter outcomes unintentionally.

---

### 5) RNG / determinism changes
**Owner:** SIM-CORE (SIM-OBSERVABILITY co-review if replay depends on it)

Checklist:
- [ ] Prefer injected RNG streams over raw `Math.random` calls.
- [ ] If using `Math.random`, ensure tests seed/override it consistently.
- [ ] If replay relies on events rather than RNG state, ensure events are sufficient to reproduce outcomes.

---

## Escalation and triage

### If you see a regression in outcomes
1) Identify the area (engine vs content vs sanitation vs spectator).
2) Assign the **Primary Owner** of that area.
3) If the regression affects many battles (broad correctness), treat as Tier 0 and pull in SIM-CORE.

### If replay breaks
- Page **SIM-OBSERVABILITY** first.
- If root cause is engine ordering or missing data in sanitation, loop in SIM-CORE.

### Fast fix rule (break glass)
If you must ship a hotfix:
- Require at least **one** approval from the area owner.
- Add a follow-up task to restore Tier 0 review and tests ASAP.

---

## Keeping this file healthy

### When to update OWNERSHIP.md
- New major folders or subsystems appear.
- A team takes over an area or a maintainer rotates off.
- A contract’s review tier changes (for example, spectator becomes a published API).

### Suggested companion file
Consider adding a `CODEOWNERS` file that mirrors the “Owned areas” table for automatic review requests.

---

## Appendix: Suggested “area labels” (for PRs/issues)
- `area:sim-core`
- `area:start-of-combat`
- `area:cards`
- `area:spectator`
- `area:replay`
- `area:input`
- `area:tests`
- `area:tooling`
```

**Grounding from `all_ts_dump.txt` (why these areas exist):**

* The simulation entrypoint builds a `FullGameState` with `SharedState` and a `Spectator`, clones sanitized input per simulation, and uses `Simulator.simulateSingleBattle` in a loop. 
* Start-of-combat is a dedicated subsystem with explicit ordering calls (anomalies, hero powers, minions, quest rewards, secrets, trinkets), and it includes an ordering TODO. 
* The card system is driven by a central hook contract in `src/cards/card.interface.ts` that wires many simulation inputs and hook types. 
* Spectator output is a first-class module with event logs, checkpoints, cadence constants, and sanitation of board/trinkets. 
* Replay reconstructs state from checkpoints + events and applies events forward, so it must stay coupled to spectator schema. 
* Full-game tests seed RNG (via `mulberry32`) and print spectator telemetry, making tests a distinct owned surface. 
