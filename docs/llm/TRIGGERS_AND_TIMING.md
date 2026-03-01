# TRIGGERS_AND_TIMING.md

*(Combat trigger model, ordering, and invariants)*
Source: `all_ts_dump.txt` 

This doc answers one question: **“When exactly does each trigger fire, and what is guaranteed about ordering?”**
It’s written for two audiences:

* **Engine devs**: you’re changing orchestration, death batching, replay, determinism.
* **Card devs**: you’re adding behavior and need to know which hook to implement and what you can safely mutate.

---

## 1) The mental model

Combat runs as a small number of **timing windows**. Within each window, the engine calls a set of **hooks** (“triggers”), and those hooks may:

* modify stats/keywords
* spawn entities
* queue more triggers (deathrattles, avenge, reborn chains)
* log telemetry (spectator)

The core invariant: **damage, death, spawn, and keyword updates are intentionally separated** so the engine can batch deaths, preserve ordering, and support replay.

---

## 2) Timing windows (high-level)

### 2.1 Coarse combat phases (telemetry + conceptual)

The engine and spectator talk in these phase buckets:

* `START_OF_COMBAT`
* `ATTACK`
* `DEATHS`
* `END_OF_COMBAT`

These are coarse. Inside each, ordering rules matter more than the label.

---

## 3) Start of Combat (SoC) timing

### 3.1 SoC pipeline ordering (engine-level)

SoC is explicitly split into **phases** (ordered buckets):

1. **QuestReward**
2. **Anomalies**
3. **Trinket**
4. **PreCombatHeroPower**
5. **IllidanHeroPower**
6. **HeroPower**
7. **Secret**
8. **Minion**

Each phase runs its own “start-of-combat” implementations and can return `shouldRecomputeCurrentAttacker`.

**Why this matters:** some SoC effects spawn or replace minions, which can change “who attacks first.”

### 3.2 SoC “timing class” on cards

Start-of-combat implementations can declare a timing:

* `pre-combat`
* `start-of-combat`
* `illidan`

Rule of thumb:

* **pre-combat** happens before “normal” SoC minion effects.
* **illidan** is a special bucket for Illidan/Wingmen-like ordering.
* **start-of-combat** is the default.

### 3.3 SoC invariants

* **SoC runs once per active hero board** (duos can swap boards, so SoC can happen on the active teammate when they enter).
* SoC is allowed to:

  * spawn entities (using spawn helpers)
  * modify stats/keywords
  * mark entities `definitelyDead` (rare, but exists in hero-power logic)
* SoC should log targeting with `spectator.registerPowerTarget(...)` when it materially changes state (helps replay/debug).

---

## 4) The Attack loop: where most triggers live

Each attack step is a fixed choreography. Here’s the canonical order:

```mermaid
flowchart TD
  A[Pick attacker] --> B[Pick defender]
  B --> C[ATTACK: on-being-attacked window]
  C --> D[ATTACK: on-attack window]
  D --> E[ATTACK: performAttack damage exchange]
  E --> F[ATTACK: after-attack (minion effects)]
  F --> G[DEATHS: death batching + deathrattles + avenge + after-death + reborn]
  G --> H[ATTACK: after-attack (trinkets)]
  H --> I[Cleanup: applyAfterStatsUpdate]
```

### 4.1 Pre-attack: **On Being Attacked** window

**Entry point:** `applyOnBeingAttackedBuffs(...)`
Order inside this window:

1. **Defender secrets** are processed first, in secret list order.
   This includes things like granting divine shield or spawning copies.
2. Then, for **each minion on the defending board**, if it implements `OnMinionAttackedCard`, call:

   * `onAttacked(entity, input)`

**Key ordering rule:** The engine comment explicitly notes that **on-being-attacked effects apply before on-attack effects**.

### 4.2 Pre-damage: **On Attack** window

**Entry point:** `applyOnAttackEffects(...)`
Order inside this window:

1. For each **attacking hero trinket**, if it implements `OnWheneverAnotherMinionAttacksCard`, call it.
2. For each **other friendly minion (excluding the attacker)**:

   * call `OnWheneverAnotherMinionAttacksCard` if implemented
   * then call the same hook for each **enchantment** on that minion (enchantments can implement attack hooks too)
3. Then trigger **Rally**:

   * `triggerRally(...)` calls `RallyCard.rally(...)` on the attacker (and rally enchantments)

**Key ordering rule:** “Whenever friendly minion attacks” effects are intended to happen **before** Rally itself (this is explicitly commented).

### 4.3 Damage exchange: `performAttack(...)`

This is where the attack actually happens (combat damage, cleave, divine shield consumption, venomous/poisonous application, etc).

**Important:** Damage application does **not** immediately “remove” minions from the board. It sets health and flags, then death resolution happens in the **DEATHS** window.

### 4.4 Post-damage, pre-deaths: after-attack (minions)

The engine calls `applyAfterAttackEffects(...)` **before** death processing, but the comments indicate some after-attack behavior must conceptually be interpreted “after minions die.” This is one of the subtle zones where correctness relies on the exact implementation of each after-attack effect.

### 4.5 Death resolution: `processMinionDeath(...)`

This is the big one. It runs until the board is stable.

Ordering in a death batch:

1. Identify and remove dead entities from each board (`makeMinionsDie(...)`)
2. Emit spectator `minion-death`
3. Record death “snapshots” into `sharedState.deaths` (restoring to max health for downstream logic)
4. Call **OnDeath** for each dead entity that implements `OnDeathCard`
5. Run `orchestrateMinionDeathEffects(...)`:

   * “after kill” effects
   * “whenever minions die” effects
   * **deathrattles (natural then enchantments)**
   * **avenge**
   * “after death” effects (some secret-speed / avenge-speed things)
   * “after minions die” effects (note: can deal damage before death chain completes)
   * **reborn processing**
   * feathermane-style followups
   * post-deathrattle effects
6. Recurse if new deaths were created
7. Optionally run “summon when space”
8. Run **OnAfterDeath** for:

   * trinkets first
   * then surviving friendly minions implementing `OnAfterDeathCard`
9. Run “remember deathrattles” style effects on survivors

**Key invariant:** **Only the death pipeline removes entities.** Damage can reduce health to 0, but the minion remains until a death batch removes it.

### 4.6 Post-deaths: after-attack (trinkets)

After death resolution, the engine calls `applyAfterAttackTrinkets(...)`.

This makes trinkets behave like “late observers” of the fully resolved attack.

### 4.7 Cleanup: `applyAfterStatsUpdate(...)`

This is a post-step cleanup hook used by the engine to clear or normalize temporary state, especially around pending stat buffs.

---

## 5) Deathrattles, Avenge, Reborn: the subtle ordering

This trio is where most “why does replay not match the game” bugs live.

### 5.1 Natural deathrattles vs enchantment deathrattles

During deathrattle processing:

* Dead entities are processed **left-to-right** (as a proxy for summon order; the code comments note summon order is the real truth, but left-to-right is used with caveats).
* For each dead entity:

  1. **Natural deathrattle** first (from the minion implementation)
  2. Then **deathrattle enchantments** (enchantments attached to the minion)

### 5.2 Player order coin flip

The deathrattle processing chooses “which side first” using a coin flip (`Math.random() > 0.5`). If you care about determinism, this must eventually be routed through your seeded RNG story.

### 5.3 Avenge timing

In the orchestration, Avenge is intended to happen:

* after deathrattles have been considered for the dead entities in that batch,
* and **before** reborn.

There’s an explicit comment: “Avenge trigger before reborn”.

Avenge also interacts with multiple holders:

* minions with avenge counters
* trinkets / quest rewards / hero-power-like objects that track avenge state

### 5.4 After-death effects

There is a category of effects applied after minions die but before the whole chain is “done” (example comment: Silent Enforcer dealing damage, then Soul Juggler, before other deathrattles fully resolve). These “mid-chain” effects are why death resolution is recursive.

### 5.5 Reborn timing and index hacks

Reborn is processed after deathrattles and avenge, and there is explicit hack logic to adjust spawn indices when spawns happened during the deathrattle phase. This is a known “fragile” area.

---

## 6) The trigger catalog (hooks you can implement)

Below are the primary “user-extensible” triggers. All are defined in `src/cards/card.interface.ts`.

### 6.1 Start of Combat hooks

* `StartOfCombatCard.startOfCombat(trinket|minion|heroPower|secret, SoCInput)`
  Fired during SoC phases (see Section 3).
* `StartOfCombatFromHandCard`
  Variant for effects that trigger from hand at SoC (rare, but exists).
* `startOfCombatTiming: 'pre-combat'|'illidan'|'start-of-combat'`
  Controls SoC ordering bucket.

**Return types matter:**

* `true/false` indicates “did it trigger”
* `{ hasTriggered; shouldRecomputeCurrentAttacker }` allows SoC to tell the engine to recompute first attacker.

### 6.2 Attack-declaration and attack-time hooks

* `OnMinionAttackedCard.onAttacked(entity, OnMinionAttackedInput)`
  Fired for each defending minion after secrets in the on-being-attacked window.
* `OnWheneverAnotherMinionAttacksCard.onWheneverAnotherMinionAttacks(...)`
  Fired for trinkets and other friendly minions (and their enchantments) before rally.
* `RallyCard.rally(minion|trinket|enchantment, OnAttackInput)`
  Fired via `triggerRally(...)` on the attacker (and rally enchantments). Multiplied by “double/triple rally” and rallying-cry quest rewards.

### 6.3 Damage hooks

* `OnDamagedCard.onDamaged(entity, OnDamagedInput)`
  Fired when an entity takes damage (inside `onEntityDamaged(...)`). Also triggers frenzy logic if relevant.
* `AfterDealDamageCard.afterDealDamage(entity, AfterDealDamageInput)`
  Fired whenever damage is dealt (minion or hero), for both sides’ boards.
* `AfterHeroDamagedCard.afterHeroDamaged(entity, AfterHeroDamagedInput)`
  Fired when a hero takes damage.

### 6.4 Death hooks

* `OnDeathCard.onDeath(entity, OnDeathInput)`
  Fired for each entity that died in the current death batch, before deathrattle orchestration.
* `DeathrattleSpawnCard.deathrattleSpawn(minion, DeathrattleTriggeredInput)`
  Used by natural deathrattle implementations to produce spawn candidates.
* `DeathrattleSpawnEnchantmentCard.deathrattleSpawnEnchantmentEffect(enchantment, minion, DeathrattleTriggeredInput)`
  Used for enchantment-driven deathrattles.
* `DeathrattleTriggeredCard.onDeathrattleTriggered(minion|trinket, DeathrattleTriggeredInput)`
  A “meta” hook fired when another deathrattle is triggered (used for “when a deathrattle triggers” effects).
* `OnAfterDeathCard.onAfterDeath(entity|trinket, OnAfterDeathInput)`
  Fired after the death batch finishes and post-death spawning is resolved. Trinkets first, then surviving minions.

### 6.5 Spawn/despawn hooks

These originate from `add-minion-to-board` and spawn helpers.

* `OnSpawnedCard.onSpawned(minion, OnSpawnInput)`
* `OnOtherSpawnedAuraCard.onOtherSpawnedAura(minion, OnOtherSpawnAuraInput)`
* `OnOtherSpawnedCard.onOtherSpawned(minion, OnOtherSpawnInput)`
* `AfterOtherSpawnedCard.afterOtherSpawned(minion|trinket, OnOtherSpawnInput)`
* `OnDespawnedCard.onDespawned(minion, OnDespawnInput)`
* `OnSpawnFailCard.onSpawnFail(entity, OnSpawnFailInput)`

**Practical rule:** if you are adding minions, do it through spawn helpers so these hooks fire consistently.

### 6.6 Keyword-change hooks (must use helpers)

These exist because toggling keywords is not “just setting a boolean.” Helpers compute previous value and notify watchers.

* `OnDivineShieldUpdatedCard.onDivineShieldUpdated(...)`
* `OnTauntUpdatedCard.onTauntUpdated(...)`
* `OnRebornUpdatedCard.onRebornUpdated(...)`
* `OnStealthUpdatedCard.onStealthUpdated(...)`
* `OnVenomousUpdatedCard.onVenomousUpdated(...)`
* `OnWindfuryUpdatedCard.onWindfuryUpdated(...)`

**Rule:** call `updateDivineShield/updateTaunt/updateReborn/...` helpers, not `entity.divineShield = true`.

### 6.7 Stats-change hooks

* `OnStatsChangedCard.onStatsChanged(entity, OnStatsChangedInput)`
  Used by the stats module (`modifyStats/setEntityStats`) to notify “when stats change” listeners.

### 6.8 Tavern spell hooks (combat-time spellcasting)

* `TavernSpellCard.castTavernSpell(spellCardId, CastSpellInput)`
* `OnTavernSpellCastCard.onTavernSpellCast(entity|trinket, CastSpellInput)`
* `AfterTavernSpellCastCard.afterTavernSpellCast(entity|trinket, CastSpellInput)`

These define spell timing around casts, and should be used instead of ad hoc “spell effects in combat.”

### 6.9 Magnetize hooks

* `OnBeforeMagnetizeCard.onBeforeMagnetize(...)`
* `OnBeforeMagnetizeSelfCard.onBeforeMagnetizeSelf(...)`
* `OnAfterMagnetizeCard.onAfterMagnetize(...)`
* `OnAfterMagnetizeSelfCard.onAfterMagnetizeSelf(...)`

Use magnetize helpers so these hooks and aura updates remain consistent.

---

## 7) Telemetry timing (spectator)

When you see calls like `spectator.registerPowerTarget(...)`, it is not “game logic,” it is **state narration**. It matters because:

* it powers replay reconstruction
* it provides “what just happened” samples

Canonical emission points:

* SoC boundary: `start-of-combat`
* Each attack: `attack`
* Each damage instance: `damage`
* Death batch: `minion-death`
* Spawn batch: `spawn`
* End of combat: `player-attack` / `opponent-attack`

**Replay-critical invariant:** deletion is represented by `minion-death`, not by damage.

---

## 8) “Don’t break these” invariants

### 8.1 Removal invariants

* A minion should only disappear from a board during the **death pipeline**.
* Damage reducing health to 0 is not sufficient to remove it.

### 8.2 Ordering invariants

* Defender secrets and on-being-attacked hooks run **before** on-attack hooks.
* OnWheneverAnotherMinionAttacks runs **before** Rally.
* Natural deathrattle runs **before** deathrattle enchantments.
* Avenge runs **before** reborn.
* Trinket after-attack hooks are late, after death resolution.

### 8.3 Mutation invariants (for card devs)

* Prefer engine helpers:

  * `modifyStats/setEntityStats` (stats)
  * keyword `updateX(...)` helpers
  * `spawnEntities + performEntitySpawns` (summons)
* If you must splice the board directly, understand you are bypassing many hooks and might need to manually reapply implied mechanics and telemetry.

### 8.4 Determinism invariants (future-proofing)

* Any ordering choice using `Math.random()` is a determinism risk.
* Prefer a seeded RNG that is threaded through the engine and recorded in checkpoints if you want replay equivalence tests to be rock solid.

---

## 9) A “when do I implement what?” cheat sheet

* “This happens at SoC” → `StartOfCombatCard` (+ `startOfCombatTiming`)
* “When something attacks” → `RallyCard` (attacker) or `OnWheneverAnotherMinionAttacksCard` (other allies/trinkets)
* “When something is attacked” → `OnMinionAttackedCard`
* “When something takes damage” → `OnDamagedCard`
* “Whenever damage is dealt (anywhere)” → `AfterDealDamageCard`
* “When hero takes damage” → `AfterHeroDamagedCard`
* “When a minion dies” → `OnDeathCard`
* “Deathrattle spawns” → `DeathrattleSpawnCard` / `DeathrattleSpawnEnchantmentCard`
* “After the dust settles from deaths” → `OnAfterDeathCard`
* “Something got spawned/despawned” → spawn/despawn hook family
* “Keyword toggles” → use `updateX` helpers so OnXUpdated triggers fire