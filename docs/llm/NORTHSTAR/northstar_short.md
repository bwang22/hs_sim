# northstar.md (Short Version)

## MVP North Star

Build a **web desktop, async-first, 3-lane roguelike autobattler** where players can complete a full run by drafting/placing units, fighting **fair ghost boards**, and seeing **deterministic, replayable combat** that makes them want to immediately play again.

### What MVP must prove

1. **The core loop is replayable** (players want “one more run”)
2. **Combat is reliable and trustworthy** (deterministic + server-authoritative)
3. **Async ghost PvP feels fair enough** to be compelling without live sync

---

## Player Promise

Players can:

* Start a run
* Draft/shop and place units on a **3-lane board**
* Fight ghost opponents
* Repeat over multiple rounds
* Finish with a result + simple progression

### Emotional target (first 10 minutes)

Players should feel:

* “That was fun”
* “That was interesting”
* “I want to explore more”
* “I can do better next run”

---

## Target Audience and Platform

### Primary audience

* **Existing autobattler players** (fastest path to honest gameplay feedback)

### MVP platform

* **Web desktop first**

  * fast iteration
  * easy playtesting
  * strong debugging/replay UI support

---

## Core Loop

1. Start run
2. Shop / draft
3. Place units on 3-lane board
4. Lock board
5. Resolve deterministic combat vs ghost
6. View result + replay/log
7. Pick 1 of 3 reward modifiers
8. Repeat until run ends
9. End-of-run summary + progression
10. Run it back

### Pre-MVP fun test slice (smallest addictiveness proof)

A **single round**:

* shop
* place
* one ghost fight
* result
* reward pick
* “Run again” prompt

If this is not fun, bigger systems are just expensive wallpaper.

---

## Match Structure (MVP Defaults)

### Mode

* **Async only** (sync PvP is future scope)

### Run length

* **10 rounds** (fits your 20–40 minute target better than 15)

### End condition (chosen default)

* **HP attrition + max rounds**
* Starting HP: **30**
* Max rounds: **10**
* End early if HP <= 0: **Yes**

### Round pacing target

* Average round target: **~2 minutes**

  * Shop/Draft: ~45s
  * Placement: ~35s
  * Combat/Replay: ~25s
  * Reward pick: ~15s

---

## Ghost PvP Design (MVP)

### What a ghost snapshot includes

* Board state
* Hero passive
* Terrain effects
* Active run modifiers
* Round number
* Validation metadata (internal)

### Fights per round

* **One ghost fight per round** (simple, readable, cheap to compute)

### Ghost source fallback (default)

1. Real player ghosts
2. Curated dev ghosts
3. Seeded legal bots

### “Fair PvP” means

* No paid power
* No persistent combat power
* Same rules/content/shop odds for all players
* Server-authoritative outcomes
* Deterministic validation

---

## Combat Determinism and Trust

### Determinism requirement

Given the same:

* initial state
* seed
* rules/content version

The system should produce the same:

* event log
* result
* final state hash

### Authority model

* **Server is source of truth**
* Client renders state/replay and sends actions
* Client simulation (if any) is non-authoritative

### Persist per combat (minimum)

* Seed
* Initial combat state
* Event log
* Final state hash

This is the trust engine. If players cannot trust losses, the game breaks emotionally before it breaks technically.

---

## MVP Content Scope (Exact Counts)

Lock exact counts to avoid range-creep.

* **Units:** 30
* **Keywords:** 8
* **Terrain effects:** 6
* **Heroes:** 6 (**passive-only**)
* **Reward modifiers:** 12

### Content philosophy

* **Lane tactics first**
* Synergy second
* Readability over complexity
* Moderate randomness, but learnable

---

## UX Requirements (MVP)

### UX priority

**Fast, functional, combat-readable**

### Must-have flows

* New Run / Continue Run
* Shop + 3-lane placement UI
* Lock board
* Combat replay/log viewer
* Reward selection
* End-of-run summary
* Match history (basic)

### Top 3 frictionless actions

1. Buy a unit
2. Move/place a unit
3. Lock/confirm board

### Replay/log viewer (good enough for MVP)

* Event list
* Play/pause
* Speed control
* Step forward
* Final result summary
* Survivors/damage summary
* Replay ID or seed (at least in debug/advanced view)

---

## Core Infra and Persistence

### Must-have infra

* Accounts (guest-first; upgrade later)
* Run persistence
* Resume run (round start/between rounds)
* Ghost selection
* Rating updates
* Match history
* Basic anti-cheat validation

### Persistence strategy (MVP default)

* **Round checkpoints + combat logs**

  * snapshot at round boundaries
  * deterministic combat artifacts per round

### Resume scope

* Required: resume at round start / between rounds
* Not required: mid-combat resume

---

## Anti-Cheat Minimums (MVP)

In scope:

* Server-authoritative combat
* Legal state validation
* Impossible-action detection
* Deterministic hash checks
* Rate limiting
* Basic tamper/audit logs

Out of scope:

* advanced anti-cheat systems
* behavioral cheat detection platforms

Goal is trust and integrity, not overbuilding security theater.

---

## Progression and Retention (MVP)

### Simple progression means

* Rating (Elo-ish)
* Match/run history
* Profile stats (optional but useful)
* No persistent power

### Top retention hooks (no power creep)

1. Tactical mastery / “I can improve”
2. Rating climb + history
3. Replay review to understand losses

---

## Success Metrics and Guardrails

### Primary MVP metric (North Star metric)

**% of players who start a second run in the same session**

Why this metric:

* directly measures replay pull
* captures fun + pacing + friction in one number

### Default “working MVP” thresholds

* Combat resolution success: **98.5%+** (goal 99%+)
* Run resume success (round start): **99%+**
* Replay open success: **97%+**
* Start second run same session: **35%+** (45%+ is strong)

### Red-line failure signals

* Ghost PvP feels fake/unfair
* Replay/result trust issues
* Round pacing drags
* Lane/terrain outcomes too confusing
* No replay pull despite reliability

### Riskiest assumption

**Async ghost PvP feels competitive enough without live sync**

---

## Explicitly Out of Scope (No Mercy)

* Marketplace / trading
* Gear / item inventory systems
* Boss encounters / co-op
* MMO hub social features
* Full story mode
* Paid power / elite combat heroes
* Synchronous live PvP (MVP v1)
* Large content pools / complex hero actives

---

## Non-Negotiable Principles

1. No paid power in competitive MVP mode
2. Server-authoritative combat outcomes
3. Every combat is reproducible from persisted artifacts
4. Readability beats content quantity
5. Scope cuts beat delayed launches
6. Async first, sync later only if evidence demands it
7. Reliability bugs outrank feature work during MVP test phase

---

## Shippable MVP Definition (Short)

MVP is shippable when:

* Players can complete full 10-round runs
* 3-lane decisions feel meaningful
* Ghost fights work consistently
* Combat is deterministic and replayable
* Run resume is stable
* UI flow is coherent and responsive
* No paid/persistent combat power exists
* Telemetry captures core loop + failures

---

## One-Line Founder Reminder

**Ship the loop, prove the replay pull, protect trust. Everything else is future DLC.** 🎯
