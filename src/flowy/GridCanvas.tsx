import { useCallback, useEffect, useRef } from 'react';
import { CAMERA } from './config';
import {
	draw,
	nodeRadius,
	offerAt,
	offerRingRadius,
	screenToWorld,
	worldToScreen,
	type Camera,
} from './render';
import { anchorOf, useFlowy } from './store';
import { getNode, nodesInRect } from './world';

/** A drag shorter than this many pixels counts as a click, not a pan. */
const CLICK_SLOP = 5;

/**
 * The grid view. Camera and pointer state live in refs rather than React state:
 * panning happens at frame rate, and re-rendering the surrounding panels 60
 * times a second to move a viewport would be pure waste. React only ever
 * re-renders here in response to the once-a-beat store updates.
 */
export default function GridCanvas() {
	const canvasRef = useRef<HTMLCanvasElement>(null);
	const cameraRef = useRef<Camera>({ x: 0.5, y: 0.5, zoom: CAMERA.zoom });
	const pointerRef = useRef<{ x: number; y: number } | null>(null);
	const hoverRef = useRef<string | null>(null);
	const dragRef = useRef<{
		startX: number;
		startY: number;
		camX: number;
		camY: number;
		moved: boolean;
	} | null>(null);

	/** Every pointer currently down, so two of them can be read as a pinch. */
	const pointersRef = useRef(new Map<number, { x: number; y: number }>());
	/** Live pinch: the last span and midpoint, updated each move. */
	const pinchRef = useRef<{ dist: number; mx: number; my: number } | null>(null);
	/** Set once a gesture has become a pinch, so lifting fingers never taps. */
	const suppressTapRef = useRef(false);
	/** Where the camera is easing to, or null when it is under manual control. */
	const glideRef = useRef<Camera | null>(null);
	/** The last camera request consumed, so each one is acted on exactly once. */
	const cueRef = useRef(0);
	/** How much of the canvas bottom the inspector sheet is covering. */
	const insetRef = useRef(0);

	/** Nearest node to a screen point, within its drawn radius. */
	const pickNode = useCallback(
		(sx: number, sy: number, w: number, h: number): string | null => {
			const cam = cameraRef.current;
			const [wx, wy] = screenToWorld(sx, sy, cam, w, h);
			const grab = Math.max(nodeRadius(cam) * 1.9, 12) / cam.zoom;
			let best: string | null = null;
			let bestDist = grab;
			for (const node of nodesInRect(wx - 2, wy - 2, wx + 2, wy + 2)) {
				const d = Math.hypot(node.x - wx, node.y - wy);
				if (d < bestDist) {
					bestDist = d;
					best = node.id;
				}
			}
			return best;
		},
		[],
	);

	/**
	 * The offered run whose ring is under a screen point. Offers sit on their
	 * destination node, so this deliberately outranks the plain node pick: while
	 * a node is ringed and priced, tapping it means "wire me there".
	 */
	const pickOffer = useCallback(
		(sx: number, sy: number, w: number, h: number): string | null => {
			const cam = cameraRef.current;
			const { offers } = useFlowy.getState();
			const grab = offerRingRadius(cam);
			let best: string | null = null;
			let bestDist = grab;
			for (const offer of offers) {
				const at = offerAt(offer, cam, w, h);
				if (!at) continue;
				const d = Math.hypot(sx - at[0], sy - at[1]);
				if (d < bestDist) {
					bestDist = d;
					best = offer.target;
				}
			}
			return best;
		},
		[],
	);

	/** Nearest connection to a screen point, by distance to its segment. */
	const pickEdge = useCallback(
		(sx: number, sy: number, w: number, h: number): string | null => {
			const cam = cameraRef.current;
			const { edges } = useFlowy.getState();
			let best: string | null = null;
			let bestDist = 10;
			for (const edge of Object.values(edges)) {
				const from = getNode(edge.from);
				const to = getNode(edge.to);
				if (!from || !to) continue;
				const [ax, ay] = worldToScreen(from.x, from.y, cam, w, h);
				const [bx, by] = worldToScreen(to.x, to.y, cam, w, h);
				const dx = bx - ax;
				const dy = by - ay;
				const lenSq = dx * dx + dy * dy;
				if (lenSq === 0) continue;
				const t = Math.max(
					0,
					Math.min(1, ((sx - ax) * dx + (sy - ay) * dy) / lenSq),
				);
				const d = Math.hypot(sx - (ax + dx * t), sy - (ay + dy * t));
				if (d < bestDist) {
					bestDist = d;
					best = edge.id;
				}
			}
			return best;
		},
		[],
	);

	/**
	 * Work out where the camera should sit so that a node and everything it is
	 * offering are both on screen, and start a glide there.
	 *
	 * MAX_LINK_DIST is 3 units and a phone shows roughly seven across, so an
	 * anchor's own ring cluster falls off the edge within a few builds. Without
	 * this the sheet cheerfully reports "6 of 8 runs affordable" over a board
	 * with no rings on it at all.
	 */
	const planCamera = useCallback(
		(node: string, force: boolean, w: number, h: number) => {
			const centre = getNode(node);
			if (!centre) return;
			const cam = cameraRef.current;
			const { offers, selection } = useFlowy.getState();

			let minX = centre.x;
			let maxX = centre.x;
			let minY = centre.y;
			let maxY = centre.y;
			// Only fold in the offers when they actually belong to this node.
			if (anchorOf(selection) === node) {
				for (const offer of offers) {
					const target = getNode(offer.target);
					if (!target) continue;
					minX = Math.min(minX, target.x);
					maxX = Math.max(maxX, target.x);
					minY = Math.min(minY, target.y);
					maxY = Math.max(maxY, target.y);
				}
			}
			// Room for the ring and its price plate, which sit outside the node.
			const pad = 0.75;
			minX -= pad;
			maxX += pad;
			minY -= pad;
			maxY += pad;

			// The sheet lies over the bottom of the canvas, so the part actually
			// worth aiming at is shorter than the canvas is.
			const safeH = Math.max(140, h - insetRef.current);
			const [vx0, vy0] = screenToWorld(0, 0, cam, w, h);
			const [vx1, vy1] = screenToWorld(w, safeH, cam, w, h);
			const visible =
				minX >= vx0 && maxX <= vx1 && minY >= vy0 && maxY <= vy1;
			if (visible && !force) return;

			// Only ever pull back to fit — yanking the zoom in on every build would
			// be far more disorienting than the odd ring near the edge.
			const fit = Math.min(w / (maxX - minX), safeH / (maxY - minY));
			const zoom = Math.max(
				CAMERA.minZoom,
				Math.min(cam.zoom, Math.min(CAMERA.maxZoom, fit)),
			);
			// Put the cluster's centre in the middle of the *safe* box, which means
			// biasing the camera so it rides above the sheet.
			glideRef.current = {
				x: (minX + maxX) / 2,
				y: (minY + maxY) / 2 + (h - safeH) / (2 * zoom),
				zoom,
			};
		},
		[],
	);

	// Dev-only handle on the live camera, so an integration check can assert what
	// a pinch or a glide actually did. Mirrors `window.flowy`; stripped from
	// production by the `import.meta.env.DEV` guard.
	useEffect(() => {
		if (!import.meta.env.DEV) return;
		(window as unknown as { flowyCamera?: Camera }).flowyCamera =
			cameraRef.current;
	}, []);

	/* --- Render loop --- */
	useEffect(() => {
		const canvas = canvasRef.current;
		if (!canvas) return;
		const ctx = canvas.getContext('2d');
		if (!ctx) return;

		let frame = 0;
		let frameCount = 0;
		const start = performance.now();

		const render = (now: number) => {
			const dpr = Math.min(window.devicePixelRatio || 1, 2);
			const rect = canvas.getBoundingClientRect();
			const w = Math.max(1, Math.round(rect.width));
			const h = Math.max(1, Math.round(rect.height));
			if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
				canvas.width = w * dpr;
				canvas.height = h * dpr;
			}
			ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

			const s = useFlowy.getState();

			// How much of the board the sheet is sitting on. Only counts when it
			// spans the canvas and overlaps it — on a wide screen the inspector is
			// a sibling beside the canvas and covers nothing.
			if (frameCount++ % 15 === 0) {
				const sheet = document.querySelector('.flowy-sheet');
				const sr = sheet?.getBoundingClientRect();
				insetRef.current =
					sr &&
					sr.width > 0 &&
					sr.left <= rect.left + 1 &&
					sr.right >= rect.right - 1 &&
					sr.top > rect.top
						? Math.max(0, rect.bottom - sr.top)
						: 0;
			}

			// Act on a camera request once, then glide rather than jump.
			if (s.cameraCue && s.cameraCue.id !== cueRef.current) {
				cueRef.current = s.cameraCue.id;
				planCamera(s.cameraCue.node, s.cameraCue.force, w, h);
			}
			const glide = glideRef.current;
			if (glide) {
				const cam = cameraRef.current;
				cam.x += (glide.x - cam.x) * 0.16;
				cam.y += (glide.y - cam.y) * 0.16;
				cam.zoom += (glide.zoom - cam.zoom) * 0.16;
				if (
					Math.abs(glide.x - cam.x) < 0.004 &&
					Math.abs(glide.y - cam.y) < 0.004 &&
					Math.abs(glide.zoom - cam.zoom) < 0.25
				) {
					// Mutate rather than replace — the object identity is held by the
					// dev camera handle.
					cam.x = glide.x;
					cam.y = glide.y;
					cam.zoom = glide.zoom;
					glideRef.current = null;
				}
			}

			draw(ctx, w, h, {
				camera: cameraRef.current,
				edges: s.edges,
				solution: s.solution,
				selection: s.selection,
				hoverNode: hoverRef.current,
				anchor: anchorOf(s.selection),
				offers: s.offers,
				coins: s.coins,
				tripped: s.tripped,
				sag: s.solution.sag,
				lastBuilt: s.lastBuilt,
				insetBottom: insetRef.current,
				timeMs: now - start,
				nowMs: now,
			});
			frame = requestAnimationFrame(render);
		};

		frame = requestAnimationFrame(render);
		return () => cancelAnimationFrame(frame);
	}, [planCamera]);

	/* --- Pointer handling --- */

	const localPoint = (e: React.PointerEvent | React.WheelEvent) => {
		const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
		return {
			x: e.clientX - rect.left,
			y: e.clientY - rect.top,
			w: rect.width,
			h: rect.height,
		};
	};

	const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
		const { x, y } = localPoint(e);
		e.currentTarget.setPointerCapture(e.pointerId);
		// Any touch takes the camera back off autopilot.
		glideRef.current = null;
		pointersRef.current.set(e.pointerId, { x, y });

		if (pointersRef.current.size === 2) {
			const [a, b] = [...pointersRef.current.values()];
			pinchRef.current = {
				dist: Math.hypot(b.x - a.x, b.y - a.y) || 1,
				mx: (a.x + b.x) / 2,
				my: (a.y + b.y) / 2,
			};
			// A second finger turns a pan into a pinch, and neither finger lifting
			// should then be read as a tap.
			dragRef.current = null;
			suppressTapRef.current = true;
			return;
		}

		dragRef.current = {
			startX: x,
			startY: y,
			camX: cameraRef.current.x,
			camY: cameraRef.current.y,
			moved: false,
		};
	};

	const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
		const { x, y, w, h } = localPoint(e);
		const cam = cameraRef.current;
		if (pointersRef.current.has(e.pointerId)) {
			pointersRef.current.set(e.pointerId, { x, y });
		}

		// Pinch: scale by how the span changed, and pan by how the midpoint moved,
		// so the pair of fingers keeps hold of the same patch of board.
		const pinch = pinchRef.current;
		if (pinch && pointersRef.current.size >= 2) {
			const [a, b] = [...pointersRef.current.values()];
			const dist = Math.hypot(b.x - a.x, b.y - a.y) || 1;
			const mx = (a.x + b.x) / 2;
			const my = (a.y + b.y) / 2;
			const [wx, wy] = screenToWorld(pinch.mx, pinch.my, cam, w, h);
			cam.zoom = Math.max(
				CAMERA.minZoom,
				Math.min(CAMERA.maxZoom, cam.zoom * (dist / pinch.dist)),
			);
			const [nx, ny] = screenToWorld(mx, my, cam, w, h);
			cam.x += wx - nx;
			cam.y += wy - ny;
			pinchRef.current = { dist, mx, my };
			hoverRef.current = null;
			return;
		}

		const drag = dragRef.current;
		if (drag) {
			const dx = x - drag.startX;
			const dy = y - drag.startY;
			if (!drag.moved && Math.hypot(dx, dy) > CLICK_SLOP) drag.moved = true;
			if (drag.moved) {
				cam.x = drag.camX - dx / cam.zoom;
				cam.y = drag.camY - dy / cam.zoom;
			}
		}

		const [wx, wy] = screenToWorld(x, y, cam, w, h);
		pointerRef.current = { x: wx, y: wy };
		hoverRef.current = drag?.moved ? null : pickNode(x, y, w, h);
	};

	const onPointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
		const { x, y, w, h } = localPoint(e);
		pointersRef.current.delete(e.pointerId);
		if (pointersRef.current.size < 2) pinchRef.current = null;

		const drag = dragRef.current;
		dragRef.current = null;

		if (suppressTapRef.current) {
			// Wait until every finger is off before taps count again.
			if (pointersRef.current.size === 0) suppressTapRef.current = false;
			return;
		}
		if (drag?.moved) return; // that was a pan

		const store = useFlowy.getState();
		// A ringed node is an offer first and a node second — that is the whole
		// point of the ring. Tapping the anchor again clears it, which is how you
		// get at a node that is currently wearing an offer.
		const offer = pickOffer(x, y, w, h);
		if (offer) {
			store.buildTo(offer);
			return;
		}
		const node = pickNode(x, y, w, h);
		if (node) {
			store.tapNode(node);
			return;
		}
		const edge = pickEdge(x, y, w, h);
		if (edge) {
			store.select({ type: 'edge', id: edge });
			return;
		}
		// A miss does nothing. Four cells in five are empty, so a thumb lands on
		// nothing constantly, and wiping every ring off the board for it was the
		// single most destructive thing a tap could do. Clearing the anchor is
		// still one tap — on the anchor itself.
	};

	const onPointerCancel = (e: React.PointerEvent<HTMLCanvasElement>) => {
		pointersRef.current.delete(e.pointerId);
		if (pointersRef.current.size < 2) pinchRef.current = null;
		if (pointersRef.current.size === 0) suppressTapRef.current = false;
		dragRef.current = null;
	};

	const onPointerLeave = () => {
		pointerRef.current = null;
		hoverRef.current = null;
	};

	// Zoom toward the cursor so the point under the pointer stays put. Desktop
	// only — touch gets the same job done with a pinch.
	const onWheel = (e: React.WheelEvent<HTMLCanvasElement>) => {
		const { x, y, w, h } = localPoint(e);
		const cam = cameraRef.current;
		glideRef.current = null;
		const [wx, wy] = screenToWorld(x, y, cam, w, h);
		const next = Math.max(
			CAMERA.minZoom,
			Math.min(CAMERA.maxZoom, cam.zoom * Math.exp(-e.deltaY * 0.0015)),
		);
		cam.zoom = next;
		const [nx, ny] = screenToWorld(x, y, cam, w, h);
		cam.x += wx - nx;
		cam.y += wy - ny;
	};

	// Keyboard is a desktop convenience only; everything here is reachable by tap.
	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			const s = useFlowy.getState();
			if (e.key === 'Escape') s.select(null);
			if (e.key === 'Home' || e.key === 'h') s.goHome();
			if (e.key === 'z') s.undo();
		};
		window.addEventListener('keydown', onKey);
		return () => window.removeEventListener('keydown', onKey);
	}, []);

	return (
		<canvas
			ref={canvasRef}
			className="flowy-canvas"
			onPointerDown={onPointerDown}
			onPointerMove={onPointerMove}
			onPointerUp={onPointerUp}
			onPointerCancel={onPointerCancel}
			onPointerLeave={onPointerLeave}
			onWheel={onWheel}
		/>
	);
}
