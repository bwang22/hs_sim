# GLOSSARY

A shared vocabulary for the Battlegrounds combat simulator, its data model, and the replay/event-log workstream.

## How to read this glossary

* **Code names** use the project’s actual identifiers (e.g., `BoardEntity`, `CombatPhase`).
* **“Replay” terms** refer to the spectator telemetry: events + periodic checkpoints.
* If a term isn’t a first-class concept in code, it’s marked as **(convention)**.

---

## Core simulation concepts

### Battle

One “matchup” between a player board and an opponent board, simulated once or many times (Monte Carlo style) to estimate win/tie/loss and damage distributions. The simulator exposes a generator that iterates to a final `SimulationResult` (so it can optionally emit intermediate results).

### Combat

The deterministic resolution of a single battle: start-of-combat effects, attack loops, death resolution, and end-of-combat hero damage. (In telemetry, this is the unit that gets an event log + checkpoints.)

### Simulation

Running many combats (often thousands) with randomized branching (target selection, ordering choices, etc.) to compute aggregated outcomes. Controlled by `BgsBattleOptions.numberOfSimulations` (not shown in the search snippets, but implied by the battle loop).

### Iteration

One pass of the battle generator. In telemetry, do not confuse with `seq` (event sequence). (convention)

### Tick

Not a first-class term in this codebase. If you need a “time step” word, prefer:

* `seq` for event ordering in the log (replay time), or
* “attack step” / “death batch” for combat progression. (convention)

---

## Phases and timing

### `CombatPhase`

High-level combat phase label used by telemetry and replay:
`'START_OF_COMBAT' | 'ATTACK' | 'DEATHS' | 'END_OF_COMBAT'`.

### Start-of-combat (SoC)

The pre-attack window where secrets, trinkets, hero powers, minion SoC effects, and anomalies can trigger. Many SoC systems recompute the “first attacker” when they cause spawns or board-size changes. (See `shouldRecomputeCurrentAttacker` pattern.)

### `StartOfCombatTiming`

A finer ordering label used by card implementations:

* `'pre-combat'` (before “start-of-combat” proper, commonly for hero powers/trinkets)
* `'start-of-combat'`
* `'illidan'` (special ordering bucket for Illidan/Wingmen-style effects)

### `StartOfCombatPhase`

A named “bucket” used to organize SoC orchestration:
`QuestReward | Anomalies | Trinket | PreCombatHeroPower | IllidanHeroPower | HeroPower | Secret | Minion`.

### Attack step

One resolved attack: attacker selected, defender chosen, damage applied, then deaths processed (possibly in batches). Telemetry may record this as an `attack` event with attacker/defender entity IDs.

### Deaths / death batch

The resolution window where entities that reached lethal health (or are marked `definitelyDead`) are removed and deathrattles/reborn/avenge chains are processed. Telemetry models “death” explicitly via `minion-death` events listing dead IDs.

### End-of-combat

Final damage is applied to heroes based on surviving board state. Telemetry has `player-attack` / `opponent-attack` events in `END_OF_COMBAT`.

---

## Identity, ownership, and board topology

### Entity

A concrete object participating in combat, tracked by stable `entityId` and a `cardId`. Most of the simulator operates on “entity objects” that are mutable during resolution, hence the need for sanitization when logging.

### `entityId`

The unique identity of an entity instance within a combat state. New spawns typically consume `sharedState.currentEntityId++` so spawned minions are uniquely identifiable and deterministic across replay if the same spawn decisions occur.

### `cardId`

The card identifier (string) that determines rules implementation (via `cardMappings`) and base stats/mechanics (via reference data).

### `friendly`

Boolean ownership marker: whether this entity belongs to the “player side” in the current simulation context. Used heavily for deciding which board/hero state to operate on and for logging minimal identities.

### Board

A side’s ordered list of `BoardEntity` objects. Position matters for neighbor effects, cleaves, “left/rightmost” targeting, and insertion points for spawns.

### Index-from-left / index-from-right

Two coordinate systems used in spawn and targeting code:

* “from left” is the array index
* “from right” is often used as a stable reference when spawns insert and shift positions (common in Battlegrounds logic). The spawn pipeline uses `spawnIndexFromRight` and computes `indexToSpawnAt` from board length.

### `boardPosition` (telemetry concept)

A positional field sometimes included in event schema proposals to reconstruct placement. (In the live spectator event union, placement is handled via spawn events with optional `insertIndexes`.)

---

## Primary data structures

### `BgsBattleInfo`

Top-level simulation input: player/opponent boards (and optional teammates), battle options, and simplified game state (turn, tribes, anomalies). *(from the initial snippet shown in chat; if you want, we can pull this into a cited msearch chunk next)*

### `BoardEntity`

The main “minion-like” runtime structure for combat resolution. Includes:

* Core stats: `attack`, `health`, plus `maxHealth`, `maxAttack`
* Keywords: `taunt`, `divineShield`, `poisonous`, `venomous`, `reborn`, `windfury`, `stealth`, plus extras like `cleave`
* Runtime fields: `definitelyDead`, `hasAttacked`, `attackImmediately`, `lastAffectedByEntity`, `pendingAttackBuffs`, etc.
* Data channels: `scriptDataNum1..6`, `tags`, `memory`, `additionalCards`, etc.

### `BoardEnchantment`

A lightweight attachment on an entity (or “remembered deathrattle”) with:

* `cardId` (what effect it represents)
* `originEntityId` (who applied it)
* `timing` (an ordering key, often derived from `currentEntityId++`)
* optional `repeats`, `value`, `memory`, and script-data tags

### `BoardSecret`

Secret representation (combat-relevant subset):

* identity: `entityId`, `cardId`
* runtime: `triggered`, `triggersLeft`, and script-data fields

### `BoardTrinket`

A trinket-like object owned by a hero with `cardId`, `entityId`, and script-data fields; can also carry avenge counters or remember a minion.

### `BgsQuestEntity`

Quest progress record in hero state: `ProgressCurrent`, `ProgressTotal`, and identifiers. (Used mainly outside combat, but present in the player entity model.)

---

## Keywords and mechanics

### Keyword flags

Common boolean toggles on `BoardEntity` that change targeting/rules:

* `taunt`, `divineShield`, `poisonous`, `venomous`, `reborn`, `windfury`, `stealth`

### `divineShield` and `strongDivineShield`

Shield keyword(s). `divineShield` is the standard boolean; `strongDivineShield` exists as an enhanced variant in some seasons/cards.

### `reborn` / `rebornFromEntityId`

Reborn indicates the entity can return once after death; `rebornFromEntityId` tracks lineage (helps prevent “self-inheriting” remembered deathrattles).

### `definitelyDead`

A hard kill marker used when an entity should be considered dead even if the object still exists temporarily during resolution (important for ordering and edge cases).

### Avenge

A counter-based trigger that fires when friendly minions die. Entities can carry `avengeDefault` and `avengeCurrent`; counters decrement on deaths, and when `avengeCurrent <= 0` the effect triggers. The engine updates these counters across board entities and also hero-attached items (hero powers, quest rewards, trinkets).

### Battlecry

An “on-play” effect that triggers when a minion is played. In combat simulation, battlecries can still be triggered indirectly by effects (e.g., “trigger a random battlecry”). The card interface supports `battlecry(minion, input)`. *(visible in the large snippet; we can also cite a tighter chunk if needed)*

### Deathrattle

An effect triggered when a minion dies. Implemented through `deathrattleSpawn` or other deathrattle orchestration paths; deathrattles can also be “remembered” (Fish-style) as `BoardEnchantment` records.

### “Remembered deathrattles”

A special mechanism where a minion stores a list of deathrattle enchantments (`rememberedDeathrattles`) instead of reusing full entity snapshots, so stats are recomputed at runtime while the identity of the deathrattle effects remains. Stored as `BoardEnchantment[]`.

### Rally

A trigger type that fires “when this attacks” (or when another minion attacks, depending on the card). The card interface supports a `rally` hook returning damage bookkeeping. Example: enchantments can implement Rally and stack via `repeats`.

### Magnetize

A “merge onto a target” mechanic (Mech modular). It’s referenced via magnetize hooks in the card interface imports and simulation modules (implementation details live in `simulation/magnetize`). *(present in snippet; can be pulled into a tighter cited chunk if useful)*

### Aura

A continuous effect that modifies stats/keywords based on board state (for example, “all beasts have +X/+Y”). The code often updates auras on spawn/despawn, and some comments explicitly mention “applySelfAuras” and aura ordering concerns. (convention)

### `attackImmediately`

A runtime flag used for tokens that should attack immediately upon being spawned (special BG behavior). Spawn code may immediately call `simulateAttack` and then clear the flag to prevent repeated immediate attacks.

### `scriptDataNum1..6`

General-purpose numeric payload slots used by many BG entities, trinkets, secrets, and enchantments to encode card-specific state. Present on entities and on trinkets and secrets (different subsets).

### `tags`

Low-level tag map `{[tag: number]: number}` for extra metadata pulled from reference data or derived at runtime. Useful when card logic needs raw tag values.

### `memory`

An untyped scratch space attached to an entity or enchantment for card-specific state that doesn’t fit the generic schema (e.g., “remembered” payload).

---

## Card implementation vocabulary

### `Card` (interface)

The base contract for a card implementation. Cards may declare `cardIds` and optionally implement `startOfCombat`. Many specialized interfaces extend this (`BattlecryCard`, `AvengeCard`, `RallyCard`, etc.).

### `cardMappings`

A dictionary `{[cardId: string]: Card}` built from an array of card implementations. Used to look up behavior for a given `cardId`. (This is the “rules registry”.) *(visible in the large snippet; can be tightened if desired)*

### Hook

A method on a card implementation invoked by the engine when a condition occurs, e.g.:

* `startOfCombat`
* `battlecry`
* `avenge`
* `deathrattleSpawn`
* `onSpawned`, `onDespawned`, `onDamaged`, etc. (convention)

### `SoCInput`

The shared parameter object passed through start-of-combat orchestration; contains player/opponent entities, boards, current attacker, and game state. (The definition exists but is truncated in the snippet; the usage pattern is consistent across SoC modules.)

---

## Replay, telemetry, and determinism

### Spectator

A subsystem that records:

* “fat” `GameAction` snapshots (legacy samples),
* plus a newer “thin” event stream and periodic checkpoints for deterministic replay. It maintains a monotonic `seq` and stores `eventsForCurrentBattle` and `checkpointsForCurrentBattle`.

### `seq` (sequence number)

A strictly increasing integer used to anchor every emitted event and checkpoint. In spectator code, `nextSeq()` increments `seq`, then the event is stored with that `seq`.

### `CombatSeq`

Alias for the sequence number concept in the combat log types: “Every Event and Checkpoint is anchored to a seq.”

### `SpectatorEvent`

The concrete union type for recorded combat events (thin log). Includes:

* `start-of-combat`
* `attack` (attacker/defender IDs)
* `damage` (source/target, amount, kind)
* end-of-combat hero attacks
* `power-target`
* `entity-upsert` (patch-like state)
* `spawn`
* `minion-death`

### `SanitizedEntity`

A minimal subset of `BoardEntity` considered “replay-relevant” for event logs: identity, stats, and key keywords. This is what `entity-upsert` and some `spawn` events carry.

### Sanitization

Because entities and boards are mutable during simulation, the spectator logger must sanitize snapshots before storing them. The code calls out that sanitizing before adding actions is “mandatory”.

### `CheckpointReason`

A label explaining why a checkpoint was taken: `SOC_START`, `SOC_END`, `ATTACK_END`, `DEATH_BATCH_END`, `EVERY_N`, `MANUAL`.

### `CHECKPOINT_EVERY_N_EVENTS`

A “safety valve” constant: every N emitted events, the spectator attempts to auto-checkpoint using last-known context (if available).

### Checkpoint (telemetry)

A periodic “fat snapshot” captured alongside the thin event stream so you can seek quickly and replay forward. The spectator stores `{seq, reason, snapshot}` where `snapshot` is a `GameAction` built from the last context. 

### Replay state

A minimal state struct used for reconstruction from checkpoints + events. It stores `seq` plus sanitized player/opponent boards, plus optional debugging fields like `lastAttack`.

### `applyEvent`

The function that takes a replay state and a `SpectatorEvent` and mutates the replay state forward one event at a time (replay engine).

### Reconstruction

`reconstructAt(checkpoints, events, targetSeq)` finds the latest checkpoint at-or-before `targetSeq`, initializes state from that checkpoint, then applies subsequent events up to `targetSeq`.

### Determinism

The property that the same initial state + same RNG stream produces the same combat outcome and the same event log. The replay plan assumes determinism by anchoring state transitions to checkpoints and sequence-ordered events. (convention, but heavily implied by the replay design.)

---

## Attacker selection and ordering

### `currentAttacker`

An integer that tracks which side acts next (commonly 0 for player, 1 for opponent). It can be recomputed after SoC or after spawns if board sizes change, often with a random tie-breaker when equal sizes.

### `shouldRecomputeCurrentAttacker`

A flag returned by certain start-of-combat triggers (and some spawn paths) to tell the engine that attacker selection might be invalid after board changes (spawns, replacements).

### Illidan ordering

Illidan-style hero powers have their own SoC handling path and are explicitly called out as having ordering ambiguity with other effects (“coin toss” logic exists in code).

---

## “Why is this weird?” debug terms (useful for onboarding)

### `lastAffectedByEntity`

A pointer stored on an entity to record who last damaged or affected it, used by some triggered effects and kill attribution. It is explicitly set after damage when the damage source is entity-like.

### `pendingAttackBuffs`

A staging list for delayed attack buffs to be applied at a specific time (e.g., some enchantments or auras). Stored on `BoardEntity`.

### `hadDivineShield`

Tracks whether the entity ever had divine shield at least once (used for certain card behaviors).

### `onCanceledSummon`

Callback that can fire if a summon is canceled due to board full or similar constraints. Used by some spawn-heavy effects to compensate counters or apply alternative logic.

---

## Mini index of commonly referenced abbreviations

* **BG**: Battlegrounds
* **SoC**: Start of Combat
* **DR**: Deathrattle (common shorthand in comments)
* **RNG**: Random number generation
* **CP**: Checkpoint (common shorthand)
* **Upsert**: “insert or update” entity state (here: `entity-upsert` event)

---

## Quick “teach-back” checkpoint (for new dev onboarding)

If a new dev can answer these three, they’re ready to navigate the code:

1. What’s the difference between **`entityId`** and **`cardId`**?
2. What are the four **`CombatPhase`** values and where do they show up in telemetry?
3. Why is **sanitization** necessary before logging?
