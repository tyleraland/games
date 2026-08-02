// The world is an infinite lattice. Nodes are not stored anywhere — they are
// derived from their coordinates by a hash, so panning to a fresh part of the
// grid always produces the same layout without anything being persisted.

import {
	MAX_LINK_DIST,
	NODE_DENSITY,
	SOURCE_ID,
	WIRE_OHMS_PER_UNIT,
	WORLD_SEED,
	linkCost,
} from './config';

export type NodeKind = 'source' | 'relay' | 'tap' | 'coil' | 'hub';

export interface NodeKindDef {
	kind: NodeKind;
	label: string;
	blurb: string;
	/** Series resistance (Ω) the charge crosses inside the node. */
	resistance: number;
	/** Current (A) the node itself draws once energised. */
	draw: number;
	/** Coins per beat at the reference voltage. */
	yield: number;
	color: string;
	/** Relative share of the procedural mix. Taps are deliberately 10%. */
	weight: number;
}

export const NODE_KINDS: Record<NodeKind, NodeKindDef> = {
	source: {
		kind: 'source',
		label: 'Source',
		blurb: 'The origin of every beat. Loss-free, but finite.',
		resistance: 0,
		draw: 0,
		yield: 0,
		color: '#ffe08a',
		weight: 0,
	},
	relay: {
		kind: 'relay',
		label: 'Relay',
		blurb: 'Plain conduit. Cheap to keep awake, unremarkable either way.',
		resistance: 0.6,
		draw: 0.05,
		yield: 0,
		color: '#7fb2d9',
		weight: 52,
	},
	tap: {
		kind: 'tap',
		label: 'Tap',
		blurb: 'Converts charge into coins. Thirsty, and it drops volts.',
		resistance: 1.2,
		draw: 0.25,
		yield: 1,
		color: '#f2c14e',
		weight: 10,
	},
	coil: {
		kind: 'coil',
		label: 'Coil',
		blurb: 'Sips current, but its resistance strangles anything downstream.',
		resistance: 2.4,
		draw: 0.02,
		yield: 0,
		color: '#b48ead',
		weight: 18,
	},
	hub: {
		kind: 'hub',
		label: 'Hub',
		blurb: 'Near-lossless junction. Hungry, but it carries a trunk line.',
		resistance: 0.15,
		draw: 0.12,
		yield: 0,
		color: '#8fd6a8',
		weight: 20,
	},
};

/** The procedural mix, excluding the source. */
const MIX: NodeKindDef[] = [
	NODE_KINDS.relay,
	NODE_KINDS.tap,
	NODE_KINDS.coil,
	NODE_KINDS.hub,
];
const MIX_TOTAL = MIX.reduce((sum, k) => sum + k.weight, 0);

export interface FlowyNode {
	id: string;
	x: number;
	y: number;
	def: NodeKindDef;
}

export interface FlowyEdge {
	id: string;
	from: string;
	to: string;
	/** +1 passes the upstream potential through, -1 inverts it. */
	polarity: 1 | -1;
	enabled: boolean;
	/** Grid-unit distance between the endpoints. */
	length: number;
	/** Wire resistance (Ω), proportional to length. */
	ohms: number;
	/** What the player paid, so a teardown can refund a share of it. */
	paid: number;
}

/* ------------------------------------------------------------------ */
/* Procedural lattice                                                  */
/* ------------------------------------------------------------------ */

/**
 * Deterministic 32-bit hash of a lattice cell. The salt is mixed in with the
 * coordinates rather than added at the end — folding it in late leaves the
 * streams correlated, which visibly skews the kind mix towards whatever rolled
 * low enough to pass the density test.
 */
function hash(x: number, y: number, salt: number): number {
	let h =
		(Math.imul(x, 0x1f1f1f1f) ^
			Math.imul(y, 0x8da6b343) ^
			Math.imul(salt + 1, 0x045d9f3b) ^
			WORLD_SEED) >>>
		0;
	h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
	h = Math.imul(h ^ (h >>> 13), 0x297a2d39);
	h ^= h >>> 16;
	return h >>> 0;
}

/** Hash mapped into [0, 1). */
const rand = (x: number, y: number, salt: number) => hash(x, y, salt) / 0x100000000;

/**
 * A few cells near the origin are pinned so the opening is always playable:
 * two reachable stepping stones and a tap within two hops of the source.
 */
const PINNED: Record<string, NodeKind> = {
	'2:0': 'relay',
	'0:2': 'relay',
	'-2:1': 'hub',
	'3:2': 'tap',
	'2:-2': 'tap',
	'-1:-2': 'relay',
};

const cache = new Map<string, FlowyNode | null>();

export const nodeId = (x: number, y: number) => `${x}:${y}`;

/** Parse an id back into coordinates. Ids are always `x:y` with integers. */
export function parseNodeId(id: string): [number, number] {
	const i = id.indexOf(':', 1);
	return [Number(id.slice(0, i)), Number(id.slice(i + 1))];
}

/** The node at a lattice cell, or null if the cell is empty. Memoised. */
export function nodeAt(x: number, y: number): FlowyNode | null {
	const id = nodeId(x, y);
	const hit = cache.get(id);
	if (hit !== undefined) return hit;

	let node: FlowyNode | null = null;
	if (id === SOURCE_ID) {
		node = { id, x, y, def: NODE_KINDS.source };
	} else if (PINNED[id]) {
		node = { id, x, y, def: NODE_KINDS[PINNED[id]] };
	} else if (rand(x, y, 0) < NODE_DENSITY) {
		// Walk the weighted mix to pick a kind.
		let roll = rand(x, y, 0x51ed) * MIX_TOTAL;
		let def = MIX[MIX.length - 1];
		for (const candidate of MIX) {
			roll -= candidate.weight;
			if (roll < 0) {
				def = candidate;
				break;
			}
		}
		node = { id, x, y, def };
	}

	cache.set(id, node);
	return node;
}

export function getNode(id: string): FlowyNode | null {
	const hit = cache.get(id);
	if (hit !== undefined) return hit;
	const [x, y] = parseNodeId(id);
	return nodeAt(x, y);
}

/** Every node whose cell falls inside the given world-space rectangle. */
export function nodesInRect(
	x0: number,
	y0: number,
	x1: number,
	y1: number,
): FlowyNode[] {
	const found: FlowyNode[] = [];
	for (let y = Math.floor(y0); y <= Math.ceil(y1); y++) {
		for (let x = Math.floor(x0); x <= Math.ceil(x1); x++) {
			const node = nodeAt(x, y);
			if (node) found.push(node);
		}
	}
	return found;
}

/* ------------------------------------------------------------------ */
/* Edges                                                               */
/* ------------------------------------------------------------------ */

export const edgeId = (from: string, to: string) => `${from}>${to}`;

export function edgeLength(from: FlowyNode, to: FlowyNode): number {
	return Math.hypot(to.x - from.x, to.y - from.y);
}

/**
 * Why a connection cannot be built, or null if it can. Kept as one place so the
 * hover preview and the actual purchase can never disagree.
 */
export function linkProblem(
	from: FlowyNode,
	to: FlowyNode,
	edges: Record<string, FlowyEdge>,
): string | null {
	if (from.id === to.id) return 'A node cannot feed itself';
	if (edges[edgeId(from.id, to.id)]) return 'Already connected';
	const length = edgeLength(from, to);
	if (length > MAX_LINK_DIST)
		return `Too far — ${length.toFixed(2)}u exceeds the ${MAX_LINK_DIST}u reach`;
	return null;
}

export function makeEdge(from: FlowyNode, to: FlowyNode): FlowyEdge {
	const length = edgeLength(from, to);
	return {
		id: edgeId(from.id, to.id),
		from: from.id,
		to: to.id,
		polarity: 1,
		enabled: true,
		length,
		ohms: length * WIRE_OHMS_PER_UNIT,
		paid: linkCost(length),
	};
}
