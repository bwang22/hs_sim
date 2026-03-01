# HASHING_AND_CANON.md

This doc defines **canonicalization (“canon”)** and **hashing** for this simulator’s state and logs. It’s the glue that makes these workflows reliable:

* determinism tests (same input + seed → same transcript)
* replay equivalence (checkpoint A + events → checkpoint B)
* “first divergence” bisection (find the exact `seq` where things drift)
* caching and dedup (avoid storing identical snapshots repeatedly)

It’s grounded in what’s already in the repo:

* the thin replay model uses **sanitized entities** (see `spectator-sanitize.ts`)
* there is an explicit “future-facing” combat log schema with optional `stateHash` and RNG cursor (`src/simulation/spectator/combat-log.ts`)

---

## 1) The core problem: mutation + ambiguity

### 1.1 Mutation

The engine mutates `BoardEntity` objects in place. If you ever hash “live objects” directly, you risk:

* hashing fields that are irrelevant to replay
* hashing fields that are unstable across versions
* hashing pointers or functions (impossible to serialize)
* hashing `undefined` fields inconsistently

### 1.2 Ambiguity

Even when two states are “the same for our purposes,” they may differ in:

* non-viewer fields (`memory`, `tags`, `lastAffectedByEntity`, callbacks)
* internal counters that do not affect what we are comparing
* ordering of object keys (JS object insertion order is not a contract you want to bet your tests on)

So: **we never hash raw state**. We hash a **canonical projection**.

---

## 2) Three canonical projections (pick the right “truth”)

You usually want *three* levels of “canon,” each for a different job.

### Canon A: Replay projection (recommended default)

Matches the thin log model and replay reducer expectations.

* based on `SanitizedEntity` (the subset used by spectator sanitization)
* only includes replay-visible fields:

  * identity: `entityId`, `cardId`, `friendly`
  * combat stats: `attack`, `health`, `maxHealth`
  * key keywords: `taunt`, `divineShield`, `poisonous`, `venomous`, `reborn`, `windfury`, `stealth`

Use this canon for:

* `CombatCheckpoint.stateHash` (the one you compare in bridge tests)
* replay equivalence validation

### Canon B: Viewer snapshot projection (fat actions)

Matches `GameAction` snapshots. Very rich, great for debugging, expensive.

Use this canon for:

* deduping outcome samples
* UI “recording” storage optimizations
* human-visible checkpoint integrity

### Canon C: Engine projection (internal)

Includes more engine-only fields (enchantments, scriptData, tags, etc). This is useful only if you want to validate deeper internal invariants.

Use this canon for:

* engine refactors where you want to guarantee no hidden drift
* performance-heavy testing where you want stronger guarantees than viewer canon

If you are not sure: start with **Canon A**.

---

## 3) Canonicalization rules (the “canon contract”)

### 3.1 General rules

1. **Drop all `undefined` fields**
   Do not serialize `foo: undefined`. Omit it.
2. **Drop all function fields**
   Example: `onCanceledSummon` can never be part of canon.
3. **Drop all object pointers** that are not part of canon
   Example: `lastAffectedByEntity` is a pointer and will cause huge unstable graphs.
4. **Normalize booleans**
   Keep as `true/false`. (Do not use truthy coercion.)
5. **Normalize numbers**

   * no `NaN`
   * no `Infinity`
   * if encountered, treat as a bug and throw or replace with a sentinel and log loudly

### 3.2 Object key order

Canonical objects must have **stable key order**, independent of construction order.

A practical rule:

* define canon objects by explicitly constructing them in the desired key order
* then use a stable stringify that preserves that order (or sorts keys recursively)

### 3.3 Array ordering

Arrays are tricky: sometimes order is meaningful, sometimes it is not.

**Board arrays:** order is meaningful (left-to-right adjacency, spawn placement, attack order heuristics).
So **preserve board order** in canon.

**Sets disguised as arrays:** (example: `deadEntityIds`, `targetEntityIds`)
You have two options:

* **order-preserving** (if emission order is meaningful and stable)
* **sorted** (if you want more robustness)

Recommendation:

* for `deadEntityIds`: sort ascending (identity set)
* for `targetEntityIds`: preserve order if it came from “ordered targeting,” otherwise sort
* be consistent and document it

---

## 4) Canon formats

### 4.1 CanonStateV1 (Replay projection)

This is the recommended canonical state shape for hashing checkpoints and replay comparisons.

```json
{
  "v": 1,
  "player": {
    "board": [
      { "entityId": 7706, "cardId": "BG34_Treasure_994", "friendly": true, "attack": 11, "health": 9, "maxHealth": 9, "taunt": false, "divineShield": false, "poisonous": false, "venomous": false, "reborn": false, "windfury": false, "stealth": false }
    ]
  },
  "opponent": {
    "board": [
      { "entityId": 8857, "cardId": "BGS_126", "friendly": false, "attack": 33, "health": 30, "maxHealth": 30, "taunt": false, "divineShield": false, "poisonous": false, "venomous": false, "reborn": false, "windfury": false, "stealth": false }
    ]
  }
}
```

Notes:

* `v` is the canon version. Bump it if you change fields or semantics.
* This projection intentionally ignores hands, secrets, trinkets, hero powers. If you want them, define CanonStateV2 and keep V1 stable.

### 4.2 CanonEventV1 (Thin event canon)

Useful if you want to hash transcripts.

A canonical event should include:

* `seq` (if you want an exact match), or omit it (if you want an order-only match)
* `type`, `phase`
* payload fields in stable order
* arrays normalized (sorted or preserved per rule)

Example (order-preserving transcript hash):

```json
{ "seq": 42, "type": "attack", "phase": "ATTACK", "attackerEntityId": 7706, "defenderEntityId": 8857 }
```

---

## 5) Hashing rules

### 5.1 Hash domain separation

Always prefix the input to the hash with a domain and version, so different hashes cannot collide “by accident.”

Examples:

* `STATE_V1|`
* `EVENTS_V1|`
* `CHECKPOINT_V1|`

### 5.2 Algorithms

Two good choices:

* **SHA-256** (crypto hash, stable, ubiquitous, slower, safest for correctness)
* **xxHash / Murmur** (fast, non-crypto, great for performance, still fine for tests if collision risk is acceptable)

Recommendation:

* use **SHA-256** for validation and correctness tests
* use **xxHash** for hot-path caching if you need speed

### 5.3 Hash encoding

* hex is easiest to diff and store
* base64 is smaller

Pick one and standardize.

---

## 6) Where hashing plugs into the existing code

### 6.1 `CombatCheckpoint.stateHash` (already modeled)

In `src/simulation/spectator/combat-log.ts`, `CombatCheckpoint` already includes:

* `stateHash?: string`
* `rng?: RngCursor`

That is exactly where canon hashing belongs.

**Spec:**

* `stateHash` should be `hash( CanonStateV1(checkpoint.snapshot) )`.

### 6.2 Spectator checkpoints today (current spectator system)

Even if the “CombatLog” interface isn’t fully wired everywhere yet, the spectator already:

* creates checkpoints periodically
* can store extra metadata on snapshots (it already attaches `checkpointReason` in some paths)

So you can implement hashing incrementally:

* compute `stateHash` when building the checkpoint snapshot
* store it alongside the checkpoint object
* keep old checkpoints valid by making the field optional

---

## 7) Canonicalization recipes

### 7.1 Canon entity (Replay projection)

Rules:

* include only sanitized fields
* omit undefined
* ensure explicit key order

Pseudo-implementation:

```ts
type CanonEntityV1 = {
  entityId: number;
  cardId: string;
  friendly: boolean;
  attack: number;
  health: number;
  maxHealth?: number;
  taunt?: boolean;
  divineShield?: boolean;
  poisonous?: boolean;
  venomous?: boolean;
  reborn?: boolean;
  windfury?: boolean;
  stealth?: boolean;
};

function canonEntityV1(e: any): CanonEntityV1 {
  return {
    entityId: e.entityId,
    cardId: e.cardId,
    friendly: !!e.friendly,
    attack: e.attack,
    health: e.health,
    maxHealth: e.maxHealth,
    taunt: e.taunt,
    divineShield: e.divineShield,
    poisonous: e.poisonous,
    venomous: e.venomous,
    reborn: e.reborn,
    windfury: e.windfury,
    stealth: e.stealth,
  };
}
```

### 7.2 Canon board

Keep order (board position matters), and canon each entity:

```ts
function canonBoardV1(board: any[]): CanonEntityV1[] {
  return (board ?? []).map(canonEntityV1);
}
```

### 7.3 Canon checkpoint state

Build from the checkpoint snapshot (fat `GameAction`), but project to replay canon:

```ts
function canonStateV1(snapshot: any) {
  return {
    v: 1,
    player: { board: canonBoardV1(snapshot.playerBoard) },
    opponent: { board: canonBoardV1(snapshot.opponentBoard) },
  };
}
```

---

## 8) Stable stringify (the “canon serializer”)

### 8.1 Why not plain `JSON.stringify`?

`JSON.stringify` is stable *for a given object construction order*, but construction order can change across refactors. For hashing, you want stability that survives harmless changes.

### 8.2 Two safe options

1. **Use a stable stringify utility** (sort keys recursively)
2. **Never rely on key sort**, instead construct canon objects in the exact key order and guarantee nested objects are similarly constructed

Recommendation:

* If you want maximum robustness, use stable stringify.

Minimal stable stringify sketch:

```ts
function stableStringify(x: any): string {
  if (x === null || typeof x !== 'object') return JSON.stringify(x);
  if (Array.isArray(x)) return `[${x.map(stableStringify).join(',')}]`;
  const keys = Object.keys(x).sort();
  return `{${keys.map(k => JSON.stringify(k) + ':' + stableStringify(x[k])).join(',')}}`;
}
```

---

## 9) Hash chaining for “first divergence” (optional but very useful)

Instead of hashing the full event list every time, maintain a rolling chain:

* `h0 = HASH("EVENTS_V1|")`
* `h(i+1) = HASH( h(i) + "|" + stableStringify(canonEvent(i)) )`

Benefits:

* you can compare the chain hash at checkpoints
* you can binary search divergence by storing every K-th chain hash
* you can detect if a single event differs without scanning the full transcript

This is especially handy when combats have long chains of events.

---

## 10) Validation specs powered by canon hashes

### 10.1 Bridge test (checkpoint equivalence)

For two checkpoints A at `seq=a` and B at `seq=b`:

1. Initialize replay from A snapshot
2. Apply thin events `(a, b]`
3. Compute `hash(replayStateCanonV1)`
4. Compare to `B.stateHash`

### 10.2 Full run test

Start from earliest checkpoint (or initial snapshot) and apply all events to end. Compare final canon hash to final snapshot hash.

---

## 11) Performance guidance

Hashing can become expensive if you do it too often.

Recommended:

* compute `stateHash` only at checkpoint creation (every N events)
* avoid hashing on every event unless debugging or building chain hashes
* if you need frequent hashing, prefer a fast non-crypto hash (xxhash) for interim checks, and SHA-256 for final assertions

---

## 12) Versioning and migration

### 12.1 Canon versioning

Always include `v` in the canonical payload.

Rules:

* additive field changes in canon require bumping `v` if they change hash inputs
* old versions must remain supported for old logs if you store them long term

### 12.2 Schema vs canon

Event schema version (`CombatLog.version`) and canon version (`CanonState.v`) are related but not identical.

* schema version changes when event types or semantics change
* canon version changes when the hashed projection changes

Keep them separate so you can evolve one without unnecessarily breaking the other.

---

## 13) Practical default recommendation

If you implement only one thing first:

* **CanonStateV1 = replay projection of boards only**
* `stateHash = sha256("STATE_V1|" + stableStringify(canonStateV1(snapshot)))`
* store it in `CombatCheckpoint.stateHash`

That gives you deterministic bridge tests immediately, with minimal complexity.
