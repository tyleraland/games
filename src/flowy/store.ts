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
	UNDO_DEPTH,
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
	linkProblem,
	makeEdge,
	offersFrom,
	type FlowyEdge,
	type LinkOffer,
} from './world';

/**
 * What the player currently has picked. A picked *node* is also the anchor —
 * the point every offered run comes from — so selecting and wiring are the same
 * act rather than two modes fighting over the same tap.
 */
export type Selection =
	| { type: 'node'; id: string }
	| { type: 'edge'; id: string }
	| null;

/** One purchase, kept so a mis-tap can be walked back. */
interface BuildRecord {
	edgeId: string;
	/** Where the anchor was standing before the build, so undo puts it back. */
	anchor: string | null;
	paid: number;
}

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

	selection: Selection;
	/** Every run buyable from the anchor right now. Empty when nothing is picked. */
	offers: LinkOffer[];
	/** Builds that can still be walked back, oldest first. */
	history: BuildRecord[];
	/** The run built most recently, for the surge the canvas paints along it. */
	lastBuilt: { id: string; at: number } | null;
	/** Transient message shown under the HUD (bad purchase, blackout, …). */
	notice: string | null;

	tick: () => void;
	select: (selection: Selection) => void;
	/** Tap a node: make it the anchor, or drop the anchor if it already was. */
	tapNode: (id: string) => void;
	/** Tap a ringed node: buy the run it is offering, in one go. */
	buildTo: (target: string) => void;
	/** Walk back the most recent build at full price. */
	undo: () => void;
	flipPolarity: (id: string) => void;
	/** Swap which end feeds which, when a run was laid the wrong way round. */
	reverseLink: (id: string) => void;
	toggleEnabled: (id: string) => void;
	removeLink: (id: string) => void;
	buy: (kind: UpgradeKind) => void;
	resetBreaker: () => void;
	notify: (message: string | null) => void;
}

/** The anchor is simply whichever node is selected. */
export const anchorOf = (selection: Selection) =>
	selection?.type === 'node' ? selection.id : null;

/**
 * The runs on offer from the anchor. Recomputed whenever the selection, the
 * graph or the solve moves, since all three change what is buyable and which
 * way round it would run.
 */
function buildOffers(
	selection: Selection,
	edges: Record<string, FlowyEdge>,
	solution: Solution,
): LinkOffer[] {
	const anchor = anchorOf(selection);
	if (!anchor) return [];
	const rankOf = new Map<string, number>();
	solution.order.forEach((id, i) => rankOf.set(id, i));
	return offersFrom(anchor, edges, (id) => rankOf.get(id) ?? Infinity);
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

	// The source starts anchored, so a fresh board already shows its first moves
	// ringed and priced with nothing to press first.
	selection: { type: 'node', id: SOURCE_ID },
	offers: buildOffers(
		{ type: 'node', id: SOURCE_ID },
		{},
		resolve({}, { volts: 0, watts: 0, battery: 0 }, false),
	),
	history: [],
	lastBuilt: null,
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
			const dark = resolve(s.edges, s.levels, true);
			set({
				tripped: true,
				stored,
				beat: s.beat + 1,
				solution: dark,
				offers: buildOffers(s.selection, s.edges, dark),
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

	select: (selection) => {
		const s = get();
		set({
			selection,
			offers: buildOffers(selection, s.edges, s.solution),
			notice: null,
		});
	},

	notify: (notice) => set({ notice }),

	tapNode: (id) => {
		const s = get();
		// Tapping the anchor again puts the board away — one tap to a clean grid,
		// and the way to re-anchor somewhere that is currently wearing an offer.
		const selection: Selection =
			anchorOf(s.selection) === id ? null : { type: 'node', id };
		set({
			selection,
			offers: buildOffers(selection, s.edges, s.solution),
			notice: null,
		});
	},

	/**
	 * The core loop, in one tap. No confirm step: the price is already on the
	 * ring, and Undo makes the mistake cheaper than the dialog would have been.
	 *
	 * The anchor then walks to the *downstream* end of the new run, so laying a
	 * line outward is one tap per node, while a run built back into the anchor
	 * leaves you standing where you were and free to carry on.
	 */
	buildTo: (target) => {
		const s = get();
		const offer = s.offers.find((o) => o.target === target);
		if (!offer) return;

		const a = getNode(offer.from);
		const b = getNode(offer.to);
		if (!a || !b) return;

		// Re-check rather than trust the offer: the graph may have moved on.
		const problem = linkProblem(a, b, s.edges);
		if (problem) {
			set({ notice: problem });
			return;
		}
		const edge = makeEdge(a, b);
		if (s.coins < edge.paid) {
			set({
				notice: `Not enough coins — that run costs ${edge.paid}, you have ${Math.floor(s.coins)}`,
			});
			return;
		}

		const edges = { ...s.edges, [edge.id]: edge };
		const solution = resolve(edges, s.levels, s.tripped);
		const selection: Selection = { type: 'node', id: edge.to };
		const landed = getNode(edge.to);
		set({
			edges,
			coins: s.coins - edge.paid,
			solution,
			selection,
			offers: buildOffers(selection, edges, solution),
			history: [
				...s.history.slice(-(UNDO_DEPTH - 1)),
				{ edgeId: edge.id, anchor: anchorOf(s.selection), paid: edge.paid },
			],
			lastBuilt: { id: edge.id, at: performance.now() },
			notice: `Wired the ${landed?.def.label.toLowerCase() ?? 'node'} at (${b.x}, ${b.y}) — ${edge.paid}c.`,
		});
	},

	undo: () => {
		const s = get();
		const history = [...s.history];
		// Skip anything that has since been torn out or reversed by hand.
		while (history.length > 0) {
			const record = history.pop()!;
			const edge = s.edges[record.edgeId];
			if (!edge) continue;

			const edges = { ...s.edges };
			delete edges[record.edgeId];
			const solution = resolve(edges, s.levels, s.tripped);
			const selection: Selection = record.anchor
				? { type: 'node', id: record.anchor }
				: null;
			set({
				edges,
				// A full refund, not the teardown's half: this is unpicking a tap,
				// not selling a wire back.
				coins: s.coins + record.paid,
				solution,
				selection,
				offers: buildOffers(selection, edges, solution),
				history,
				lastBuilt: null,
				notice: `Undone — ${record.paid}c back.`,
			});
			return;
		}
		set({ history, notice: 'Nothing left to undo.' });
	},

	flipPolarity: (id) => {
		const s = get();
		const edge = s.edges[id];
		if (!edge) return;
		const edges = {
			...s.edges,
			[id]: { ...edge, polarity: (edge.polarity * -1) as 1 | -1 },
		};
		const solution = resolve(edges, s.levels, s.tripped);
		set({ edges, solution, offers: buildOffers(s.selection, edges, solution) });
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
		const selection: Selection = { type: 'edge', id: flipped.id };
		set({
			edges,
			solution,
			selection,
			offers: buildOffers(selection, edges, solution),
			// The wire survived, but under a new id, so the undo entry has to follow.
			history: s.history.map((h) =>
				h.edgeId === id ? { ...h, edgeId: flipped.id } : h,
			),
			notice: null,
		});
	},

	toggleEnabled: (id) => {
		const s = get();
		const edge = s.edges[id];
		if (!edge) return;
		const edges = { ...s.edges, [id]: { ...edge, enabled: !edge.enabled } };
		const solution = resolve(edges, s.levels, s.tripped);
		set({ edges, solution, offers: buildOffers(s.selection, edges, solution) });
	},

	removeLink: (id) => {
		const s = get();
		const edge = s.edges[id];
		if (!edge) return;
		const edges = { ...s.edges };
		delete edges[id];
		const solution = resolve(edges, s.levels, s.tripped);
		// Stand back on the feeding end rather than nowhere, so tearing out a bad
		// run leaves you ready to lay the replacement.
		const selection: Selection = { type: 'node', id: edge.from };
		set({
			edges,
			coins: s.coins + Math.floor(edge.paid * REFUND_FRACTION),
			selection,
			solution,
			offers: buildOffers(selection, edges, solution),
			history: s.history.filter((h) => h.edgeId !== id),
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
		// Volts and stiffness both move the terminal, and the terminal is where
		// every potential in the network is propagated from. Only the battery
		// leaves the solve alone until the next beat.
		const solution =
			kind === 'battery' ? s.solution : resolve(s.edges, levels, s.tripped);
		set({
			levels,
			coins: s.coins - cost,
			solution,
			offers: buildOffers(s.selection, s.edges, solution),
			notice: null,
		});
	},

	resetBreaker: () => {
		const s = get();
		const solution = resolve(s.edges, s.levels, false);
		set({
			tripped: false,
			solution,
			offers: buildOffers(s.selection, s.edges, solution),
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
