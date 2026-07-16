import { useRef } from 'react';
import { RigidBody, type RapierRigidBody } from '@react-three/rapier';
import { SLINGSHOT_ORIGIN, PROJECTILE_RADIUS } from './config';

// The projectile. It spawns at the slingshot origin with gravity disabled so it
// hovers in place until launched (the impulse is wired in Milestone 4). The ref
// is held here so the launch logic can reach the underlying rigid body.
export default function Projectile() {
	const ref = useRef<RapierRigidBody>(null);

	return (
		<RigidBody
			ref={ref}
			colliders="ball"
			position={SLINGSHOT_ORIGIN}
			gravityScale={0}
			restitution={0.3}
			friction={0.6}
		>
			<mesh castShadow>
				<sphereGeometry args={[PROJECTILE_RADIUS, 32, 32]} />
				<meshStandardMaterial color="#bf616a" metalness={0.1} roughness={0.5} />
			</mesh>
		</RigidBody>
	);
}
