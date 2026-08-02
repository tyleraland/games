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

/** Open-circuit voltage of the source at upgrade level 0. */
export const SOURCE_VOLTS_BASE = 48;
export const SOURCE_VOLTS_PER_LEVEL = 12;

/**
 * The source is not ideal — it has internal resistance, and every amp drawn
 * through it costs I·r volts at the terminal before the network even starts.
 *
 * This is what a brownout *is* here: not a penalty applied to the score, but
 * the bus voltage genuinely sagging, exactly as it would if you hung too much
 * load on a real supply. Everything downstream follows from it for free —
 * lights dim, the far end of the grid drops below its wake threshold, and taps
 * earn less because they are actually under-volted.
 *
 * The Capacity upgrade makes the source stiffer by lowering this resistance.
 */
export const SOURCE_OHMS_BASE = 2.5;

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

// Sag is measured as the fraction of open-circuit voltage lost at the source
// terminal. The bands mirror how real undervoltage is talked about: a brownout
// is usually described as a 10–25% reduction, and below roughly 40% of nominal
// protective gear drops the load rather than let equipment cook.

/** Below this the bus is healthy and nothing visibly changes. */
export const SAG_BROWNOUT = 0.08;

/** Past this the flicker turns ugly and the far grid starts falling over. */
export const SAG_SEVERE = 0.25;

/** Undervoltage trip: the breaker opens and the whole network goes dark. */
export const SAG_TRIP = 0.6;

/** How far a browned-out bus has fallen through the band, as 0..1. */
export const sagSeverity = (sag: number) =>
	Math.max(0, Math.min(1, (sag - SAG_BROWNOUT) / (SAG_TRIP - SAG_BROWNOUT)));

/* ------------------------------------------------------------------ */
/* Economy                                                             */
/* ------------------------------------------------------------------ */

/**
 * Enough to fund the first four or five runs outright. At 80 the opening was
 * two builds and then 8–25 seconds of watching a single tap trickle before the
 * next one was affordable, which is the worst part of the game sitting at the
 * front of it. This shortens the cold start without touching the income curve,
 * the sag economy or any later price.
 */
export const START_COINS = 120;

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

/**
 * The battery acts as voltage support: while it has charge it injects current
 * at the bus to hold the sag down to this, which is what a real grid battery
 * is for.
 */
export const BATTERY_SUPPORT_SAG = 0.06;

/* ------------------------------------------------------------------ */
/* Derived source/battery stats                                        */
/* ------------------------------------------------------------------ */

export const sourceVolts = (level: number) =>
	SOURCE_VOLTS_BASE + SOURCE_VOLTS_PER_LEVEL * level;

/** Internal resistance (Ω). Each Capacity level makes the source stiffer. */
export const sourceOhms = (level: number) =>
	SOURCE_OHMS_BASE / (1 + 0.5 * level);

/**
 * The most power this source can ever hand to a load. Maximum power transfer
 * happens when the external load matches the internal resistance, at which
 * point the terminal sits at half the open-circuit voltage — so the ceiling is
 * V²/4r. Shown as the source's rating.
 */
export const sourceMaxWatts = (volts: number, ohms: number) =>
	(volts * volts) / (4 * ohms);

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
	/** Connections on offer — distinct from both rails so offers never read as live. */
	offer: '#6fd6c4',
	/** An offer you cannot currently afford. */
	offerPoor: '#6b7488',
	/** The node you are currently wiring from. */
	anchor: '#f4f1de',
};

/* ------------------------------------------------------------------ */
/* Building                                                            */
/* ------------------------------------------------------------------ */

/**
 * How many builds back the Undo stack remembers. Deep enough that a run of
 * mis-taps is recoverable, shallow enough that it stays a mis-tap eraser
 * rather than a free rewind of the whole game.
 */
export const UNDO_DEPTH = 12;

/** How long the surge along a freshly built run lasts, in ms. */
export const BUILD_FLASH_MS = 520;
