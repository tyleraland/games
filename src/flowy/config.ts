// Flowy — every tunable number lives here so the simulation, the economy and
// the renderer all read the same values. Nothing in this file imports game
// state, so it is safe to pull into any module.

/** One "beat" of the source: coins, battery and brownout all step on this. */
export const TICK_MS = 1000;

/* ------------------------------------------------------------------ */
/* World generation                                                    */
/* ------------------------------------------------------------------ */

export const WORLD_SEED = 0x9e3779b9;

/** Fraction of lattice cells that hold a node. */
export const NODE_DENSITY = 0.2;

/** The source is always at the origin. */
export const SOURCE_ID = '0:0';

/** Longest connection the player may build, in grid units. */
export const MAX_LINK_DIST = 3;

/* ------------------------------------------------------------------ */
/* Electrical model                                                    */
/* ------------------------------------------------------------------ */

/** Terminal voltage of the source at upgrade level 0. */
export const SOURCE_VOLTS_BASE = 48;
export const SOURCE_VOLTS_PER_LEVEL = 12;

/** Power the source can deliver before it browns out, at level 0. */
export const SOURCE_WATTS_BASE = 120;
export const SOURCE_WATTS_PER_LEVEL = 60;

/**
 * A node needs at least this much potential — either polarity — to wake up.
 * Below it the node goes dark but keeps drawing, so an over-long run costs
 * watts without earning anything.
 */
export const MIN_VOLTS = 6;

/** Voltage a tap is rated for. Its output scales with |V| / this. */
export const REFERENCE_VOLTS = 48;

/** Even a wildly over-volted tap cannot exceed this multiple of its rating. */
export const MAX_YIELD_MULTIPLIER = 2;

/** Wire resistance per grid unit of length (Ω). */
export const WIRE_OHMS_PER_UNIT = 0.35;

/* ------------------------------------------------------------------ */
/* Brownout / blackout                                                 */
/* ------------------------------------------------------------------ */

/**
 * Above 100% load the source sags. Output is multiplied by 1/load², so the
 * penalty bites quadratically the further past capacity you push: 110% load
 * costs you 17% of your yield, 150% costs you 56%.
 */
export const brownoutFactor = (load: number) =>
	load <= 1 ? 1 : 1 / (load * load);

/** At twice capacity the breaker trips and the whole network goes dark. */
export const BLACKOUT_LOAD = 2;

/* ------------------------------------------------------------------ */
/* Economy                                                             */
/* ------------------------------------------------------------------ */

export const START_COINS = 80;

/**
 * Connections cost more than linearly in length, so reaching a distant node is
 * a real decision rather than always-correct. Long wires also carry more
 * resistance, which is the other half of the tradeoff.
 */
export const linkCost = (length: number) => Math.round(6 + 4 * length * length);

/** Tearing out a connection returns half of what it cost. */
export const REFUND_FRACTION = 0.5;

export const UPGRADES = {
	volts: { base: 45, growth: 1.65 },
	watts: { base: 35, growth: 1.55 },
	battery: { base: 70, growth: 1.8 },
} as const;

export type UpgradeKind = keyof typeof UPGRADES;

export const upgradeCost = (kind: UpgradeKind, level: number) =>
	Math.round(UPGRADES[kind].base * UPGRADES[kind].growth ** level);

/* ------------------------------------------------------------------ */
/* Battery                                                             */
/* ------------------------------------------------------------------ */

/** Storage in joules (watt-seconds) per battery level. Level 0 = no battery. */
export const BATTERY_JOULES_PER_LEVEL = 400;

/** How fast it can absorb or release, in watts, per level. */
export const BATTERY_WATTS_PER_LEVEL = 30;

/* ------------------------------------------------------------------ */
/* Derived source/battery stats                                        */
/* ------------------------------------------------------------------ */

export const sourceVolts = (level: number) =>
	SOURCE_VOLTS_BASE + SOURCE_VOLTS_PER_LEVEL * level;

export const sourceWatts = (level: number) =>
	SOURCE_WATTS_BASE + SOURCE_WATTS_PER_LEVEL * level;

export const batteryJoules = (level: number) =>
	BATTERY_JOULES_PER_LEVEL * level;

export const batteryWatts = (level: number) => BATTERY_WATTS_PER_LEVEL * level;

/* ------------------------------------------------------------------ */
/* Presentation                                                        */
/* ------------------------------------------------------------------ */

export const CAMERA = {
	/** Pixels per grid unit. */
	zoom: 56,
	minZoom: 18,
	maxZoom: 130,
};

/** How many graph hops a charge pulse advances per beat of the source. */
export const PULSE_HOPS_PER_BEAT = 4;

export const COLORS = {
	background: '#0b0e14',
	grid: '#151a24',
	gridAxis: '#1e2634',
	positive: '#e8794b',
	negative: '#5aa9e6',
	disabled: '#39404f',
	dead: '#2a3140',
	select: '#f4f1de',
	text: '#c7d0dd',
};
