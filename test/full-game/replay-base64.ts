// replay-base64.ts (run from repo root)
import * as fs from 'fs';
import * as path from 'path';

import type { SpectatorEvent, SpectatorCheckpoint } from '../../src/simulation/spectator/spectator';
import { initReplayStateFromCheckpoint, replayToSeq } from '../../src/simulation/replay/apply-event';

// --- tiny CLI args ---
const args = new Map<string, string>();
for (const a of process.argv.slice(2)) {
	const [k, v = ''] = a.split('=');
	args.set(k.replace(/^--/, ''), v);
}
const targetSeq = Number(args.get('seq') ?? '0'); // 0 => replay full
const bucket = (args.get('bucket') ?? 'won') as 'won' | 'lost' | 'tied';
const index = Number(args.get('i') ?? '0');

// --- decode base64.txt -> object ---
const base64Path = path.join(process.cwd(), '../../bwang22/api-simulate-battlegrounds-battle/base64.txt');
const b64 = fs.readFileSync(base64Path, 'utf8').replace(/\s+/g, '');
const payload = JSON.parse(b64);

// --- locate a sample that has events/checkpoints ---
function getSample(obj: any): { events: SpectatorEvent[]; checkpoints: SpectatorCheckpoint[] } {
	// case A: base64 is directly a sample
	if (obj?.events && obj?.checkpoints) return obj;

	// case B: base64 is a full simulationResult with outcomeSamples
	const s = obj?.outcomeSamples?.[bucket]?.[index];
	if (s?.events && s?.checkpoints) return s;

	throw new Error(
		`Couldn't find {events, checkpoints}. ` +
			`Tried payload.events/checkpoints and payload.outcomeSamples.${bucket}[${index}].`,
	);
}

const sample = getSample(payload);
const events: SpectatorEvent[] = sample.events ?? [];
const checkpoints: SpectatorCheckpoint[] = sample.checkpoints ?? [];

if (!checkpoints.length) throw new Error('No checkpoints found. Need at least one checkpoint to replay from.');

const maxSeq = events.length ? events[events.length - 1].seq : checkpoints[checkpoints.length - 1].seq;
const seqToReplay = targetSeq > 0 ? Math.min(targetSeq, maxSeq) : maxSeq;

// pick latest checkpoint with seq <= seqToReplay
const checkpoint =
	[...checkpoints].reverse().find((c) => c.seq <= seqToReplay) ?? checkpoints[0];

// replay
const trace = (args.get('trace') ?? '0') === '1';
const verboseToFile = (args.get('out') ?? '') || (trace ? 'replay_verbose.txt' : '');
const stream = verboseToFile ? fs.createWriteStream(verboseToFile, { flags: 'w' }) : null;

const writeLine = (s: string) => {
	if (stream) stream.write(s + '\n');
};

const state = replayToSeq(checkpoint, events, seqToReplay, {
	onStep: trace
		? ({ event, playerBoard, opponentBoard }) => {
				writeLine(`\n#${event.seq} ${event.type} phase=${(event as any).phase ?? ''}`);

				// event payload (minus huge fields)
				writeLine(`event=${JSON.stringify(event)}`);

				writeLine(`player=${playerBoard.length} opponent=${opponentBoard.length}`);

				// full boards
				writeLine(`P: ${playerBoard.join(' | ')}`);
				writeLine(`O: ${opponentBoard.join(' | ')}`);
		  }
		: undefined,
});

stream?.end();
if (verboseToFile) {
	console.log(`Wrote replay log to ${verboseToFile}`);
}


// print a quick summary
console.log(`Replay done: targetSeq=${seqToReplay}, checkpointSeq=${checkpoint.seq}, events=${events.length}`);
console.log(`Player board (${state.playerBoard.length}):`, state.playerBoard.map((e) => `${e.cardId} ${e.attack}/${e.health}`));
console.log(
	`Opponent board (${state.opponentBoard.length}):`,
	state.opponentBoard.map((e) => `${e.cardId} ${e.attack}/${e.health}`),
);
