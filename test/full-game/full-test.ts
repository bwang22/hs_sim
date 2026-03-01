/* eslint-disable @typescript-eslint/no-use-before-define */
import { AllCardsLocalService } from '@firestone-hs/reference-data';
import { readFileSync, writeFileSync } from 'fs';
import { BgsBattleInfo } from '../../src/bgs-battle-info';
import { encode } from '../../src/services/utils';
import runSimulation, { assignCards } from '../../src/simulate-bgs-battle';
import { applyDebugState } from './apply-debug-state';
import jsonEvent3 from './game.json';
import { mulberry32 } from "../../src/lib/rng";
import { initReplayStateFromCheckpoint, applyEvent } from '../../src/simulation/replay/apply-event';
export const stateFromCheckpoint = initReplayStateFromCheckpoint;

console.log('starting test');
const test = async () => {
	Error.stackTraceLimit = Infinity;
	process.env.FORCE_COLOR = '0';
	process.env.NO_COLOR = '1';
	console.log('preparing to run simulation');
	const start = Date.now();
	const input: BgsBattleInfo = {
		...jsonEvent3,
		options: {
			...jsonEvent3.options,
			numberOfSimulations: 1,
			skipInfoLogs: false,
			maxAcceptableDuration: 5000,
			itermediateResults: 0,
			includeOutcomeSamples: true,
			damageConfidence: 0.95,
		},
		gameState: {
			...jsonEvent3.gameState,
		},
	} as any;

	applyDebugState();

	const cardsStr = readFileSync('test/full-game/cards_bg.json').toString();
	const allCards = new AllCardsLocalService(cardsStr);
	// const allCards = new AllCardsService();
	await allCards.initializeCardsDb();
	console.log('cards initialized', allCards.getCards().length);
	assignCards(allCards);

	(Math as any).random = mulberry32(42);
	const result = await runSimulation({ body: JSON.stringify(input) });

	// ---- DEBUG: print spectator telemetry (Lambda wrapper aware) ----
	console.log('--- DEBUG: reached post-sim logging ---');

	const payload =
		typeof (result as any)?.body === 'string'
			? JSON.parse((result as any).body)
			: (result as any);

	const samples = (payload as any).outcomeSamples ?? (payload as any).samples;
	console.log('payload keys:', payload ? Object.keys(payload) : payload);
	console.log('samples keys:', samples ? Object.keys(samples) : samples);

	const anySample =
		samples?.won?.[0] ?? samples?.lost?.[0] ?? samples?.tied?.[0];

	if (!anySample) {
		console.log('No samples found. Counts:', {
			won: samples?.won?.length ?? 0,
			lost: samples?.lost?.length ?? 0,
			tied: samples?.tied?.length ?? 0,
		});
	} else {
		console.log('sample keys:', Object.keys(anySample));
		const events = (anySample as any).events ?? [];
		const checkpoints = (anySample as any).checkpoints ?? [];
		console.log('--- Spectator Telemetry ---');
		console.log('events:', events.length, 'checkpoints:', checkpoints.length);
		console.log('first event:', events[0]);
		console.log('last event:', events[events.length - 1]);
		console.log('first checkpoint:', checkpoints[0]?.reason, 'seq', checkpoints[0]?.seq);
		console.log('last checkpoint: ', checkpoints[checkpoints.length - 1]?.reason, 'seq', checkpoints[checkpoints.length - 1]?.seq);
	}

	const telemetrySample  = anySample as any;
	const events = (telemetrySample .events ?? []) as any[];
	const checkpoints = (telemetrySample .checkpoints ?? []) as any[];

	events.sort((a, b) => a.seq - b.seq);
	checkpoints.sort((a, b) => a.seq - b.seq);

	// Start from the first checkpoint
	const cp = checkpoints[0];
	let state = stateFromCheckpoint(cp.snapshot, cp.seq);

	// Find the first event after the checkpoint
	let i = events.findIndex((e) => e.seq > cp.seq);
	if (i < 0) i = events.length;

	// Step function
	function step() {
		if (i >= events.length) return false;
		applyEvent(state, events[i]);
		i++;
		return true;
	}

	// Run N steps and print
	for (let k = 0; k < events.length; k++) {
		if (!step()) break;
		console.log(`seq=${state.seq} lastAttack=`, state.lastAttack);
	}

	const bodyObj = JSON.parse(result.body);

	// remove actions wherever it lives
	delete bodyObj.actions; // top-level (if present)

	for (const bucket of ['won', 'lost', 'tied'] as const) {
		for (const sample of bodyObj?.outcomeSamples?.[bucket] ?? []) {
			delete sample.actions; // per-sample (common case)
		}
	}

	result.body = JSON.stringify(bodyObj);
	const simulationResult = JSON.parse(result.body);
	// console.log('result', {
	// 	...simulationResult,
	// 	// outcomeSamples: undefined,
	// });
	// console.log(JSON.stringify(simulationResult));
	console.log('simulation took', Date.now() - start, 'ms');

	const sample =
		simulationResult.outcomeSamples.tied?.[0] ??
		simulationResult.outcomeSamples.won?.[0] ??
		simulationResult.outcomeSamples.lost?.[0] ??
		null;
	const base64 = JSON.stringify(sample);
	//console.log(base64);
	writeFileSync('base64.txt', base64);
    console.log('Base64 string saved to base64.txt');
	console.log('result', {
		...simulationResult,
		outcomeSamples: undefined,
	});
};
test();
