# DEBUGGING.md

A practical debugging playbook for this Battlegrounds combat simulator, based on the architecture and tooling patterns visible in `all_ts_dump.txt`. This is optimized for **new-dev onboarding** and for **fast root-cause** when something “feels wrong” (incorrect odds, weird combat sequence, replay mismatch, infinite loops, etc).

---

## 0) Debugging philosophy (how to win quickly)

This simulator has three defining traits:

1. **Mutation-heavy state** (entities are updated in place)
2. **Stochastic branching** (target selection/order coin flips use randomness)
3. **Deep chained effects** (deathrattles/avenge/reborn/spawns can recurse)

So the fastest path is:

* **make it deterministic**
* **capture a narrative** (events/actions)
* **bisect where it diverges**
* **fix the smallest invariant break**

---

## 1) First step: make it reproducible

### 1.1 Use the seeded runner

Run the deterministic harness (it patches `Math.random()` with a seeded PRNG).

```bash
npm run test-seeded
```

If you’re debugging inside your own script, mimic the seeded runner pattern:

* patch `Math.random` at process start
* restore after if needed

### 1.2 Confirm nondeterminism sources

If results still vary run-to-run:

* search for `Date.now()` usage (a common test flake source)
* check any iteration over object keys (should be rare)
* ensure your seed patch happens before any module executes random-dependent initialization

**Rule of thumb:** if you can’t reproduce, you can’t debug.

---

## 2) Pick your debug lens (choose one)

### Lens A: “Outcome looks wrong”

You trust the sim’s internal sequence but odds/damage are off.

### Lens B: “One combat sequence looks wrong”

You want to inspect a single fight step-by-step.

### Lens C: “Replay/event log mismatch”

The sim seems fine, but the replay reconstruction diverges.

### Lens D: “Performance / infinite loop”

Simulation is slow, hangs, or triggers safety guards.

Each lens has a different fastest workflow below.

---

## 3) Lens A: Outcome looks wrong (win/tie/loss or damage)

### 3.1 Reduce the problem

* Drop `numberOfSimulations` to something small (e.g., 1–50) to inspect single combats.
* Enable outcome samples (`includeOutcomeSamples: true`) so you get representative narratives.

### 3.2 Check the input normalization boundary

Many “wrong odds” issues are actually wrong/missing fields in input:

* wrong `friendly` flags
* missing `maxHealth`
* missing trinket/secret structures
* legacy fields (secrets on board vs player) not normalized as expected

Start at:

* `src/input-sanitation.ts` (`buildFinalInput(...)`)
* `src/input-clone.ts` (`cloneInput3(...)`)

Checklist:

* Do both heroes have correct `hpLeft`, `tavernTier`?
* Are board minions ordered correctly?
* Do all `entityId`s look unique?
* Are `validTribes`/`anomalies` applied as intended?

### 3.3 Verify end-of-combat damage computation

If odds are fine but damage is off:

* inspect end-of-combat logic in `src/simulation/simulator.ts`
* verify it sums:

  * surviving minion tech levels (from card data)
  * plus hero tavern tier
  * plus duos spillover logic if teammate exists

### 3.4 Confirm the “physics invariant”

If a minion seems to die “too early” or “too late,” remember:

* damage reduces health
* deaths are processed in a death batch
* removal happens only in death pipeline

Look at:

* `src/simulation/attack.ts` (damage application + calling death processing)
* `src/simulation/minion-death.ts` (removal and bookkeeping)

---

## 4) Lens B: One combat sequence looks wrong (step-by-step narrative)

### 4.1 Enable samples and inspect the action list

Set:

* `includeOutcomeSamples: true`

Then inspect one `GameSample` under:

* `outcomeSamples.won[]` / `.lost[]` / `.tied[]`

These samples carry a sequence of actions/events that serve as the “story” of what happened.

### 4.2 The “canonical attack step” checklist

When reading the story, validate each attack step follows expected timing:

1. `attack` event (attacker + defender)
2. defender-side “on being attacked” effects

   * secrets first
   * defensive hooks next
3. attacker-side “on attack” effects

   * trinkets / other minions / enchantments
   * rally
4. damage exchange
5. death batch events
6. spawn events (from deathrattles/reborn)
7. next attack

If an effect appears in the wrong place, start at:

* `src/simulation/attack.ts` orchestration
* `src/simulation/on-being-attacked.ts`
* `src/simulation/on-attack.ts`
* `src/simulation/deathrattle-orchestration.ts`

### 4.3 Add one diagnostic print, not ten

Good debug prints are boundary-based:

* “attacker chosen: X”
* “defender chosen: Y”
* “death batch: [ids]”
* “spawned: [ids]”

Prefer adding prints/logs at:

* `spectator.registerAttack`
* `registerDeadEntities`
* `registerMinionsSpawn`

Because those are stable narrative edges.

### 4.4 Confirm attacker selection rules

A common “sequence looks wrong” cause is attacker selection:

* first attacker chosen by board size (random tie-break)
* SoC can request recompute if it changes board sizes
* “attackImmediately” introduces speed-attacker behavior

Start at:

* `src/simulation/simulator.ts`
* `src/simulation/start-of-combat/start-of-combat.ts`
* `src/simulation/spawns.ts` (attackImmediately logic)

---

## 5) Lens C: Replay mismatch (thin log reconstruction diverges)

Replay uses:

* thin `SpectatorEvent[]`
* periodic checkpoints (fat snapshot actions)
* reducer `applyEvent(...)`

### 5.1 Understand what “replay correctness” means here

Replay state is a projection:

* it reconstructs sanitized boards and key highlights
* it is **not** the full simulation state

So the correct question is:

> “Does replay reconstruction match the sanitized snapshot at checkpoints?”

### 5.2 The two killer tests (recommended practice)

1. **Bridge test**: checkpoint A + apply events → checkpoint B
2. **Full run**: apply all events from start → final snapshot

If you see mismatches, it is almost always one of:

* missing `entity-upsert` after a state change
* wrong spawn insert index handling
* missing death event for a removal
* entityId collision or wrong `friendly` assignment

### 5.3 Bisect the first divergence

Workflow:

1. Pick a target `seq` in the middle
2. `reconstructAt(targetSeq)`
3. Compare to the nearest checkpoint snapshot state
4. Binary search to find the first `seq` where they differ

### 5.4 Common replay failure patterns

#### Pattern 1: Entity health wrong

Cause:

* damage events are applied, but later state changes (heals/buffs) were not logged as upserts.

Fix:

* emit `entity-upsert` after meaningful state changes, or add more checkpoints.

#### Pattern 2: Entity disappears without death

Cause:

* removal happened via direct board splice, bypassing death pipeline and `minion-death` emission.

Fix:

* route removals through death pipeline invariants.

#### Pattern 3: Spawn placement drift

Cause:

* `spawn` event missing `insertIndexes` or computed incorrectly.

Fix:

* ensure spawn logging happens after insertion, and compute insert indexes reliably.

#### Pattern 4: Entity exists on both boards

Cause:

* wrong `friendly` or entityId reuse.

Fix:

* ensure spawned entities get new entityIds and correct friendly assignment.

### 5.5 Where to look

* `src/simulation/spectator/spectator.ts` (emission)
* `src/simulation/spectator/spectator-sanitize.ts` (sanitization correctness)
* `src/simulation/replay/apply-event.ts` (reducer semantics)

---

## 6) Lens D: Performance, hangs, infinite loops

### 6.1 Known safety guards

The engine includes guards like:

* max attack iterations (short-circuit at some threshold)
* Monte Carlo duration limit (`maxAcceptableDuration`)
* deadlock checks (both boards have no attack-capable minions)

If these fire:

* you likely created an unbounded spawn loop
* or left `attackImmediately` uncleared
* or broke death recognition/removal

### 6.2 Performance profiling checklist

1. Reduce simulations to 1 and see if it still hangs:

   * If yes, it’s a single-combat loop bug.
   * If no, it’s Monte Carlo scale.
2. Print number of entities:

   * if entity count explodes, suspect summon loops / deathrattle loops
3. Check board size invariants:

   * board should never exceed 7 minions

### 6.3 Usual culprits

* “Summon when space” interactions creating repeated fills
* deathrattles spawning into full boards with repeated retries
* a minion repeatedly marked `attackImmediately`
* `definitelyDead` not being cleared/handled properly

### 6.4 Where to look

* `src/simulation/spawns.ts`
* `src/simulation/summon-when-space.ts`
* `src/simulation/minion-death.ts`
* `src/simulation/deathrattle-orchestration.ts`
* `src/simulation/attack.ts`

---

## 7) Debugging “wrong trigger timing”

If a card triggers but at the wrong time, check:

### 7.1 Is it the right hook?

Common confusions:

* `OnMinionAttacked` vs `OnAttack`
* `OnDeath` vs `DeathrattleSpawn` vs `OnAfterDeath`
* SoC timing buckets (`pre-combat`, `illidan`, default)

### 7.2 Is it being invoked from the correct window?

Inspect dispatch sites:

* SoC: `simulation/start-of-combat/*`
* Attack: `on-being-attacked.ts`, `on-attack.ts`, `after-attack.ts`
* Death: `minion-death.ts`, `deathrattle-orchestration.ts`

### 7.3 Is mutation done via helpers?

If a card directly sets a keyword or stats:

* watchers might not run
* later effects might assume state wasn’t changed yet

Use:

* stats helpers
* keyword update helpers
* spawn helpers

---

## 8) Debugging “it doesn’t trigger at all”

Fast checklist:

1. Does the input cardId match expected (normal vs golden)?
2. Does the implementation file include that id in `cardIds: [...]`?
3. Is it registered in `_card-mappings.ts`?
4. Is the hook interface correct (SoC vs deathrattle vs on attack)?
5. Is the engine calling that hook in this timing window?

Where to verify:

* `_card-mappings.ts` (registry)
* `card.interface.ts` (type guard exists?)
* engine window file that dispatches that hook

---

## 9) Debugging “stats/keywords look inconsistent”

Symptoms:

* divine shield never removed
* taunt rules not respected
* stats don’t match expected after buff/debuff

Likely causes:

* direct mutation bypassing controllers
* missing aura refresh
* enchantments applied without timing ordering

Where to look:

* `src/simulation/stats.ts`
* `src/keywords/*`
* `src/simulation/auras.ts`
* `src/simulation/enchantments.ts`

---

## 10) Tools and techniques that work well here

### 10.1 Deterministic “single-run microscope”

Run 1 simulation with seeded RNG and print every spectator event.

This gives you a stable transcript.

### 10.2 Minimal reproduction harness

When debugging a new bug:

* create a minimal `BgsBattleInfo` with only necessary minions
* avoid huge real-world boards until the bug is isolated

### 10.3 Hash-based state comparison

To bisect mismatch:

* define a stable hash of sanitized boards:

  * sort by entityId
  * stringify stable fields
* compare at checkpoints and after event application

### 10.4 Don’t debug from the content file first

If a card “feels wrong,” start from the **timing window** (engine call site) and trace into the content hook. The cause is frequently ordering, not the card code.

---

## 11) “Where to set breakpoints” (high ROI)

### Engine boundaries

* `Simulator.simulateSingleBattle(...)`
* `handleStartOfCombat(...)`
* `doFullAttack(...)` or the core attack orchestrator
* `processMinionDeath(...)`
* `orchestrateMinionDeathEffects(...)`
* `performEntitySpawns(...)`

### Telemetry boundaries

* `Spectator.emitEvent(...)`
* `registerAttack(...)`
* `registerDamageDealt(...)`
* `registerDeadEntities(...)`
* `registerMinionsSpawn(...)`

### Replay boundaries

* `reconstructAt(...)`
* `applyEvent(...)`

---

## 12) A compact “debug decision tree”

1. **Can you reproduce?**

* no → make deterministic first
* yes → continue

2. **Is the final outcome wrong or the sequence wrong?**

* outcome wrong → check input normalization, damage computation
* sequence wrong → inspect attack/death pipeline ordering

3. **Is replay wrong but sim right?**

* yes → missing upserts/spawn indexes/death events
* no → engine or content logic bug

4. **Is it slow/hanging?**

* yes → check spawn/death recursion and attackImmediately clearing
