// src/http-server.ts
import Fastify from 'fastify';
import { AllCardsService } from '@firestone-hs/reference-data';

import type { BgsBattleInfo } from './bgs-battle-info';
import { CardsData } from './cards/cards-data';
import { buildFinalInput } from './input-sanitation';
import { cloneInput3 } from './input-clone';
import { SharedState } from './simulation/shared-state';
import { Simulator } from './simulation/simulator';
import { Spectator } from './simulation/spectator/spectator';
import type { FullGameState } from './simulation/internal-game-state';
import type { SimulationResult } from './simulation-result';

// If you want to reuse your normalizeOutcomeSamplesToEvents helper, import it from your existing file.
// For now, we’ll keep “results only” by default so outcomeSamples won’t be returned unless debug=1.

const fastify = Fastify({
	logger: true,
	bodyLimit: 5 * 1024 * 1024, // 5MB, adjust if needed
});

let cards: AllCardsService;
let cardsInitPromise: Promise<void> | null = null;

async function initCardsOnce() {
	if (!cards) {
		cards = new AllCardsService();
	}
	if (!cardsInitPromise) {
		cardsInitPromise = (async () => {
			await cards.initializeCardsDb();
			fastify.log.info('Cards DB initialized');
		})();
	}
	return cardsInitPromise;
}
fastify.addHook('onRequest', async (request, _reply) => {
	fastify.log.info(
		{ reqId: request.id, method: request.method, url: request.url },
		'combat request in',
	);
});

fastify.addHook('onResponse', async (request, reply) => {
	fastify.log.info(
		{ reqId: request.id, statusCode: reply.statusCode },
		'combat request out',
	);
});

fastify.get('/healthz', async () => ({ ok: true }));

fastify.post('/v1/combat/simulate', async (request, reply) => {
	const debug = (request.query as any)?.debug === '1' || (request.query as any)?.debug === 'true';

	const battleInput = request.body as BgsBattleInfo;
	if (!battleInput) {
		return reply.code(400).send({ error: { code: 'BAD_REQUEST', message: 'Missing JSON body' } });
	}

	await initCardsOnce();
    

	// Per-request cardsData because validTribes/anomalies can vary by gameState/options
	const cardsData = new CardsData(cards, false);
	cardsData.inititialize(
		battleInput.gameState?.validTribes ?? battleInput.options?.validTribes,
		battleInput.gameState?.anomalies ?? [],
	);

	const start = Date.now();

	// Run the simulation (final result only)
	const result = runToFinalResult(battleInput, cards, cardsData, { debug });

	const durationMs = Date.now() - start;

	// Results only by default
	const responseBody: any = {
		result,
		meta: {
			durationMs,
		},
	};

	if (debug) {
		responseBody.meta.debug = true;
		// If you want, you can attach extra info here (log tails, intermediate stats, etc.)
	}

	reply.header('Cache-Control', 'no-store');
	return reply.code(200).send(responseBody);
});

function runToFinalResult(
	battleInput: BgsBattleInfo,
	cards: AllCardsService,
	cardsData: CardsData,
	opts: { debug: boolean },
): SimulationResult {
	// Mirror your generator logic but return only final result
	const start = Date.now();
	const maxAcceptableDuration = battleInput.options?.maxAcceptableDuration || 8000;
	const hideMaxSimulationDurationWarning = battleInput.options?.hideMaxSimulationDurationWarning ?? false;
	const numberOfSimulations = battleInput.options?.numberOfSimulations || 8000;
	const intermediateSteps = battleInput.options?.intermediateResults ?? 200;
	const damageConfidence = battleInput.options?.damageConfidence ?? 0.9;

	// Default to false unless explicitly requested, because you said “only debugging”
	const includeOutcomeSamples = opts.debug && (battleInput.options?.includeOutcomeSamples ?? true);

	const simulationResult: SimulationResult = {
		wonLethal: 0,
		won: 0,
		tied: 0,
		lost: 0,
		lostLethal: 0,
		damageWons: [],
		damageWon: 0,
		damageWonRange: null,
		damageLosts: [],
		damageLost: 0,
		damageLostRange: null,
		wonLethalPercent: undefined,
		wonPercent: undefined,
		tiedPercent: undefined,
		lostPercent: undefined,
		lostLethalPercent: undefined,
		averageDamageWon: undefined,
		averageDamageLost: undefined,
	};

	const spectator = new Spectator(includeOutcomeSamples);
	const inputReady = buildFinalInput(battleInput, cards, cardsData);

	const outcomes: Record<string, number> = {};

	for (let i = 0; i < numberOfSimulations; i++) {
		const input: BgsBattleInfo = cloneInput3(inputReady);
		const inputClone: BgsBattleInfo = cloneInput3(inputReady);

		const gameState: FullGameState = {
			allCards: cards,
			cardsData: cardsData,
			spectator: spectator,
			sharedState: new SharedState(),
			currentTurn: input.gameState.currentTurn,
			validTribes: input.gameState.validTribes,
			anomalies: input.gameState.anomalies,
			gameState: {
				player: {
					player: input.playerBoard.player,
					board: input.playerBoard.board,
					teammate: (input as any).playerTeammateBoard,
				},
				opponent: {
					player: input.opponentBoard.player,
					board: input.opponentBoard.board,
					teammate: (input as any).opponentTeammateBoard,
				},
				playerInitial: {
					player: inputClone.playerBoard.player,
					board: inputClone.playerBoard.board,
					teammate: (inputClone as any).playerTeammateBoard,
				},
				opponentInitial: {
					player: inputClone.opponentBoard.player,
					board: inputClone.opponentBoard.board,
					teammate: (inputClone as any).opponentTeammateBoard,
				},
			},
		};

		const simulator = new Simulator(gameState);
		const battleResult = simulator.simulateSingleBattle(gameState.gameState.player, gameState.gameState.opponent);

		if (Date.now() - start > maxAcceptableDuration && !hideMaxSimulationDurationWarning) {
			console.warn('Stopping simulation after', i, 'iterations and', Date.now() - start, 'ms');
			break;
		}
		if (!battleResult) {
			continue;
		}

		if (battleResult.result === 'won') {
			simulationResult.won++;
			simulationResult.damageWon += battleResult.damageDealt;
			simulationResult.damageWons.push(battleResult.damageDealt);
			if (battleResult.damageDealt >= battleInput.opponentBoard.player.hpLeft) {
				simulationResult.wonLethal++;
			}
		} else if (battleResult.result === 'lost') {
			simulationResult.lost++;
			simulationResult.damageLost += battleResult.damageDealt;
			simulationResult.damageLosts.push(battleResult.damageDealt);
			outcomes[battleResult.damageDealt] = (outcomes[battleResult.damageDealt] ?? 0) + 1;
			if (battleInput.playerBoard.player.hpLeft && battleResult.damageDealt >= battleInput.playerBoard.player.hpLeft) {
				simulationResult.lostLethal++;
			}
		} else {
			simulationResult.tied++;
		}

		spectator.commitBattleResult(battleResult.result);

		// optional intermediate update (kept for parity, but not returned unless you later add streaming)
		if (!!intermediateSteps && i > 0 && i % intermediateSteps === 0) {
			updateSimulationResult(simulationResult, inputReady, damageConfidence);
		}
	}

	updateSimulationResult(simulationResult, inputReady, damageConfidence);
	spectator.prune();

	// Don’t ship huge arrays
	simulationResult.damageWons = [];
	simulationResult.damageLosts = [];

	// Only attach outcomeSamples when debugging (and includeOutcomeSamples true)
	if (includeOutcomeSamples) {
		(simulationResult as any).outcomeSamples = spectator.buildOutcomeSamples(battleInput.gameState);
	}

	return simulationResult;
}

function updateSimulationResult(simulationResult: any, input: any, damageConfidence: number) {
	const totalMatches = simulationResult.won + simulationResult.tied + simulationResult.lost;
	if (totalMatches <= 0) {
		return;
	}
	const checkRounding = (roundedValue: number, initialValue: number, totalValue: number): number => {
		if (roundedValue === 0 && initialValue !== 0) return 0.01;
		if (roundedValue === 100 && initialValue !== totalValue) return 99.9;
		return roundedValue;
	};

	simulationResult.wonPercent = checkRounding(Math.round((10 * (100 * simulationResult.won)) / totalMatches) / 10, simulationResult.won, totalMatches);
	simulationResult.wonLethalPercent = checkRounding(Math.round((10 * (100 * simulationResult.wonLethal)) / totalMatches) / 10, simulationResult.wonLethal, totalMatches);
	simulationResult.lostPercent = checkRounding(Math.round((10 * (100 * simulationResult.lost)) / totalMatches) / 10, simulationResult.lost, totalMatches);
	simulationResult.lostLethalPercent = checkRounding(Math.round((10 * (100 * simulationResult.lostLethal)) / totalMatches) / 10, simulationResult.lostLethal, totalMatches);
	simulationResult.tiedPercent = checkRounding(Math.max(0, 100 - simulationResult.lostPercent - simulationResult.wonPercent), simulationResult.tied, totalMatches);

	const calculateDamageRange = (damageArray: number[], conf: number): { min: number; max: number } => {
		if (!damageArray?.length) return { min: 0, max: 0 };
		const sorted = [...damageArray].sort((a, b) => a - b);
		const percentile = (arr: number[], p: number) => arr[Math.floor(p * arr.length)];
		return { min: percentile(sorted, 1 - conf), max: percentile(sorted, conf) };
	};

	const totalDamageWon = simulationResult.damageWons.reduce((a: number, b: number) => a + b, 0);
	const totalDamageLost = simulationResult.damageLosts.reduce((a: number, b: number) => a + b, 0);
	const damageWonRange = calculateDamageRange(simulationResult.damageWons, damageConfidence);
	const damageLostRange = calculateDamageRange(simulationResult.damageLosts, damageConfidence);

	simulationResult.averageDamageWon = simulationResult.won ? totalDamageWon / simulationResult.won : 0;
	simulationResult.averageDamageLost = simulationResult.lost ? totalDamageLost / simulationResult.lost : 0;
	simulationResult.damageWonRange = simulationResult.won ? damageWonRange : null;
	simulationResult.damageLostRange = simulationResult.lost ? damageLostRange : null;
}

const PORT = Number(process.env.PORT ?? 8080);
const HOST = process.env.HOST ?? '0.0.0.0';

async function main() {
	try {
		await fastify.listen({ port: PORT, host: HOST });
		fastify.log.info(`combat server listening on http://${HOST}:${PORT}`);
	} catch (err) {
		fastify.log.error(err, 'failed to start server');
		process.exit(1);
	}
}

// optional: graceful shutdown
process.on('SIGINT', async () => {
	fastify.log.info('SIGINT received, shutting down');
	await fastify.close();
	process.exit(0);
});
process.on('SIGTERM', async () => {
	fastify.log.info('SIGTERM received, shutting down');
	await fastify.close();
	process.exit(0);
});

main();