import { create } from 'zustand';
import {
	BATTERY_SUPPORT_SAG,
	MAX_YIELD_MULTIPLIER,
	REFERENCE_VOLTS,
	REFUND_FRACTION,
	SAG_TRIP,
	SOURCE_ID,
	START_COINS,
	TICK_MS,
	batteryJoules,
	batteryWatts,
	sourceMaxWatts,
	sourceOhms,
	sourceVolts,
	upgradeCost,
	type UpgradeKind,
} from './config';
import { solve, type Solution } from './sim';
import {
	edgeId,
	getNode,
	linkProblem,
	makeEdge,
	type FlowyEdge,
} from './world';

/** What the player currently has picked, for the inspector panel. */
export type Selection =
	| { type: 'node'; id: string }
	| { type: 'edge'; id: string }
	| null;

/** Snapshot of the last beat, for the HUD. */
export interface Meters {
	/** What the source would read with nothing hung off it. */
	openVolts: number;
	/** What it actually reads under load. The gap is the brownout. */
	terminalVolts: number;
	/** Fraction of open-circuit voltage lost at the terminal, 0..1. */
	sag: number;
	/** Total current the network is pulling. */
	totalAmps: number;
	/** Watts handed to the network at the terminal. */
	demandW: number;
	/** The source's own ceiling, V²/4r. */
	maxW: number;
	/** Watts the battery contributed (negative while charging). */
	batteryW: number;
	/** Amps the battery injected at the bus. */
	batteryAmps: number;
	/** Watts lost as heat in wires and node internals. */
	lossW: number;
	/** Watts cooked inside the source by its own resistance. */
	sourceLossW: number;
	/** Coins earned on the last beat. */
	incomeC: number;
}

const NO_METERS: Meters = {
	openVolts: 0,
	terminalVolts: 0,
	sag: 0,
	totalAmps: 0,
	demandW: 0,
	maxW: 0,
	batteryW: 0,
	batteryAmps: 0,
	lossW: 0,
	sourceLossW: 0,
	incomeC: 0,
};

interface FlowyState {
	edges: Record<string, FlowyEdge>;
	solution: Solution;

	coins: number;
	beat: number;
	stored: number; // joules currently in the battery
	tripped: boolean; // breaker has blown; nothing flows until reset
	levels: Record<UpgradeKind, number>;
	meters: Meters;

	/** UI: 'select' inspects, 'build' wires the next two nodes clicked. */
	mode: 'select' | 'build';
	selection: Selection;
	/** First endpoint chosen while in build mode. */
	linkFrom: string | null;
	/** Transient message shown under the HUD (bad purchase, blackout, …). */
	notice: string | null;

	tick: () => void;
	setMode: (mode: 'select' | 'build') => void;
	select: (selection: Selection) => void;
	/** Click a node: selects it, or advances the two-step build. */
	tapNode: (id: string) => void;
	cancelLink: () => void;
	buildLink: (from: string, to: string) => void;
	flipPolarity: (id: string) => void;
	toggleEnabled: (id: string) => void;
	removeLink: (id: string) => void;
	buy: (kind: UpgradeKind) => void;
	resetBreaker: () => void;
	notify: (message: string | null) => void;
}

/**
 * Re-run the solve against the current graph, upgrades and battery support.
 * A tripped breaker is an open circuit: the source sits at open-circuit volts
 * with nothing drawing on it, and the network sees nothing at all.
 */
function resolve(
	edges: Record<string, FlowyEdge>,
	levels: Record<UpgradeKind, number>,
	tripped: boolean,
	batteryAmps = 0,
): Solution {
	const spec = {
		openVolts: sourceVolts(levels.volts),
		ohms: sourceOhms(levels.watts),
		batteryAmps,
	};
	return solve(tripped ? [] : Object.values(edges), spec);
}

export const useFlowy = create<FlowyState>((set, get) => ({
	edges: {},
	solution: resolve({}, { volts: 0, watts: 0, battery: 0 }, false),

	coins: START_COINS,
	beat: 0,
	stored: 0,
	tripped: false,
	levels: { volts: 0, watts: 0, battery: 0 },
	meters: NO_METERS,

	mode: 'select',
	selection: { type: 'node', id: SOURCE_ID },
	linkFrom: null,
	notice: null,

	/* ---------------------------------------------------------------- */
	/* The beat                                                          */
	/* ---------------------------------------------------------------- */

	tick: () => {
		const s = get();
		const dt = TICK_MS / 1000;
		const openVolts = sourceVolts(s.levels.volts);
		const ohms = sourceOhms(s.levels.watts);
		const capJ = batteryJoules(s.levels.battery);
		const rateW = batteryWatts(s.levels.battery);

		// Solve once with the source carrying everything, to see how far the bus
		// would fall on its own.
		const bare = resolve(s.edges, s.levels, s.tripped);

		// The battery is voltage support: it injects current at the bus to hold
		// the sag down to its target, and soaks up spare current to charge when
		// there is headroom. Positive amps discharge, negative amps charge.
		const allowedAmps = ohms > 0 ? (openVolts * BATTERY_SUPPORT_SAG) / ohms : 0;
		const vEst = Math.max(bare.terminalVolts, 1);
		let batteryAmps = 0;
		if (capJ > 0 && !s.tripped) {
			if (bare.totalAmps > allowedAmps) {
				batteryAmps = Math.min(
					bare.totalAmps - allowedAmps,
					rateW / vEst,
					s.stored / dt / vEst,
				);
			} else {
				// Charging pulls extra current through the source, so never take
				// more than the headroom that keeps the bus inside its target.
				batteryAmps = -Math.min(
					allowedAmps - bare.totalAmps,
					rateW / vEst,
					(capJ - s.stored) / dt / vEst,
				);
			}
		}

		const solution = resolve(s.edges, s.levels, s.tripped, batteryAmps);
		const batteryW = batteryAmps * Math.max(solution.terminalVolts, 1);
		const stored = Math.max(
			0,
			Math.min(capJ, s.stored - batteryW * dt),
		);

		// Undervoltage trip: past SAG_TRIP the protective gear drops the load
		// rather than let everything sit there cooking at half voltage.
		if (!s.tripped && solution.sag > SAG_TRIP) {
			set({
				tripped: true,
				stored,
				beat: s.beat + 1,
				solution: resolve(s.edges, s.levels, true),
				meters: { ...NO_METERS, openVolts, maxW: sourceMaxWatts(openVolts, ohms) },
				notice:
					'Blackout — undervoltage trip. Shed load or stiffen the source, then reset the breaker.',
			});
			return;
		}

		// Taps pay out in proportion to how well they are actually fed. There is
		// no brownout multiplier anywhere: a sagging bus lowers every node's
		// potential, and the lower potential is what shrinks the payout.
		let incomeC = 0;
		for (const id of solution.energized) {
			const node = getNode(id);
			if (!node || node.def.yield === 0) continue;
			const v = Math.abs(solution.volts.get(id) ?? 0);
			const quality = Math.min(v / REFERENCE_VOLTS, MAX_YIELD_MULTIPLIER);
			incomeC += node.def.yield * quality;
		}

		set({
			beat: s.beat + 1,
			coins: s.coins + incomeC,
			stored,
			solution,
			meters: {
				openVolts,
				terminalVolts: solution.terminalVolts,
				sag: solution.sag,
				totalAmps: solution.totalAmps,
				demandW: solution.demandW,
				maxW: sourceMaxWatts(openVolts, ohms),
				batteryW,
				batteryAmps,
				lossW: solution.lossW,
				sourceLossW: solution.sourceLossW,
				incomeC,
			},
		});
	},

	/* ---------------------------------------------------------------- */
	/* Player actions                                                    */
	/* ---------------------------------------------------------------- */

	setMode: (mode) => set({ mode, linkFrom: null, notice: null }),
	select: (selection) => set({ selection }),
	notify: (notice) => set({ notice }),
	cancelLink: () => set({ linkFrom: null }),

	tapNode: (id) => {
		const s = get();
		if (s.mode !== 'build') {
			set({ selection: { type: 'node', id }, notice: null });
			return;
		}
		if (!s.linkFrom) {
			set({ linkFrom: id, selection: { type: 'node', id }, notice: null });
			return;
		}
		if (s.linkFrom === id) {
			set({ linkFrom: null });
			return;
		}
		get().buildLink(s.linkFrom, id);
	},

	buildLink: (from, to) => {
		const s = get();
		const a = getNode(from);
		const b = getNode(to);
		if (!a || !b) return;

		const problem = linkProblem(a, b, s.edges);
		if (problem) {
			set({ notice: problem, linkFrom: null });
			return;
		}
		const edge = makeEdge(a, b);
		if (s.coins < edge.paid) {
			set({
				notice: `Not enough coins — this run costs ${edge.paid}`,
				linkFrom: null,
			});
			return;
		}

		const edges = { ...s.edges, [edge.id]: edge };
		set({
			edges,
			coins: s.coins - edge.paid,
			// Chain from the node just wired, so long runs are a series of clicks.
			linkFrom: to,
			selection: { type: 'edge', id: edge.id },
			solution: resolve(edges, s.levels, s.tripped),
			notice: null,
		});
	},

	flipPolarity: (id) => {
		const s = get();
		const edge = s.edges[id];
		if (!edge) return;
		const edges = {
			...s.edges,
			[id]: { ...edge, polarity: (edge.polarity * -1) as 1 | -1 },
		};
		set({ edges, solution: resolve(edges, s.levels, s.tripped) });
	},

	toggleEnabled: (id) => {
		const s = get();
		const edge = s.edges[id];
		if (!edge) return;
		const edges = { ...s.edges, [id]: { ...edge, enabled: !edge.enabled } };
		set({ edges, solution: resolve(edges, s.levels, s.tripped) });
	},

	removeLink: (id) => {
		const s = get();
		const edge = s.edges[id];
		if (!edge) return;
		const edges = { ...s.edges };
		delete edges[id];
		set({
			edges,
			coins: s.coins + Math.floor(edge.paid * REFUND_FRACTION),
			selection: null,
			solution: resolve(edges, s.levels, s.tripped),
		});
	},

	buy: (kind) => {
		const s = get();
		const cost = upgradeCost(kind, s.levels[kind]);
		if (s.coins < cost) {
			set({ notice: `Not enough coins — that upgrade costs ${cost}` });
			return;
		}
		const levels = { ...s.levels, [kind]: s.levels[kind] + 1 };
		set({
			levels,
			coins: s.coins - cost,
			// Volts and stiffness both move the terminal, and the terminal is
			// where every potential in the network is propagated from. Only the
			// battery leaves the solve alone until the next beat.
			solution:
				kind === 'battery'
					? s.solution
					: resolve(s.edges, levels, s.tripped),
			notice: null,
		});
	},

	resetBreaker: () => {
		const s = get();
		set({
			tripped: false,
			solution: resolve(s.edges, s.levels, false),
			notice: null,
		});
	},
}));

/** Convenience for the canvas, which reads state outside React's render loop. */
export const flowyState = () => useFlowy.getState();

// Dev-only handle on the live store, so the console and integration checks can
// set up a board directly instead of clicking through an entire build order.
// Stripped from production builds by the `import.meta.env.DEV` guard.
if (import.meta.env.DEV) {
	(window as unknown as { flowy?: typeof useFlowy }).flowy = useFlowy;
}

/** The id a hovered node would connect *from*, if a build is in progress. */
export const pendingEdgeId = (from: string | null, to: string | null) =>
	from && to ? edgeId(from, to) : null;
