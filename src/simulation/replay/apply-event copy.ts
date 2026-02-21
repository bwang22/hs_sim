// src/simulation/apply-event.ts
import type { GameAction } from '../spectator/game-action';
import type { SpectatorCheckpoint, SpectatorEvent, CheckpointReason, CombatPhase } from '../spectator/spectator';

// ------------------------------
// Replay-state (viewer-grade)
// ------------------------------

export type Side = 'player' | 'opponent';
export type Zone = 'board' | 'hand';

export interface ReplayEntity {
	entityId: number;
	cardId: string;
	friendly: boolean;

	// Viewer-visible stats (optional because your current SPAWN event doesn't carry them)
	attack?: number;
	health?: number;
	maxHealth?: number;

	taunt?: boolean;
	divineShield?: boolean;
	poisonous?: boolean;
	venomous?: boolean;
	reborn?: boolean;
	windfury?: boolean;
	stealth?: boolean;
}

export interface ReplayState {
	seq: number;
	phase: CombatPhase;

	playerBoard: ReplayEntity[];
	opponentBoard: ReplayEntity[];
	playerHand: ReplayEntity[];
	opponentHand: ReplayEntity[];

	// Optional meta
	lastAttack?: { attackerEntityId: number; defenderEntityId: number };
	lastPowerTarget?: { sourceEntityId: number; targetEntityIds: readonly number[] };

	// End-of-combat pings
	playerHeroDamage?: number;
	opponentHeroDamage?: number;
}

/**
 * Build a replay state from a checkpoint snapshot (your existing GameAction).
 * This is your "full state" anchor.
 */
export function stateFromCheckpoint(snapshot: GameAction, seq: number, phase: CombatPhase = 'START_OF_COMBAT'): ReplayState {
	return {
		seq,
		phase,

		playerBoard: cloneEntities(snapshot.playerBoard),
		opponentBoard: cloneEntities(snapshot.opponentBoard),
		playerHand: cloneEntities(snapshot.playerHand),
		opponentHand: cloneEntities(snapshot.opponentHand),
	};
}

function cloneEntities(list: readonly any[] | null | undefined): ReplayEntity[] {
	if (!list?.length) return [];
	return list.map((e) => ({
		entityId: e.entityId,
		cardId: e.cardId,
		friendly: e.friendly,

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
	}));
}

// ------------------------------
// The Reducer
// ------------------------------

export function applyEvent(state: ReplayState, event: SpectatorEvent): void {
	state.seq = event.seq;

	switch (event.type) {
		case 'start-of-combat': {
			state.phase = 'START_OF_COMBAT';
			state.lastAttack = undefined;
			state.lastPowerTarget = undefined;
			state.playerHeroDamage = undefined;
			state.opponentHeroDamage = undefined;
			return;
		}

		case 'attack': {
			state.phase = 'ATTACK';
			state.lastAttack = {
				attackerEntityId: event.attackerEntityId,
				defenderEntityId: event.defenderEntityId,
			};
			return;
		}

		case 'damage': {
			// Damage can hit minions (board/hand) or heroes (not represented as entities here).
			// If target isn't found, we ignore it.
			state.phase = event.phase;
			applyDamage(state, event.targetEntityId, event.damage);
			return;
		}

		case 'power-target': {
			state.phase = event.phase;
			state.lastPowerTarget = {
				sourceEntityId: event.sourceEntityId,
				targetEntityIds: event.targetEntityIds,
			};
			return;
		}

		case 'spawn': {
			state.phase = 'DEATHS';

			// Your current spawn event does NOT include insertion position or stats.
			// We add them at the end of the relevant board by 'friendly' flag.
			for (const s of event.spawned ?? []) {
				const ent: ReplayEntity = {
					entityId: s.entityId,
					cardId: s.cardId,
					friendly: s.friendly,
				};
				(s.friendly ? state.playerBoard : state.opponentBoard).push(ent);
			}
			return;
		}

		case 'minion-death': {
			state.phase = 'DEATHS';
			removeEntities(state, event.deadEntityIds);
			return;
		}

		case 'player-attack': {
			state.phase = 'END_OF_COMBAT';
			state.playerHeroDamage = (state.playerHeroDamage ?? 0) + event.damage;
			return;
		}

		case 'opponent-attack': {
			state.phase = 'END_OF_COMBAT';
			state.opponentHeroDamage = (state.opponentHeroDamage ?? 0) + event.damage;
			return;
		}

        case 'entity-upsert': {
        // Update or insert entity stats/keywords so the replay state matches emitted events.
        // We don’t move it on the board here (spawn/death handle board membership and placement).
        const e = event.entity;

        const upsertInBoard = (board: any[]) => {
            if (!board) return;
            const idx = board.findIndex((x) => x?.entityId === e.entityId);
            if (idx >= 0) {
            board[idx] = { ...board[idx], ...e };
            }
        };

        // Most replay states have playerBoard/opponentBoard arrays (or similar).
        // Update whichever side contains the entity.
        upsertInBoard((state as any).playerBoard);
        upsertInBoard((state as any).opponentBoard);

        // If you also track “entities by id” / lookup maps, update them too
        const entities = (state as any).entitiesById;
        if (entities) {
            entities[e.entityId] = { ...(entities[e.entityId] ?? {}), ...e };
        }

        break;
        }


		default: {
			// Exhaustiveness guard: if you add new event types, TS will force you here if you enable never checks.
			// eslint-disable-next-line @typescript-eslint/no-unused-vars
			const _never: never = event;
			return;
		}
	}
}

// ------------------------------
// Helpers
// ------------------------------

function applyDamage(state: ReplayState, targetEntityId: number, dmg: number): void {
	const target = findEntityById(state, targetEntityId);
	if (!target) return;

	// If we don't know health yet (because of sparse events), we still track "some damage happened"
	if (target.health == null) {
		target.health = undefined;
		return;
	}
	target.health = (target.health ?? 0) - dmg;
}

function removeEntities(state: ReplayState, ids: readonly number[]): void {
	if (!ids?.length) return;

	const kill = new Set(ids);

	state.playerBoard = state.playerBoard.filter((e) => !kill.has(e.entityId));
	state.opponentBoard = state.opponentBoard.filter((e) => !kill.has(e.entityId));
	state.playerHand = state.playerHand.filter((e) => !kill.has(e.entityId));
	state.opponentHand = state.opponentHand.filter((e) => !kill.has(e.entityId));
}

function findEntityById(state: ReplayState, id: number): ReplayEntity | undefined {
	return (
		state.playerBoard.find((e) => e.entityId === id) ??
		state.opponentBoard.find((e) => e.entityId === id) ??
		state.playerHand.find((e) => e.entityId === id) ??
		state.opponentHand.find((e) => e.entityId === id)
	);
}

// ------------------------------
// Reconstruction (checkpoint + replay)
// ------------------------------

/**
 * Reconstruct state at a given seq using checkpoints + events.
 *
 * Preconditions:
 * - checkpoints are sorted by seq ascending
 * - events are sorted by seq ascending
 */
export function reconstructAt(
	checkpoints: readonly SpectatorCheckpoint[],
	events: readonly SpectatorEvent[],
	targetSeq: number,
): ReplayState | null {
	const cp = findLatestCheckpointAtOrBefore(checkpoints, targetSeq);
	if (!cp) return null;

	let state = stateFromCheckpoint(cp.snapshot, cp.seq, phaseFromReason(cp.reason));

	for (const e of events) {
		if (e.seq <= cp.seq) continue;
		if (e.seq > targetSeq) break;
		applyEvent(state, e);
	}

	return state;
}

function findLatestCheckpointAtOrBefore(checkpoints: readonly SpectatorCheckpoint[], seq: number): SpectatorCheckpoint | null {
	let best: SpectatorCheckpoint | null = null;
	for (const c of checkpoints) {
		if (c.seq <= seq) best = c;
		else break;
	}
	return best;
}

function phaseFromReason(reason: CheckpointReason): CombatPhase {
	switch (reason) {
		case 'SOC_START':
			return 'START_OF_COMBAT';
		case 'SOC_END':
		case 'ATTACK_END':
		case 'DEATH_BATCH_END':
		case 'EVERY_N':
		case 'MANUAL':
		default:
			return 'ATTACK';
	}
}
