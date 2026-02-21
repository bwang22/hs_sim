import { BoardTrinket } from '../../bgs-player-entity';
import { BoardEntity } from '../../board-entity';
import { GameAction } from './game-action';

export const collapseActions = (
	enabled: boolean,
	actions: readonly GameAction[],
	sanitizeBoard: (board: readonly BoardEntity[] | null | undefined) => readonly BoardEntity[] | undefined,
	sanitizeTrinkets: (trinkets: readonly BoardTrinket[]) => readonly BoardTrinket[] | undefined,
): readonly GameAction[] => {
	if (!enabled) return [];
	if (!actions?.length) return [];

	const result: any[] = [];
	const src: any[] = actions as any[];

	for (let i = 0; i < src.length; i++) {
		const a = src[i] ?? {};
		const action: any = {
			...a,
			playerBoard: sanitizeBoard(a.playerBoard),
			opponentBoard: sanitizeBoard(a.opponentBoard),
			playerHand: sanitizeBoard(a.playerHand),
			opponentHand: sanitizeBoard(a.opponentHand),
			deaths: sanitizeBoard(a.deaths),
			spawns: sanitizeBoard(a.spawns),
			playerTrinkets: sanitizeTrinkets(a.playerTrinkets),
			opponentTrinkets: sanitizeTrinkets(a.opponentTrinkets),
		};

		const last: any = result.length ? result[result.length - 1] : null;

		if (last) {
			action.playerBoard = action.playerBoard ?? last.playerBoard;
			action.opponentBoard = action.opponentBoard ?? last.opponentBoard;
			action.playerHand = action.playerHand ?? last.playerHand;
			action.opponentHand = action.opponentHand ?? last.opponentHand;

			action.playerSecrets = action.playerSecrets ?? last.playerSecrets;
			action.opponentSecrets = action.opponentSecrets ?? last.opponentSecrets;

			action.playerRewardCardId = action.playerRewardCardId ?? last.playerRewardCardId;
			action.playerRewardEntityId = action.playerRewardEntityId ?? last.playerRewardEntityId;
			action.playerRewardData = action.playerRewardData ?? last.playerRewardData;

			action.opponentRewardCardId = action.opponentRewardCardId ?? last.opponentRewardCardId;
			action.opponentRewardEntityId = action.opponentRewardEntityId ?? last.opponentRewardEntityId;
			action.opponentRewardData = action.opponentRewardData ?? last.opponentRewardData;

			action.playerCardId = action.playerCardId ?? last.playerCardId;
			action.playerEntityId = action.playerEntityId ?? last.playerEntityId;

			action.playerHeroPowerCardId = action.playerHeroPowerCardId ?? last.playerHeroPowerCardId;
			action.playerHeroPowerEntityId = action.playerHeroPowerEntityId ?? last.playerHeroPowerEntityId;
			action.playerHeroPowerUsed = action.playerHeroPowerUsed ?? last.playerHeroPowerUsed;

			action.opponentCardId = action.opponentCardId ?? last.opponentCardId;
			action.opponentEntityId = action.opponentEntityId ?? last.opponentEntityId;

			action.opponentHeroPowerCardId = action.opponentHeroPowerCardId ?? last.opponentHeroPowerCardId;
			action.opponentHeroPowerEntityId = action.opponentHeroPowerEntityId ?? last.opponentHeroPowerEntityId;
			action.opponentHeroPowerUsed = action.opponentHeroPowerUsed ?? last.opponentHeroPowerUsed;

			action.playerTrinkets = action.playerTrinkets ?? last.playerTrinkets;
			action.opponentTrinkets = action.opponentTrinkets ?? last.opponentTrinkets;
		}

		// collapse damage into prior attack for back-compat viewers
		if (last && action.type === 'damage' && last.type === 'attack' && action.damages?.length) {
			last.damages = last.damages || [];
			last.damages.push(action.damages[0]);
			last.playerBoard = action.playerBoard;
			last.opponentBoard = action.opponentBoard;
			last.playerHand = action.playerHand;
			last.opponentHand = action.opponentHand;
			last.playerSecrets = action.playerSecrets;
			last.opponentSecrets = action.opponentSecrets;
			last.playerTrinkets = action.playerTrinkets;
			last.opponentTrinkets = action.opponentTrinkets;
			continue;
		}

		// collapse consecutive damage
		if (last && action.type === 'damage' && last.type === 'damage' && action.damages?.length) {
			last.damages = last.damages || [];
			last.damages.push(action.damages[0]);
			last.playerBoard = action.playerBoard;
			last.opponentBoard = action.opponentBoard;
			last.playerHand = action.playerHand;
			last.opponentHand = action.opponentHand;
			last.playerSecrets = action.playerSecrets;
			last.opponentSecrets = action.opponentSecrets;
			last.playerTrinkets = action.playerTrinkets;
			last.opponentTrinkets = action.opponentTrinkets;
			continue;
		}

		// collapse power-target same source
		if (last && action.type === 'power-target' && last.type === 'power-target' && action.sourceEntityId === last.sourceEntityId) {
			last.targetEntityIds = last.targetEntityIds ?? [];
			action.targetEntityIds = action.targetEntityIds ?? [];
			last.targetEntityIds.push(...action.targetEntityIds);
			last.playerBoard = action.playerBoard;
			last.opponentBoard = action.opponentBoard;
			last.playerHand = action.playerHand;
			last.opponentHand = action.opponentHand;
			last.playerSecrets = action.playerSecrets;
			last.opponentSecrets = action.opponentSecrets;
			last.playerTrinkets = action.playerTrinkets;
			last.opponentTrinkets = action.opponentTrinkets;
			continue;
		}

		result.push(action);
	}

	return result as GameAction[];
};
