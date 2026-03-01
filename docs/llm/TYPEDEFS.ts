// typedefs.ts
// Canonical type definitions (LLM-friendly) distilled from `all_ts_dump.txt`.
// Goal: make it easy to reason about data shapes without chasing imports across 674 files.
//
// Notes:
// - This file is designed to be *readable* first. It should also be TypeScript-valid.
// - External library types (Race, ReferenceCard, etc.) are modeled as lightweight placeholders.
//   If you want strict compile-time alignment, swap these placeholders for real imports.

// ============================================================================
// 0) External / placeholder types (replace with real imports if desired)
// ============================================================================

/** Card ID string (e.g., "BG25_007") */
export type CardId = string;

/** Entity ID used as stable handles inside a combat and in telemetry */
export type EntityId = number;

/** From `@firestone-hs/reference-data` (enum). Modeled as `number` for portability here. */
export type Race = number;

/** From `@firestone-hs/reference-data` (enum). Modeled as `number` for portability here. */
export type GameTag = number;

/** From `@firestone-hs/reference-data` (interface). Minimal placeholder. */
export interface ReferenceCard {
	id?: string;
	dbfId?: number;
	name?: string;
	cost?: number;
	techLevel?: number;
	[runtimeKey: string]: any;
}

/** From `@firestone-hs/reference-data` (service). Minimal placeholder. */
export interface AllCardsService {
	getCard?(cardId: CardId): ReferenceCard | undefined;
	[runtimeKey: string]: any;
}

/** Utility used in a few places (modeled from src/services/utils.ts intent). */
export type Mutable<T> = { -readonly [K in keyof T]: T[K] };

/** Derived BG metadata service (from src/cards/cards-data.ts). Keep loose here. */
export interface CardsData {
	[runtimeKey: string]: any;
}

// ============================================================================
// 1) Public API inputs
// ============================================================================

export interface BgsBattleInfo {
	readonly playerBoard: BgsBoardInfo;
	readonly playerTeammateBoard?: BgsBoardInfo;
	readonly opponentBoard: BgsBoardInfo;
	readonly opponentTeammateBoard?: BgsBoardInfo;
	readonly options: BgsBattleOptions;
	readonly gameState: BgsGameState;
	readonly heroHasDied?: boolean;
}

export interface BgsGameState {
	readonly currentTurn: number;
	readonly validTribes?: readonly Race[];
	readonly anomalies?: readonly string[];
}

export interface BgsBattleOptions {
	readonly numberOfSimulations: number;
	readonly maxAcceptableDuration?: number;
	readonly hideMaxSimulationDurationWarning?: boolean;
	readonly intermediateResults?: number;
	readonly includeOutcomeSamples?: boolean;
	readonly damageConfidence?: number;
	/** @deprecated */
	readonly validTribes?: readonly Race[];
	readonly skipInfoLogs: boolean;
}

export interface BgsBoardInfo {
	readonly player: BgsPlayerEntity;
	readonly board: BoardEntity[];
	/** @deprecated */
	readonly secrets?: BoardSecret[];
}

// ============================================================================
// 2) Core entities
// ============================================================================

export interface BoardEntity {
	entityId: EntityId;
	cardId: CardId;
	attack: number;
	health: number;

	maxHealth?: number;
	maxAttack?: number;
	avengeCurrent?: number;
	avengeDefault?: number;
	frenzyChargesLeft?: number;
	definitelyDead?: boolean;
	taunt?: boolean;
	divineShield?: boolean;
	strongDivineShield?: boolean;
	poisonous?: boolean;
	venomous?: boolean;
	reborn?: boolean;
	rebornFromEntityId?: EntityId;
	cleave?: boolean;
	windfury?: boolean;
	stealth?: boolean;

	enchantments?: BoardEnchantment[];
	pendingAttackBuffs?: number[];

	scriptDataNum1?: number;
	scriptDataNum2?: number;
	scriptDataNum3?: number;
	scriptDataNum4?: number;
	scriptDataNum5?: number;
	scriptDataNum6?: number;

	inInitialState?: boolean;

	// For Build-An-Undead and Zilliax
	additionalCards?: readonly CardId[] | null;
	dynamicInfo?: readonly any[] | null;

	tags?: { [tag: number]: number };

	// When using this as a remembered deathrattle
	originalCardId?: CardId;

	// Fish / memory style mechanics
	rememberedDeathrattles?: BoardEnchantment[];
	deathrattleRepeats?: number;
	damageMultiplier?: number;

	locked?: boolean;
	friendly?: boolean;

	cantAttack?: boolean;
	hasAttacked?: number;
	immuneWhenAttackCharges?: number;
	attackImmediately?: boolean;

	// Used only to handle some aura bookkeeping
	previousAttack?: number;
	lastAffectedByEntity?: BoardEntity;

	// Did it have divine shield at least once? (Sinrunner Blanchy)
	hadDivineShield?: boolean;

	// Typo exists in source (`abiityChargesLeft`)
	abiityChargesLeft?: number;

	indexFromLeftAtTimeOfDeath?: number;
	spawnIndexFromRight?: number;

	tavernTier?: number;

	memory?: any;
	gildedInCombat?: boolean;

	onCanceledSummon?: () => void;
}

export interface BoardEnchantment {
	cardId: CardId;
	originEntityId?: EntityId;
	tagScriptDataNum1?: number;
	tagScriptDataNum2?: number;
	timing: number;
	repeats?: number;
	value?: number;
	memory?: any;
}

export interface BoardSecret {
	entityId: EntityId;
	cardId: CardId;
	triggered?: boolean;
	scriptDataNum1?: number;
	scriptDataNum2?: number;
	triggersLeft?: number;
}

// ============================================================================
// 3) Hero-side model
// ============================================================================

export interface BgsPlayerEntity {
	cardId: CardId;
	hpLeft: number;
	readonly tavernTier: number;
	heroPowers: readonly BgsHeroPower[];

	/** @deprecated */
	heroPowerId?: CardId | undefined | null;
	/** @deprecated */
	readonly heroPowerEntityId?: EntityId;
	/** @deprecated */
	readonly heroPowerUsed?: boolean;
	/** @deprecated */
	readonly heroPowerInfo?: number | string;
	/** @deprecated */
	heroPowerInfo2?: number;
	/** @deprecated */
	avengeCurrent?: number;
	/** @deprecated */
	avengeDefault?: number;
	/** @deprecated */
	heroPowerActivated?: boolean;

	friendly?: boolean;
	entityId?: EntityId;

	questEntities: BgsQuestEntity[];
	questRewards?: CardId[];

	questRewardEntities?: {
		cardId: CardId;
		entityId: EntityId;
		avengeDefault?: number;
		avengeCurrent?: number;
		scriptDataNum1: number;
	}[];

	hand?: BoardEntity[];
	secrets?: BoardSecret[];
	trinkets?: BoardTrinket[];
	globalInfo?: BgsPlayerGlobalInfo;

	startOfCombatDone?: boolean;

	// Needed for compatibility with BoardEntity
	enchantments?: BoardEnchantment[];

	deadEyeDamageDone?: number;

	rapidReanimationMinion?: BoardEntity;
	rapidReanimationIndexFromLeft?: number;
	rapidReanimationIndexFromRight?: number;
}

export interface BgsHeroPower {
	cardId: CardId;
	entityId: EntityId;
	used: boolean;

	// In source: number | string | BoardEntity
	info: number | string | BoardEntity;

	info2: number;
	info3: number;
	info4: number;
	info5: number;
	info6: number;

	scoreValue1?: number;
	scoreValue2?: number;
	scoreValue3?: number;

	avengeCurrent?: number;
	avengeDefault?: number;
	locked?: number;

	ready?: boolean;
	activated?: boolean;
}

export interface BgsPlayerGlobalInfo {
	EternalKnightsDeadThisGame?: number;
	SanlaynScribesDeadThisGame?: number;

	UndeadAttackBonus?: number;
	HauntedCarapaceAttackBonus?: number;
	HauntedCarapaceHealthBonus?: number;

	FrostlingBonus?: number;

	BloodGemAttackBonus?: number;
	BloodGemHealthBonus?: number;

	GoldrinnBuffAtk?: number;
	GoldrinnBuffHealth?: number;

	SpellsCastThisGame?: number;
	TavernSpellsCastThisGame?: number;

	PiratesPlayedThisGame?: number;

	BeastsSummonedThisGame?: number;
	BeastsSummonedThisCombat?: number;

	MagnetizedThisGame?: number;

	PiratesSummonedThisGame?: number;
	PirateAttackBonus?: number;

	AstralAutomatonsSummonedThisGame?: number;

	ChoralAttackBuff?: number;
	ChoralHealthBuff?: number;

	BeetleAttackBuff?: number;
	BeetleHealthBuff?: number;

	// Confusing naming: "elementals grant more stats"
	ElementalAttackBuff?: number;
	ElementalHealthBuff?: number;

	PirateAttackBuff?: number;
	PirateHealthBuff?: number;

	TavernSpellHealthBuff?: number;
	TavernSpellAttackBuff?: number;

	GoldSpentThisGame?: number;

	VolumizerHealthBuff?: number;
	VolumizerAttackBuff?: number;

	WhelpAttackBuff?: number;
	WhelpHealthBuff?: number;

	DeepBluesPlayed?: number;

	MutatedLasherAttackBuff?: number;
	MutatedLasherHealthBuff?: number;

	BattlecriesTriggeredThisGame?: number;

	FriendlyMinionsDeadLastCombat?: number;

	AdditionalAttack?: number;
}

export interface BgsQuestEntity {
	CardId: CardId;
	RewardDbfId: number;
	ProgressCurrent: number;
	ProgressTotal: number;
}

export interface BoardTrinket {
	cardId: CardId;
	entityId: EntityId;
	scriptDataNum1: number;
	scriptDataNum2?: number;
	scriptDataNum6?: number;
	rememberedMinion?: BoardEntity;
	avengeDefault?: number;
	avengeCurrent?: number;
}

// ============================================================================
// 4) Internal runtime state (single combat)
// ============================================================================

export interface FullGameState {
	allCards: AllCardsService;
	cardsData: CardsData;
	spectator: Spectator;
	sharedState: SharedState;
	currentTurn: number;
	validTribes: readonly Race[];
	anomalies: readonly string[];
	gameState: GameState;
}

export interface GameState {
	player: PlayerState;
	opponent: PlayerState;
	playerInitial: PlayerState;
	opponentInitial: PlayerState;
}

export interface PlayerState {
	board: BoardEntity[];
	player: BgsPlayerEntity;
	teammate?: PlayerState;
}

export class SharedState {
	public static debugEnabled = false;

	public anomalies: readonly string[] = [];
	public currentEntityId = 1;
	public currentAttackerEntityId: EntityId | null = null;
	public deaths: BoardEntity[] = [];
	public debug = false;

	constructor() {
		this.debug = SharedState.debugEnabled;
	}
}

// ============================================================================
// 5) Outputs
// ============================================================================

export interface SingleSimulationResult {
	readonly result: 'won' | 'lost' | 'tied';
	readonly damageDealt: number;
}

export interface SimulationResult {
	wonLethal: number;
	won: number;
	tied: number;
	lost: number;
	lostLethal: number;

	damageWon: number;
	damageWons: number[];
	damageWonRange: { min: number; max: number };

	damageLost: number;
	damageLosts: number[];
	damageLostRange: { min: number; max: number };

	wonLethalPercent: number;
	wonPercent: number;
	tiedPercent: number;
	lostPercent: number;
	lostLethalPercent: number;

	averageDamageWon: number;
	averageDamageLost: number;

	outcomeSamples?: OutcomeSamples;
}

export interface OutcomeSamples {
	won: readonly GameSample[];
	lost: readonly GameSample[];
	tied: readonly GameSample[];
}

// ============================================================================
// 6) Telemetry / replay types
// ============================================================================

export interface GameSample {
	readonly actions: readonly GameAction[];
	readonly anomalies: readonly string[];
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

export interface Damage {
	readonly sourceEntityId?: EntityId;
	readonly targetEntityId?: EntityId;
	readonly damage?: number;
}

export interface GameEventContext {
	playerBoard: readonly BoardEntity[];
	playerHand: readonly BoardEntity[];
	playerSecrets: readonly BoardSecret[];
	playerTrinkets: readonly BoardTrinket[];

	opponentBoard: readonly BoardEntity[];
	opponentHand: readonly BoardEntity[];
	opponentSecrets: readonly BoardSecret[];
	opponentTrinkets: readonly BoardTrinket[];

	playerCardId: CardId;
	playerEntityId: EntityId;
	playerHeroPowerCardId: CardId;
	playerHeroPowerEntityId: EntityId;
	playerHeroPowerUsed: boolean;
	playerHeroPowers: readonly BgsHeroPower[];

	opponentCardId: CardId;
	opponentEntityId: EntityId;
	opponentHeroPowerCardId: CardId;
	opponentHeroPowerEntityId: EntityId;
	opponentHeroPowerUsed: boolean;
	opponentHeroPowers: readonly BgsHeroPower[];

	playerRewardCardId: CardId;
	playerRewardEntityId: EntityId;
	playerRewardData: number;

	opponentRewardCardId: CardId;
	opponentRewardEntityId: EntityId;
	opponentRewardData: number;
}

export interface StartOfCombatEvent extends GameEventContext {
	type: 'start-of-combat';
}
export interface AttackEvent extends GameEventContext {
	type: 'attack';
	attackerEntityId: EntityId;
	defenderEntityId: EntityId;
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
	sourceEntityId?: EntityId;
}
export interface MinionDeathEvent extends GameEventContext {
	type: 'minion-death';
	deaths: readonly BoardEntity[];
	deadMinionsPositionsOnBoard?: readonly number[];
}
export interface PowerTargetEvent extends GameEventContext {
	type: 'power-target';
	sourceEntityId: EntityId;
	targetEntityIds: readonly EntityId[];
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

/** Back-compat alias used across the codebase */
export type GameAction = GameEvent;

export type CombatPhase = 'START_OF_COMBAT' | 'ATTACK' | 'DEATHS' | 'END_OF_COMBAT';

export type CheckpointReason = 'SOC_START' | 'SOC_END' | 'ATTACK_END' | 'DEATH_BATCH_END' | 'EVERY_N' | 'MANUAL';

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
	| { seq: number; type: 'start-of-combat'; phase: 'START_OF_COMBAT' }
	| { seq: number; type: 'attack'; phase: 'ATTACK'; attackerEntityId: EntityId; defenderEntityId: EntityId }
	| {
			seq: number;
			type: 'damage';
			phase: 'ATTACK' | 'DEATHS';
			sourceEntityId?: EntityId;
			targetEntityId: EntityId;
			damage: number;
			kind: 'combat' | 'effect';
	  }
	| { seq: number; type: 'player-attack'; phase: 'END_OF_COMBAT'; damage: number }
	| { seq: number; type: 'opponent-attack'; phase: 'END_OF_COMBAT'; damage: number }
	| {
			seq: number;
			type: 'power-target';
			phase: 'START_OF_COMBAT' | 'ATTACK' | 'DEATHS';
			sourceEntityId: EntityId;
			targetEntityIds: readonly EntityId[];
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
			sourceEntityId?: EntityId;
			spawned: readonly SanitizedEntity[];
			insertIndexes?: readonly number[];
	  }
	| {
			seq: number;
			type: 'minion-death';
			phase: 'DEATHS';
			deadEntityIds: readonly EntityId[];
			deadMinionsPositionsOnBoard?: readonly number[];
	  };

export interface SpectatorCheckpoint {
	seq: number;
	reason: CheckpointReason;
	snapshot: GameAction;
}

// ============================================================================
// 7) Simulation hook input structs (used by card hooks)
// ============================================================================

export interface SoCInput {
	playerEntity: BgsPlayerEntity;
	playerBoard: BoardEntity[];
	opponentEntity: BgsPlayerEntity;
	opponentBoard: BoardEntity[];
	currentAttacker: number;
	playerBoardBefore?: BoardEntity[];
	opponentBoardBefore?: BoardEntity[];
	gameState: FullGameState;
	playerIsFriendly: boolean;
}

// Keyword update hook inputs (from src/keywords/*)
export interface OnDivineShieldUpdatedInput {
	board: BoardEntity[];
	hero: BgsPlayerEntity;
	otherHero: BgsPlayerEntity;
	gameState: FullGameState;
	target: BoardEntity;
	newValue: boolean;
	previousValue: boolean;
}
export interface OnRebornUpdatedInput {
	board: BoardEntity[];
	hero: BgsPlayerEntity;
	otherHero: BgsPlayerEntity;
	gameState: FullGameState;
	target: BoardEntity;
	newValue: boolean;
	previousValue: boolean;
}
export interface OnStealthUpdatedInput {
	board: BoardEntity[];
	hero: BgsPlayerEntity;
	otherHero: BgsPlayerEntity;
	gameState: FullGameState;
	target: BoardEntity;
	newValue: boolean;
	previousValue: boolean;
}
export interface OnTauntUpdatedInput {
	board: BoardEntity[];
	hero: BgsPlayerEntity;
	otherHero: BgsPlayerEntity;
	gameState: FullGameState;
	target: BoardEntity;
	newValue: boolean;
	previousValue: boolean;
}
export interface OnVenomousUpdatedInput {
	board: BoardEntity[];
	hero: BgsPlayerEntity;
	otherHero: BgsPlayerEntity;
	gameState: FullGameState;
	target: BoardEntity;
	newValue: boolean;
	previousValue: boolean;
}
export interface OnWindfuryUpdatedInput {
	board: BoardEntity[];
	hero: BgsPlayerEntity;
	otherHero: BgsPlayerEntity;
	gameState: FullGameState;
	target: BoardEntity;
	newValue: boolean;
	previousValue: boolean;
}

// Spawn/despawn hook inputs (from add-minion-to-board.ts)
export interface OnSpawnInput {
	hero: BgsPlayerEntity;
	board: BoardEntity[];
	gameState: FullGameState;
}
export interface OnOtherSpawnInput {
	spawned: BoardEntity;
	hero: BgsPlayerEntity;
	board: BoardEntity[];
	otherHero: BgsPlayerEntity;
	otherBoard: BoardEntity[];
	gameState: FullGameState;
	applySelfAuras: boolean;
}
export interface OnOtherSpawnAuraInput {
	spawned: BoardEntity;
	hero: BgsPlayerEntity;
	board: BoardEntity[];
	gameState: FullGameState;
}
export interface OnDespawnInput {
	hero: BgsPlayerEntity;
	board: BoardEntity[];
	gameState: FullGameState;
}

// Death/kill related inputs (from attack.ts)
export interface OnDeathInput {
	readonly hero: BgsPlayerEntity;
	readonly board: BoardEntity[];
	readonly gameState: FullGameState;
}
export interface OnAfterDeathInput {
	readonly hero: BgsPlayerEntity;
	readonly board: BoardEntity[];
	readonly otherHero: BgsPlayerEntity;
	readonly otherBoard: BoardEntity[];
	readonly deadEntities: BoardEntity[];
	readonly gameState: FullGameState;
}
export interface OnMinionKilledInput {
	readonly killer: BoardEntity;
	readonly killerIsAttacking: boolean;
	readonly minionKilled: BoardEntity;
	readonly attackingHero: BgsPlayerEntity;
	readonly attackingBoard: BoardEntity[];
	readonly defendingHero: BgsPlayerEntity;
	readonly defendingBoard: BoardEntity[];
	readonly defenderNeighbours: readonly BoardEntity[];
	readonly gameState: FullGameState;
	readonly playerIsFriendly: boolean;
}

// Avenge / battlecry / blood gems / hand / damage
export interface AvengeInput {
	readonly board: BoardEntity[];
	readonly deadEntity: BoardEntity;
	readonly hero: BgsPlayerEntity;
	readonly otherBoard: BoardEntity[];
	readonly otherHero: BgsPlayerEntity;
	readonly gameState: FullGameState;
}

export interface BattlecryInput {
	board: BoardEntity[];
	hero: BgsPlayerEntity;
	otherBoard: BoardEntity[];
	otherHero: BgsPlayerEntity;
	gameState: FullGameState;
}
/** In source: `export type OnBattlecryTriggeredInput = BattlecryInput;` */
export type OnBattlecryTriggeredInput = BattlecryInput;

export interface PlayedBloodGemsOnAnyInput {
	source: BoardEntity | BoardTrinket | BgsPlayerEntity;
	target: BoardEntity;
	board: BoardEntity[];
	hero: BgsPlayerEntity;
	otherBoard: BoardEntity[];
	otherHero: BgsPlayerEntity;
	gameState: FullGameState;
}
export interface PlayedBloodGemsOnMeInput {
	board: BoardEntity[];
	hero: BgsPlayerEntity;
	otherBoard: BoardEntity[];
	otherHero: BgsPlayerEntity;
	gameState: FullGameState;
}

export interface OnCardAddedToHandInput {
	addedCard: BoardEntity;
	board: BoardEntity[];
	hero: BgsPlayerEntity;
	gameState: FullGameState;
}

export interface AfterDealDamageInput {
	damagedEntity: BoardEntity | BgsPlayerEntity;
	damageDealer: BoardEntity | BgsPlayerEntity;
	damage: number;
	board: BoardEntity[];
	hero: BgsPlayerEntity;
	gameState: FullGameState;
}

export interface AfterHeroDamagedInput {
	damage: number;
	board: BoardEntity[];
	hero: BgsPlayerEntity;
	gameState: FullGameState;
}

export interface DeathrattleTriggeredInput {
	readonly boardWithDeadEntity: BoardEntity[];
	readonly boardWithDeadEntityHero: BgsPlayerEntity;
	readonly deadEntity: BoardEntity;
	readonly otherBoard: BoardEntity[];
	readonly otherBoardHero: BgsPlayerEntity;
	readonly deadEntityIndexFromRight?: number;
	readonly gameState: FullGameState;
}

// Magnetize inputs (from magnetize.ts)
export interface OnBeforeMagnetizeInput {
	board: BoardEntity[];
	hero: BgsPlayerEntity;
	magnetizedCard: Mutable<ReferenceCard>;
	magnetizeTarget: BoardEntity;
	gameState: FullGameState;
}
export interface OnBeforeMagnetizeSelfInput {
	board: BoardEntity[];
	hero: BgsPlayerEntity;
	magnetizeTarget: BoardEntity;
	gameState: FullGameState;
}
export interface OnAfterMagnetizeInput {
	board: BoardEntity[];
	hero: BgsPlayerEntity;
	otherHero: BgsPlayerEntity;
	otherBoard: BoardEntity[];
	magnetizedCard: ReferenceCard;
	magnetizeTarget: BoardEntity;
	gameState: FullGameState;
}
export interface OnAfterMagnetizeSelfInput {
	board: BoardEntity[];
	hero: BgsPlayerEntity;
	magnetizeTarget: BoardEntity;
	gameState: FullGameState;
}

// These three inputs exist in the repo, but weren’t re-extracted in this turn.
// They’re included as *high-confidence shapes* used by hooks.
// If you want, paste the relevant file sections and I’ll tighten them to exact source.

export interface OnAttackInput {
	// High-confidence fields used across on-attack hooks:
	attackingEntity: BoardEntity;
	defendingEntity: BoardEntity;
	attackingHero: BgsPlayerEntity;
	defendingHero: BgsPlayerEntity;
	attackingBoard: BoardEntity[];
	defendingBoard: BoardEntity[];
	gameState: FullGameState;
	playerIsFriendly: boolean;
	/** Optional: neighbors for cleave/adjacency rules */
	defenderNeighbours?: readonly BoardEntity[];
}

export interface OnMinionAttackedInput {
	// High-confidence fields used across on-being-attacked hooks:
	attackedEntity: BoardEntity;
	attacker: BoardEntity;
	attackedHero: BgsPlayerEntity;
	attackedBoard: BoardEntity[];
	attackerHero: BgsPlayerEntity;
	attackerBoard: BoardEntity[];
	gameState: FullGameState;
	playerIsFriendly: boolean;
}

export interface RebornEffectInput {
	rebornedEntity: BoardEntity;
	board: BoardEntity[];
	hero: BgsPlayerEntity;
	otherBoard: BoardEntity[];
	otherHero: BgsPlayerEntity;
	gameState: FullGameState;
	playerIsFriendly: boolean;
}

export interface OnStatsChangedInput {
	entity: BoardEntity;
	board: BoardEntity[];
	hero: BgsPlayerEntity;
	otherBoard?: BoardEntity[];
	otherHero?: BgsPlayerEntity;
	gameState: FullGameState;
	previousAttack: number;
	previousHealth: number;
}

// ============================================================================
// 8) Card hook interfaces (what card implementations can implement)
// ============================================================================

export interface StartOfCombatCard {
	cardIds: readonly CardId[];
	startOfCombat: (minion: BoardEntity | BoardTrinket | BgsHeroPower, input: SoCInput) => void | boolean | {
		shouldRecomputeCurrentAttacker?: boolean;
	};
}

export interface BattlecryCard {
	cardIds: readonly CardId[];
	battlecry: (minion: BoardEntity, input: BattlecryInput) => void;
}

export interface OnBattlecryTriggeredCard {
	cardIds: readonly CardId[];
	onBattlecryTriggered: (minion: BoardEntity, input: OnBattlecryTriggeredInput) => void;
}

export interface AvengeCard {
	cardIds: readonly CardId[];
	baseAvengeValue?: (cardId: CardId) => number;
	avenge: (minion: BoardEntity, input: AvengeInput) => void;
}

export interface AfterDealDamageCard {
	cardIds: readonly CardId[];
	afterDealDamage: (minion: BoardEntity, input: AfterDealDamageInput) => void;
}

export interface OnAttackCard {
	cardIds: readonly CardId[];
	onAttack: (minion: BoardEntity, input: OnAttackInput) => void;
}

export interface OnMinionAttackedCard {
	cardIds: readonly CardId[];
	onMinionAttacked: (minion: BoardEntity, input: OnMinionAttackedInput) => void;
}

export interface OnDeathCard {
	cardIds: readonly CardId[];
	onDeath: (minion: BoardEntity, input: OnDeathInput) => void;
}

export interface OnAfterDeathCard {
	cardIds: readonly CardId[];
	onAfterDeath: (minion: BoardEntity, input: OnAfterDeathInput) => void;
}

export interface OnMinionKilledCard {
	cardIds: readonly CardId[];
	onMinionKilled: (minion: BoardEntity, input: OnMinionKilledInput) => void;
}

export interface DeathrattleTriggeredCard {
	cardIds: readonly CardId[];
	onDeathrattleTriggered: (minion: BoardEntity, input: DeathrattleTriggeredInput) => void;
}

export interface OnSpawnedCard {
	cardIds: readonly CardId[];
	onSpawned: (minion: BoardEntity, input: OnSpawnInput) => void;
}

export interface OnOtherSpawnedCard {
	cardIds: readonly CardId[];
	onOtherSpawned: (minion: BoardEntity, input: OnOtherSpawnInput) => void;
}

export interface OnOtherSpawnAuraCard {
	cardIds: readonly CardId[];
	onOtherSpawnAura: (minion: BoardEntity, input: OnOtherSpawnAuraInput) => void;
}

export interface OnDespawnedCard {
	cardIds: readonly CardId[];
	onDespawned: (minion: BoardEntity, input: OnDespawnInput) => void;
}

export interface PlayedBloodGemsOnAnyCard {
	cardIds: readonly CardId[];
	playedBloodGemsOnAny: (minion: BoardEntity, input: PlayedBloodGemsOnAnyInput) => void;
}

export interface PlayedBloodGemsOnMeCard {
	cardIds: readonly CardId[];
	playedBloodGemsOnMe: (minion: BoardEntity, input: PlayedBloodGemsOnMeInput) => void;
}

export interface OnCardAddedToHandCard {
	cardIds: readonly CardId[];
	onCardAddedToHand: (minion: BoardEntity, input: OnCardAddedToHandInput) => void;
}

export interface OnDivineShieldUpdatedCard {
	cardIds: readonly CardId[];
	onDivineShieldUpdated: (minion: BoardEntity, input: OnDivineShieldUpdatedInput) => void;
}
export interface OnRebornUpdatedCard {
	cardIds: readonly CardId[];
	onRebornUpdated: (minion: BoardEntity, input: OnRebornUpdatedInput) => void;
}
export interface OnStealthUpdatedCard {
	cardIds: readonly CardId[];
	onStealthUpdated: (minion: BoardEntity, input: OnStealthUpdatedInput) => void;
}
export interface OnTauntUpdatedCard {
	cardIds: readonly CardId[];
	onTauntUpdated: (minion: BoardEntity, input: OnTauntUpdatedInput) => void;
}
export interface OnVenomousUpdatedCard {
	cardIds: readonly CardId[];
	onVenomousUpdated: (minion: BoardEntity, input: OnVenomousUpdatedInput) => void;
}
export interface OnWindfuryUpdatedCard {
	cardIds: readonly CardId[];
	onWindfuryUpdated: (minion: BoardEntity, input: OnWindfuryUpdatedInput) => void;
}

export interface OnBeforeMagnetizeCard {
	cardIds: readonly CardId[];
	onBeforeMagnetize: (minion: BoardEntity, input: OnBeforeMagnetizeInput) => void;
}
export interface OnBeforeMagnetizeSelfCard {
	cardIds: readonly CardId[];
	onBeforeMagnetizeSelf: (minion: BoardEntity, input: OnBeforeMagnetizeSelfInput) => void;
}
export interface OnAfterMagnetizeCard {
	cardIds: readonly CardId[];
	onAfterMagnetize: (minion: BoardEntity, input: OnAfterMagnetizeInput) => void;
}
export interface OnAfterMagnetizeSelfCard {
	cardIds: readonly CardId[];
	onAfterMagnetizeSelf: (minion: BoardEntity, input: OnAfterMagnetizeSelfInput) => void;
}

export interface AfterHeroDamagedCard {
	cardIds: readonly CardId[];
	afterHeroDamaged: (minion: BoardEntity, input: AfterHeroDamagedInput) => void;
}

export interface RebornEffectCard {
	cardIds: readonly CardId[];
	rebornEffect: (minion: BoardEntity, input: RebornEffectInput) => void;
}

export interface OnStatsChangedCard {
	cardIds: readonly CardId[];
	onStatsChanged: (minion: BoardEntity, input: OnStatsChangedInput) => void;
}

/**
 * The umbrella card type.
 * Implementations typically satisfy a subset of hook interfaces above.
 */
export type Card =
	| (StartOfCombatCard & Partial<Record<string, never>>)
	| (BattlecryCard & Partial<Record<string, never>>)
	| (AvengeCard & Partial<Record<string, never>>)
	| (AfterDealDamageCard & Partial<Record<string, never>>)
	| (OnAttackCard & Partial<Record<string, never>>)
	| (OnMinionAttackedCard & Partial<Record<string, never>>)
	| (OnDeathCard & Partial<Record<string, never>>)
	| (OnAfterDeathCard & Partial<Record<string, never>>)
	| (OnMinionKilledCard & Partial<Record<string, never>>)
	| (DeathrattleTriggeredCard & Partial<Record<string, never>>)
	| (OnSpawnedCard & Partial<Record<string, never>>)
	| (OnOtherSpawnedCard & Partial<Record<string, never>>)
	| (OnOtherSpawnAuraCard & Partial<Record<string, never>>)
	| (OnDespawnedCard & Partial<Record<string, never>>)
	| (PlayedBloodGemsOnAnyCard & Partial<Record<string, never>>)
	| (PlayedBloodGemsOnMeCard & Partial<Record<string, never>>)
	| (OnCardAddedToHandCard & Partial<Record<string, never>>)
	| (OnDivineShieldUpdatedCard & Partial<Record<string, never>>)
	| (OnRebornUpdatedCard & Partial<Record<string, never>>)
	| (OnStealthUpdatedCard & Partial<Record<string, never>>)
	| (OnTauntUpdatedCard & Partial<Record<string, never>>)
	| (OnVenomousUpdatedCard & Partial<Record<string, never>>)
	| (OnWindfuryUpdatedCard & Partial<Record<string, never>>)
	| (OnBeforeMagnetizeCard & Partial<Record<string, never>>)
	| (OnBeforeMagnetizeSelfCard & Partial<Record<string, never>>)
	| (OnAfterMagnetizeCard & Partial<Record<string, never>>)
	| (OnAfterMagnetizeSelfCard & Partial<Record<string, never>>)
	| (AfterHeroDamagedCard & Partial<Record<string, never>>)
	| (RebornEffectCard & Partial<Record<string, never>>)
	| (OnStatsChangedCard & Partial<Record<string, never>>)
	| {
			cardIds: readonly CardId[];
			// Allow unknown extra hooks without breaking the typedef file
			[hookName: string]: any;
	  };

// ============================================================================
// 9) Type guard signatures (card.interface.ts pattern)
// ============================================================================

export const hasStartOfCombat = (card: any): card is StartOfCombatCard => !!card?.startOfCombat;
export const hasBattlecry = (card: any): card is BattlecryCard => !!card?.battlecry;
export const hasOnBattlecryTriggered = (card: any): card is OnBattlecryTriggeredCard => !!card?.onBattlecryTriggered;

export const hasAvenge = (card: any): card is AvengeCard => !!card?.avenge;

export const hasAfterDealDamage = (card: any): card is AfterDealDamageCard => !!card?.afterDealDamage;

export const hasOnAttack = (card: any): card is OnAttackCard => !!card?.onAttack;
export const hasOnMinionAttacked = (card: any): card is OnMinionAttackedCard => !!card?.onMinionAttacked;

export const hasOnDeath = (card: any): card is OnDeathCard => !!card?.onDeath;
export const hasOnAfterDeath = (card: any): card is OnAfterDeathCard => !!card?.onAfterDeath;
export const hasOnMinionKilled = (card: any): card is OnMinionKilledCard => !!card?.onMinionKilled;

export const hasOnDeathrattleTriggered = (card: any): card is DeathrattleTriggeredCard => !!card?.onDeathrattleTriggered;

export const hasOnSpawned = (card: any): card is OnSpawnedCard => !!card?.onSpawned;
export const hasOnOtherSpawned = (card: any): card is OnOtherSpawnedCard => !!card?.onOtherSpawned;
export const hasOnOtherSpawnAura = (card: any): card is OnOtherSpawnAuraCard => !!card?.onOtherSpawnAura;
export const hasOnDespawned = (card: any): card is OnDespawnedCard => !!card?.onDespawned;

export const hasPlayedBloodGemsOnAny = (card: any): card is PlayedBloodGemsOnAnyCard => !!card?.playedBloodGemsOnAny;
export const hasPlayedBloodGemsOnMe = (card: any): card is PlayedBloodGemsOnMeCard => !!card?.playedBloodGemsOnMe;

export const hasOnCardAddedToHand = (card: any): card is OnCardAddedToHandCard => !!card?.onCardAddedToHand;

export const hasOnDivineShieldUpdated = (card: any): card is OnDivineShieldUpdatedCard => !!card?.onDivineShieldUpdated;
export const hasOnRebornUpdated = (card: any): card is OnRebornUpdatedCard => !!card?.onRebornUpdated;
export const hasOnStealthUpdated = (card: any): card is OnStealthUpdatedCard => !!card?.onStealthUpdated;
export const hasOnTauntUpdated = (card: any): card is OnTauntUpdatedCard => !!card?.onTauntUpdated;
export const hasOnVenomousUpdated = (card: any): card is OnVenomousUpdatedCard => !!card?.onVenomousUpdated;
export const hasOnWindfuryUpdated = (card: any): card is OnWindfuryUpdatedCard => !!card?.onWindfuryUpdated;

export const hasOnBeforeMagnetize = (card: any): card is OnBeforeMagnetizeCard => !!card?.onBeforeMagnetize;
export const hasOnBeforeMagnetizeSelf = (card: any): card is OnBeforeMagnetizeSelfCard => !!card?.onBeforeMagnetizeSelf;
export const hasOnAfterMagnetize = (card: any): card is OnAfterMagnetizeCard => !!card?.onAfterMagnetize;
export const hasOnAfterMagnetizeSelf = (card: any): card is OnAfterMagnetizeSelfCard => !!card?.onAfterMagnetizeSelf;

export const hasAfterHeroDamaged = (card: any): card is AfterHeroDamagedCard => !!card?.afterHeroDamaged;

export const hasRebornEffect = (card: any): card is RebornEffectCard => !!card?.rebornEffect;

export const hasOnStatsChanged = (card: any): card is OnStatsChangedCard => !!card?.onStatsChanged;

// ============================================================================
// 10) Spectator placeholder (runtime implementation lives in src/simulation/spectator/*)
// ============================================================================

export interface Spectator {
	// Keep this intentionally loose for typedef file.
	[runtimeKey: string]: any;
}