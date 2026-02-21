import { BgsGameState } from '../../bgs-battle-info';
import { BgsPlayerEntity, BoardTrinket } from '../../bgs-player-entity';
import { BoardEntity } from '../../board-entity';
import { BoardSecret } from '../../board-secret';
import { GameAction, buildGameAction } from './game-action';
import { GameSample } from './game-sample';

const MAX_SAMPLES = 1;

// Safety valve: every N emitted events, auto-create a checkpoint snapshot (if we have enough context)
const CHECKPOINT_EVERY_N_EVENTS = 200;

// ------------------------------
// Events + Checkpoints (new)
// ------------------------------

export type CombatPhase = 'START_OF_COMBAT' | 'ATTACK' | 'DEATHS' | 'END_OF_COMBAT';

export type CheckpointReason = 'SOC_START' | 'SOC_END' | 'ATTACK_END' | 'DEATH_BATCH_END' | 'EVERY_N' | 'MANUAL';

// What we consider "replay-relevant" for entities (enough for most combat replays)
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
			// NOTE: Now includes full sanitized stats + keywords, so apply-event can reconstruct reliably
			spawned: readonly SanitizedEntity[];
			// Optional: where the entities ended up on that side's board at the moment we logged the event.
			// If omitted or contains -1, replay can fallback to append.
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
	snapshot: GameAction;
	// Optional later: stateHash, rng cursor, etc.
}

const MAX_SAMPLES_HINT = MAX_SAMPLES; // keep lint happy if you ever change MAX_SAMPLES usage

// ---- FIX: distributive omit over union ----
type DistributiveOmit<T, K extends PropertyKey> = T extends any ? Omit<T, K> : never;
type SpectatorEventInput = DistributiveOmit<SpectatorEvent, 'seq'>;

export class Spectator {
	private actionsForCurrentBattle: GameAction[];
	private wonBattles: GameSample[];
	private tiedBattles: GameSample[];
	private lostBattles: GameSample[];

	// New: thin event log + periodic snapshots
	private seq: number;
	private eventsForCurrentBattle: SpectatorEvent[];
	private checkpointsForCurrentBattle: SpectatorCheckpoint[];

	// New: last-known context so we can checkpoint on a timer (EVERY_N) without needing simulator changes immediately
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
		// (keeping original behavior)
		this.wonBattles = this.wonBattles.slice(0, MAX_SAMPLES_HINT);
		this.lostBattles = this.lostBattles.slice(0, MAX_SAMPLES_HINT);
		this.tiedBattles = this.tiedBattles.slice(0, MAX_SAMPLES_HINT);
	}

	/**
	 * Optional helper to inspect logs for the current battle (useful while wiring simulator checkpoints).
	 */
	public getCurrentBattleTelemetry(): {
		seq: number;
		events: readonly SpectatorEvent[];
		checkpoints: readonly SpectatorCheckpoint[];
	} {
		return {
			seq: this.seq,
			events: this.eventsForCurrentBattle,
			checkpoints: this.checkpointsForCurrentBattle,
		};
	}

	/**
	 * New: simulator can call this at boundaries (SOC_END, ATTACK_END, DEATH_BATCH_END, MANUAL, etc.).
	 * This does NOT replace existing GameAction actions; it simply adds a proper checkpoint.
	 */
	public checkpointNow(reason: CheckpointReason): void {
		if (!this.enabled) return;

		const snapshot = this.buildSnapshotFromLastContext(reason);
		if (!snapshot) return;

		this.addCheckpoint(reason, snapshot);
	}

	public buildOutcomeSamples(gameState: BgsGameState): {
		won: readonly GameSample[];
		lost: readonly GameSample[];
		tied: readonly GameSample[];
	} {
		if (!this.enabled) {
			return {
				won: [],
				lost: [],
				tied: [],
			};
		}
		return {
			won: this.wonBattles?.map((battle) => this.cleanUpActions(battle, gameState)),
			lost: this.lostBattles?.map((battle) => this.cleanUpActions(battle, gameState)),
			tied: this.tiedBattles?.map((battle) => this.cleanUpActions(battle, gameState)),
		};
	}

	private cleanUpActions(battle: GameSample, gameState: BgsGameState): GameSample {
		const collapsed = this.collapseActions((battle as any).actions);
		const result: GameSample = {
			...battle,
			actions: collapsed,
			anomalies: gameState.anomalies,
		};

		// Preserve extra runtime fields if present (events/checkpoints) without changing GameSample typing
		(result as any).events = (battle as any).events ?? (result as any).events;
		(result as any).checkpoints = (battle as any).checkpoints ?? (result as any).checkpoints;

		return result;
	}

	public commitBattleResult(result: 'won' | 'lost' | 'tied'): void {
		if (!this.enabled) {
			this.actionsForCurrentBattle = [];
			this.eventsForCurrentBattle = [];
			this.checkpointsForCurrentBattle = [];
			this.seq = 0;
			return;
		}
		if (
			this.wonBattles.length >= MAX_SAMPLES &&
			this.lostBattles.length >= MAX_SAMPLES &&
			this.tiedBattles.length >= MAX_SAMPLES
		) {
			this.actionsForCurrentBattle = [];
			this.eventsForCurrentBattle = [];
			this.checkpointsForCurrentBattle = [];
			this.seq = 0;
			return;
		}

		// const actionsForBattle = this.collapseActions(this.actionsForCurrentBattle);
		const actionsForBattle = this.actionsForCurrentBattle;
		const eventsForBattle = this.eventsForCurrentBattle;
		const checkpointsForBattle = this.checkpointsForCurrentBattle;

		this.actionsForCurrentBattle = [];
		this.eventsForCurrentBattle = [];
		this.checkpointsForCurrentBattle = [];
		this.seq = 0;

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

	public registerAttack(
		attackingEntity: BoardEntity,
		defendingEntity: BoardEntity,
		attackingBoard: readonly BoardEntity[],
		defendingBoard: readonly BoardEntity[],
		attackingBoardHero: BgsPlayerEntity,
		defendingBoardHero: BgsPlayerEntity,
	): void {
		if (!this.enabled) {
			return;
		}

		// Determine "player"/"opponent" perspective the same way your viewer expects
		const isAttackerFriendly = attackingBoard.every((entity) => entity.friendly);
		const playerHero = isAttackerFriendly ? attackingBoardHero : defendingBoardHero;
		const opponentHero = isAttackerFriendly ? defendingBoardHero : attackingBoardHero;
		const friendlyBoard = isAttackerFriendly ? attackingBoard : defendingBoard;
		const opponentBoard = isAttackerFriendly ? defendingBoard : attackingBoard;

		// Update last-known context for future checkpoints
		this.setLastContext(friendlyBoard, opponentBoard, playerHero, opponentHero);

		// New: emit thin event
		this.emitEvent({
			type: 'attack',
			phase: 'ATTACK',
			attackerEntityId: attackingEntity.entityId,
			defenderEntityId: defendingEntity.entityId,
		});

		// Keep original behavior for now (so existing viewers/tests don't break):
		const action: GameAction = buildGameAction(playerHero, opponentHero, {
			type: 'attack',
			sourceEntityId: attackingEntity.entityId,
			targetEntityId: defendingEntity.entityId,
			playerBoard: this.sanitize(friendlyBoard),
			playerHand: this.sanitize(playerHero.hand),
			opponentBoard: this.sanitize(opponentBoard),
			opponentHand: this.sanitize(opponentHero.hand),
		});
		this.addAction(action);
	}

	public registerStartOfCombat(
		friendlyBoard: readonly BoardEntity[],
		opponentBoard: readonly BoardEntity[],
		friendlyHero: BgsPlayerEntity,
		opponentHero: BgsPlayerEntity,
	): void {
		if (!this.enabled) {
			return;
		}

		this.setLastContext(friendlyBoard, opponentBoard, friendlyHero, opponentHero);

		// New: emit thin event
		this.emitEvent({
			type: 'start-of-combat',
			phase: 'START_OF_COMBAT',
		});

		// Existing snapshot (this is also a natural checkpoint boundary)
		const action: GameAction = buildGameAction(friendlyHero, opponentHero, {
			type: 'start-of-combat',
			playerBoard: this.sanitize(friendlyBoard),
			opponentBoard: this.sanitize(opponentBoard),
			playerHand: this.sanitize(friendlyHero.hand),
			opponentHand: this.sanitize(opponentHero.hand),
		});
		this.addAction(action);

		// New: record it as a checkpoint too
		this.addCheckpoint('SOC_START', action);
	}

	public registerPlayerAttack(
		friendlyBoard: readonly BoardEntity[],
		opponentBoard: readonly BoardEntity[],
		damage: number,
	): void {
		if (!this.enabled) {
			return;
		}

		this.setLastContext(friendlyBoard, opponentBoard, this.lastFriendlyHero, this.lastOpponentHero);

		this.emitEvent({
			type: 'player-attack',
			phase: 'END_OF_COMBAT',
			damage: damage,
		});

		// keep existing behavior
		const action: GameAction = buildGameAction(null, null, {
			type: 'player-attack',
			playerBoard: this.sanitize(friendlyBoard),
			opponentBoard: this.sanitize(opponentBoard),
			playerHand: null,
			opponentHand: null,
			damages: [
				{
					damage: damage,
				},
			],
		});
		this.addAction(action);
	}

	public registerOpponentAttack(
		friendlyBoard: readonly BoardEntity[],
		opponentBoard: readonly BoardEntity[],
		damage: number,
	): void {
		if (!this.enabled) {
			return;
		}

		this.setLastContext(friendlyBoard, opponentBoard, this.lastFriendlyHero, this.lastOpponentHero);

		this.emitEvent({
			type: 'opponent-attack',
			phase: 'END_OF_COMBAT',
			damage: damage,
		});

		// keep existing behavior
		const action: GameAction = buildGameAction(null, null, {
			type: 'opponent-attack',
			playerBoard: this.sanitize(friendlyBoard),
			opponentBoard: this.sanitize(opponentBoard),
			playerHand: null,
			opponentHand: null,
			damages: [
				{
					damage: damage,
				},
			],
		});
		this.addAction(action);
	}

	public registerDamageDealt(
		damagingEntity: BoardEntity,
		damagedEntity: BoardEntity,
		damageTaken: number,
		damagedEntityBoard: BoardEntity[],
	): void {
		if (!this.enabled) {
			return;
		}

		// Update last-known board context when possible
		const friendlyBoard = damagedEntityBoard.every((entity) => entity.friendly) ? damagedEntityBoard : null;
		const opponentBoard = damagedEntityBoard.every((entity) => !entity.friendly) ? damagedEntityBoard : null;
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

		// keep existing behavior
		const action: GameAction = buildGameAction(null, null, {
			type: 'damage',
			damages: [
				{
					sourceEntityId: damagingEntity.entityId,
					targetEntityId: damagedEntity.entityId,
					damage: damageTaken,
				},
			],
			playerBoard: this.sanitize(friendlyBoard),
			opponentBoard: this.sanitize(opponentBoard),
			playerHand: null,
			opponentHand: null,
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
		if (!this.enabled) {
			return;
		}
		if (!targetEntity) {
			return;
		}

		const friendlyBoard = targetBoard?.every((entity) => entity.friendly) ? targetBoard : null;
		const opponentBoard = targetBoard?.every((entity) => !entity.friendly) ? targetBoard : null;
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

		// NEW: emit upsert so replay can reflect buffs/keyword toggles
		const after = targetBoard?.find((x) => x.entityId === targetEntity.entityId);
		if (after) {
			const ent = (this.sanitize([after]) as SanitizedEntity[])[0];
			this.emitEvent({
				type: 'entity-upsert',
				phase: 'ATTACK',
				entity: ent,
			});
		}

		// keep existing behavior
		const action: GameAction = buildGameAction(friendlyHero, opponentHero, {
			type: 'power-target',
			sourceEntityId: sourceEntity.entityId,
			targetEntityId: targetEntity.entityId,
			playerBoard: this.sanitize(friendlyBoard),
			opponentBoard: this.sanitize(opponentBoard),
			playerHand: this.sanitize(friendlyHero?.hand),
			opponentHand: this.sanitize(opponentHero?.hand),
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
		if (!this.enabled) {
			return;
		}
		if (!targetEntities?.length) {
			return;
		}

		const friendlyBoard = targetBoard?.every((entity) => entity.friendly) ? targetBoard : null;
		const opponentBoard = targetBoard?.every((entity) => !entity.friendly) ? targetBoard : null;
		const friendlyHero = hero1?.friendly ? hero1 : hero2?.friendly ? hero2 : null;
		const opponentHero = hero1?.friendly ? hero2 : hero2?.friendly ? hero1 : null;

		this.setLastContext(
			friendlyBoard ?? this.lastFriendlyBoard,
			opponentBoard ?? this.lastOpponentBoard,
			friendlyHero ?? this.lastFriendlyHero,
			opponentHero ?? this.lastOpponentHero,
		);

		const ids = targetEntities.map((entity) => entity.entityId);

		this.emitEvent({
			type: 'power-target',
			phase: 'ATTACK',
			sourceEntityId: sourceEntity.entityId,
			targetEntityIds: ids,
		});

		// NEW: emit upserts for all targets found on the board snapshot
		for (const id of ids) {
			const after = targetBoard?.find((x) => x.entityId === id);
			if (!after) continue;
			const ent = (this.sanitize([after]) as SanitizedEntity[])[0];
			this.emitEvent({
				type: 'entity-upsert',
				phase: 'ATTACK',
				entity: ent,
			});
		}

		// keep existing behavior
		const action: GameAction = buildGameAction(friendlyHero, opponentHero, {
			type: 'power-target',
			sourceEntityId: sourceEntity.entityId,
			targetEntityIds: ids,
			playerBoard: this.sanitize(friendlyBoard),
			opponentBoard: this.sanitize(opponentBoard),
			playerHand: this.sanitize(friendlyHero?.hand),
			opponentHand: this.sanitize(opponentHero?.hand),
		});
		this.addAction(action);
	}

	public registerMinionsSpawn(
		sourceEntity: BoardEntity | BgsPlayerEntity | BoardTrinket,
		boardOnWhichToSpawn: BoardEntity[],
		spawnedEntities: readonly BoardEntity[],
	): void {
		if (!this.enabled) {
			return;
		}
		if (!spawnedEntities || spawnedEntities.length === 0) {
			return;
		}

		const friendlyBoard = boardOnWhichToSpawn.every((entity) => entity.friendly) ? boardOnWhichToSpawn : null;
		const opponentBoard = boardOnWhichToSpawn.every((entity) => !entity.friendly) ? boardOnWhichToSpawn : null;

		this.setLastContext(
			friendlyBoard ?? this.lastFriendlyBoard,
			opponentBoard ?? this.lastOpponentBoard,
			this.lastFriendlyHero,
			this.lastOpponentHero,
		);

		// NEW: include full spawned stats + placement indices so apply-event can reconstruct accurately
		const spawnedSan = this.sanitize(spawnedEntities) as SanitizedEntity[];
		const insertIndexes = spawnedSan.map((s) => boardOnWhichToSpawn.findIndex((b) => b.entityId === s.entityId));

		this.emitEvent({
			type: 'spawn',
			phase: 'DEATHS',
			sourceEntityId: sourceEntity?.entityId,
			spawned: spawnedSan,
			insertIndexes: insertIndexes?.some((i) => i >= 0) ? insertIndexes : undefined,
		});

		// keep existing behavior
		const action: GameAction = buildGameAction(null, null, {
			type: 'spawn',
			spawns: this.sanitize(spawnedEntities),
			sourceEntityId: sourceEntity?.entityId,
			playerBoard: this.sanitize(friendlyBoard),
			opponentBoard: this.sanitize(opponentBoard),
			playerHand: null,
			opponentHand: null,
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
		if (!this.enabled) {
			return;
		}
		const deaths = [...(deadEntities1 || []), ...(deadEntities2 || [])];
		if (!deaths || deaths.length === 0) {
			return;
		}

		// Update last-known boards if we can infer friendly/opponent
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

		this.emitEvent({
			type: 'minion-death',
			phase: 'DEATHS',
			deadEntityIds: deaths.map((d) => d.entityId),
			deadMinionsPositionsOnBoard: [
				...(deadMinionIndexes1 || []).map((i) => board1.length - i),
				...(deadMinionIndexes2 || []).map((i) => board2.length - i),
			],
		});

		// keep existing behavior
		const action: GameAction = buildGameAction(null, null, {
			type: 'minion-death',
			deaths: this.sanitize(deaths),
			deadMinionsPositionsOnBoard: [
				...(deadMinionIndexes1 || []).map((i) => board1.length - i),
				...(deadMinionIndexes2 || []).map((i) => board2.length - i),
			],
		});
		this.addAction(action);
	}

	private addAction(action: GameAction) {
		// NEW: tag action with current event seq so you can line up fat snapshots with thin events
		(action as any).seq = this.seq;
		this.actionsForCurrentBattle.push(action);
	}

	// ------------------------------
	// New helpers
	// ------------------------------

	private nextSeq(): number {
		return ++this.seq;
	}

	// ---- FIXED SIGNATURE: distributive omit ----
	private emitEvent(event: SpectatorEventInput): void {
		if (!this.enabled) return;

		const withSeq: SpectatorEvent = { seq: this.nextSeq(), ...event } as SpectatorEvent;
		this.eventsForCurrentBattle.push(withSeq);

		// Safety valve checkpoint
		if (CHECKPOINT_EVERY_N_EVENTS > 0 && this.seq % CHECKPOINT_EVERY_N_EVENTS === 0) {
			const snapshot = this.buildSnapshotFromLastContext('EVERY_N');
			if (snapshot) {
				this.addCheckpoint('EVERY_N', snapshot);
			}
		}
	}

	private addCheckpoint(reason: CheckpointReason, snapshot: GameAction): void {
		this.checkpointsForCurrentBattle.push({
			seq: this.seq,
			reason,
			snapshot,
		});
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
		// Need at least boards to be useful
		if (!this.lastFriendlyBoard && !this.lastOpponentBoard) {
			return null;
		}

		// Reuse your existing snapshot builder so the viewer stays consistent
		const snapshot: GameAction = buildGameAction(this.lastFriendlyHero, this.lastOpponentHero, {
			type: 'start-of-combat',
			playerBoard: this.sanitize(this.lastFriendlyBoard ?? undefined),
			opponentBoard: this.sanitize(this.lastOpponentBoard ?? undefined),
			playerHand: this.sanitize(this.lastFriendlyHero?.hand ?? undefined),
			opponentHand: this.sanitize(this.lastOpponentHero?.hand ?? undefined),
		});

		// Tagging: you can later set snapshot.type differently if you want
		// (keeping as 'start-of-combat' avoids adding new GameAction types right now)
		(snapshot as any).checkpointReason = reason;

		return snapshot;
	}

	private collapseActions(actions: readonly GameAction[]): readonly GameAction[] {
		if (!this.enabled) {
			return [];
		}
		if (!actions || actions.length === 0) {
			return [];
		}
		const result: GameAction[] = [];
		for (let i = 0; i < actions.length; i++) {
			const action: GameAction = {
				...actions[i],
				playerBoard: this.sanitize(actions[i].playerBoard),
				opponentBoard: this.sanitize(actions[i].opponentBoard),
				playerHand: this.sanitize(actions[i].playerHand),
				opponentHand: this.sanitize(actions[i].opponentHand),
				// spawns: this.sanitize(actions[i].spawns),
				deaths: this.sanitize(actions[i].deaths),
				playerTrinkets: this.sanitizeTrinkets(actions[i].playerTrinkets),
				opponentTrinkets: this.sanitizeTrinkets(actions[i].opponentTrinkets),
			};
			const lastAction = result.length > 0 ? result[result.length - 1] : null;

			if (lastAction) {
				action.playerBoard = action.playerBoard ?? lastAction.playerBoard;
				action.opponentBoard = action.opponentBoard ?? lastAction.opponentBoard;
				action.playerHand = action.playerHand ?? lastAction.playerHand;
				action.opponentHand = action.opponentHand ?? lastAction.opponentHand;
				action.playerSecrets = action.playerSecrets ?? lastAction.playerSecrets;
				action.opponentSecrets = action.opponentSecrets ?? lastAction.opponentSecrets;
				action.playerRewardCardId = action.playerRewardCardId ?? lastAction.playerRewardCardId;
				action.playerRewardEntityId = action.playerRewardEntityId ?? lastAction.playerRewardEntityId;
				action.playerRewardData = action.playerRewardData ?? lastAction.playerRewardData;
				action.opponentRewardCardId = action.opponentRewardCardId ?? lastAction.opponentRewardCardId;
				action.opponentRewardEntityId = action.opponentRewardEntityId ?? lastAction.opponentRewardEntityId;
				action.opponentRewardData = action.opponentRewardData ?? lastAction.opponentRewardData;
				action.playerCardId = action.playerCardId ?? lastAction.playerCardId;
				action.playerEntityId = action.playerEntityId ?? lastAction.playerEntityId;
				action.playerHeroPowerCardId = action.playerHeroPowerCardId ?? lastAction.playerHeroPowerCardId;
				action.playerHeroPowerEntityId = action.playerHeroPowerEntityId ?? lastAction.playerHeroPowerEntityId;
				action.playerHeroPowerUsed = action.playerHeroPowerUsed ?? lastAction.playerHeroPowerUsed;
				action.opponentCardId = action.opponentCardId ?? lastAction.opponentCardId;
				action.opponentEntityId = action.opponentEntityId ?? lastAction.opponentEntityId;
				action.opponentHeroPowerCardId = action.opponentHeroPowerCardId ?? lastAction.opponentHeroPowerCardId;
				action.opponentHeroPowerEntityId =
					action.opponentHeroPowerEntityId ?? lastAction.opponentHeroPowerEntityId;
				action.opponentHeroPowerUsed = action.opponentHeroPowerUsed ?? lastAction.opponentHeroPowerUsed;
				action.playerTrinkets = action.playerTrinkets ?? lastAction.playerTrinkets;
				action.opponentTrinkets = action.opponentTrinkets ?? lastAction.opponentTrinkets;
			}

			if (lastAction && action.type === 'damage' && lastAction.type === 'attack') {
				lastAction.damages = lastAction.damages || [];
				lastAction.damages.push({
					damage: action.damages[0].damage,
					sourceEntityId: action.damages[0].sourceEntityId,
					targetEntityId: action.damages[0].targetEntityId,
				});
				lastAction.playerBoard = action.playerBoard;
				lastAction.opponentBoard = action.opponentBoard;
				lastAction.playerHand = action.playerHand;
				lastAction.opponentHand = action.opponentHand;
				lastAction.playerSecrets = action.playerSecrets;
				lastAction.opponentSecrets = action.opponentSecrets;
				lastAction.playerTrinkets = action.playerTrinkets;
				lastAction.opponentTrinkets = action.opponentTrinkets;
			} else if (lastAction && action.type === 'damage' && lastAction.type === 'damage') {
				lastAction.damages = lastAction.damages || [];
				lastAction.damages.push({
					damage: action.damages[0].damage,
					sourceEntityId: action.damages[0].sourceEntityId,
					targetEntityId: action.damages[0].targetEntityId,
				});
				lastAction.playerBoard = action.playerBoard;
				lastAction.opponentBoard = action.opponentBoard;
				lastAction.playerHand = action.playerHand;
				lastAction.opponentHand = action.opponentHand;
				lastAction.playerSecrets = action.playerSecrets;
				lastAction.opponentSecrets = action.opponentSecrets;
				lastAction.playerTrinkets = action.playerTrinkets;
				lastAction.opponentTrinkets = action.opponentTrinkets;
			} else if (
				lastAction &&
				action.type === 'power-target' &&
				lastAction.type === 'power-target' &&
				action.sourceEntityId === lastAction.sourceEntityId
			) {
				lastAction.targetEntityIds =
					lastAction.targetEntityIds ?? (lastAction.targetEntityId ? [lastAction.targetEntityId] : []);
				action.targetEntityIds =
					action.targetEntityIds ?? (action.targetEntityId ? [action.targetEntityId] : []);
				lastAction.targetEntityIds.push(...action.targetEntityIds);
				lastAction.playerBoard = action.playerBoard;
				lastAction.opponentBoard = action.opponentBoard;
				lastAction.playerHand = action.playerHand;
				lastAction.opponentHand = action.opponentHand;
				lastAction.playerSecrets = action.playerSecrets;
				lastAction.opponentSecrets = action.opponentSecrets;
				lastAction.playerTrinkets = action.playerTrinkets;
				lastAction.opponentTrinkets = action.opponentTrinkets;
			} else {
				result.push(action);
			}
		}

		return result;
	}

	// Calling sanitize every time before we add an action to the list is mandatory, since
	// the entities and boards are mutable
	private sanitize(board: readonly BoardEntity[] | null | undefined): readonly BoardEntity[] {
		if (!board) {
			return undefined;
		}
		return board.map(
			(entity) =>
				({
					entityId: entity.entityId,
					cardId: entity.cardId,
					friendly: entity.friendly,
					attack: entity.attack,
					health: entity.health,
					maxHealth: entity.maxHealth,
					taunt: entity.taunt,
					divineShield: entity.divineShield,
					poisonous: entity.poisonous,
					venomous: entity.venomous,
					reborn: entity.reborn,
					windfury: entity.windfury,
					stealth: entity.stealth,
				} as BoardEntity),
		);
	}

	private sanitizeTrinkets(trinkets: readonly BoardTrinket[]): readonly BoardTrinket[] {
		if (!trinkets?.length) {
			return undefined;
		}
		const result = trinkets.map(
			(t) =>
				({
					cardId: t.cardId,
					entityId: t.entityId,
					scriptDataNum1: t.scriptDataNum1,
					scriptDataNum6: t.scriptDataNum6,
				} as BoardTrinket),
		);
		return result;
	}
}
