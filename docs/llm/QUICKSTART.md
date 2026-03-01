# QUICKSTART.md

A practical “get it running, get it deterministic, get it debuggable” guide for this Battlegrounds combat simulator codebase (as captured in `all_ts_dump.txt`).

---

## 0) What this repo does

* Takes **two Battlegrounds boards** (plus hero/trinket/quest/secret context)
* Runs **many simulated combats** (Monte Carlo)
* Returns **win / tie / loss** rates and **damage distributions**
* Can optionally include **outcome samples** and a **combat event log** for replay-style debugging

---

## 1) Prerequisites

* **Node.js** (LTS strongly recommended)
* **npm** (or yarn/pnpm if you adapt commands)
* Ability to run **TypeScript** via `ts-node` (already used by test scripts)

If your environment is “fresh”, the simplest path is: Node LTS + `npm ci`.

---

## 2) Install

```bash
# from repo root
npm ci
```

If you don’t have a lockfile or prefer normal install:

```bash
npm install
```

---

## 3) Run the “known good” test commands

These are the two commands that appear in the project workflows:

### 3.1 Full-game harness (non-seeded)

```bash
npm run test-board
```

### 3.2 Deterministic full-game harness (seeded)

```bash
npm run test-seeded
```

If you see warnings about `Date.now()` or nondeterminism, that’s a sign the seeded runner is patching RNG but some other time source is sneaking in.

---

## 4) Run a simulation programmatically (library mode)

### 4.1 Minimal example (TypeScript)

Create `tools/run-once.ts`:

```ts
import { simulateBattle } from "../src/simulate-bgs-battle";
import type { BgsBattleInfo } from "../src/bgs-battle-info";

// 1) Build a minimal input. Real inputs usually come from a client or saved state.
const input: BgsBattleInfo = {
  playerBoard: {
    player: {
      cardId: "HERO_01",
      hpLeft: 40,
      tavernTier: 5,
      heroPowers: [],
      questEntities: [],
      friendly: true,
    },
    board: [],
  },
  opponentBoard: {
    player: {
      cardId: "HERO_02",
      hpLeft: 40,
      tavernTier: 5,
      heroPowers: [],
      questEntities: [],
      friendly: false,
    },
    board: [],
  },
  options: {
    numberOfSimulations: 2000,
    skipInfoLogs: true,
    includeOutcomeSamples: true,
  },
  gameState: {
    currentTurn: 10,
    anomalies: [],
    validTribes: [],
  },
};

async function main() {
  // simulateBattle is a generator that yields intermediate results
  const gen = simulateBattle(input);

  let last: any = null;
  for (let step = await gen.next(); !step.done; step = await gen.next()) {
    last = step.value;
    // optional: print intermediate progress
    // console.log(last.wonPercent, last.tiedPercent, last.lostPercent);
  }

  // final result
  console.log(last);
}

main().catch(console.error);
```

Run it:

```bash
npx ts-node tools/run-once.ts
```

### 4.2 What you get back

A `SimulationResult` containing:

* counts + percents: `won`, `tied`, `lost`, plus lethal variants
* damage aggregates: `averageDamageWon`, `damageWonRange`, etc
* optional: `outcomeSamples` if `includeOutcomeSamples: true`

---

## 5) Run as a Lambda-style handler (service mode)

There is a default export in `src/simulate-bgs-battle.ts` that behaves like an AWS Lambda handler and expects:

* `event.body` to be JSON stringified `BgsBattleInfo`

Example `tools/invoke-lambda.ts`:

```ts
import handler from "../src/simulate-bgs-battle";
import type { BgsBattleInfo } from "../src/bgs-battle-info";

const input: BgsBattleInfo = /* build or load input */ null as any;

async function main() {
  const event = { body: JSON.stringify(input) };
  const res = await handler(event as any, {} as any, () => {});
  console.log(res.statusCode);
  console.log(res.body);
}

main().catch(console.error);
```

Run:

```bash
npx ts-node tools/invoke-lambda.ts
```

---

## 6) Determinism: how to make runs reproducible

The repo uses `Math.random()` in several ordering choices (coin flips, tie-breakers, target selection). Deterministic tests work by **patching `Math.random`** with a seeded PRNG (Mulberry32).

### 6.1 The “official” way in this repo

Use:

```bash
npm run test-seeded
```

### 6.2 If you want deterministic programmatic runs

Follow the pattern in `test/full-game/seeded-runner.ts`:

* patch `Math.random` at the start
* restore it afterward if you’re running mixed workloads

Practical guideline:

* If you are debugging a specific combat log issue, patch RNG before you run it, so you can reproduce the same branch decisions.

---

## 7) Debugging: getting a “what happened” record

### 7.1 Outcome samples (easy mode)

Set:

```ts
options: { includeOutcomeSamples: true }
```

The simulator will keep a limited number of sample combats (won/lost/tied) including “events/actions” that describe what happened. This is the fastest way to answer: “What did one representative loss look like?”

### 7.2 Replay-style event log (deep mode)

Internally, `Spectator` collects:

* a thin event stream (attack/damage/spawn/death/upsert)
* periodic checkpoints for fast reconstruction

There are helper scripts under `test/full-game/` that support replay workflows (including base64 helpers). If you’re chasing a mismatch, the typical flow is:

1. Run deterministic (`test-seeded`)
2. Extract one sample or one battle’s event log
3. Reconstruct state at a target sequence using replay reducer
4. Compare to a checkpoint snapshot

---

## 8) Common knobs you’ll tweak first

### 8.1 Speed vs accuracy

* `numberOfSimulations`: more sims → tighter confidence
* `maxAcceptableDuration`: safety stop if simulation time runs long

### 8.2 Debug payload size

* `includeOutcomeSamples`: extremely helpful, but increases output size and runtime

### 8.3 Logging noise

* `skipInfoLogs`: keep it `true` unless you’re debugging performance or edge behavior

---

## 9) Common gotchas (and how to avoid them)

### 9.1 “My state drifted” bugs

If you modify board state directly (array splices, keyword booleans, raw stat fields), you can bypass:

* aura bookkeeping
* keyword update hooks
* stats change watchers
* telemetry upserts

Safe pattern:

* stats: use stats helper functions
* keywords: use keyword update helpers
* summons: use spawn/add-minion helpers

### 9.2 Infinite combats / deadlocks

The engine has safety valves (attack count caps, 0-attack deadlock detection). If you hit these:

* suspect a card effect creating unbounded token loops
* suspect “attack immediately” not being cleared correctly
* suspect deaths not being recognized (health reduced but not marked for removal)

### 9.3 Nondeterministic tests

If seeded runs still differ:

* look for any use of `Date.now()` or other time sources
* look for iteration order over JS object keys (rare but can bite)
* ensure RNG is patched before any code that reads randomness runs

---

## 10) New-dev “first hour” plan

If you’re onboarding someone, this sequence works well:

1. **Run** `npm run test-board`
2. **Run** `npm run test-seeded`
3. Open:

   * `src/simulate-bgs-battle.ts` (outer loop)
   * `src/simulation/simulator.ts` (single combat)
   * `src/simulation/attack.ts` (attack pipeline)
4. Pick one card implementation and trace:

   * `_card-mappings.ts` → implementation file → hook call site in the engine

---

## 11) Where to read next

If you want a deeper understanding (and where to change things safely):

* `ARCHITECTURE.md` (systems + flow)
* `PROJECT_MAP.md` (where things live)
* `DATA_MODEL.md` (types that matter)
* `CORE_LOGIC_FLOWS.md` (runtime execution paths)
* `TRIGGERS_AND_TIMING.md` (hook order and invariants)
* `EVENTS.md` / `EVENT_CATALOG.md` (telemetry + replay)