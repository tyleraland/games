import { useMemo } from 'react';
import { RigidBody } from '@react-three/rapier';
import type { Vector3Tuple } from 'three';
import { BRICK, WALL } from './config';

// Palette for the bricks (Nord-ish), cycled across the wall.
const COLORS = ['#88c0d0', '#81a1c1', '#8fbcbb', '#a3be8c', '#ebcb8b'];

// Build the brick centre positions once: aligned columns, `rows` high, centred
// on x = 0 and touching along x so the wall reads as a single face.
export function buildWall(): Vector3Tuple[] {
	const [w, h] = BRICK;
	const positions: Vector3Tuple[] = [];
	for (let r = 0; r < WALL.rows; r++) {
		for (let c = 0; c < WALL.cols; c++) {
			const x = (c - (WALL.cols - 1) / 2) * w;
			const y = h / 2 + r * h;
			positions.push([x, y, WALL.z]);
		}
	}
	return positions;
}

// A stack of dynamic RigidBody bricks with cuboid colliders. At rest the wall
// stands; a projectile impact scatters it (Milestone 4).
export default function Blocks() {
	const layout = useMemo(buildWall, []);

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
