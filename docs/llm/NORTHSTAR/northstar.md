# northstar.md

## Project North Star Packet

**Product:** 3-Lane Roguelike Autobattler (Web Desktop MVP)
**Version:** Draft v1 (defaulted assumptions filled)
**Date:** 2026-02-23

---

## 1. Purpose of This Document

This document is the operating compass for the MVP. It exists to keep the project pointed at one thing:

**Prove the core loop is fun enough to replay and reliable enough to trust.**

It is not a wishlist. It is not a lore bible. It is not a future economy spec.

If a feature does not directly help prove **fun + reliability** in the MVP, it is out.

This packet should help:

* you make scope decisions quickly
* future collaborators understand what is actually being built
* the engineering work stay aligned with game design intent
* playtests produce signal instead of chaos

---

## 2. MVP North Star

### North Star Statement

Build a **web desktop, async-first, 3-lane roguelike autobattler** where players can start a run, draft and position units, fight fair ghost boards, and finish a complete match with deterministic replayable combat and simple progression, in a way that makes them want to immediately run it back.

### What the MVP must prove

1. **Core loop engagement**

   * Players enjoy drafting, placing, and watching outcomes enough to repeat runs.
2. **Combat reliability**

   * Matches resolve consistently and deterministically.
3. **Async PvP viability**

   * Fighting ghost boards feels fair and interesting enough to support competitive play without live sync.
4. **Run wrapper viability**

   * A lightweight roguelike wrapper improves replayability without overwhelming the core combat system.

### What the MVP does not need to prove

* a long-term economy
* marketplace liquidity
* MMO social systems
* deep narrative campaign
* monetization sophistication
* esports-grade balance

---

## 3. Player Promise

### Core Player Promise (MVP)

You can jump into a run, make meaningful tactical choices on a 3-lane board, fight fair ghost opponents, and complete a satisfying match with clear outcomes and replayable combat.

### Emotional Promise (first 10 minutes)

The player should feel:

* **curiosity** (“What else is possible?”)
* **tactical agency** (“My placement mattered.”)
* **replay pull** (“I can do better next run.”)
* **light wonder / flavor** (“There is a world here, even if the story is minimal in MVP.”)

### Desired player reaction

> “That was fun and interesting. I want to explore more. Let me try again, I think I can do better next time.”

That sentence is the MVP heartbeat.

---

## 4. Target Audience and Positioning

## Primary Audience

**Existing autobattler players**

These players already understand:

* board positioning matters
* economy/shop decisions matter
* synergies and tempo tradeoffs matter
* variance is part of the game, but fairness still matters

They are the best first audience because they can quickly detect whether the design has real tactical depth or just pretty scaffolding.

## Secondary Audience (later, not MVP-critical)

* roguelike strategy players
* tactics players who enjoy deterministic systems
* async competitive players who prefer flexible session timing

## Platform (MVP)

**Web desktop first**

Why this is correct for MVP:

* fastest iteration loop
* easiest playtest distribution
* better debug tooling
* easier replay/log visibility during development
* reduces mobile UX and performance constraints while core systems are still changing

---

## 5. Product Scope Snapshot

### The MVP is:

* **Async PvP arena mode**
* **Roguelike run wrapper (lightweight)**
* **3-lane tactical board placement**
* **Deterministic combat simulation**
* **Simple progression and match history**
* **Server-authoritative combat resolution**
* **Replay/log viewer sufficient for debugging and player trust**

### The MVP is not:

* a live PvP service
* a social MMO
* a gear/economy game
* a content-heavy collectible game
* a story campaign RPG

Think of the MVP as a sharpened blade, not a museum.

---

## 6. Core Loop

## Core Loop Summary

1. **Start run**
2. **Enter round**
3. **Shop / draft units**
4. **Place units on 3-lane board**
5. **Lock board**
6. **Resolve deterministic combat vs ghost**
7. **Review outcome + replay/log**
8. **Choose one of three rewards**
9. **Repeat until run ends**
10. **Receive result + simple progression**

## Why this loop is the MVP center

This loop contains every signal we need:

* tactical choices
* combat clarity
* fairness perception
* replayability
* run momentum
* system reliability

If this loop works, content and features can scale later.
If this loop fails, no amount of marketplace glitter will save it.

---

## 7. Match Structure (Defaulted MVP Decisions)

The following decisions are locked by default for MVP v1 to prevent scope drift.

## 7.1 PvP Mode Type

**MVP v1 = Async only**

* Live/sync PvP is explicitly out of scope.
* Sync PvP may be prototyped later only after async loop and reliability metrics are strong.

### Why

Async lets the project validate gameplay and infrastructure without building a real-time networking stack, latency handling, live matchmaking UX, reconnect logic, or desync headaches.

## 7.2 Session Length Target

**Target run length: 20 to 40 minutes** (user input)

This is preserved, but constrained through round count and pacing targets.

## 7.3 Round Count

**MVP default round count = 10 rounds**

Why 10:

* fits 20 to 40 minute target better than 15 rounds
* enough rounds to create build arc and adaptation
* short enough for repeat runs and playtest iteration

## 7.4 Run End Condition (Chosen Default)

**HP attrition + max rounds (hybrid cap)**

### Default values

* **Starting HP:** 30
* **Max rounds:** 10
* **Run ends early if HP <= 0:** Yes
* **If player survives to round 10:** final placement/result determined by end-state score tie-breakers (see below)

This structure gives:

* immediate stakes
* flexible run lengths
* less frustration than pure fixed rounds
* more narrative arc than pure X wins/losses

## 7.5 Round Time Budget (Design Target)

The user specified roughly **2 minutes per round**. For MVP, this is a pacing target, not a hard timer.

### Target phase budget (average)

* **Shop/Draft:** 45 sec
* **Placement:** 35 sec
* **Combat/Replay (default playback):** 25 sec
* **Reward pick:** 15 sec

Total target: **~120 sec / round average**

Notes:

* Some rounds will be faster
* Players can spend more time reading on first runs
* MVP should optimize for responsiveness so the player spends time deciding, not waiting

## 7.6 Smallest Addictiveness Test Slice (Pre-MVP)

The user identified **a single round** as the smallest loop to prove fun.

This becomes the **Pre-MVP Test Slice**:

### Pre-MVP Test Slice Requirements

* Start test round
* Shop from a small curated set
* Place on 3 lanes
* Fight one ghost
* Show deterministic result
* Offer one reward pick (even if it does not continue into a full run yet)
* Prompt “Run again”

This slice should be buildable before full progression, accounts, and complete content.

---

## 8. Ghost PvP Design (Core Competitive Anchor)

This is the design anchor that makes the MVP feel like a game instead of a simulator demo.

## 8.1 What a Ghost Is (MVP Default)

A ghost snapshot contains:

* **Board state**
* **Hero passive**
* **Lane terrain effects**
* **Run modifiers/rewards currently active**
* **Round number**
* **Combat seed metadata / validation references** (system-side)

### Why this level of snapshot is necessary

If terrain, passives, or rewards exist for one player but not represented in the ghost snapshot, fairness perception breaks. The player will lose trust fast.

## 8.2 Ghost Source Strategy (MVP Default)

**Mixed fallback strategy**

Priority order:

1. **Real player ghost snapshots** (same round band and comparable power)
2. **Curated developer ghosts** (for early population and testing)
3. **Seeded legal bots** (generated within content/rules constraints)

Mirror matches are allowed only as a low-priority fallback and should be labeled internally (not necessarily in UI).

## 8.3 Number of Fights per Round

**One ghost fight per round** (MVP default)

Why:

* simplest mental model
* lowest compute cost
* fastest iteration
* easiest replay/debug
* preserves “one round, one outcome” rhythm

Multi-fight averaging can be added later if variance needs smoothing.

## 8.4 Fair PvP Arena Definition (MVP Operational Definition)

“Fair PvP” in MVP means:

* **No paid power**
* **No persistent combat power from account progression**
* **Same content pool and rules for all players**
* **Same shop odds / reward generation rules**
* **Server-authoritative combat outcomes**
* **Deterministic validation of legal state transitions**

This must be true in implementation, not just marketing copy.

## 8.5 Matchmaking Simplicity (MVP Default)

Matchmaking for ghost selection should prioritize:

1. Same or nearby **round number**
2. Similar **power band** (basic heuristic)
3. Similar **rating band** (when available)
4. Fallback to curated/bot ghosts

### Power band heuristic (simple MVP version)

A lightweight estimate using:

* total board stats
* unit tier/rarity proxy (if applicable)
* active modifiers count
* hero passive strength bucket (manual tuning for MVP)

Do not overengineer this in v1. It just needs to prevent absurd mismatches.

---

## 9. Combat Determinism and Reliability North Star

This is the trust engine of the product.

## 9.1 Determinism Requirement (MVP Default)

**Exact replay reproducibility**

Given the same:

* initial combat state
* seed
* rules version
* inputs (if any combat-time inputs exist)

the system must produce:

* the **same event log**
* the **same final outcome**
* the **same final state hash**

This is stronger than “same winner.” The event sequence matters for replay trust and debugging.

## 9.2 Server Authority (MVP)

**Server is the source of truth for combat outcomes.**

Client responsibilities:

* send legal actions (shop/placement/lock)
* render state and replay
* optionally simulate for preview only if clearly non-authoritative

Server responsibilities:

* validate round setup
* resolve combat
* persist deterministic artifacts
* return result + replay/log payload
* reject illegal/tampered state submissions

## 9.3 Persisted Combat Artifacts (MVP Minimum Set)

Persist the following per combat:

* **Seed**
* **Initial combat state**
* **Event log**
* **Final state hash**

Optional in MVP:

* replay blob cache (derived from event log)
* final rendered board snapshot (for performance / history previews)

This artifact set supports:

* replay generation
* bug reproduction
* anti-cheat checks
* desync debugging
* trust audits

## 9.4 Rules Versioning

Every combat should reference a **rules/content version ID** so old replays remain interpretable after patches.

Minimum:

* `sim_version`
* `content_version`
* `balance_version` (can be same as content version at MVP)

## 9.5 Reliability Targets (MVP)

### Primary reliability thresholds

* **Combat resolution success rate:** **98.5%+** (target 99%+ before wider release)
* **Run resume success rate (round start):** **99%+**
* **Replay generation/open success rate:** **97%+**
* **No corrupted run states in normal flow:** effectively zero tolerance (any corruption is P0)

### Player trust principle

If a player loses and the replay/log looks wrong, that is not just a bug. It is a trust breach.

---

## 10. Content Scope (Exact MVP Counts)

Ranges become traps. MVP uses exact counts.

## 10.1 Exact Content Counts (MVP Defaults)

* **Units:** 30
* **Keywords:** 8
* **Terrain effects:** 6
* **Heroes:** 6 (passive-only)
* **Reward modifiers:** 12

This is enough to create variety without collapsing into balance debt.

## 10.2 Hero Scope Decision (MVP Default)

**Heroes included, passive-only**

No active hero powers in MVP.

### Why this is the right middle path

* keeps identity and replay variety
* supports the user’s “minions or aspects of a hero” vision
* avoids UI, timing, and rules complexity of active powers

## 10.3 Content Philosophy (MVP Default)

**Lane-position tactics first, synergy second**

Priority stack:

1. Placement decisions must matter
2. Terrain interactions must be readable
3. Keywords create clear tactical moments
4. Unit synergies add variety without requiring encyclopedic knowledge
5. Hero passives shape run style, not overwhelm it

## 10.4 Randomness Tuning (MVP Default)

**Moderate randomness with learnable consistency**

The game should feel surprising, but not arbitrary.

### Design principle

Players should lose and think:

* “I got out-positioned”
* “I overcommitted to the wrong lane”
* “I should have taken the other reward”

They should not think:

* “The game rolled nonsense and deleted me.”

## 10.5 Readability Rule (MVP)

No effect should require paragraph reading during a run.

### MVP readability constraints

* 1 keyword = short definition
* Unit text should be readable in one glance
* Avoid stacked exception clauses
* Avoid hidden timing traps unless visibly signaled
* Combat log must explain non-obvious outcomes

---

## 11. Core Systems Scope

## 11.1 Game Mode (MVP Must-Have)

### Fair PvP Arena (Async)

* gearless / normalized
* ghost board opponents
* simple rating (Elo-ish)
* match history
* run-based structure

## 11.2 Roguelike Run Wrapper (MVP Must-Have)

A run consists of **10 rounds**.

Between rounds:

* player gets a **1 of 3 reward choice**
* reward modifies future rounds (small but meaningful)

End conditions:

* HP depletion OR round 10 reached

## 11.3 Progression (MVP Default)

“Simple progression” in MVP means:

* **Rating (Elo-ish)**
* **Match/run history**
* **Profile stats**
* **Cosmetic-neutral account progression level** (optional but safe)
* **No persistent power gains**

### What persistent progression should do

* create identity
* create return motivation
* support history and bragging rights
* never change combat fairness in ranked async mode

## 11.4 Retention Hooks (No Power Progression)

MVP default top retention hooks:

1. **Run-it-back tactical mastery loop**
2. **Rating climb and match history**
3. **Replay review (“what actually happened?”)**

Optional low-risk additions if time allows:

* daily featured seed/run challenge
* cosmetic profile badges
* streak tracker (non-power)

---

## 12. UX Requirements (MVP)

## 12.1 UX Priority (MVP Default)

**Fast, functional, and combat-readable**

Not spectacle-first.
Not mobile-polish-first.
Not animation-heavy-first.

The UX should feel like a sharp instrument:

* responsive
* legible
* trustworthy

## 12.2 Required MVP Screens / Flows

### A. Entry

* New Run
* Continue Run
* Match History
* Profile / Rating (minimal)

### B. Run Flow

* Shop / draft view
* 3-lane board placement view
* Lock/confirm board
* Combat result + replay/log view
* Reward selection
* Next round transition

### C. End of Run

* placement/result
* damage dealt / received summary
* key units / highlights
* replay links for recent rounds (optional but valuable)
* run again CTA

## 12.3 Frictionless Actions (Top 3)

These actions must feel instant and obvious:

1. **Buy a unit**
2. **Move/place a unit on the 3-lane board**
3. **Lock/confirm round setup**

If these feel sticky, the whole game feels slow no matter how good the combat system is.

## 12.4 Combat Log / Replay Viewer (MVP “Good Enough”)

Must include:

* event list (human-readable)
* playback speed controls
* pause / play
* step forward
* final result summary
* damage / surviving units summary
* visible seed or replay ID (at least in advanced/debug mode)

Nice to have:

* step backward
* board diff views
* lane-focused filters

## 12.5 Tutorial Scope (MVP Default)

**Tooltips + first-run guidance only** (not a full guided tutorial)

Rationale:

* existing autobattler players are primary audience
* reduces implementation cost
* still provides onboarding support for lane/terrain-specific concepts

---

## 13. Technical North Star (MVP)

## 13.1 Architectural Principle

The MVP should be designed as a **deterministic simulation system with a thin game service wrapper**, not a UI-first prototype with combat scripts bolted on later.

That means:

* sim correctness is a first-class concern
* replay/debug artifacts are generated by design
* persistence schema supports reconstruction
* UI consumes state and events, not hidden side effects

## 13.2 Frontend Stack (Default assumption)

**Web desktop frontend** with a modern web UI framework (React/TypeScript assumed unless otherwise chosen).

Frontend priorities:

* fast board interactions
* clear state rendering
* replay/log visualization
* robust error and reconnect handling
* minimal animation coupling to simulation logic

## 13.3 Backend Stack (Default assumption)

Backend should support:

* server-authoritative combat
* persistence for runs and combats
* ghost selection
* rating updates
* account identity (guest + upgrade path)
* versioned sim execution

A practical MVP stack can be:

* application server (TS/Node or Python, depending existing sim implementation)
* relational DB for runs/accounts/history
* object or blob storage for replay/event payloads (optional in early MVP)
* background jobs for ghost indexing and cleanup (lightweight queue optional)

The exact language is less important than enforcing deterministic boundaries and robust persistence.

## 13.4 Persistence Unit of a Run (MVP Default)

**Mixed strategy: round checkpoints + combat event logs**

Persist:

* run state snapshot at round boundaries
* combat artifacts per round (seed, initial state, event log, final hash)

Why this is the MVP sweet spot:

* fast resume
* deterministic audit trail
* easier debugging than snapshots alone
* simpler than fully event-sourcing every menu/shop action on day one

## 13.5 Resume Run Scope (MVP Default)

**Resume supported at round start and between-round states**

* Resume at round start: required
* Resume during shop/placement: nice if easy, but not mandatory in v1
* Resume mid-combat: not required

This keeps recovery practical without forcing mid-frame replay-state restoration complexity.

---

## 14. Anti-Cheat Minimums (MVP)

The game does not need military-grade anti-cheat in MVP, but it does need a basic lock on the front door.

## 14.1 In-Scope Anti-Cheat Basics

* **Server-authoritative combat resolution**
* **Server validation of legal round setup**
* **Deterministic state hash validation**
* **Impossible action detection** (invalid units, duplicate ownership, illegal placements)
* **Request rate limiting**
* **Basic tamper/audit logs**
* **Version checks** (client/server schema compatibility)

## 14.2 Out of Scope for MVP

* advanced behavioral cheat detection
* kernel-level anti-cheat
* sophisticated fraud rings analysis
* live anti-bot enforcement systems

## 14.3 Security Principle

MVP security work should protect competitive trust and data integrity, not become a platform detour.

---

## 15. Accounts, Identity, and Progression Data

## 15.1 Account Flow (MVP Default)

**Guest-first account identity with optional upgrade later**

Why:

* lowest friction onboarding
* better for playtests
* still allows persistence and history
* can convert to registered account later

## 15.2 Required Account-Linked Data

* player ID
* rating
* run history
* active run state
* match/combat history references
* cosmetic-neutral progression stats (if included)

## 15.3 Match History (MVP)

Match history should answer:

* when did I play
* what was the result
* what build/hero did I use
* can I rewatch key rounds
* what killed me / what won me the round

This is both retention and debugging disguised as a feature.

---

## 16. Success Metrics, Guardrails, and Kill Criteria

This section is the real north star. Features are just tools.

## 16.1 Primary MVP Success Metric (Chosen Default)

**% of players who start a second run in the same session**

Why this is the primary metric:

* directly measures replay pull
* reflects fun, pacing, and friction together
* less noisy than long-term retention in early test populations
* forces focus on the actual loop rather than vanity features

## 16.2 Supporting Metrics (MVP)

### Reliability

* combat resolution success rate
* replay generation/open success rate
* run resume success rate
* desync/validation failure rate

### Engagement

* average rounds completed per run
* average run duration
* reward selection time (signal for clarity vs confusion)
* replay open rate after losses
* run abandonment rate by round

### Fairness perception proxies

* mismatch complaints / support flags
* extreme stomp frequency
* average power-band gap of ghost pairing

## 16.3 MVP “Working” Thresholds (Default Targets)

These are defaults and should be revised after first tests.

### Reliability thresholds

* **Combat resolution success:** **98.5%+** (goal 99%+)
* **Run resume success (round start):** **99%+**
* **Replay open success:** **97%+**
* **Corrupted active runs:** **<0.5%** (goal near zero)

### Engagement thresholds

* **Start second run same session:** **35%+** (good), **45%+** (very strong signal)
* **Complete at least 1 full run after onboarding:** **60%+**
* **Median run duration:** **20 to 30 min**
* **Round-to-round continuation rate:** should not cliff after rounds 1 to 2

## 16.4 Red-Line Failure Signals (Simplify or Pivot Triggers)

If these persist after iteration, the MVP needs simplification or directional change:

1. **Ghost PvP does not feel competitive/fair**

   * players describe outcomes as random or fake
2. **Combat reliability is unstable**

   * frequent replay mismatches, invalid results, or corrupted runs
3. **Round pacing drags**

   * players feel they are waiting, not deciding
4. **Rules comprehension is poor**

   * repeated confusion about terrain/lane outcomes
5. **No replay pull**

   * low second-run starts despite stable reliability

## 16.5 Single Riskiest Assumption (Default)

**Ghost PvP feels competitive and satisfying enough without live sync.**

This assumption should be tested early and brutally.

---

## 17. Explicit Out-of-Scope List (No Mercy)

These are cut from MVP unless a future re-scope explicitly brings them in.

### Economy / systems

* Marketplace / trading
* Item / gear inventory
* deep crafting systems
* paid power systems
* elite heroes with power advantages

### Modes / encounters

* Boss encounters
* Co-op events
* full story campaign
* MMO train hub social systems
* synchronous live PvP (for MVP v1)

### Content expansion

* large card/unit pools
* complex hero actives
* advanced progression trees
* collectible rarity economy complexity

### Business / monetization complexity

* power monetization
* elaborate season pass system
* token/web3 integrations affecting MVP loop fairness

You can add lore flavor. You cannot add scope by poetry.

---

## 18. Non-Negotiable Principles (MVP Defaults)

1. **No paid power in the MVP competitive mode**
2. **Server is authoritative for combat outcomes**
3. **Every combat is reproducible from persisted deterministic artifacts**
4. **Readability beats content quantity**
5. **Scope cuts beat delayed launches**
6. **Async first, sync later only if demanded by evidence**
7. **Reliability bugs outrank new feature work during MVP testing**

These principles should be used in design reviews and feature triage.

---

## 19. Milestones (Pre-MVP Slice to MVP)

## Milestone 0: Combat Kernel Proof

Goal: prove deterministic combat engine basics for a tiny ruleset.

Deliverables:

* deterministic seed-based combat
* event log generation
* final state hash
* basic replay playback from event log
* test harness for reproducibility

Success criteria:

* same seed/input reproduces same event log across repeated runs
* killer tests pass consistently (checkpoint equivalence / full replay equivalence)

## Milestone 1: Single-Round Vertical Slice (Pre-MVP Addictiveness Test)

Goal: prove one complete round is fun enough to repeat.

Deliverables:

* shop -> placement -> combat -> result -> reward
* one ghost fight
* simple UI loop
* replay/log viewer baseline
* run-again button

Success criteria:

* playtesters voluntarily replay multiple times
* no major confusion about lanes/terrain
* round completes reliably

## Milestone 2: Full Run Wrapper (10 Rounds)

Goal: deliver complete run arc.

Deliverables:

* HP system
* 10-round structure
* reward progression
* run end summary
* save/resume at round boundaries

Success criteria:

* full runs complete end-to-end
* resume works reliably
* pacing feels acceptable

## Milestone 3: Async Ghost Arena Infrastructure

Goal: make PvP ghost loop operational and fair enough for testing.

Deliverables:

* ghost snapshot ingestion
* ghost retrieval/matching
* fallback dev ghosts/bots
* rating update pipeline
* match history

Success criteria:

* low mismatch rates
* players perceive ghost matches as fair enough
* no major exploit path in setup submissions

## Milestone 4: MVP Content & UX Lock

Goal: stabilize before external testing.

Deliverables:

* 30 units, 8 keywords, 6 terrain, 6 passive heroes, 12 rewards
* tooltips and first-run guidance
* basic stats/profile
* bug triage and balance pass
* versioned content/rules identifiers

Success criteria:

* content complete and coherent
* reliability thresholds near target
* major UX friction points removed

## Milestone 5: Closed MVP Playtest

Goal: test replay pull and system trust.

Deliverables:

* guest accounts
* telemetry
* support/debug workflow
* crash/error monitoring
* feedback survey

Success criteria:

* second-run same-session metric shows signal
* reliability targets hold in real use
* no P0 trust failures (wrong replay/result)

---

## 20. Playtesting and Telemetry (Recommended MVP Instrumentation)

Even a tiny telemetry layer will save weeks of guessing.

## 20.1 Essential Telemetry Events

* `account_created_guest`
* `run_started`
* `run_resumed`
* `round_started`
* `shop_action` (buy/sell/refresh/skip)
* `placement_changed`
* `board_locked`
* `combat_resolve_started`
* `combat_resolve_completed`
* `combat_resolve_failed`
* `replay_opened`
* `replay_completed`
* `reward_offered`
* `reward_selected`
* `round_result`
* `run_completed`
* `run_abandoned`
* `error_client`
* `error_server`
* `validation_rejected`

## 20.2 Minimal Metadata to Attach

* player ID (anonymous-safe internal ID)
* run ID
* round number
* hero ID
* content version
* sim version
* ghost source type (real/dev/bot/mirror)
* duration metrics (phase timing)
* result outcome

## 20.3 First Playtest Questions (After 3 Runs)

1. What felt most interesting or clever?
2. Did your positioning choices feel like they mattered?
3. Did any loss feel unfair or impossible to understand?
4. Was the replay/log useful?
5. Did the run feel too long, too short, or about right?
6. What made you start or not start another run?
7. What confused you most?

---

## 21. Known Open Questions (Intentionally Unresolved)

These are not oversights. They are deferred decisions.

1. **Exact scoring/tie-break logic at round 10**
2. **Elo variant and rating update formula**
3. **Power-band heuristic sophistication**
4. **How much story flavor appears between rounds**
5. **How visible combat seed/replay internals are in player UI**
6. **Whether mid-shop resume is worth MVP complexity**
7. **Whether heroes remain in MVP if content schedule slips**
8. **How many terrains are global vs lane-specific per round**
9. **Long-term path to sync PvP**
10. **Any future web3/economy integration (fully out of MVP decision space)**

If one of these blocks progress, choose the simplest option that preserves fairness and determinism.

---

## 22. Definition of Shippable MVP

MVP is shippable when all of the following are true:

### Gameplay

* player can complete full 10-round runs
* 3-lane placement decisions are readable and meaningful
* reward picks alter later rounds in noticeable ways
* async ghost fights function consistently

### Reliability

* deterministic combat reproducibility is verified
* combat resolution success meets threshold
* run resume at round boundaries is stable
* replay/log opens and explains outcomes sufficiently

### UX

* new run, placement, lock, replay, and end summary flow is coherent
* major friction in top 3 actions is resolved
* tooltips/first-run guidance cover lane/terrain basics

### Fairness / integrity

* no paid power in competitive mode
* no persistent power affecting ranked outcomes
* basic anti-cheat validation is live
* ghost fallback logic prevents dead queues and absurd mismatches

### Operations

* telemetry captures core loop and failures
* error logging allows bug triage
* content/rules versions are traceable

---

## 23. Practical Scope Cut Ladder (When Time Slips)

If the project slips, cut in this order before touching determinism or core loop:

1. **Reduce content counts** (units 30 -> 24, rewards 12 -> 9)
2. **Reduce heroes** (6 passive heroes -> 0 neutral-only)
3. **Reduce terrain complexity** (6 -> 4 simpler effects)
4. **Simplify progression** (rating + history only)
5. **Ship replay viewer with basic controls only**
6. **Cut polish/animations**
7. **Cut match history detail**

Do **not** cut:

* server authority
* deterministic artifacts
* replay trust foundation
* core round loop completeness

---

## 24. Glossary (Canonical Terms)

### Run

A sequence of rounds (MVP: 10) with persistent HP and reward choices.

### Round

One cycle of shop, placement, combat, and reward (if applicable).

### Ghost

A snapshot-based async opponent representation used for combat in place of a live player.

### Fair PvP Arena

Competitive async mode with no paid power and no persistent combat advantages.

### Deterministic Combat

Combat that produces identical event logs and outcomes given identical inputs and seed.

### Event Log

Ordered list of simulation events used to reconstruct or replay combat.

### Final State Hash

Hash of final combat state used for validation and debugging.

### Reward Modifier

A small run-level effect chosen between rounds that changes future strategy.

### Terrain Effect

A lane or battlefield condition that alters combat behavior in a readable way.

### Hero Passive

A non-activated identity effect that shapes playstyle without adding active timing complexity.

---

## 25. One-Page Summary (Founder/Team Alignment)

### Build this now

A **web desktop async roguelike autobattler** with a **10-round run**, **3-lane tactical placement**, **ghost PvP**, **deterministic replayable combat**, and **simple fair progression**.

### Prove this

Players start another run because the loop is fun, understandable, and feels fair.

### Protect this

Determinism, replay trust, and server authority.

### Cut this

Marketplace, gear, bosses, MMO hub, deep story, paid power, sync PvP.

### Primary metric

**% of players who start a second run in the same session**

---

## 26. Default Decisions Applied (for transparency)

These were filled as defaults to complete this draft and should be revised only with intent:

* Async only for MVP
* 10 rounds
* HP attrition + max rounds
* Start HP 30
* End early on HP <= 0
* One ghost fight per round
* Ghost snapshot includes board + hero passive + terrain + run modifiers
* Mixed ghost fallback (real -> dev -> bots)
* Exact replay reproducibility determinism
* Persist seed + initial state + event log + final state hash
* 30 units / 8 keywords / 6 terrain / 6 passive heroes / 12 rewards
* Guest-first accounts
* Primary metric = second run same session
