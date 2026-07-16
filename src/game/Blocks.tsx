import { useMemo } from 'react';
import { RigidBody } from '@react-three/rapier';
import type { Vector3Tuple } from 'three';
import { BRICK, PYRAMID } from './config';

// Palette for the bricks (Nord-ish), cycled across the stack.
const COLORS = ['#88c0d0', '#81a1c1', '#8fbcbb', '#a3be8c', '#ebcb8b'];

// Build the brick centre positions once as a pyramid: the base row has
// `PYRAMID.base` bricks, each row above has one fewer and is offset by half a
// brick so it bridges the two below.
export function buildPyramid(): Vector3Tuple[] {
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
// pyramid stands; a projectile impact scatters it (Milestone 4).
export default function Blocks() {
	const layout = useMemo(buildPyramid, []);

	return (
		<>
			{layout.map((pos, i) => (
				<RigidBody
					key={i}
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
