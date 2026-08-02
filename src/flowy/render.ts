// Canvas painter. This is a pure function of (camera, game state, clock) — it
// owns no state of its own, so the rAF loop can call it as often as it likes.

import {
	BUILD_FLASH_MS,
	COLORS,
	MAX_LINK_DIST,
	MIN_VOLTS,
	PULSE_HOPS_PER_BEAT,
	SAG_BROWNOUT,
	SOURCE_ID,
	TICK_MS,
	sagSeverity,
} from './config';
import type { Solution } from './sim';
import type { FlowyEdge, LinkOffer } from './world';
import { getNode, nodesInRect } from './world';

export interface Camera {
	/** World-space point at the centre of the viewport. */
	x: number;
	y: number;
	/** Pixels per grid unit. */
	zoom: number;
}

export interface RenderInput {
	camera: Camera;
	edges: Record<string, FlowyEdge>;
	solution: Solution;
	selection: { type: 'node' | 'edge'; id: string } | null;
	hoverNode: string | null;
	/** The node being wired from. Every offer starts here. */
	anchor: string | null;
	/** Runs buyable from the anchor, ringed on their far end. */
	offers: LinkOffer[];
	/** Whether the player can afford each offer, for the ring styling. */
	coins: number;
	tripped: boolean;
	/** Fraction of open-circuit voltage the source has lost, 0..1. */
	sag: number;
	/** The run just bought, so the surge can be painted along it. */
	lastBuilt: { id: string; at: number } | null;
	timeMs: number;
	/** The same clock `lastBuilt.at` was stamped from. */
	nowMs: number;
}

/* ------------------------------------------------------------------ */
/* Brownout flicker                                                    */
/* ------------------------------------------------------------------ */

const fract = (n: number) => n - Math.floor(n);

/** Deterministic value noise, so the flicker is smooth rather than strobing. */
function noise1(t: number): number {
	const i = Math.floor(t);
	const f = t - i;
	const a = fract(Math.sin(i * 127.1) * 43758.5453);
	const b = fract(Math.sin((i + 1) * 127.1) * 43758.5453);
	return a + (b - a) * f * f * (3 - 2 * f);
}

/**
 * How brightly the network burns right now, 0..1.
 *
 * A healthy bus is a flat 1. Once it starts sagging the lights gutter — two
 * noise bands for the constant unsteadiness, plus an occasional deep dip like
 * a big load stepping on and off somewhere. The whole thing scales with how
 * far through the brownout band the terminal has fallen, so a mild sag is a
 * faint waver and a severe one is barely holding on.
 */
export function flickerAt(timeMs: number, sag: number): number {
	if (sag <= SAG_BROWNOUT) return 1;
	const severity = sagSeverity(sag);
	const t = timeMs / 1000;
	const waver = 0.55 * noise1(t * 8.3) + 0.45 * noise1(t * 21.7);
	const gutter = noise1(t * 2.9) > 0.82 ? 1 : 0;
	const dip = severity * (0.4 * waver + 0.35 * gutter);
	return Math.max(0.12, 1 - dip);
}

export const worldToScreen = (
	wx: number,
	wy: number,
	cam: Camera,
	w: number,
	h: number,
): [number, number] => [
	(wx - cam.x) * cam.zoom + w / 2,
	(wy - cam.y) * cam.zoom + h / 2,
];

export const screenToWorld = (
	sx: number,
	sy: number,
	cam: Camera,
	w: number,
	h: number,
): [number, number] => [
	(sx - w / 2) / cam.zoom + cam.x,
	(sy - h / 2) / cam.zoom + cam.y,
];

/** Node radius in pixels, so hit-testing and drawing agree. */
export const nodeRadius = (cam: Camera) => Math.max(4, cam.zoom * 0.17);

function withAlpha(hex: string, alpha: number): string {
	const n = parseInt(hex.slice(1), 16);
	return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

/** RenderInput plus the per-frame brightness the flicker resolved to. */
type Scene = RenderInput & { brightness: number };

export function draw(
	ctx: CanvasRenderingContext2D,
	w: number,
	h: number,
	input: RenderInput,
) {
	const { camera: cam, edges } = input;
	const scene: Scene = {
		...input,
		brightness: input.tripped ? 0 : flickerAt(input.timeMs, input.sag),
	};

	ctx.fillStyle = COLORS.background;
	ctx.fillRect(0, 0, w, h);

	const [x0, y0] = screenToWorld(0, 0, cam, w, h);
	const [x1, y1] = screenToWorld(w, h, cam, w, h);

	drawGrid(ctx, cam, w, h, x0, y0, x1, y1);

	// The reach limit sits under everything: it is context, not an object.
	drawReach(ctx, cam, w, h, scene);

	// Connections first so nodes sit on top of their own wires.
	for (const edge of Object.values(edges)) {
		drawEdge(ctx, cam, w, h, edge, scene);
	}

	drawOfferRuns(ctx, cam, w, h, scene);

	for (const node of nodesInRect(x0 - 1, y0 - 1, x1 + 1, y1 + 1)) {
		drawNode(ctx, cam, w, h, node.id, scene);
	}

	// Rings and prices go over the nodes they belong to, so nothing is hidden
	// behind a glow at the moment the player is aiming at it.
	drawOfferRings(ctx, cam, w, h, scene);

	if (!input.tripped) drawPulses(ctx, cam, w, h, scene);
	drawBuildSurge(ctx, cam, w, h, scene);

	// Panning far afield is the whole exploration loop, so keep a way home.
	drawSourceCompass(ctx, cam, w, h);

	drawSagVignette(ctx, w, h, scene);
}

/**
 * Amber creeping in from the edges of the screen while the bus is down, going
 * red as it approaches the trip point. Costs nothing to read and makes it
 * unmistakable that the problem is the supply rather than the wiring.
 */
function drawSagVignette(
	ctx: CanvasRenderingContext2D,
	w: number,
	h: number,
	scene: Scene,
) {
	if (scene.tripped) {
		ctx.fillStyle = 'rgba(6, 8, 12, 0.55)';
		ctx.fillRect(0, 0, w, h);
		return;
	}
	if (scene.sag <= SAG_BROWNOUT) return;

	const severity = sagSeverity(scene.sag);
	const cx = w / 2;
	const cy = h / 2;
	const inner = Math.min(w, h) * 0.28;
	const outer = Math.hypot(w, h) * 0.62;
	const gradient = ctx.createRadialGradient(cx, cy, inner, cx, cy, outer);
	// Amber at a mild sag, red once it is getting dangerous.
	const red = Math.round(224 + 20 * severity);
	const green = Math.round(150 - 80 * severity);
	const peak = (0.1 + 0.42 * severity) * (0.65 + 0.35 * scene.brightness);
	gradient.addColorStop(0, `rgba(${red}, ${green}, 60, 0)`);
	gradient.addColorStop(1, `rgba(${red}, ${green}, 60, ${peak.toFixed(3)})`);
	ctx.fillStyle = gradient;
	ctx.fillRect(0, 0, w, h);
}

/* ------------------------------------------------------------------ */

function drawGrid(
	ctx: CanvasRenderingContext2D,
	cam: Camera,
	w: number,
	h: number,
	x0: number,
	y0: number,
	x1: number,
	y1: number,
) {
	if (cam.zoom < 22) return;
	ctx.fillStyle = COLORS.grid;
	const r = Math.max(1, cam.zoom * 0.018);
	for (let y = Math.floor(y0); y <= Math.ceil(y1); y++) {
		for (let x = Math.floor(x0); x <= Math.ceil(x1); x++) {
			const [sx, sy] = worldToScreen(x, y, cam, w, h);
			ctx.beginPath();
			ctx.arc(sx, sy, r, 0, Math.PI * 2);
			ctx.fill();
		}
	}

	// Faint axes through the origin help you find your way back to the source.
	ctx.strokeStyle = COLORS.gridAxis;
	ctx.lineWidth = 1;
	const [ox, oy] = worldToScreen(0, 0, cam, w, h);
	ctx.beginPath();
	ctx.moveTo(0, oy);
	ctx.lineTo(w, oy);
	ctx.moveTo(ox, 0);
	ctx.lineTo(ox, h);
	ctx.stroke();
}

function drawEdge(
	ctx: CanvasRenderingContext2D,
	cam: Camera,
	w: number,
	h: number,
	edge: FlowyEdge,
	input: Scene,
) {
	const from = getNode(edge.from);
	const to = getNode(edge.to);
	if (!from || !to) return;

	const [ax, ay] = worldToScreen(from.x, from.y, cam, w, h);
	const [bx, by] = worldToScreen(to.x, to.y, cam, w, h);
	const live =
		!input.tripped &&
		edge.enabled &&
		input.solution.energized.has(edge.from) &&
		(input.solution.edgeAmps.get(edge.id) ?? 0) > 0;

	const selected =
		input.selection?.type === 'edge' && input.selection.id === edge.id;

	let color: string;
	if (!edge.enabled) color = COLORS.disabled;
	else if (!live) color = COLORS.dead;
	else color = edge.polarity > 0 ? COLORS.positive : COLORS.negative;

	const amps = input.solution.edgeAmps.get(edge.id) ?? 0;
	const width = Math.max(1.2, Math.min(6, 1.2 + amps * 2.5)) * (cam.zoom / 56);

	ctx.save();
	ctx.lineCap = 'round';
	ctx.setLineDash(edge.enabled ? [] : [6, 6]);
	ctx.lineWidth = width;
	ctx.strokeStyle = live ? withAlpha(color, 0.35 + 0.55 * input.brightness) : color;
	if (live) {
		ctx.shadowColor = color;
		ctx.shadowBlur = 8 * input.brightness;
	}
	ctx.beginPath();
	ctx.moveTo(ax, ay);
	ctx.lineTo(bx, by);
	ctx.stroke();
	ctx.restore();

	if (selected) {
		ctx.save();
		ctx.setLineDash([]);
		ctx.strokeStyle = COLORS.select;
		ctx.lineWidth = width + 3;
		ctx.globalAlpha = 0.4;
		ctx.beginPath();
		ctx.moveTo(ax, ay);
		ctx.lineTo(bx, by);
		ctx.stroke();
		ctx.restore();
	}

	// Direction chevron at the midpoint — the graph is directed, and which way
	// a run points is the difference between a working branch and a dead one.
	if (cam.zoom >= 30) {
		const mx = (ax + bx) / 2;
		const my = (ay + by) / 2;
		const angle = Math.atan2(by - ay, bx - ax);
		const size = Math.max(4, cam.zoom * 0.1);
		ctx.save();
		ctx.translate(mx, my);
		ctx.rotate(angle);
		ctx.fillStyle = edge.enabled ? withAlpha(color, 0.95) : color;
		ctx.beginPath();
		ctx.moveTo(size, 0);
		ctx.lineTo(-size * 0.7, size * 0.62);
		ctx.lineTo(-size * 0.7, -size * 0.62);
		ctx.closePath();
		ctx.fill();
		// The sign rides on the chevron so polarity is readable at a glance.
		ctx.rotate(-angle);
		ctx.fillStyle = COLORS.background;
		ctx.font = `bold ${Math.max(8, size * 1.1)}px ui-monospace, monospace`;
		ctx.textAlign = 'center';
		ctx.textBaseline = 'middle';
		ctx.fillText(edge.polarity > 0 ? '+' : '−', 0, 0.5);
		ctx.restore();
	}
}

function drawNode(
	ctx: CanvasRenderingContext2D,
	cam: Camera,
	w: number,
	h: number,
	id: string,
	input: Scene,
) {
	const node = getNode(id);
	if (!node) return;
	const [sx, sy] = worldToScreen(node.x, node.y, cam, w, h);
	const r = nodeRadius(cam);
	const volts = input.solution.volts.get(id) ?? 0;
	const energized = !input.tripped && input.solution.energized.has(id);
	const isSource = id === SOURCE_ID;
	const selected =
		input.selection?.type === 'node' && input.selection.id === id;
	const hovered = input.hoverNode === id;
	const color = node.def.color;

	// Both the glow and the fill scale with how well the node is fed, so voltage
	// sag along a long run — and the whole grid dimming during a brownout — is
	// visible without opening the inspector.
	if (energized) {
		const strength = Math.min(1, Math.abs(volts) / 48) * input.brightness;
		ctx.save();
		ctx.shadowColor = color;
		ctx.shadowBlur = (isSource ? 26 : 14) * (0.4 + strength);
		ctx.fillStyle = withAlpha(color, 0.3 + 0.6 * strength);
		ctx.beginPath();
		ctx.arc(sx, sy, r, 0, Math.PI * 2);
		ctx.fill();
		ctx.restore();
	} else {
		ctx.fillStyle = withAlpha(color, 0.16);
		ctx.beginPath();
		ctx.arc(sx, sy, r, 0, Math.PI * 2);
		ctx.fill();
		ctx.strokeStyle = withAlpha(color, 0.45);
		ctx.lineWidth = 1.5;
		ctx.stroke();
	}

	// Negative-rail nodes get a ring, so an inverted branch reads instantly.
	if (energized && volts < 0) {
		ctx.strokeStyle = COLORS.negative;
		ctx.lineWidth = Math.max(1.5, r * 0.22);
		ctx.beginPath();
		ctx.arc(sx, sy, r * 1.45, 0, Math.PI * 2);
		ctx.stroke();
	}

	// Taps carry a coin pip so you can spot income while panning.
	if (node.def.yield > 0 && cam.zoom >= 26) {
		ctx.fillStyle = energized
			? COLORS.background
			: withAlpha(node.def.color, 0.5);
		ctx.beginPath();
		ctx.arc(sx, sy, r * 0.38, 0, Math.PI * 2);
		ctx.fill();
	}

	if (isSource) {
		ctx.strokeStyle = withAlpha(node.def.color, input.tripped ? 0.25 : 0.8);
		ctx.lineWidth = 2;
		ctx.beginPath();
		ctx.arc(sx, sy, r * 1.9, 0, Math.PI * 2);
		ctx.stroke();
	}

	// The anchor wears a broken reticle rather than another solid ring. The
	// source already has a solid ring of its own, and on a fresh board the two
	// sit on the same node — a gapped collar reads as a cursor, not as another
	// property of the node.
	if (input.anchor === id) {
		const rr = r * 2.05;
		ctx.save();
		ctx.strokeStyle = COLORS.anchor;
		ctx.lineWidth = 3.2;
		ctx.lineCap = 'round';
		ctx.shadowColor = COLORS.anchor;
		ctx.shadowBlur = 9;
		for (let i = 0; i < 4; i++) {
			const start = i * (Math.PI / 2) + Math.PI / 8;
			ctx.beginPath();
			ctx.arc(sx, sy, rr, start, start + Math.PI / 4);
			ctx.stroke();
		}
		ctx.restore();
	} else if (selected || hovered) {
		ctx.strokeStyle = selected ? COLORS.select : withAlpha(COLORS.select, 0.45);
		ctx.lineWidth = 2;
		ctx.beginPath();
		ctx.arc(sx, sy, r * 2.2, 0, Math.PI * 2);
		ctx.stroke();
	}

	// Live nodes report their potential. Dark ones name themselves only if they
	// are worth walking towards — labelling every relay just makes noise.
	const label = energized
		? `${volts.toFixed(1)}V`
		: node.def.kind === 'relay'
			? null
			: node.def.label.toLowerCase();
	if (label && cam.zoom >= 44) {
		ctx.fillStyle = withAlpha(COLORS.text, energized ? 0.75 : 0.35);
		ctx.font = `${Math.max(9, cam.zoom * 0.17)}px system-ui, sans-serif`;
		ctx.textAlign = 'center';
		ctx.textBaseline = 'top';
		ctx.fillText(label, sx, sy + r * 2.4);
	}
}

/**
 * Radius of an offer's tap target, which is the ring drawn around the node the
 * run would reach. Floored well above the 44px guideline, because the whole
 * game is played by putting a thumb on one of these.
 */
export const offerRingRadius = (cam: Camera) => Math.max(22, cam.zoom * 0.4);

/** Screen position of an offer's tap target — shared with the canvas hit-test. */
export function offerAt(
	offer: LinkOffer,
	cam: Camera,
	w: number,
	h: number,
): [number, number] | null {
	const target = getNode(offer.target);
	if (!target) return null;
	return worldToScreen(target.x, target.y, cam, w, h);
}

/** A shared, gentle breath so every offer on screen pulses as one set. */
const offerPulse = (timeMs: number) => 0.72 + 0.28 * Math.sin(timeMs / 380);

/** The build radius around the anchor, so the reach rule is visible not memorised. */
function drawReach(
	ctx: CanvasRenderingContext2D,
	cam: Camera,
	w: number,
	h: number,
	input: Scene,
) {
	if (!input.anchor) return;
	const node = getNode(input.anchor);
	if (!node) return;
	const [sx, sy] = worldToScreen(node.x, node.y, cam, w, h);
	ctx.save();
	ctx.setLineDash([3, 7]);
	ctx.lineWidth = 1;
	ctx.strokeStyle = withAlpha(COLORS.offer, 0.16);
	ctx.beginPath();
	ctx.arc(sx, sy, MAX_LINK_DIST * cam.zoom, 0, Math.PI * 2);
	ctx.stroke();
	ctx.restore();
}

/** The dashed run each offer would lay, drawn under the nodes. */
function drawOfferRuns(
	ctx: CanvasRenderingContext2D,
	cam: Camera,
	w: number,
	h: number,
	input: Scene,
) {
	if (input.offers.length === 0 || !input.anchor) return;
	const anchor = getNode(input.anchor);
	if (!anchor) return;
	const [ax, ay] = worldToScreen(anchor.x, anchor.y, cam, w, h);
	const breath = offerPulse(input.timeMs);

	for (const offer of input.offers) {
		const target = getNode(offer.target);
		if (!target) continue;
		const affordable = input.coins >= offer.cost;
		const [bx, by] = worldToScreen(target.x, target.y, cam, w, h);

		ctx.save();
		ctx.setLineDash([4, 6]);
		ctx.lineWidth = 1.4;
		ctx.strokeStyle = withAlpha(
			affordable ? COLORS.offer : COLORS.offerPoor,
			affordable ? 0.14 + 0.16 * breath : 0.1,
		);
		ctx.beginPath();
		ctx.moveTo(ax, ay);
		ctx.lineTo(bx, by);
		ctx.stroke();
		ctx.restore();
	}
}

/**
 * The offers themselves: a ring around every node one tap would reach, wearing
 * its price. The tap target *is* the destination, so buying a connection is the
 * same gesture as pointing at where you want it to go — no midpoint handle to
 * find, no panel to confirm through.
 */
function drawOfferRings(
	ctx: CanvasRenderingContext2D,
	cam: Camera,
	w: number,
	h: number,
	input: Scene,
) {
	if (input.offers.length === 0) return;
	const ring = offerRingRadius(cam);
	const breath = offerPulse(input.timeMs);

	// Two passes: every ring, then every price. Offers sit a single grid unit
	// apart at times, and a ring painted later must not clip the plate of the
	// offer next to it — the price is the one thing that has to stay readable.
	const onScreen = [];
	for (const offer of input.offers) {
		const target = getNode(offer.target);
		if (!target) continue;
		const [sx, sy] = worldToScreen(target.x, target.y, cam, w, h);
		if (sx < -ring || sy < -ring || sx > w + ring || sy > h + ring) continue;
		onScreen.push({ offer, sx, sy, affordable: input.coins >= offer.cost });
	}

	for (const { sx, sy, affordable } of onScreen) {
		const tint = affordable ? COLORS.offer : COLORS.offerPoor;
		ctx.save();
		ctx.lineWidth = affordable ? 2.2 : 1.4;
		ctx.strokeStyle = withAlpha(tint, affordable ? 0.45 + 0.45 * breath : 0.3);
		if (affordable) {
			ctx.shadowColor = tint;
			ctx.shadowBlur = 7 * breath;
		}
		ctx.beginPath();
		ctx.arc(sx, sy, ring, 0, Math.PI * 2);
		ctx.stroke();
		ctx.restore();
	}

	if (cam.zoom < 30) return;

	for (const { offer, sx, sy, affordable } of onScreen) {
		const tint = affordable ? COLORS.offer : COLORS.offerPoor;
		// The price rides above the ring on its own plate, so it stays legible
		// over the grid, over a wire, or over a lit node's glow.
		const label = `${offer.cost}c`;
		const font = Math.max(10, Math.min(13, cam.zoom * 0.21));
		ctx.save();
		ctx.font = `700 ${font}px ui-monospace, monospace`;
		ctx.textAlign = 'center';
		ctx.textBaseline = 'middle';
		const padX = 5;
		const tw = ctx.measureText(label).width + padX * 2;
		const th = font + 5;
		const py = sy - ring - th * 0.62;
		ctx.fillStyle = withAlpha(COLORS.background, 0.88);
		ctx.beginPath();
		ctx.roundRect(sx - tw / 2, py - th / 2, tw, th, th / 2);
		ctx.fill();
		ctx.strokeStyle = withAlpha(tint, affordable ? 0.55 : 0.3);
		ctx.lineWidth = 1;
		ctx.stroke();
		ctx.fillStyle = withAlpha(tint, affordable ? 1 : 0.55);
		ctx.fillText(label, sx, py + 0.5);
		ctx.restore();
	}
}

/**
 * A bright surge running the length of a run the instant it is bought. The
 * purchase has no confirm step, so this is what tells you it happened — and it
 * shows which way the new wire feeds while it does.
 */
function drawBuildSurge(
	ctx: CanvasRenderingContext2D,
	cam: Camera,
	w: number,
	h: number,
	input: Scene,
) {
	const built = input.lastBuilt;
	if (!built) return;
	const age = input.nowMs - built.at;
	if (age < 0 || age > BUILD_FLASH_MS) return;
	const edge = input.edges[built.id];
	if (!edge) return;
	const from = getNode(edge.from);
	const to = getNode(edge.to);
	if (!from || !to) return;

	const t = age / BUILD_FLASH_MS;
	const fade = 1 - t;
	const [ax, ay] = worldToScreen(from.x, from.y, cam, w, h);
	const [bx, by] = worldToScreen(to.x, to.y, cam, w, h);

	ctx.save();
	ctx.lineCap = 'round';
	ctx.lineWidth = 2 + 5 * fade;
	ctx.strokeStyle = withAlpha(COLORS.offer, 0.75 * fade);
	ctx.shadowColor = COLORS.offer;
	ctx.shadowBlur = 14 * fade;
	ctx.beginPath();
	ctx.moveTo(ax, ay);
	ctx.lineTo(bx, by);
	ctx.stroke();

	// The head of the surge, travelling the way the charge will.
	const ease = 1 - (1 - t) * (1 - t);
	ctx.fillStyle = '#fff6e8';
	ctx.beginPath();
	ctx.arc(
		ax + (bx - ax) * ease,
		ay + (by - ay) * ease,
		3 + 5 * fade,
		0,
		Math.PI * 2,
	);
	ctx.fill();
	ctx.restore();
}

/**
 * The rhythm. Every beat the source emits a pulse that ripples outward along
 * the supply tree; each connection's dot is delayed by its depth, so you can
 * watch the wave spread and see where it stops.
 */
function drawPulses(
	ctx: CanvasRenderingContext2D,
	cam: Camera,
	w: number,
	h: number,
	input: Scene,
) {
	const { solution, timeMs } = input;
	const beats = timeMs / TICK_MS;

	for (const [id, edge] of Object.entries(input.edges)) {
		if (!edge.enabled) continue;
		const amps = solution.edgeAmps.get(id) ?? 0;
		if (amps <= 0) continue;
		if (!solution.energized.has(edge.to)) continue;
		const from = getNode(edge.from);
		const to = getNode(edge.to);
		if (!from || !to) continue;

		const depth = solution.depth.get(edge.from) ?? 0;
		const phase = beats - depth / PULSE_HOPS_PER_BEAT;
		const t = phase - Math.floor(phase);

		const [ax, ay] = worldToScreen(from.x, from.y, cam, w, h);
		const [bx, by] = worldToScreen(to.x, to.y, cam, w, h);
		const px = ax + (bx - ax) * t;
		const py = ay + (by - ay) * t;

		const color = edge.polarity > 0 ? COLORS.positive : COLORS.negative;
		const size = Math.max(2, Math.min(6, 2 + amps * 2)) * (cam.zoom / 56);
		ctx.save();
		ctx.globalAlpha = 0.85 * input.brightness;
		ctx.shadowColor = color;
		ctx.shadowBlur = 10;
		ctx.fillStyle = '#fff6e8';
		ctx.beginPath();
		ctx.arc(px, py, size, 0, Math.PI * 2);
		ctx.fill();
		ctx.restore();
	}
}

/** Arrow at the screen edge pointing home when the source is off-view. */
function drawSourceCompass(
	ctx: CanvasRenderingContext2D,
	cam: Camera,
	w: number,
	h: number,
) {
	const [sx, sy] = worldToScreen(0, 0, cam, w, h);
	const margin = 26;
	if (sx > margin && sx < w - margin && sy > margin && sy < h - margin) return;

	const cx = w / 2;
	const cy = h / 2;
	const angle = Math.atan2(sy - cy, sx - cx);
	const px = cx + Math.cos(angle) * (Math.min(w, h) / 2 - margin);
	const py = cy + Math.sin(angle) * (Math.min(w, h) / 2 - margin);

	ctx.save();
	ctx.translate(px, py);
	ctx.rotate(angle);
	ctx.fillStyle = withAlpha('#ffe08a', 0.85);
	ctx.beginPath();
	ctx.moveTo(11, 0);
	ctx.lineTo(-8, 7);
	ctx.lineTo(-8, -7);
	ctx.closePath();
	ctx.fill();
	ctx.restore();
}

/** Shared with the inspector so both describe a node the same way. */
export const voltStatus = (volts: number) =>
	Math.abs(volts) >= MIN_VOLTS ? 'live' : 'dark';
