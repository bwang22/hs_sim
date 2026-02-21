import { BoardEntity } from '../../board-entity';
import { GameAction } from './game-action';

export const MAX_SAMPLES = 1;

// Safety valve: every N emitted events, auto-create a checkpoint snapshot (if we have enough context)
export const CHECKPOINT_EVERY_N_EVENTS = 200;

export type CombatPhase = 'START_OF_COMBAT' | 'ATTACK' | 'DEATHS' | 'END_OF_COMBAT';

export type CheckpointReason = 'SOC_START' | 'SOC_END' | 'ATTACK_END' | 'DEATH_BATCH_END' | 'EVERY_N' | 'MANUAL';

// What we consider "replay-relevant" for entities
export type SanitizedEntity = Pick<
	BoardEntity,
	| 'entityId'
	| 'cardId'
	| 'friendly'
	| 'attack'
	| 'health'
	| 'maxHealth'
	| 'taunt'
	| 'divineShield'
	| 'poisonous'
	| 'venomous'
	| 'reborn'
	| 'windfury'
	| 'stealth'
>;

export type SpectatorEvent =
	| {
			seq: number;
			type: 'start-of-combat';
			phase: 'START_OF_COMBAT';
	  }
	| {
			seq: number;
			type: 'attack';
			phase: 'ATTACK';
			attackerEntityId: number;
			defenderEntityId: number;
	  }
	| {
			seq: number;
			type: 'damage';
			phase: 'ATTACK' | 'DEATHS';
			sourceEntityId?: number;
			targetEntityId: number;
			damage: number;
			kind: 'combat' | 'effect';
	  }
	| {
			seq: number;
			type: 'player-attack';
			phase: 'END_OF_COMBAT';
			damage: number;
	  }
	| {
			seq: number;
			type: 'opponent-attack';
			phase: 'END_OF_COMBAT';
			damage: number;
	  }
	| {
			seq: number;
			type: 'power-target';
			phase: 'START_OF_COMBAT' | 'ATTACK' | 'DEATHS';
			sourceEntityId: number;
			targetEntityIds: readonly number[];
	  }
	| {
			seq: number;
			type: 'entity-upsert';
			phase: 'START_OF_COMBAT' | 'ATTACK' | 'DEATHS';
			entity: SanitizedEntity;
	  }
	| {
			seq: number;
			type: 'spawn';
			phase: 'DEATHS';
			sourceEntityId?: number;
			spawned: readonly SanitizedEntity[];
			insertIndexes?: readonly number[];
	  }
	| {
			seq: number;
			type: 'minion-death';
			phase: 'DEATHS';
			deadEntityIds: readonly number[];
			deadMinionsPositionsOnBoard?: readonly number[];
	  };

export interface SpectatorCheckpoint {
	seq: number;
	reason: CheckpointReason;
	snapshot: GameAction; // full snapshot event (new game-action)
}

// distributive omit over union
export type DistributiveOmit<T, K extends PropertyKey> = T extends any ? Omit<T, K> : never;
export type SpectatorEventInput = DistributiveOmit<SpectatorEvent, 'seq'>;

export const MAX_SAMPLES_HINT = MAX_SAMPLES;
