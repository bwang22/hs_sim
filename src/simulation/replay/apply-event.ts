// src/simulation/replay/apply-event.ts
import type { GameAction } from '../spectator/game-action';
import type { SpectatorEvent } from '../spectator/spectator';
import type { SanitizedEntity } from '../spectator/spectator-types';

export type CombatEvent = SpectatorEvent;

/**
 * Minimal state needed to replay combat deterministically from checkpoints + events.
 * Keep it small and serializable.
 */
export interface CombatReplayState {
	seq: number;

	playerBoard: SanitizedEntity[];
	opponentBoard: SanitizedEntity[];

	// Optional bookkeeping / debugging:
	lastAttack?: { attackerEntityId: number; defenderEntityId: number };
	lastPowerTarget?: { sourceEntityId: number; targetEntityIds: readonly number[] };

	// End-of-combat info (optional)
	endDamage?: { toPlayer?: number; toOpponent?: number };
}

/**
 * Create a replay state from a checkpoint snapshot (fat snapshot from GameAction).
 * Your checkpoint snapshot is currently stored as a GameAction of type 'start-of-combat'.
 */
export function initReplayStateFromCheckpoint(snapshot: GameAction, seq: number = (snapshot as any)?.seq ?? 0): CombatReplayState {
	return {
		seq,
		playerBoard: (snapshot.playerBoard ?? []) as unknown as SanitizedEntity[],
		opponentBoard: (snapshot.opponentBoard ?? []) as unknown as SanitizedEntity[],
	};
}

/**
 * Overwrite an existing state from a checkpoint snapshot.
 * Useful when seeking or when you want to jump to the closest checkpoint then replay forward.
 */
export function applyCheckpoint(state: CombatReplayState, checkpoint: { seq: number; snapshot: GameAction }): void {
	state.seq = checkpoint.seq;
	state.playerBoard = (checkpoint.snapshot.playerBoard ?? []) as unknown as SanitizedEntity[];
	state.opponentBoard = (checkpoint.snapshot.opponentBoard ?? []) as unknown as SanitizedEntity[];
	state.lastAttack = undefined;
	state.lastPowerTarget = undefined;
	state.endDamage = undefined;
}

/**
 * Apply a single event to the replay state.
 * This is the Reducer.
 */
export function applyEvent(state: CombatReplayState, event: CombatEvent): void {
	// Keep seq monotonic (events are already ordered, but this guards against misuse)
	state.seq = event.seq;

	switch (event.type) {
		case 'start-of-combat': {
			// Boundary marker. State comes from checkpoint; event itself carries no board in the thin stream.
			state.lastAttack = undefined;
			state.lastPowerTarget = undefined;
			state.endDamage = undefined;
			return;
		}

		case 'attack': {
			state.lastAttack = { attackerEntityId: event.attackerEntityId, defenderEntityId: event.defenderEntityId };
			return;
		}

		case 'damage': {
			// Find target on either board and subtract.
			const target = findEntity(state, event.targetEntityId);
			if (target) {
				target.health = Math.max(0, (target.health ?? 0) - (event.damage ?? 0));
				// We intentionally do NOT remove entities here. That’s what 'minion-death' is for.
			}
			return;
		}

		case 'minion-death': {
			// Remove dead entities from both boards (by id).
			const dead = new Set(event.deadEntityIds ?? []);
			if (dead.size === 0) return;

			state.playerBoard = state.playerBoard.filter((e) => !dead.has(e.entityId));
			state.opponentBoard = state.opponentBoard.filter((e) => !dead.has(e.entityId));
			return;
		}

		case 'spawn': {
			// Insert spawned entities into the correct board.
			// We use entity.friendly to choose board, and insertIndexes when available.
			const spawned = event.spawned ?? [];
			if (!spawned.length) return;

			// We assume all spawned in a single event are on the same side (common), but we support mixed.
			for (let i = 0; i < spawned.length; i++) {
				const ent = spawned[i];
				const idx = event.insertIndexes?.[i];

				const board = ent.friendly ? state.playerBoard : state.opponentBoard;

				// If entity already exists (rare, but can happen with weird logs), overwrite it.
				const existingIndex = board.findIndex((b) => b.entityId === ent.entityId);
				if (existingIndex >= 0) {
					board[existingIndex] = { ...board[existingIndex], ...ent };
					continue;
				}

				// Insert at index if valid; else append.
				if (typeof idx === 'number' && idx >= 0 && idx <= board.length) {
					board.splice(idx, 0, ent);
				} else {
					board.push(ent);
				}
			}
			return;
		}

		case 'entity-upsert': {
			// Merge updated stats/keywords. If missing, insert onto its side.
			const ent = event.entity;
			const board = ent.friendly ? state.playerBoard : state.opponentBoard;
			const i = board.findIndex((b) => b.entityId === ent.entityId);
			if (i >= 0) {
				board[i] = { ...board[i], ...ent };
			} else {
				board.push(ent);
			}
			return;
		}

		case 'power-target': {
			// No guaranteed state change, but good for replay UI/debug.
			state.lastPowerTarget = { sourceEntityId: event.sourceEntityId, targetEntityIds: event.targetEntityIds };
			return;
		}

		case 'player-attack': {
			// End-of-combat damage to opponent hero from player side (or however you interpret it)
			state.endDamage = { ...(state.endDamage ?? {}), toOpponent: event.damage };
			return;
		}

		case 'opponent-attack': {
			state.endDamage = { ...(state.endDamage ?? {}), toPlayer: event.damage };
			return;
		}

		default: {
			// Exhaustiveness guard
			const _never: never = event;
			return _never;
		}
	}
}

/**
 * Replay from a checkpoint up to (and including) a target seq.
 * Assumes `events` are in ascending seq order.
 */

export function replayToSeq(
	checkpoint: { seq: number; snapshot: GameAction },
	events: readonly CombatEvent[],
	targetSeq: number,
	opts?: {
		onStep?: (info: {
			event: CombatEvent;
			state: CombatReplayState;
			// handy snapshots (cheap, small)
			playerBoard: string[];
			opponentBoard: string[];
		}) => void;
	},
): CombatReplayState {
	const state = initReplayStateFromCheckpoint(checkpoint.snapshot, checkpoint.seq);

	for (const ev of events) {
		if (ev.seq <= checkpoint.seq) continue;
		if (ev.seq > targetSeq) break;

		applyEvent(state, ev);

		opts?.onStep?.({
			event: ev,
			state,
			playerBoard: state.playerBoard.map((e) => `${e.entityId}:${e.cardId} ${e.attack}/${e.health}`),
			opponentBoard: state.opponentBoard.map((e) => `${e.entityId}:${e.cardId} ${e.attack}/${e.health}`),
		});
	}

	return state;
}


// ------------------------
// Internals
// ------------------------

function findEntity(state: CombatReplayState, entityId: number): SanitizedEntity | null {
	for (const e of state.playerBoard) {
		if (e.entityId === entityId) return e;
	}
	for (const e of state.opponentBoard) {
		if (e.entityId === entityId) return e;
	}
	return null;
}
