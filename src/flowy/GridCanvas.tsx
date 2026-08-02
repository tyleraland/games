import { useCallback, useEffect, useRef } from 'react';
import { CAMERA } from './config';
import {
	draw,
	nodeRadius,
	screenToWorld,
	worldToScreen,
	type Camera,
} from './render';
import { useFlowy } from './store';
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

	/* --- Render loop --- */
	useEffect(() => {
		const canvas = canvasRef.current;
		if (!canvas) return;
		const ctx = canvas.getContext('2d');
		if (!ctx) return;

		let frame = 0;
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
			draw(ctx, w, h, {
				camera: cameraRef.current,
				edges: s.edges,
				solution: s.solution,
				selection: s.selection,
				hoverNode: hoverRef.current,
				linkFrom: s.linkFrom,
				pointer: pointerRef.current,
				tripped: s.tripped,
				factor: s.tripped ? 0 : s.meters.factor,
				timeMs: now - start,
			});
			frame = requestAnimationFrame(render);
		};

		frame = requestAnimationFrame(render);
		return () => cancelAnimationFrame(frame);
	}, []);

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
		const drag = dragRef.current;
		dragRef.current = null;
		if (drag?.moved) return; // that was a pan

		const store = useFlowy.getState();
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
		// Empty space: drop the selection, and abandon a half-built connection.
		store.select(null);
		if (store.linkFrom) store.cancelLink();
	};

	const onPointerLeave = () => {
		pointerRef.current = null;
		hoverRef.current = null;
		dragRef.current = null;
	};

	// Zoom toward the cursor so the point under the pointer stays put.
	const onWheel = (e: React.WheelEvent<HTMLCanvasElement>) => {
		const { x, y, w, h } = localPoint(e);
		const cam = cameraRef.current;
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

	// Escape abandons a pending connection; Home flies back to the source.
	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			if (e.key === 'Escape') useFlowy.getState().cancelLink();
			if (e.key === 'Home' || e.key === 'h') {
				cameraRef.current.x = 0.5;
				cameraRef.current.y = 0.5;
			}
			if (e.key === 'b') {
				const s = useFlowy.getState();
				s.setMode(s.mode === 'build' ? 'select' : 'build');
			}
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
			onPointerLeave={onPointerLeave}
			onWheel={onWheel}
		/>
	);
}
