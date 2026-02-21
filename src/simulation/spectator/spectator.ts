import { BgsGameState } from '../../bgs-battle-info';
import { BgsPlayerEntity, BoardTrinket } from '../../bgs-player-entity';
import { BoardEntity } from '../../board-entity';
import { BoardSecret } from '../../board-secret';
import { GameAction, buildGameAction } from './game-action';
import { GameSample } from './game-sample';
import { collapseActions } from './spectator-collapse-actions';
import { sanitizeBoard, sanitizeTrinkets } from './spectator-sanitize';
import {
	CHECKPOINT_EVERY_N_EVENTS,
	CheckpointReason,
	CombatPhase,
	MAX_SAMPLES,
	MAX_SAMPLES_HINT,
	SanitizedEntity,
	SpectatorCheckpoint,
	SpectatorEvent,
	SpectatorEventInput,
} from './spectator-types';

// ✅ IMPORTANT: apply-event.ts imports these from './spectator/spectator'
export type { SpectatorCheckpoint, SpectatorEvent, CheckpointReason, CombatPhase } from './spectator-types';

export class Spectator {
	private actionsForCurrentBattle: GameAction[];
	private wonBattles: GameSample[];
	private tiedBattles: GameSample[];
	private lostBattles: GameSample[];

	private seq: number;
	private eventsForCurrentBattle: SpectatorEvent[];
	private checkpointsForCurrentBattle: SpectatorCheckpoint[];

	private lastFriendlyBoard: readonly BoardEntity[] | null;
	private lastOpponentBoard: readonly BoardEntity[] | null;
	private lastFriendlyHero: BgsPlayerEntity | null;
	private lastOpponentHero: BgsPlayerEntity | null;

	constructor(private readonly enabled: boolean) {
		this.actionsForCurrentBattle = [];
		this.wonBattles = [];
		this.tiedBattles = [];
		this.lostBattles = [];

		this.seq = 0;
		this.eventsForCurrentBattle = [];
		this.checkpointsForCurrentBattle = [];

		this.lastFriendlyBoard = null;
		this.lastOpponentBoard = null;
		this.lastFriendlyHero = null;
		this.lastOpponentHero = null;
	}

	public prune(): void {
		this.wonBattles = this.wonBattles.slice(0, MAX_SAMPLES_HINT);
		this.lostBattles = this.lostBattles.slice(0, MAX_SAMPLES_HINT);
		this.tiedBattles = this.tiedBattles.slice(0, MAX_SAMPLES_HINT);
	}

	public checkpointNow(reason: CheckpointReason): void {
		if (!this.enabled) return;
		const snapshot = this.buildSnapshotFromLastContext(reason);
		if (!snapshot) return;
		this.addCheckpoint(reason, snapshot);
	}

	public buildOutcomeSamples(gameState: BgsGameState): { won: readonly GameSample[]; lost: readonly GameSample[]; tied: readonly GameSample[] } {
		if (!this.enabled) {
			return { won: [], lost: [], tied: [] };
		}
		return {
			won: this.wonBattles?.map((battle) => this.cleanUpActions(battle, gameState)),
			lost: this.lostBattles?.map((battle) => this.cleanUpActions(battle, gameState)),
			tied: this.tiedBattles?.map((battle) => this.cleanUpActions(battle, gameState)),
		};
	}

	private cleanUpActions(battle: GameSample, gameState: BgsGameState): GameSample {
		const collapsed = collapseActions(this.enabled, (battle as any).actions, sanitizeBoard, sanitizeTrinkets);
		const result: GameSample = {
			...battle,
			actions: collapsed,
			anomalies: gameState.anomalies,
		};

		(result as any).events = (battle as any).events ?? (result as any).events;
		(result as any).checkpoints = (battle as any).checkpoints ?? (result as any).checkpoints;

		return result;
	}

	public commitBattleResult(result: 'won' | 'lost' | 'tied'): void {
		if (!this.enabled) {
			this.resetCurrentBattle();
			return;
		}
		if (
			this.wonBattles.length >= MAX_SAMPLES &&
			this.lostBattles.length >= MAX_SAMPLES &&
			this.tiedBattles.length >= MAX_SAMPLES
		) {
			this.resetCurrentBattle();
			return;
		}

		const actionsForBattle = this.actionsForCurrentBattle;
		const eventsForBattle = this.eventsForCurrentBattle;
		const checkpointsForBattle = this.checkpointsForCurrentBattle;

		this.resetCurrentBattle();

		const battle = {
			actions: actionsForBattle,
			anomalies: [],
			events: eventsForBattle,
			checkpoints: checkpointsForBattle,
		} as unknown as GameSample;

		switch (result) {
			case 'won':
				this.wonBattles.push(battle);
				break;
			case 'lost':
				this.lostBattles.push(battle);
				break;
			case 'tied':
				this.tiedBattles.push(battle);
				break;
		}
	}

	public registerStartOfCombat(
		friendlyBoard: readonly BoardEntity[],
		opponentBoard: readonly BoardEntity[],
		friendlyHero: BgsPlayerEntity,
		opponentHero: BgsPlayerEntity,
	): void {
		if (!this.enabled) return;

		this.setLastContext(friendlyBoard, opponentBoard, friendlyHero, opponentHero);

		this.emitEvent({ type: 'start-of-combat', phase: 'START_OF_COMBAT' });

		const action = buildGameAction(friendlyHero, opponentHero, {
			type: 'start-of-combat',
			playerBoard: sanitizeBoard(friendlyBoard),
			opponentBoard: sanitizeBoard(opponentBoard),
			playerHand: sanitizeBoard(friendlyHero?.hand),
			opponentHand: sanitizeBoard(opponentHero?.hand),
		});
		this.addAction(action);
		this.addCheckpoint('SOC_START', action);
	}

	public registerAttack(
		attackingEntity: BoardEntity,
		defendingEntity: BoardEntity,
		attackingBoard: readonly BoardEntity[],
		defendingBoard: readonly BoardEntity[],
		attackingBoardHero: BgsPlayerEntity,
		defendingBoardHero: BgsPlayerEntity,
	): void {
		if (!this.enabled) return;

		const isAttackerFriendly = attackingBoard.every((e) => e.friendly);
		const playerHero = isAttackerFriendly ? attackingBoardHero : defendingBoardHero;
		const opponentHero = isAttackerFriendly ? defendingBoardHero : attackingBoardHero;
		const friendlyBoard = isAttackerFriendly ? attackingBoard : defendingBoard;
		const opponentBoard = isAttackerFriendly ? defendingBoard : attackingBoard;

		this.setLastContext(friendlyBoard, opponentBoard, playerHero, opponentHero);

		this.emitEvent({
			type: 'attack',
			phase: 'ATTACK',
			attackerEntityId: attackingEntity.entityId,
			defenderEntityId: defendingEntity.entityId,
		});

		const action = buildGameAction(playerHero, opponentHero, {
			type: 'attack',
			attackerEntityId: attackingEntity.entityId,
			defenderEntityId: defendingEntity.entityId,
			playerBoard: sanitizeBoard(friendlyBoard),
			opponentBoard: sanitizeBoard(opponentBoard),
			playerHand: sanitizeBoard(playerHero?.hand),
			opponentHand: sanitizeBoard(opponentHero?.hand),
		});
		this.addAction(action);
	}

	public registerPlayerAttack(friendlyBoard: readonly BoardEntity[], opponentBoard: readonly BoardEntity[], damage: number): void {
		if (!this.enabled) return;

		this.setLastContext(friendlyBoard, opponentBoard, this.lastFriendlyHero, this.lastOpponentHero);

		this.emitEvent({ type: 'player-attack', phase: 'END_OF_COMBAT', damage });

		const action = buildGameAction(this.lastFriendlyHero, this.lastOpponentHero, {
			type: 'player-attack',
			damage,
			playerBoard: sanitizeBoard(friendlyBoard),
			opponentBoard: sanitizeBoard(opponentBoard),
		});
		this.addAction(action);
	}

	public registerOpponentAttack(friendlyBoard: readonly BoardEntity[], opponentBoard: readonly BoardEntity[], damage: number): void {
		if (!this.enabled) return;

		this.setLastContext(friendlyBoard, opponentBoard, this.lastFriendlyHero, this.lastOpponentHero);

		this.emitEvent({ type: 'opponent-attack', phase: 'END_OF_COMBAT', damage });

		const action = buildGameAction(this.lastFriendlyHero, this.lastOpponentHero, {
			type: 'opponent-attack',
			damage,
			playerBoard: sanitizeBoard(friendlyBoard),
			opponentBoard: sanitizeBoard(opponentBoard),
		});
		this.addAction(action);
	}

	public registerDamageDealt(
		damagingEntity: BoardEntity,
		damagedEntity: BoardEntity,
		damageTaken: number,
		damagedEntityBoard: BoardEntity[],
	): void {
		if (!this.enabled) return;

		const friendlyBoard = damagedEntityBoard.every((e) => e.friendly) ? damagedEntityBoard : null;
		const opponentBoard = damagedEntityBoard.every((e) => !e.friendly) ? damagedEntityBoard : null;

		if (friendlyBoard || opponentBoard) {
			this.setLastContext(
				friendlyBoard ?? this.lastFriendlyBoard,
				opponentBoard ?? this.lastOpponentBoard,
				this.lastFriendlyHero,
				this.lastOpponentHero,
			);
		}

		this.emitEvent({
			type: 'damage',
			phase: 'ATTACK',
			sourceEntityId: damagingEntity.entityId,
			targetEntityId: damagedEntity.entityId,
			damage: damageTaken,
			kind: 'combat',
		});

		const action = buildGameAction(this.lastFriendlyHero, this.lastOpponentHero, {
			type: 'damage',
			damages: [
				{
					sourceEntityId: damagingEntity.entityId,
					targetEntityId: damagedEntity.entityId,
					damage: damageTaken,
				},
			],
			playerBoard: sanitizeBoard(friendlyBoard ?? undefined),
			opponentBoard: sanitizeBoard(opponentBoard ?? undefined),
		});
		this.addAction(action);
	}

	public registerPowerTarget(
		sourceEntity: BoardEntity | BgsPlayerEntity | BoardSecret | BoardTrinket,
		targetEntity: BoardEntity | BgsPlayerEntity,
		targetBoard: BoardEntity[],
		hero1: BgsPlayerEntity,
		hero2: BgsPlayerEntity,
	): void {
		if (!this.enabled) return;
		if (!targetEntity) return;

		const friendlyBoard = targetBoard?.every((e) => e.friendly) ? targetBoard : null;
		const opponentBoard = targetBoard?.every((e) => !e.friendly) ? targetBoard : null;
		const friendlyHero = hero1?.friendly ? hero1 : hero2?.friendly ? hero2 : null;
		const opponentHero = hero1?.friendly ? hero2 : hero2?.friendly ? hero1 : null;

		this.setLastContext(
			friendlyBoard ?? this.lastFriendlyBoard,
			opponentBoard ?? this.lastOpponentBoard,
			friendlyHero ?? this.lastFriendlyHero,
			opponentHero ?? this.lastOpponentHero,
		);

		this.emitEvent({
			type: 'power-target',
			phase: 'ATTACK',
			sourceEntityId: sourceEntity.entityId,
			targetEntityIds: [targetEntity.entityId],
		});

		// Optional thin upsert
		const after = targetBoard?.find((x) => x.entityId === targetEntity.entityId);
		if (after) {
			const ent = (sanitizeBoard([after]) as SanitizedEntity[])[0];
			this.emitEvent({ type: 'entity-upsert', phase: 'ATTACK', entity: ent });
		}

		const action = buildGameAction(friendlyHero, opponentHero, {
			type: 'power-target',
			sourceEntityId: sourceEntity.entityId,
			targetEntityIds: [targetEntity.entityId],
			playerBoard: sanitizeBoard(friendlyBoard ?? undefined),
			opponentBoard: sanitizeBoard(opponentBoard ?? undefined),
			playerHand: sanitizeBoard(friendlyHero?.hand),
			opponentHand: sanitizeBoard(opponentHero?.hand),
		});
		this.addAction(action);
	}

	public registerPowerTargets(
		sourceEntity: BoardEntity | BgsPlayerEntity | BoardSecret | BoardTrinket,
		targetEntities: (BoardEntity | BgsPlayerEntity)[],
		targetBoard: BoardEntity[],
		hero1: BgsPlayerEntity,
		hero2: BgsPlayerEntity,
	): void {
		if (!this.enabled) return;
		if (!targetEntities?.length) return;

		const friendlyBoard = targetBoard?.every((e) => e.friendly) ? targetBoard : null;
		const opponentBoard = targetBoard?.every((e) => !e.friendly) ? targetBoard : null;
		const friendlyHero = hero1?.friendly ? hero1 : hero2?.friendly ? hero2 : null;
		const opponentHero = hero1?.friendly ? hero2 : hero2?.friendly ? hero1 : null;

		this.setLastContext(
			friendlyBoard ?? this.lastFriendlyBoard,
			opponentBoard ?? this.lastOpponentBoard,
			friendlyHero ?? this.lastFriendlyHero,
			opponentHero ?? this.lastOpponentHero,
		);

		const ids = targetEntities.map((e) => e.entityId);

		this.emitEvent({ type: 'power-target', phase: 'ATTACK', sourceEntityId: sourceEntity.entityId, targetEntityIds: ids });

		for (const id of ids) {
			const after = targetBoard?.find((x) => x.entityId === id);
			if (!after) continue;
			const ent = (sanitizeBoard([after]) as SanitizedEntity[])[0];
			this.emitEvent({ type: 'entity-upsert', phase: 'ATTACK', entity: ent });
		}

		const action = buildGameAction(friendlyHero, opponentHero, {
			type: 'power-target',
			sourceEntityId: sourceEntity.entityId,
			targetEntityIds: ids,
			playerBoard: sanitizeBoard(friendlyBoard ?? undefined),
			opponentBoard: sanitizeBoard(opponentBoard ?? undefined),
			playerHand: sanitizeBoard(friendlyHero?.hand),
			opponentHand: sanitizeBoard(opponentHero?.hand),
		});
		this.addAction(action);
	}

	public registerMinionsSpawn(
		sourceEntity: BoardEntity | BgsPlayerEntity | BoardTrinket,
		boardOnWhichToSpawn: BoardEntity[],
		spawnedEntities: readonly BoardEntity[],
	): void {
		if (!this.enabled) return;
		if (!spawnedEntities?.length) return;

		const friendlyBoard = boardOnWhichToSpawn.every((e) => e.friendly) ? boardOnWhichToSpawn : null;
		const opponentBoard = boardOnWhichToSpawn.every((e) => !e.friendly) ? boardOnWhichToSpawn : null;

		this.setLastContext(
			friendlyBoard ?? this.lastFriendlyBoard,
			opponentBoard ?? this.lastOpponentBoard,
			this.lastFriendlyHero,
			this.lastOpponentHero,
		);

		const spawnedSan = sanitizeBoard(spawnedEntities) as SanitizedEntity[];
		const insertIndexes = spawnedSan.map((s) => boardOnWhichToSpawn.findIndex((b) => b.entityId === s.entityId));

		this.emitEvent({
			type: 'spawn',
			phase: 'DEATHS',
			sourceEntityId: sourceEntity?.entityId,
			spawned: spawnedSan,
			insertIndexes: insertIndexes?.some((i) => i >= 0) ? insertIndexes : undefined,
		});

		const action = buildGameAction(this.lastFriendlyHero, this.lastOpponentHero, {
			type: 'spawn',
			spawns: sanitizeBoard(spawnedEntities),
			sourceEntityId: sourceEntity?.entityId,
			playerBoard: sanitizeBoard(friendlyBoard ?? undefined),
			opponentBoard: sanitizeBoard(opponentBoard ?? undefined),
		});
		this.addAction(action);
	}

	public registerDeadEntities(
		deadMinionIndexes1: number[],
		deadEntities1: BoardEntity[],
		board1: BoardEntity[],
		deadMinionIndexes2: number[],
		deadEntities2: BoardEntity[],
		board2: BoardEntity[],
	): void {
		if (!this.enabled) return;

		const deaths = [...(deadEntities1 || []), ...(deadEntities2 || [])];
		if (!deaths?.length) return;

		const b1Friendly = board1?.every((e) => e.friendly);
		const b2Friendly = board2?.every((e) => e.friendly);
		const b1Opponent = board1?.every((e) => !e.friendly);
		const b2Opponent = board2?.every((e) => !e.friendly);
		const friendlyBoard = b1Friendly ? board1 : b2Friendly ? board2 : null;
		const opponentBoard = b1Opponent ? board1 : b2Opponent ? board2 : null;

		this.setLastContext(
			friendlyBoard ?? this.lastFriendlyBoard,
			opponentBoard ?? this.lastOpponentBoard,
			this.lastFriendlyHero,
			this.lastOpponentHero,
		);

		const positions = [
			...(deadMinionIndexes1 || []).map((i) => board1.length - i),
			...(deadMinionIndexes2 || []).map((i) => board2.length - i),
		];

		this.emitEvent({
			type: 'minion-death',
			phase: 'DEATHS',
			deadEntityIds: deaths.map((d) => d.entityId),
			deadMinionsPositionsOnBoard: positions,
		});

		const action = buildGameAction(this.lastFriendlyHero, this.lastOpponentHero, {
			type: 'minion-death',
			deaths: sanitizeBoard(deaths),
			deadMinionsPositionsOnBoard: positions,
			playerBoard: sanitizeBoard(friendlyBoard ?? undefined),
			opponentBoard: sanitizeBoard(opponentBoard ?? undefined),
		});
		this.addAction(action);
	}

	private addAction(action: GameAction) {
		(action as any).seq = this.seq;
		this.actionsForCurrentBattle.push(action);
	}

	private nextSeq(): number {
		return ++this.seq;
	}

	private emitEvent(event: SpectatorEventInput): void {
		if (!this.enabled) return;

		const withSeq: SpectatorEvent = { seq: this.nextSeq(), ...event } as SpectatorEvent;
		this.eventsForCurrentBattle.push(withSeq);

		if (CHECKPOINT_EVERY_N_EVENTS > 0 && this.seq % CHECKPOINT_EVERY_N_EVENTS === 0) {
			const snapshot = this.buildSnapshotFromLastContext('EVERY_N');
			if (snapshot) this.addCheckpoint('EVERY_N', snapshot);
		}
	}

	private addCheckpoint(reason: CheckpointReason, snapshot: GameAction): void {
		this.checkpointsForCurrentBattle.push({ seq: this.seq, reason, snapshot });
	}

	private setLastContext(
		friendlyBoard: readonly BoardEntity[] | null | undefined,
		opponentBoard: readonly BoardEntity[] | null | undefined,
		friendlyHero: BgsPlayerEntity | null | undefined,
		opponentHero: BgsPlayerEntity | null | undefined,
	): void {
		this.lastFriendlyBoard = friendlyBoard ?? this.lastFriendlyBoard;
		this.lastOpponentBoard = opponentBoard ?? this.lastOpponentBoard;
		this.lastFriendlyHero = friendlyHero ?? this.lastFriendlyHero;
		this.lastOpponentHero = opponentHero ?? this.lastOpponentHero;
	}

	private buildSnapshotFromLastContext(reason: CheckpointReason): GameAction | null {
		if (!this.lastFriendlyBoard && !this.lastOpponentBoard) return null;

		const snapshot = buildGameAction(this.lastFriendlyHero, this.lastOpponentHero, {
			type: 'start-of-combat',
			playerBoard: sanitizeBoard(this.lastFriendlyBoard ?? undefined),
			opponentBoard: sanitizeBoard(this.lastOpponentBoard ?? undefined),
			playerHand: sanitizeBoard(this.lastFriendlyHero?.hand ?? undefined),
			opponentHand: sanitizeBoard(this.lastOpponentHero?.hand ?? undefined),
		});

		(snapshot as any).checkpointReason = reason;
		return snapshot;
	}

	private resetCurrentBattle(): void {
		this.actionsForCurrentBattle = [];
		this.eventsForCurrentBattle = [];
		this.checkpointsForCurrentBattle = [];
		this.seq = 0;
	}
}
