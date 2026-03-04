// src/http-server.ts
import Fastify from 'fastify';
import { AllCardsLocalService, AllCardsService } from '@firestone-hs/reference-data';
import { readFileSync } from 'fs';
import path from 'path';
import { initReplayStateFromCheckpoint, applyEvent } from './simulation/replay/apply-event';

// ✅ Deterministic RNG hook (make combat sims reproducible)
// If this relative path doesn't resolve in your repo layout, adjust it accordingly.
import { mulberry32 } from "./lib/rng";

import type { BgsBattleInfo } from './bgs-battle-info';
import { CardsData } from './cards/cards-data';
import { buildFinalInput } from './input-sanitation';
import { cloneInput3 } from './input-clone';
import { SharedState } from './simulation/shared-state';
import { Simulator } from './simulation/simulator';
import { Spectator } from './simulation/spectator/spectator';
import type { FullGameState } from './simulation/internal-game-state';
import type { SimulationResult } from './simulation-result';

/**
 * What this file does (high level)
 * - Boots a Fastify HTTP server with a single combat endpoint.
 * - Lazily loads + initializes the Battlegrounds card database once (from a local cards_bg.json).
 * - For each /v1/combat/simulate request:
 *   1) Builds per-request CardsData (because validTribes/anomalies can differ per match).
 *   2) Sanitizes/normalizes input into the format the simulator expects (buildFinalInput).
 *   3) Runs N Monte-Carlo combat iterations (simulateSingleBattle) to estimate win/tie/loss + damage stats.
 *   4) Returns the aggregated SimulationResult plus timing metadata.
 * - If debug=1, also returns outcomeSamples captured by Spectator for inspection.
 */

const fastify = Fastify({
	logger: true,
	bodyLimit: 5 * 1024 * 1024, // 5MB, adjust if needed
});

let cards: AllCardsService;
let cardsInitPromise: Promise<void> | null = null;

async function initCardsOnce() {
	if (!cards) {
		const cardsPath = path.resolve(process.cwd(), 'test/full-game/cards_bg.json');
		const cardsStr = readFileSync(cardsPath, 'utf8');
		cards = new AllCardsLocalService(cardsStr);
		fastify.log.info({ cardsPath }, 'Using local cards JSON');
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

	// 1) Ensure the card DB is ready (loaded once per process)
	await initCardsOnce();

	// 2) Build per-request CardsData because tribes/anomalies can vary per game
	const cardsData = new CardsData(cards, false);
	cardsData.inititialize(
		battleInput.gameState?.validTribes ?? battleInput.options?.validTribes,
		battleInput.gameState?.anomalies ?? [],
	);

	const start = Date.now();

	// 3) Run a Monte-Carlo combat sim and aggregate results into a SimulationResult
	//    (wins/ties/losses, lethal odds, damage ranges). Debug can additionally return outcomeSamples.
	const result = runToFinalResult(battleInput, cards, cardsData, { debug });

	const durationMs = Date.now() - start;

	const responseBody: any = {
		result,
		meta: { durationMs, ...(debug ? { debug: true } : {}) },
	};

	if (debug && (result as any)?.outcomeSamples) {
		responseBody.debugTelemetry = buildDebugTelemetry((result as any).outcomeSamples, { traceLimit: 5000 });
	}

	if ((responseBody.result as any)?.outcomeSamples) {
		for (const bucket of ['won', 'lost', 'tied'] as const) {
			for (const sample of (responseBody.result as any).outcomeSamples[bucket] ?? []) {
				delete sample.actions;
			}
		}
	}

	reply.header('Cache-Control', 'no-store');
	return reply.code(200).send(responseBody);
});

type OutcomeSamples = Record<'won' | 'lost' | 'tied', any[]>;

function buildDebugTelemetry(outcomeSamples: OutcomeSamples, opts?: { traceLimit?: number }) {
	const traceLimit = opts?.traceLimit ?? 5000;

	const pickSample = () => {
		for (const bucket of ['won', 'lost', 'tied'] as const) {
			const s = outcomeSamples?.[bucket]?.[0];
			if (s) return { bucket, sample: s };
		}
		return null;
	};

	const picked = pickSample();
	if (!picked) {
		return {
			ok: false,
			message: 'No outcomeSamples found (won/lost/tied all empty)',
		};
	}

	const { bucket, sample } = picked;
	const events = (sample.events ?? []) as any[];
	const checkpoints = (sample.checkpoints ?? []) as any[];

	events.sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0));
	checkpoints.sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0));

	const timeline = [
		...checkpoints.map((cp) => ({ kind: 'checkpoint', seq: cp.seq, reason: cp.reason })),
		...events.map((e) => ({ kind: 'event', seq: e.seq, type: e.type ?? e.eventType ?? e.name })),
	].sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0));

	let replayTrace: any[] | undefined = undefined;

	// Build the same replay trace you printed in the test script
	if (checkpoints.length > 0 && events.length > 0) {
		const cp = checkpoints[0];
		let state = initReplayStateFromCheckpoint(cp.snapshot, cp.seq);

		let i = events.findIndex((e) => (e.seq ?? 0) > (cp.seq ?? 0));
		if (i < 0) i = events.length;

		replayTrace = [];
		let steps = 0;

		while (i < events.length && steps < traceLimit) {
			const evt = events[i];
			applyEvent(state, evt);

			replayTrace.push({
				seq: state.seq,
				lastAttack: state.lastAttack,
				// optional: keep a tiny bit of event identity for debugging
				eventSeq: evt.seq,
				eventType: evt.type ?? evt.eventType ?? evt.name,
			});

			i++;
			steps++;
		}
	}

	return {
		ok: true,
		picked: { bucket, index: 0 },
		counts: { events: events.length, checkpoints: checkpoints.length },
		firstEvent: events[0],
		lastEvent: events[events.length - 1],
		firstCheckpoint: checkpoints[0] ? { reason: checkpoints[0].reason, seq: checkpoints[0].seq } : null,
		lastCheckpoint: checkpoints[checkpoints.length - 1]
			? { reason: checkpoints[checkpoints.length - 1].reason, seq: checkpoints[checkpoints.length - 1].seq }
			: null,
		timeline,
		replayTrace,
	};
}

function runToFinalResult(
	battleInput: BgsBattleInfo,
	cards: AllCardsService,
	cardsData: CardsData,
	opts: { debug: boolean },
): SimulationResult {
	const start = Date.now();
	const maxAcceptableDuration = battleInput.options?.maxAcceptableDuration || 8000;
	const hideMaxSimulationDurationWarning = battleInput.options?.hideMaxSimulationDurationWarning ?? false;
	const numberOfSimulations = battleInput.options?.numberOfSimulations || 1;
	const intermediateSteps = battleInput.options?.intermediateResults ?? 200;
	const damageConfidence = battleInput.options?.damageConfidence ?? 0.9;

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
		seed: 0,
	};

	const spectator = new Spectator(includeOutcomeSamples);
	const inputReady = buildFinalInput(battleInput, cards, cardsData);

	// ✅ Deterministic RNG (your requested two lines, effectively)
	// IMPORTANT: seed once per request so the whole Monte-Carlo run is reproducible.
	const prevRandom = Math.random;
	const MAX = 1_000_000_000_000_000; // 1e15
	const randomnumseed = Math.floor(Math.random() * MAX) + 1; // 1..1e15
	(Math as any).random = mulberry32(randomnumseed);
	simulationResult.seed = randomnumseed;

	try {
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

			// This is the “physics step”:
			// given two boards, run one full combat resolution and return outcome + damage dealt.
			const battleResult = simulator.simulateSingleBattle(
				gameState.gameState.player,
				gameState.gameState.opponent,
			);

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
				if (battleInput.playerBoard.player.hpLeft && battleResult.damageDealt >= battleInput.playerBoard.player.hpLeft) {
					simulationResult.lostLethal++;
				}
			} else {
				simulationResult.tied++;
			}

			spectator.commitBattleResult(battleResult.result);

			if (!!intermediateSteps && i > 0 && i % intermediateSteps === 0) {
				updateSimulationResult(simulationResult, inputReady, damageConfidence);
			}
		}
	} finally {
		// restore global RNG so other code paths don't inherit the seeded generator
		(Math as any).random = prevRandom;
	}

	updateSimulationResult(simulationResult, inputReady, damageConfidence);
	spectator.prune();

	// Don’t ship huge arrays
	simulationResult.damageWons = [];
	simulationResult.damageLosts = [];

	if (includeOutcomeSamples) {
		(simulationResult as any).outcomeSamples = spectator.buildOutcomeSamples(battleInput.gameState);
	}

	return simulationResult;
}

// ... updateSimulationResult + main() unchanged ...

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