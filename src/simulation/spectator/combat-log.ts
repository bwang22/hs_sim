import { GameAction } from './game-action';
import { BoardEntity } from '../../board-entity';

/**
 * Monotonic sequence number for the log.
 * Every Event and Checkpoint is anchored to a seq.
 */
export type CombatSeq = number;

export type CombatPhase = 'START_OF_COMBAT' | 'ATTACK' | 'DEATHS' | 'END_OF_COMBAT';

export type CheckpointReason = 'SOC_START' | 'SOC_END' | 'ATTACK_END' | 'DEATH_BATCH_END' | 'EVERY_N' | 'MANUAL';

/**
 * Optional: enough information to resume RNG at a checkpoint.
 * If your RNG is counter-based, store that counter here.
 * If your RNG has multiple streams, track each stream’s cursor.
 */
export interface RngCursor {
	readonly streams: readonly {
		readonly stream: 'combat' | 'discover' | 'other';
		readonly index: number;
	}[];
}

/**
 * -------------------------
 * EVENTS (thin, always)
 * -------------------------
 *
 * NOTE: these are "semantic events" emitted by the engine/spectator.
 * They do NOT include full board/hand snapshots.
 */
export interface CombatEventBase {
	readonly seq: CombatSeq;
	readonly type: CombatEventType;
	readonly phase?: CombatPhase;

	/**
	 * Optional causality pointers: "this event happened because of those earlier events".
	 * You can add this later without breaking everything.
	 */
	readonly parents?: readonly CombatSeq[];
}

export type CombatEventType =
	| 'SOC_MARKER'
	| 'ATTACK'
	| 'DAMAGE'
	| 'HERO_DAMAGE'
	| 'POWER_TARGETS'
	| 'SPAWN'
	| 'DEATHS';

/** Start/end markers for phases, useful for checkpointing cadence */
export interface SocMarkerEvent extends CombatEventBase {
	readonly type: 'SOC_MARKER';
	readonly marker: 'SOC_START' | 'SOC_END';
}

export interface AttackEvent extends CombatEventBase {
	readonly type: 'ATTACK';
	readonly attackerEntityId: number;
	readonly defenderEntityId: number;
	/**
	 * Optional: helpful for UI without state snapshots
	 * (can be derived later if you prefer)
	 */
	readonly attackerFriendly?: boolean;
}

export interface DamageEvent extends CombatEventBase {
	readonly type: 'DAMAGE';
	readonly sourceEntityId?: number;
	readonly targetEntityId: number;
	readonly amount: number;
	readonly kind: 'combat' | 'effect';
}

export interface HeroDamageEvent extends CombatEventBase {
	readonly type: 'HERO_DAMAGE';
	readonly to: 'player' | 'opponent';
	readonly amount: number;
}

export interface PowerTargetsEvent extends CombatEventBase {
	readonly type: 'POWER_TARGETS';
	readonly sourceEntityId: number;
	readonly targetEntityIds: readonly number[];
}

export interface SpawnEvent extends CombatEventBase {
	readonly type: 'SPAWN';
	readonly sourceEntityId?: number;
	/**
	 * Minimal spawned identity. If your replayer runs the engine, this can be just entityId+cardId.
	 * If you want a patch-style replayer later, include pos/atk/hp here.
	 */
	readonly spawned: readonly Pick<BoardEntity, 'entityId' | 'cardId' | 'friendly'>[];
}

export interface DeathsEvent extends CombatEventBase {
	readonly type: 'DEATHS';
	readonly entityIds: readonly number[];
	readonly deadMinionsPositionsOnBoard?: readonly number[];
}

export type CombatEvent =
	| SocMarkerEvent
	| AttackEvent
	| DamageEvent
	| HeroDamageEvent
	| PowerTargetsEvent
	| SpawnEvent
	| DeathsEvent;

/**
 * -------------------------
 * CHECKPOINTS (thick, periodic)
 * -------------------------
 *
 * We reuse your existing GameAction snapshot machinery, because buildGameAction()
 * already knows how to package hero powers, trinkets, rewards, secrets, etc.
 */
export interface CombatCheckpoint {
	readonly seq: CombatSeq;
	readonly reason: CheckpointReason;

	/**
	 * Snapshot for viewer/debugging. Typically a GameAction whose fields include
	 * playerBoard/opponentBoard/hands/secrets/trinkets + hero metadata.
	 */
	readonly snapshot: GameAction;

	/**
	 * Optional: quick verification to detect divergence.
	 * (You can add hashing later.)
	 */
	readonly stateHash?: string;

	/**
	 * Optional: resume RNG from here without replaying from seq 0.
	 */
	readonly rng?: RngCursor;
}

/**
 * Full log for one combat.
 */
export interface CombatLog {
	readonly version: '1.0';
	readonly seed: string | number;
	readonly events: readonly CombatEvent[];
	readonly checkpoints: readonly CombatCheckpoint[];
}

/**
 * Sink/recorder interface.
 * Spectator can implement this (or wrap it).
 */
export interface ICombatRecorder {
	emitEvent(event: Omit<CombatEventBase, 'seq'> & Partial<Pick<CombatEventBase, 'seq'>> & any): void;
	emitCheckpoint(checkpoint: Omit<CombatCheckpoint, 'seq'> & Partial<Pick<CombatCheckpoint, 'seq'>>): void;
}
