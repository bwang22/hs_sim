import { BoardEntity } from '../../../board-entity';
import { CardIds } from '../../../services/card-ids';
import { BattlecryInput } from '../../../simulation/battlecries';
import { addCardsInHand } from '../../../simulation/cards-in-hand';
import { BattlecryCard } from '../../card.interface';

export const RazorfenGeomancer: BattlecryCard = {
	cardIds: [CardIds.RazorfenGeomancer_BG20_100, CardIds.RazorfenGeomancer_BG20_100_G],
	battlecry: (minion: BoardEntity, input: BattlecryInput) => {
		const mult = minion.cardId === CardIds.RazorfenGeomancer_BG20_100 ? 2 : 4;
		const cardsToAdd = Array(mult).fill(CardIds.BloodGem);
		addCardsInHand(input.hero, input.board, cardsToAdd, input.gameState);
		return true;
	},
};
