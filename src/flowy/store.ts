import { create } from 'zustand';
import {
	BLACKOUT_LOAD,
	MAX_YIELD_MULTIPLIER,
	REFERENCE_VOLTS,
	REFUND_FRACTION,
	SOURCE_ID,
	START_COINS,
	TICK_MS,
	batteryJoules,
	batteryWatts,
	brownoutFactor,
	sourceVolts,
	sourceWatts,
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
	/** Watts drawn at the source terminal. */
	demandW: number;
	/** Watts the source itself can supply. */
	capacityW: number;
	/** Watts the battery contributed (negative while charging). */
	batteryW: number;
	/** demand / (capacity + battery discharge). */
	load: number;
	/** Output multiplier from the brownout curve — 1 when healthy. */
	factor: number;
	/** Watts lost as heat in wires and node internals. */
	lossW: number;
	/** Coins earned on the last beat. */
	incomeC: number;
}

const NO_METERS: Meters = {
	demandW: 0,
	capacityW: 0,
	batteryW: 0,
	load: 0,
	factor: 1,
	lossW: 0,
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

/** Re-run the solve against the current graph and upgrade level. */
function resolve(
	edges: Record<string, FlowyEdge>,
	voltLevel: number,
	tripped: boolean,
): Solution {
	if (tripped) return solve([], sourceVolts(voltLevel));
	return solve(Object.values(edges), sourceVolts(voltLevel));
}

export const useFlowy = create<FlowyState>((set, get) => ({
	edges: {},
	solution: solve([], sourceVolts(0)),

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
		const capacityW = sourceWatts(s.levels.watts);
		const demandW = s.tripped ? 0 : s.solution.demandW;

		// The battery fills from whatever headroom is left and empties to cover a
		// shortfall — which is what keeps a spiky network out of brownout.
		const capJ = batteryJoules(s.levels.battery);
		const rateW = batteryWatts(s.levels.battery);
		const deficit = demandW - capacityW;
		let batteryW = 0;
		let stored = s.stored;
		if (deficit > 0) {
			batteryW = Math.min(deficit, rateW, stored / dt);
		} else if (capJ > 0) {
			batteryW = -Math.min(-deficit, rateW, (capJ - stored) / dt);
		}
		stored = Math.max(0, Math.min(capJ, stored - batteryW * dt));

		const supplyW = capacityW + Math.max(0, batteryW);
		const load = supplyW > 0 ? demandW / supplyW : 0;

		// Past twice capacity the breaker gives up entirely.
		if (!s.tripped && load >= BLACKOUT_LOAD) {
			set({
				tripped: true,
				stored,
				beat: s.beat + 1,
				solution: resolve(s.edges, s.levels.volts, true),
				meters: {
					...NO_METERS,
					demandW,
					capacityW,
					load,
					factor: 0,
				},
				notice: 'Blackout — the breaker tripped. Shed load, then reset it.',
			});
			return;
		}

		const factor = s.tripped ? 0 : brownoutFactor(load);

		// Taps pay out in proportion to how well they are fed: a tap sitting at
		// half its rated voltage returns half a coin, and a brownout scales the
		// whole network down on top of that.
		let incomeC = 0;
		if (!s.tripped) {
			for (const id of s.solution.energized) {
				const node = getNode(id);
				if (!node || node.def.yield === 0) continue;
				const v = Math.abs(s.solution.volts.get(id) ?? 0);
				const quality = Math.min(v / REFERENCE_VOLTS, MAX_YIELD_MULTIPLIER);
				incomeC += node.def.yield * quality * factor;
			}
		}

		set({
			beat: s.beat + 1,
			coins: s.coins + incomeC,
			stored,
			meters: {
				demandW,
				capacityW,
				batteryW,
				load,
				factor,
				lossW: s.tripped ? 0 : s.solution.lossW,
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
			solution: resolve(edges, s.levels.volts, s.tripped),
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
		set({ edges, solution: resolve(edges, s.levels.volts, s.tripped) });
	},

	toggleEnabled: (id) => {
		const s = get();
		const edge = s.edges[id];
		if (!edge) return;
		const edges = { ...s.edges, [id]: { ...edge, enabled: !edge.enabled } };
		set({ edges, solution: resolve(edges, s.levels.volts, s.tripped) });
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
			solution: resolve(edges, s.levels.volts, s.tripped),
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
			// A voltage bump changes every potential in the network.
			solution:
				kind === 'volts'
					? resolve(s.edges, levels.volts, s.tripped)
					: s.solution,
			notice: null,
		});
	},

	resetBreaker: () => {
		const s = get();
		set({
			tripped: false,
			solution: resolve(s.edges, s.levels.volts, false),
			notice: null,
		});
	},
}));

/** Convenience for the canvas, which reads state outside React's render loop. */
export const flowyState = () => useFlowy.getState();

/** The id a hovered node would connect *from*, if a build is in progress. */
export const pendingEdgeId = (from: string | null, to: string | null) =>
	from && to ? edgeId(from, to) : null;
