import { useEffect, useRef } from 'react';
import { RigidBody, type RapierRigidBody } from '@react-three/rapier';
import {
	SLINGSHOT_ORIGIN,
	PROJECTILE_RADIUS,
	SPEED_PER_POWER,
} from './config';
import { useGame } from './store';

// The projectile. It spawns at the slingshot origin with gravity disabled so it
// hovers in place until launched. On launch it re-enables gravity and receives
// a single impulse derived from the angle and power, so it arcs toward the wall.
export default function Projectile() {
	const ref = useRef<RapierRigidBody>(null);
	const launchId = useGame((s) => s.launchId);

	useEffect(() => {
		// launchId 0 is the un-fired state (also right after a reset).
		if (launchId === 0 || !ref.current) return;

		const { angle, power } = useGame.getState();
		const rad = (angle * Math.PI) / 180;
		// Fly toward the wall (-z) with an upward component set by the angle.
		const dir = { x: 0, y: Math.sin(rad), z: -Math.cos(rad) };
		const speed = power * SPEED_PER_POWER;
		// impulse = mass * desired velocity, so the launch speed is independent
		// of the projectile's mass.
		const m = ref.current.mass();
		ref.current.setGravityScale(1, true);
		ref.current.applyImpulse(
			{ x: dir.x * speed * m, y: dir.y * speed * m, z: dir.z * speed * m },
			true,
		);
	}, [launchId]);

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
