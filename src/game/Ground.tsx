import { RigidBody } from '@react-three/rapier';
import { GROUND_SIZE } from './config';

// A large fixed ground slab. Modelled as a thin box (rather than an infinite
// plane) so a single cuboid collider both renders and collides. The top face
// sits exactly at y = 0, so everything else can be positioned relative to 0.
const THICKNESS = 1;

export default function Ground() {
	return (
		<RigidBody type="fixed" friction={1} colliders="cuboid">
			<mesh receiveShadow position={[0, -THICKNESS / 2, 0]}>
				<boxGeometry args={[GROUND_SIZE, THICKNESS, GROUND_SIZE]} />
				<meshStandardMaterial color="#3b4252" />
			</mesh>
		</RigidBody>
	);
}
