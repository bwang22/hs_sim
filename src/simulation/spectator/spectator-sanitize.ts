import { BoardTrinket } from '../../bgs-player-entity';
import { BoardEntity } from '../../board-entity';
import { SanitizedEntity } from './spectator-types';

export const sanitizeBoard = (board: readonly BoardEntity[] | null | undefined): readonly BoardEntity[] => {
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
			} as unknown as SanitizedEntity as BoardEntity),
	);
};

export const sanitizeTrinkets = (trinkets: readonly BoardTrinket[]): readonly BoardTrinket[] => {
	if (!trinkets?.length) {
		return undefined;
	}
	return trinkets.map(
		(t) =>
			({
				cardId: t.cardId,
				entityId: t.entityId,
				scriptDataNum1: t.scriptDataNum1,
				scriptDataNum6: t.scriptDataNum6,
			} as BoardTrinket),
	);
};
