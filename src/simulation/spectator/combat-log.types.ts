// src/simulation/replay/combat-log.types.ts

import { BoardEntity } from '../../board-entity';
import { BoardSecret } from '../../board-secret';
import { BgsHeroPower, BgsPlayerEntity, BoardTrinket } from '../../bgs-player-entity';

// ---------------------------------------------
// EVENTS
// ---------------------------------------------

export type CombatPhase = 'START_OF_COMBAT' | 'ATTACK' | 'DEATHS' | 'END_OF_COMBAT';

/**
 * Base shape for every event in the log.
 * - seq is globally monotonic for the whole combat
 * - parents gives causal linkage (optional but very helpful)
 */
export interface CombatEventBase {
	readonly seq: number;
	readonly type: string;
	readonly phase?: CombatPhase;
	readonly parents?: readonly number[];
}

/**
 * Optional: record RNG consumption as an event.
 * This is only needed if you can't restore RNG state via a counter/state in checkpoints.
 */
export interface RngEvent extends CombatEventBase {
	readonly type: 'RNG';
	readonly stream: 'combat' | 'discover' | 'other';
	readonly index: number; // how many RNG pulls have occurred in this stream
	readonly value: number; // the sampled value (or int)
}

/**
 * Attack selection/announcement (who is hitting whom).
 */
export interface AttackDeclaredEvent extends CombatEventBase {
	readonly type: 'ATTACK_DECLARED';
	readonly attackerEntityId: number;
	readonly defenderEntityId: number;
}

/**
 * Damage application (can be combat or effect-based).
 */
export interface DamageEvent extends CombatEventBase {
	readonly type: 'DAMAGE';
	readonly sourceEntityId?: number;
	readonly targetEntityId: number;
	readonly amount: number;
	readonly kind: 'combat' | 'effect' | 'hero';
}

/**
 * A minion died (resolution point).
 * Note: some engines distinguish "marked dead" vs "removed"; keep it simple first.
 */
export interface MinionDiedEvent extends CombatEventBase {
	readonly type: 'MINION_DIED';
	readonly entityId: number;
}

/**
 * A minion was spawned/summoned onto a board at a given position.
 * You might need more fields depending on how much your spawn logic derives from rules.
 */
export interface SpawnedEvent extends CombatEventBase {
	readonly type: 'SPAWNED';
	readonly entityId: number; // must be stable and deterministic
	readonly cardId: string;
	readonly controller: 'player' | 'opponent';
	readonly boardPosition: number;
}

/**
 * Keyword/state toggles that matter for subsequent rules
 * (divine shield, reborn consumed, stealth cleared, etc.).
 * Keep generic: "flag name + boolean".
 */
export interface FlagChangedEvent extends CombatEventBase {
	readonly type: 'FLAG_CHANGED';
	readonly entityId: number;
	readonly flag:
		| 'DIVINE_SHIELD'
		| 'STEALTH'
		| 'TAUNT'
		| 'REBORN'
		| 'VENOMOUS'
		| 'WINDFURY';
	readonly enabled: boolean;
}

/**
 * Phase boundary markers. These are great for checkpoint cadence.
 */
export interface PhaseBoundaryEvent extends CombatEventBase {
	readonly type: 'PHASE_BOUNDARY';
	readonly boundary:
		| 'SOC_START'
		| 'SOC_END'
		| 'ATTACK_START'
		| 'ATTACK_END'
		| 'DEATH_BATCH_START'
		| 'DEATH_BATCH_END'
		| 'COMBAT_END';
}

// Union of all supported events
export type CombatEvent =
	| RngEvent
	| AttackDeclaredEvent
	| DamageEvent
	| MinionDiedEvent
	| SpawnedEvent
	| FlagChangedEvent
	| PhaseBoundaryEvent;

// ---------------------------------------------
// CHECKPOINTS
// ---------------------------------------------

/**
 * Checkpoint snapshot.
 * - seq is the last event included in this snapshot (inclusive)
 * - state is a snapshot sufficient to resume deterministic replay
 *
 * IMPORTANT:
 * Your internal engine likely needs more than just "boards".
 * Start with this spectator-friendly snapshot, but plan to add internal bits later
 * (pending triggers, enchantments, RNG state, etc.).
 */
export interface CombatCheckpoint {
	readonly seq: number;
	readonly reason: 'SOC_END' | 'ATTACK_END' | 'DEATH_BATCH_END' | 'EVERY_N' | 'MANUAL';

	// Optional but highly recommended for fast equivalence checks
	readonly stateHash?: string;

	// Minimal spectator-facing snapshot (what your current GameAction carries)
	readonly snapshot: CombatSnapshot;

	// Optional: RNG resume support
	readonly rng?: {
		readonly streams?: readonly {
			readonly stream: 'combat' | 'discover' | 'other';
			readonly index: number;
		}[];
	};
}

/**
 * A "viewer-friendly" snapshot.
 * This mirrors what your GameAction builder is doing today.
 */
export interface CombatSnapshot {
	readonly playerBoard: readonly BoardEntity[];
	readonly playerHand: readonly BoardEntity[];
	readonly playerSecrets: readonly BoardSecret[];
	readonly playerTrinkets: readonly BoardTrinket[];
	readonly opponentBoard: readonly BoardEntity[];
	readonly opponentHand: readonly BoardEntity[];
	readonly opponentSecrets: readonly BoardSecret[];
	readonly opponentTrinkets: readonly BoardTrinket[];

	readonly playerCardId: string;
	readonly playerEntityId: number;
	readonly playerHeroPowerCardId: string;
	readonly playerHeroPowerEntityId: number;
	readonly playerHeroPowerUsed: boolean;
	readonly playerHeroPowers: readonly BgsHeroPower[];
	readonly opponentCardId: string;
	readonly opponentEntityId: number;
	readonly opponentHeroPowerCardId: string;
	readonly opponentHeroPowerEntityId: number;
	readonly opponentHeroPowerUsed: boolean;
	readonly opponentHeroPowers: readonly BgsHeroPower[];

	readonly playerRewardCardId: string;
	readonly playerRewardEntityId: number;
	readonly playerRewardData: number;
	readonly opponentRewardCardId: string;
	readonly opponentRewardEntityId: number;
	readonly opponentRewardData: number;
}

// ---------------------------------------------
// LOGGER INTERFACE
// ---------------------------------------------

/**
 * Sink for logs.
 * You can implement this in your existing spectator.
 */
export interface ICombatLogSink {
	emitEvent(event: CombatEvent): void;
	emitCheckpoint(checkpoint: CombatCheckpoint): void;
}
