// game-action.ts (event-based, fixed)

import { CardIds } from '../../services/card-ids';
import { BgsHeroPower, BgsPlayerEntity, BoardTrinket } from '../../bgs-player-entity';
import { BoardEntity } from '../../board-entity';
import { BoardSecret } from '../../board-secret';

export interface Damage {
	readonly sourceEntityId?: number;
	readonly targetEntityId?: number;
	readonly damage?: number;
}

export type GameEventType =
	| 'start-of-combat'
	| 'attack'
	| 'player-attack'
	| 'opponent-attack'
	| 'damage'
	| 'spawn'
	| 'minion-death'
	| 'power-target';

export interface GameEventContext {
	playerBoard: readonly BoardEntity[];
	playerHand: readonly BoardEntity[];
	playerSecrets: readonly BoardSecret[];
	playerTrinkets: readonly BoardTrinket[];

	opponentBoard: readonly BoardEntity[];
	opponentHand: readonly BoardEntity[];
	opponentSecrets: readonly BoardSecret[];
	opponentTrinkets: readonly BoardTrinket[];

	playerCardId: string;
	playerEntityId: number;
	playerHeroPowerCardId: string;
	playerHeroPowerEntityId: number;
	playerHeroPowerUsed: boolean;
	playerHeroPowers: readonly BgsHeroPower[];

	opponentCardId: string;
	opponentEntityId: number;
	opponentHeroPowerCardId: string;
	opponentHeroPowerEntityId: number;
	opponentHeroPowerUsed: boolean;
	opponentHeroPowers: readonly BgsHeroPower[];

	playerRewardCardId: string;
	playerRewardEntityId: number;
	playerRewardData: number;

	opponentRewardCardId: string;
	opponentRewardEntityId: number;
	opponentRewardData: number;
}

export interface StartOfCombatEvent extends GameEventContext {
	type: 'start-of-combat';
}

export interface AttackEvent extends GameEventContext {
	type: 'attack';
	attackerEntityId: number;
	defenderEntityId: number;
}

export interface PlayerAttackEvent extends GameEventContext {
	type: 'player-attack';
	damage: number;
}

export interface OpponentAttackEvent extends GameEventContext {
	type: 'opponent-attack';
	damage: number;
}

export interface DamageEvent extends GameEventContext {
	type: 'damage';
	damages: readonly Damage[];
}

export interface SpawnEvent extends GameEventContext {
	type: 'spawn';
	spawns: readonly BoardEntity[];
	sourceEntityId?: number;
}

export interface MinionDeathEvent extends GameEventContext {
	type: 'minion-death';
	deaths: readonly BoardEntity[];
	deadMinionsPositionsOnBoard?: readonly number[];
}

export interface PowerTargetEvent extends GameEventContext {
	type: 'power-target';
	sourceEntityId: number;
	targetEntityIds: readonly number[];
}

export type GameEvent =
	| StartOfCombatEvent
	| AttackEvent
	| PlayerAttackEvent
	| OpponentAttackEvent
	| DamageEvent
	| SpawnEvent
	| MinionDeathEvent
	| PowerTargetEvent;

// Back-compat exports
export type GameAction = GameEvent;

type EventByType = {
	[K in GameEventType]: Extract<GameEvent, { type: K }>;
};

// ---- FIX: distributive omit over union ----
type DistributiveOmit<T, K extends PropertyKey> = T extends any ? Omit<T, K> : never;

type GameEventInput = {
	[K in GameEventType]: DistributiveOmit<EventByType[K], keyof GameEventContext>;
}[GameEventType];

type BuildContextOverrides = Partial<
	Pick<
		GameEventContext,
		| 'playerBoard'
		| 'playerHand'
		| 'playerSecrets'
		| 'playerTrinkets'
		| 'opponentBoard'
		| 'opponentHand'
		| 'opponentSecrets'
		| 'opponentTrinkets'
		| 'playerHeroPowerEntityId'
		| 'opponentHeroPowerEntityId'
	>
>;

const buildGameEventContext = (
	playerHero: BgsPlayerEntity | null | undefined,
	opponentHero: BgsPlayerEntity | null | undefined,
	overrides: BuildContextOverrides = {},
): GameEventContext => {
	const isPlayerSireD = playerHero?.cardId?.startsWith(CardIds.SireDenathrius_BG24_HERO_100);
	const isOpponentSireD = opponentHero?.cardId?.startsWith(CardIds.SireDenathrius_BG24_HERO_100);

	// Boards/hands: allow overrides; otherwise try to infer from hero shapes; otherwise default to []
	const playerBoard =
		overrides.playerBoard ??
		((playerHero as any)?.board ?? (playerHero as any)?.boardEntities ?? (playerHero as any)?.boardMinions ?? []) ??
		[];
	const playerHand =
		overrides.playerHand ??
		((playerHero as any)?.hand ?? (playerHero as any)?.handEntities ?? (playerHero as any)?.handMinions ?? []) ??
		[];

	const opponentBoard =
		overrides.opponentBoard ??
		((opponentHero as any)?.board ??
			(opponentHero as any)?.boardEntities ??
			(opponentHero as any)?.boardMinions ??
			[]) ??
		[];
	const opponentHand =
		overrides.opponentHand ??
		((opponentHero as any)?.hand ??
			(opponentHero as any)?.handEntities ??
			(opponentHero as any)?.handMinions ??
			[]) ??
		[];

	const ctx: GameEventContext = {
		playerBoard,
		playerHand,
		playerSecrets: overrides.playerSecrets ?? (playerHero?.secrets ?? []).filter((s) => !s.triggered),
		playerTrinkets: overrides.playerTrinkets ?? (playerHero?.trinkets ?? []),

		opponentBoard,
		opponentHand,
		opponentSecrets: overrides.opponentSecrets ?? (opponentHero?.secrets ?? []).filter((s) => !s.triggered),
		opponentTrinkets: overrides.opponentTrinkets ?? (opponentHero?.trinkets ?? []),

		playerCardId: playerHero?.cardId ?? null,
		playerEntityId: playerHero?.entityId ?? null,

		playerHeroPowerCardId:
			playerHero?.trinkets?.find((t) => t.scriptDataNum6 === 3)?.cardId ??
			(isPlayerSireD ? playerHero?.questRewardEntities?.[0]?.cardId : null) ??
			playerHero?.heroPowers?.[0]?.cardId ??
			null,
		playerHeroPowerEntityId: overrides.playerHeroPowerEntityId ?? 100000002,
		playerHeroPowerUsed: playerHero?.heroPowers?.[0]?.used ?? null,
		playerHeroPowers: playerHero?.heroPowers ?? [],

		playerRewardCardId:
			isPlayerSireD && (playerHero?.questRewardEntities?.length ?? 0) < 2
				? null
				: playerHero?.questRewardEntities?.[1]?.cardId ?? playerHero?.questRewards?.[0] ?? null,
		playerRewardEntityId:
			isPlayerSireD && (playerHero?.questRewardEntities?.length ?? 0) < 2
				? null
				: playerHero?.questRewardEntities?.[1]?.entityId ?? null,
		playerRewardData:
			isPlayerSireD && (playerHero?.questRewardEntities?.length ?? 0) < 2
				? null
				: playerHero?.questRewardEntities?.[0]?.scriptDataNum1 ?? 0,

		opponentCardId: opponentHero?.cardId ?? null,
		opponentEntityId: opponentHero?.entityId ?? null,

		opponentHeroPowerCardId:
			opponentHero?.trinkets?.find((t) => t.scriptDataNum6 === 3)?.cardId ??
			(isOpponentSireD ? opponentHero?.questRewardEntities?.[0]?.cardId : null) ??
			opponentHero?.heroPowers?.[0]?.cardId ??
			(opponentHero as any)?.heroPowerId ??
			null,
		opponentHeroPowerEntityId: overrides.opponentHeroPowerEntityId ?? 200000002,
		opponentHeroPowerUsed: (opponentHero as any)?.heroPowerUsed ?? opponentHero?.heroPowers?.[0]?.used ?? null,
		opponentHeroPowers: opponentHero?.heroPowers ?? [],

		opponentRewardCardId:
			isOpponentSireD && (opponentHero?.questRewardEntities?.length ?? 0) < 2
				? null
				: opponentHero?.questRewardEntities?.[1]?.cardId ?? opponentHero?.questRewards?.[0] ?? null,
		opponentRewardEntityId:
			isOpponentSireD && (opponentHero?.questRewardEntities?.length ?? 0) < 2
				? null
				: opponentHero?.questRewardEntities?.[1]?.entityId ?? null,
		opponentRewardData:
			isOpponentSireD && (opponentHero?.questRewardEntities?.length ?? 0) < 2
				? null
				: opponentHero?.questRewardEntities?.[0]?.scriptDataNum1 ?? 0,
	};

	return ctx;
};

/**
 * Event builder: pass ONLY the event payload (+ optional board/hand/secret/trinket overrides if needed).
 *
 * Example:
 *   emit(buildGameEvent(p, o, { type: 'damage', damages: [...] }));
 */
export const buildGameEvent = <K extends GameEventType>(
	playerHero: BgsPlayerEntity | null | undefined,
	opponentHero: BgsPlayerEntity | null | undefined,
	event: GameEventInput & { type: K } & BuildContextOverrides,
): EventByType[K] => {
	const {
		playerBoard,
		playerHand,
		playerSecrets,
		playerTrinkets,
		opponentBoard,
		opponentHand,
		opponentSecrets,
		opponentTrinkets,
		playerHeroPowerEntityId,
		opponentHeroPowerEntityId,
		...payload
	} = event as any;

	const ctx = buildGameEventContext(playerHero, opponentHero, {
		playerBoard,
		playerHand,
		playerSecrets,
		playerTrinkets,
		opponentBoard,
		opponentHand,
		opponentSecrets,
		opponentTrinkets,
		playerHeroPowerEntityId,
		opponentHeroPowerEntityId,
	});

	return {
		...ctx,
		...payload,
	} as EventByType[K];
};

// Back-compat name
export const buildGameAction = buildGameEvent;
