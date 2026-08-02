// The electrical solve. Given the graph and the source voltage, work out what
// every node and wire is carrying.
//
// The model is deliberately a *game* model rather than a SPICE netlist, but it
// is built out of honest Ohm's law pieces:
//
//   * Current is demanded at the leaves. Each energised node draws a fixed
//     operating current; a wire carries the sum of everything downstream of it.
//   * The source is not ideal. It has internal resistance, so its terminal
//     voltage is only the open-circuit figure minus I·r — hang more load on it
//     and the whole bus sags. That is the brownout, and because every node's
//     potential is propagated down from that terminal, everything else follows
//     from it without any separate penalty being applied anywhere.
//   * Voltage falls by I·R across every wire and through every node's own
//     series resistance. Long chains and fat loads sag, exactly as they should.
//   * Charge follows the path of least resistance. A Dijkstra tree over
//     (wire Ω + node Ω) decides which connection actually feeds each node; the
//     others are live but idle, redundant paths rather than extra throughput.
//   * Polarity is the interesting part. A `-` connection inverts the potential
//     it passes on. A node fed `+` by its supply path and `-` by a spare
//     connection sees the two oppose, and the difference is what is left. Two
//     feeds of the same sign do not stack — parallel supplies never do.
//
// A node below MIN_VOLTS goes dark: it earns nothing and lights nothing. It
// still pulls its operating current, though, so running a chain out past the
// point where it can be fed is not free — you pay watts for nodes that cannot
// do their job. That is deliberate, and it is what makes voltage upgrades and
// short trunk runs worth paying for.

import { MIN_VOLTS, SOURCE_ID } from './config';
import type { FlowyEdge, FlowyNode } from './world';
import { getNode } from './world';

export interface SourceSpec {
	/** Open-circuit voltage — what the source would show with nothing hung off it. */
	openVolts: number;
	/** Internal resistance (Ω). Every amp drawn costs I·r at the terminal. */
	ohms: number;
	/** Amps the battery is injecting at the bus, easing the source's share. */
	batteryAmps?: number;
}

export interface Solution {
	/** Nodes reached from the source, nearest (by resistance) first. */
	order: string[];
	/** Node id → id of the connection that actually feeds it. */
	parent: Map<string, string>;
	/** Hops from the source along the supply tree. */
	depth: Map<string, number>;
	/** Potential at the node's input terminal (signed — `-` feeds invert). */
	volts: Map<string, number>;
	/** Potential left after the node's own series resistance. */
	vout: Map<string, number>;
	/** Current entering the node: its own draw plus everything downstream. */
	amps: Map<string, number>;
	/** Connection id → current it carries. Idle connections are absent. */
	edgeAmps: Map<string, number>;
	/** Nodes holding at least MIN_VOLTS of either polarity. */
	energized: Set<string>;
	/** Watts drawn at the source terminal. */
	demandW: number;
	/** Watts burned as I²R in wires and node internals. */
	lossW: number;

	/* --- The source's own state, which is where a brownout lives --- */
	/** What the source would read with nothing connected. */
	openVolts: number;
	/** What it actually reads once the network is pulling on it. */
	terminalVolts: number;
	/** Total current the network is asking for. */
	totalAmps: number;
	/** The share of it the source itself has to push. */
	sourceAmps: number;
	/** Fraction of open-circuit voltage lost at the terminal, 0..1. */
	sag: number;
	/** The source's internal resistance (Ω) for this solve. */
	sourceOhms: number;
	/** Watts cooked inside the source by its own internal resistance. */
	sourceLossW: number;
}

const EMPTY: Solution = {
	order: [],
	parent: new Map(),
	depth: new Map(),
	volts: new Map(),
	vout: new Map(),
	amps: new Map(),
	edgeAmps: new Map(),
	energized: new Set(),
	demandW: 0,
	lossW: 0,
	openVolts: 0,
	terminalVolts: 0,
	totalAmps: 0,
	sourceAmps: 0,
	sag: 0,
	sourceOhms: 0,
	sourceLossW: 0,
};

/** Adjacency rebuilt per solve; the graphs are small enough that this is free. */
interface Adjacency {
	out: Map<string, FlowyEdge[]>;
	inc: Map<string, FlowyEdge[]>;
	byId: Map<string, FlowyEdge>;
}

function buildAdjacency(edges: FlowyEdge[]): Adjacency {
	const out = new Map<string, FlowyEdge[]>();
	const inc = new Map<string, FlowyEdge[]>();
	const byId = new Map<string, FlowyEdge>();
	for (const e of edges) {
		byId.set(e.id, e);
		if (!e.enabled) continue;
		let o = out.get(e.from);
		if (!o) out.set(e.from, (o = []));
		o.push(e);
		let i = inc.get(e.to);
		if (!i) inc.set(e.to, (i = []));
		i.push(e);
	}
	return { out, inc, byId };
}

export function solve(edges: FlowyEdge[], spec: SourceSpec): Solution {
	const adj = buildAdjacency(edges);
	const source = getNode(SOURCE_ID);
	if (!source) return EMPTY;

	/* --- Least-resistance supply tree (Dijkstra) --- */
	const dist = new Map<string, number>([[SOURCE_ID, 0]]);
	const parent = new Map<string, string>();
	const depth = new Map<string, number>([[SOURCE_ID, 0]]);
	const nodes = new Map<string, FlowyNode>([[SOURCE_ID, source]]);
	const order: string[] = [];
	const settled = new Set<string>();
	// Linear-scan frontier: networks stay in the hundreds of nodes, so a heap
	// would be more machinery than it is worth.
	const frontier = new Set<string>([SOURCE_ID]);

	while (frontier.size > 0) {
		let best: string | null = null;
		let bestDist = Infinity;
		for (const id of frontier) {
			const d = dist.get(id)!;
			if (d < bestDist) {
				bestDist = d;
				best = id;
			}
		}
		if (best === null) break;
		frontier.delete(best);
		settled.add(best);
		order.push(best);

		for (const e of adj.out.get(best) ?? []) {
			if (settled.has(e.to)) continue;
			const target = nodes.get(e.to) ?? getNode(e.to);
			if (!target) continue;
			nodes.set(e.to, target);
			const step = bestDist + e.ohms + target.def.resistance;
			if (step < (dist.get(e.to) ?? Infinity)) {
				dist.set(e.to, step);
				parent.set(e.to, e.id);
				depth.set(e.to, (depth.get(best) ?? 0) + 1);
				frontier.add(e.to);
			}
		}
	}

	/* --- Currents, accumulated leaves-first --- */
	const amps = new Map<string, number>();
	for (const id of order) amps.set(id, nodes.get(id)!.def.draw);
	const edgeAmps = new Map<string, number>();
	for (let i = order.length - 1; i > 0; i--) {
		const id = order[i];
		const edge = adj.byId.get(parent.get(id)!);
		if (!edge) continue;
		const carried = amps.get(id)!;
		edgeAmps.set(edge.id, carried);
		amps.set(edge.from, (amps.get(edge.from) ?? 0) + carried);
	}

	/* --- What the source terminal is actually holding --- */
	// The node draws are constant-current, so the total the network asks for is
	// already known from the accumulation above — no load-flow iteration needed.
	// The battery injects its share at the bus, and whatever is left has to come
	// through the source's internal resistance, costing I·r on the way out.
	const totalAmps = amps.get(SOURCE_ID) ?? 0;
	const sourceAmps = Math.max(0, totalAmps - (spec.batteryAmps ?? 0));
	const terminalVolts = Math.max(0, spec.openVolts - sourceAmps * spec.ohms);
	const sag =
		spec.openVolts > 0 ? 1 - terminalVolts / spec.openVolts : 0;

	/* --- Voltages, propagated source-first --- */
	// Two sweeps, both in supply-tree order.
	//
	// The first works out what every node's own supply path delivers, ignoring
	// opposition. The second re-runs the propagation and lets each node be
	// fought by its strongest opposing feed, sourcing the opponent's strength
	// from sweep one. Doing it in two passes is what makes cancellation
	// order-independent: a spare connection cancels just as hard whether its
	// far end happens to sort before or after its target, which a single sweep
	// gets wrong. Cancellation still cascades downstream, because sweep two
	// propagates through the values it is writing.
	const volts = new Map<string, number>([[SOURCE_ID, terminalVolts]]);
	const vout = new Map<string, number>([[SOURCE_ID, terminalVolts]]);
	const voutRaw = new Map<string, number>([[SOURCE_ID, terminalVolts]]);

	/** Potential arriving at `id` down its supply path, given a source map. */
	const throughFeed = (id: string, from: Map<string, number>) => {
		const edge = adj.byId.get(parent.get(id)!)!;
		const upstream = from.get(edge.from) ?? 0;
		// Ohm's law: the wire eats I·R of whatever the upstream terminal offers.
		const dropped = Math.max(
			0,
			Math.abs(upstream) - (edgeAmps.get(edge.id) ?? 0) * edge.ohms,
		);
		return edge.polarity * Math.sign(upstream) * dropped;
	};

	/** Potential left after the node's own series resistance. */
	const afterNode = (id: string, v: number) =>
		Math.sign(v) *
		Math.max(0, Math.abs(v) - amps.get(id)! * nodes.get(id)!.def.resistance);

	for (let i = 1; i < order.length; i++) {
		const id = order[i];
		voutRaw.set(id, afterNode(id, throughFeed(id, voutRaw)));
	}

	for (let i = 1; i < order.length; i++) {
		const id = order[i];
		const feed = parent.get(id)!;
		let v = throughFeed(id, vout);

		// Any *other* live connection into this node fights the supply path if it
		// arrives with the opposite sign. Only the strongest opponent counts —
		// summing them would let cancellation be stacked arbitrarily.
		let opposing = 0;
		for (const other of adj.inc.get(id) ?? []) {
			if (other.id === feed) continue;
			const contribution = other.polarity * (voutRaw.get(other.from) ?? 0);
			if (
				Math.sign(contribution) !== Math.sign(v) &&
				Math.abs(contribution) > Math.abs(opposing)
			) {
				opposing = contribution;
			}
		}
		v += opposing;

		volts.set(id, v);
		vout.set(id, afterNode(id, v));
	}

	/* --- Who is actually awake, and what it all costs --- */
	const energized = new Set<string>();
	if (terminalVolts >= MIN_VOLTS) energized.add(SOURCE_ID);
	for (const id of order) {
		if (Math.abs(volts.get(id) ?? 0) >= MIN_VOLTS) energized.add(id);
	}

	let lossW = 0;
	for (const [edgeIdKey, current] of edgeAmps) {
		const edge = adj.byId.get(edgeIdKey);
		if (edge) lossW += current * current * edge.ohms;
	}
	for (const id of order) {
		const node = nodes.get(id)!;
		const current = amps.get(id) ?? 0;
		lossW += current * current * node.def.resistance;
	}

	// Power handed to the network at the terminal, and what the source wastes
	// heating itself up on the way there.
	const demandW = terminalVolts * totalAmps;
	const sourceLossW = sourceAmps * sourceAmps * spec.ohms;

	return {
		order,
		parent,
		depth,
		volts,
		vout,
		amps,
		edgeAmps,
		energized,
		demandW,
		lossW,
		openVolts: spec.openVolts,
		terminalVolts,
		totalAmps,
		sourceAmps,
		sag,
		sourceOhms: spec.ohms,
		sourceLossW,
	};
}

export const emptySolution = () => EMPTY;
