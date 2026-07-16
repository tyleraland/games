import { Physics } from '@react-three/rapier';
import { GRAVITY } from './config';
import Lights from './Lights';
import Ground from './Ground';
import Blocks from './Blocks';
import Projectile from './Projectile';
import { useGame } from './store';

// The 3D world. Everything physical lives inside <Physics>. Lighting is added
// outside the physics tree because lights are not simulated bodies.
export default function Scene() {
	// Bumping resetKey remounts the wall and projectile at their start state.
	const resetKey = useGame((s) => s.resetKey);

	return (
		<>
			<Lights />
			<color attach="background" args={['#1e222a']} />
			<fog attach="fog" args={['#1e222a', 40, 90]} />
			<Physics gravity={GRAVITY}>
				<Ground />
				<group key={resetKey}>
					<Blocks />
					<Projectile />
				</group>
			</Physics>
		</>
	);
}
