import { RigidBody } from '@react-three/rapier';

// Milestone 1 sanity check: a single dynamic body that spawns in the air,
// falls under gravity and comes to rest on the ground. Removed once the block
// stack (Milestone 2) provides its own proof that physics works.
export default function TestCube() {
	return (
		<RigidBody colliders="cuboid" position={[0, 6, 0]} restitution={0.2}>
			<mesh castShadow>
				<boxGeometry args={[1, 1, 1]} />
				<meshStandardMaterial color="#d08770" />
			</mesh>
		</RigidBody>
	);
}
