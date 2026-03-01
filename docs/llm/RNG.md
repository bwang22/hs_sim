```md
# RNG.md
Randomness, determinism, and how this simulator rolls its dice 🎲

This repo is a Battlegrounds combat simulator. RNG is not a side character here, it is a lead actor: it decides attackers/targets, breaks ties, picks spawns, shuffles pools, and (today) even breaks “simultaneous trigger ordering” ties with coin flips.

This doc explains:
- What RNG exists in the codebase today (as shown in `all_ts_dump.txt`)
- Where randomness enters combat outcomes
- How determinism is currently achieved in tests
- The failure modes (ways determinism quietly breaks)
- A recommended path to “explicit RNG” (seeded runs without global patching)
- Test patterns to keep RNG sane over time

---

## Goals

### Primary goals
1) **Reproducibility:** same input + same seed ⇒ same event log + same final state.
2) **Debuggability:** a bug should be replayable from a seed (or from events/checkpoints).
3) **Safety:** changes that accidentally add RNG calls should get caught early.
4) **Performance:** RNG should be cheap; avoid heavy crypto RNG or allocations in hot loops.

### Secondary goals
- **Portability:** deterministic behavior should match across Node versions and platforms.
- **Refactor resilience:** replay should ideally not depend on the exact *number* of RNG calls.

---

## What RNG exists today (current state)

### 1) A deterministic PRNG exists, but is mostly test-only
File: `src/lib/rng.ts`

- Defines `RNG = () => number`
- Implements **Mulberry32**: `mulberry32(seed)`
- Provides helpers: `randInt(rng, min, maxInclusive)`, `choice(rng, arr)`

This is the “official seeded RNG implementation” currently in the repo.

### 2) Production code mostly uses `Math.random()`
Key helpers in `src/services/utils.ts`:
- `pickRandom(array)` uses `Math.floor(Math.random() * array.length)`
- `shuffleArray(array)` uses Fisher-Yates with `Math.random()`

Many subsystems call `Math.random()` directly instead of going through helpers.

### 3) Tests patch `Math.random` to force determinism
Files:
- `test/full-game/seeded-runner.ts` patches `Math.random = mulberry32(42)` **before** importing `full-test`.
- `test/full-game/full-test.ts` also patches `Math.random = mulberry32(42)` before calling `runSimulation`.
- `test/rng-smoke.ts` asserts Mulberry32’s first outputs for seed 42.
- `test/rng-patch-smoke.ts` asserts patching works (Math.random matches the seeded generator step-for-step).

So the determinism strategy right now is: **patch global `Math.random` in-process**.

---

## Where randomness enters combat outcomes (major call-site categories)

Think of RNG in this simulator as three buckets:

### Bucket A: “True random game effects” (targets, spawns, choices)
These are effects that are genuinely random in Battlegrounds and must use RNG.

Examples in the codebase:
- Target selection via `pickRandom` / `pickRandomAlive` (battlecries, spells, many card effects)
  - e.g., `src/simulation/battlecries.ts` uses `pickRandom(...)` extensively.
- Spawn pools selected randomly
  - e.g., `src/simulation/deathrattle-spawns.ts` selects Ghastcoiler spawns with `Math.random()` against `cardsData.ghastcoilerSpawns[...]`.

### Bucket B: “Tie-break randomness” (ordering when rules are ambiguous or simultaneous)
These are coin flips used to decide “who resolves first” when both sides have simultaneous triggers or board sizes are equal.

This is extremely high-impact: it can affect the *entire* combat trajectory even though it’s “just” a tie-break.

Examples:
- Start-of-combat modules use coin flips to decide which side processes first:
  - `src/simulation/start-of-combat/soc-minion.ts`
  - `src/simulation/start-of-combat/soc-hero-power.ts`
  - `src/simulation/start-of-combat/soc-secret.ts`
  - `src/simulation/start-of-combat/soc-quest-reward.ts`
  - `src/simulation/start-of-combat/soc-trinket.ts`
  - `src/simulation/start-of-combat/soc-illidan-hero-power.ts` includes comments noting “coin toss” behavior.
- Many of these also compute the initial attacker when boards are equal using `Math.round(Math.random())`.
- Deathrattle orchestration flips which player is processed first across multiple effect categories:
  - `src/simulation/deathrattle-orchestration.ts` repeatedly uses `Math.random() > 0.5` to choose processing order.

If you care about replay stability, Bucket B is the spiciest sauce.

### Bucket C: “Algorithmic randomness” (shuffle, sampling, Monte Carlo)
Used for:
- Shuffling arrays (`shuffleArray`)
- Selecting multiple distinct random items (`pickMultipleRandomDifferent`)
- Monte Carlo simulation sampling across many runs

---

## Determinism model today (how seeded runs work)

### The rule
**All randomness is assumed to route through `Math.random()`** (directly or indirectly via helpers).

### The test strategy
- Patch `Math.random` to a seeded generator (Mulberry32).
- Run one simulation and compare its output (or print spectator telemetry).

Why `seeded-runner.ts` exists:
- Patching must happen **before** any module-level code executes that could call `Math.random`.
- `seeded-runner.ts` patches first, then imports `./full-test`.

This is a good pattern for JS codebases that still rely on global RNG.

---

## Determinism hazards (how this can break without anyone noticing)

### 1) Hidden RNG calls change the sequence
If someone adds a new `Math.random()` call anywhere earlier in the call chain, you still get “determinism”… but a different deterministic universe. That can invalidate golden fixtures and replays.

Mitigation:
- Make RNG calls **explicit** (recommended migration below).
- Add tests that assert event logs match for known seeds.

### 2) Import-time randomness
If a module runs `Math.random()` at import time (top-level), patching inside the test function is too late.

Mitigation:
- Keep patching in the runner before imports (already done).
- Add a linter rule or grep check for top-level RNG calls.

### 3) Time-budget stopping changes sample size
`src/simulate-bgs-battle.ts` can stop early based on `Date.now()` vs `maxAcceptableDuration`.
That affects Monte Carlo result stability (win% changes if you ran 2000 sims vs 8000 sims).

Mitigation:
- For deterministic Monte Carlo comparisons, set `numberOfSimulations` explicitly and disable time-based early stop (or set duration huge).
- Treat time stopping as “nondeterminism source adjacent to RNG.”

### 4) Non-stable iteration order
Even with seeded RNG:
- Iterating over object keys or Sets/Maps can bite you if you rely on insertion order across refactors.
- Sorting without a tie-break comparator can be unstable if equal keys occur.

Mitigation:
- Always sort with a deterministic tie-break (entityId is your friend).
- Avoid “for..in over object” where ordering matters.

### 5) Capturing `Math.random` by reference
If code does `const r = Math.random; r()`, patching later won’t affect that captured function.
(Quick scan shows this is mainly in tests where `originalRandom` is stored intentionally.)

Mitigation:
- Prefer explicit RNG injection anyway.

---

## Recommended direction: explicit RNG (no global patching required)

### Why migrate
Global patching is convenient but fragile:
- It couples determinism to import ordering.
- It makes replay sensitive to call counts.
- It makes “what consumed RNG” hard to reason about.

### Target design (practical, minimal diff)
Introduce an explicit RNG handle on `FullGameState` or `SharedState`, e.g.:

- `gameState.shared.rng: RNG`
- Add `gameState.shared.roll` helpers: `coinflip()`, `int(min,max)`, `choice(arr)`, `shuffle(arr)`

Then:
1) Replace direct `Math.random()` calls with `gameState.shared.rng()`
2) Replace `pickRandom` / `shuffleArray` with versions that accept an `rng` parameter:
   - `pickRandom(rng, array)`
   - `shuffleArray(rng, array)`
3) Update call sites gradually (start-of-combat and deathrattle ordering first, because they are Bucket B).

### Seed plumbing (how to seed per simulation run)
Add optional `options.seed` to `BgsBattleInfo.options`.

Then:
- If `seed` is provided: `baseRng = mulberry32(seed)`
- For Monte Carlo with N simulations, derive per-run seeds to avoid “shared stream cross-talk”.

Simple derivation options:
- **Option 1 (cheap):** `seed_i = (seed + i) >>> 0`
- **Option 2 (better mixing):** use a SplitMix32-style hash to derive `seed_i` from `(seed, i)`.

Either way, the invariant is:
- same `(seed, i)` always produces the same run RNG stream,
- reordering simulations does not change per-run outcomes.

---

## Replay vs RNG: two strategies (choose intentionally)

### Strategy A: replay depends on seed + exact RNG call order
Pros:
- Smaller event logs.
Cons:
- Refactors that add/remove RNG calls break replay compatibility.

### Strategy B: log “semantic random decisions” as events
Instead of relying on call order, emit events like:
- `coinflip(processPlayerFirst=true)`
- `chooseTarget(sourceId=..., chosenId=...)`
- `chooseSpawn(pool=..., chosenCardId=...)`
- `shuffleResult(hash=...)` or “chosen indices” (if needed)

Pros:
- Replay is robust across refactors.
- Debugging is easier (“why did it choose that target?” is explicit).
Cons:
- Slightly larger logs, more plumbing.

Given you’re already building spectator events + checkpoints, Strategy B fits your direction: you can keep RNG as a generator for simulation, but treat the **decisions** as the source of truth for replay.

---

## Practical “rules of engagement” for RNG in this repo

### Do
- Prefer `gameState.shared.rng()` (once it exists) over `Math.random()`.
- Use helpers: `randInt`, `choice`, and RNG-aware `shuffle`.
- Break ties deterministically when possible (entityId ordering), and only coinflip when rules truly require it.
- Keep RNG calls out of debug logging, tracing, or metrics.

### Don’t
- Don’t add new direct `Math.random()` calls in core ordering code (start-of-combat, death processing) without documenting why.
- Don’t rely on time-based early stopping when comparing deterministic results.
- Don’t use floating-point comparisons that depend on tiny rounding differences if you can avoid it.

---

## Testing checklist (what should exist and what to add next)

Already present:
- ✅ `test/rng-smoke.ts` validates Mulberry32 output for a known seed.
- ✅ `test/rng-patch-smoke.ts` validates patching `Math.random`.
- ✅ `test/full-game/seeded-runner.ts` patches before import to avoid import-time RNG pitfalls.
- ✅ `test/full-game/full-test.ts` uses `numberOfSimulations: 1` and patches RNG.

Recommended additions:
1) **Golden replay test per seed**
   - Run combat with seed 42 and assert:
     - final board hash equals expected
     - spectator event log hash equals expected
2) **Call-site guard**
   - CI grep check: flag new `Math.random()` in `src/simulation/**` unless explicitly allowed.
3) **Bridge test for replay**
   - Checkpoint A + events ⇒ matches Checkpoint B (your “bridge test” concept slots in perfectly here).

---

## Quick map: “RNG hotspots” worth treating as Tier-0 sensitive
If you change these, expect outcomes to shift broadly:

- `src/simulation/start-of-combat/*` (coinflips + initial attacker tie breaks)
- `src/simulation/deathrattle-orchestration.ts` (process-first coinflips)
- `src/services/utils.ts` (`pickRandom`, `shuffleArray`)
- `src/simulation/deathrattle-spawns.ts` (random spawn pools)
- “Mass usage” sites like `src/simulation/battlecries.ts`
