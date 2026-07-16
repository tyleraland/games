import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { RigidBody, type RapierRigidBody } from '@react-three/rapier';
import type { Vector3Tuple } from 'three';
import { BRICK, PYRAMID, DISPLACEMENT_THRESHOLD } from './config';
import { useGame } from './store';

// Palette for the bricks (Nord-ish), cycled across the stack.
const COLORS = ['#88c0d0', '#81a1c1', '#8fbcbb', '#a3be8c', '#ebcb8b'];

// Build the brick centre positions once as a pyramid: the base row has
// `PYRAMID.base` bricks, each row above has one fewer and is offset by half a
// brick so it bridges the two below.
function buildPyramid(): Vector3Tuple[] {
	const [w, h] = BRICK;
	const positions: Vector3Tuple[] = [];
	for (let r = 0; r < PYRAMID.base; r++) {
		const count = PYRAMID.base - r;
		const y = h / 2 + r * h;
		for (let c = 0; c < count; c++) {
			const x = (c - (count - 1) / 2) * w;
			positions.push([x, y, PYRAMID.z]);
		}
	}
	return positions;
}

// A stack of dynamic RigidBody bricks with cuboid colliders. At rest the
// pyramid stands; a projectile impact scatters it. Each frame the number of
// bricks displaced past a threshold is written to the store as the score.
export default function Blocks() {
	const layout = useMemo(buildPyramid, []);
	// One rigid-body handle per brick, filled in by the ref callbacks below.
	const bodies = useRef<(RapierRigidBody | null)[]>([]);
	const setScore = useGame((s) => s.setScore);

	useFrame(() => {
		let count = 0;
		for (let i = 0; i < layout.length; i++) {
			const body = bodies.current[i];
			if (!body) continue;
			const t = body.translation();
			const [ix, iy, iz] = layout[i];
			// Count a brick as knocked down once it has moved far horizontally
			// from its start, or dropped noticeably below its start height.
			const horizontal = Math.hypot(t.x - ix, t.z - iz);
			if (horizontal > DISPLACEMENT_THRESHOLD || t.y < iy - 0.4) count++;
		}
		// setScore is a no-op when unchanged, so this stays cheap per frame.
		setScore(count);
	});

	return (
		<>
			{layout.map((pos, i) => (
				<RigidBody
					key={i}
					ref={(el) => {
						bodies.current[i] = el;
					}}
					position={pos}
					colliders="cuboid"
					friction={0.8}
					restitution={0.1}
				>
					<mesh castShadow receiveShadow>
						<boxGeometry args={BRICK} />
						<meshStandardMaterial color={COLORS[i % COLORS.length]} />
					</mesh>
				</RigidBody>
			))}
		</>
	);
}
