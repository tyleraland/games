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
	getNode,
	ghostLinks,
	linkProblem,
	makeEdge,
	type FlowyEdge,
	type GhostLink,
} from './world';

/** What the player currently has picked, for the inspector panel. */
export type Selection =
	| { type: 'node'; id: string }
	| { type: 'edge'; id: string }
	| { type: 'ghost'; id: string }
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

	/** UI: 'select' inspects, 'add' overlays every connection you could buy. */
	mode: 'select' | 'add';
	selection: Selection;
	/** The connections on offer while in add mode. Recomputed as the grid grows. */
	ghosts: GhostLink[];
	/** Transient message shown under the HUD (bad purchase, blackout, …). */
	notice: string | null;

	tick: () => void;
	setMode: (mode: 'select' | 'add') => void;
	select: (selection: Selection) => void;
	/** Click a node: inspects it. */
	tapNode: (id: string) => void;
	/** Buy the ghost currently selected. */
	confirmGhost: () => void;
	flipPolarity: (id: string) => void;
	/** Swap which end feeds which, when a run was laid the wrong way round. */
	reverseLink: (id: string) => void;
	toggleEnabled: (id: string) => void;
	removeLink: (id: string) => void;
	buy: (kind: UpgradeKind) => void;
	resetBreaker: () => void;
	notify: (message: string | null) => void;
}

/**
 * The connections currently on offer. Everything the source can reach counts as
 * "on the network", plus the source itself, so a fresh game still has somewhere
 * to start.
 */
function buildGhosts(
	edges: Record<string, FlowyEdge>,
	solution: Solution,
): GhostLink[] {
	const network = new Set<string>([SOURCE_ID, ...solution.order]);
	const rankOf = new Map<string, number>();
	solution.order.forEach((id, i) => rankOf.set(id, i));
	return ghostLinks(network, edges, (id) => rankOf.get(id) ?? Infinity);
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
	ghosts: [],
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

	setMode: (mode) => {
		const s = get();
		set({
			mode,
			// Offers are only meaningful while you are shopping for one.
			ghosts: mode === 'add' ? buildGhosts(s.edges, s.solution) : [],
			selection: s.selection?.type === 'ghost' ? null : s.selection,
			notice: null,
		});
	},

	select: (selection) => set({ selection }),
	notify: (notice) => set({ notice }),

	tapNode: (id) => set({ selection: { type: 'node', id }, notice: null }),

	confirmGhost: () => {
		const s = get();
		if (s.selection?.type !== 'ghost') return;
		const ghost = s.ghosts.find((g) => g.id === s.selection!.id);
		if (!ghost) return;

		const a = getNode(ghost.from);
		const b = getNode(ghost.to);
		if (!a || !b) return;

		// Re-check rather than trust the offer: the graph may have moved on.
		const problem = linkProblem(a, b, s.edges);
		if (problem) {
			set({ notice: problem, selection: null });
			return;
		}
		const edge = makeEdge(a, b);
		if (s.coins < edge.paid) {
			set({ notice: `Not enough coins — this run costs ${edge.paid}` });
			return;
		}

		const edges = { ...s.edges, [edge.id]: edge };
		const solution = resolve(edges, s.levels, s.tripped);
		set({
			edges,
			coins: s.coins - edge.paid,
			solution,
			// Stay in add mode with a refreshed set of offers, so laying a run is
			// tap-confirm-tap-confirm rather than a trip back through the toolbar.
			ghosts: buildGhosts(edges, solution),
			selection: { type: 'edge', id: edge.id },
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

	reverseLink: (id) => {
		const s = get();
		const edge = s.edges[id];
		if (!edge) return;
		const a = getNode(edge.to);
		const b = getNode(edge.from);
		if (!a || !b) return;

		const rest = { ...s.edges };
		delete rest[id];
		const problem = linkProblem(a, b, rest);
		if (problem) {
			set({ notice: problem });
			return;
		}
		// Same wire, same price already paid — only which end feeds which changes.
		const flipped: FlowyEdge = {
			...edge,
			id: `${edge.to}>${edge.from}`,
			from: edge.to,
			to: edge.from,
		};
		const edges = { ...rest, [flipped.id]: flipped };
		const solution = resolve(edges, s.levels, s.tripped);
		set({
			edges,
			solution,
			ghosts: s.mode === 'add' ? buildGhosts(edges, solution) : s.ghosts,
			selection: { type: 'edge', id: flipped.id },
			notice: null,
		});
	},

	toggleEnabled: (id) => {
		const s = get();
		const edge = s.edges[id];
		if (!edge) return;
		const edges = { ...s.edges, [id]: { ...edge, enabled: !edge.enabled } };
		const solution = resolve(edges, s.levels, s.tripped);
		set({
			edges,
			solution,
			ghosts: s.mode === 'add' ? buildGhosts(edges, solution) : s.ghosts,
		});
	},

	removeLink: (id) => {
		const s = get();
		const edge = s.edges[id];
		if (!edge) return;
		const edges = { ...s.edges };
		delete edges[id];
		const solution = resolve(edges, s.levels, s.tripped);
		set({
			edges,
			coins: s.coins + Math.floor(edge.paid * REFUND_FRACTION),
			selection: null,
			solution,
			ghosts: s.mode === 'add' ? buildGhosts(edges, solution) : s.ghosts,
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
