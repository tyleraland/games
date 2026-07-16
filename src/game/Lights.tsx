// Basic three-point-ish lighting: soft ambient fill plus one shadow-casting
// directional key light. The shadow camera is sized to the play field so
// shadows stay crisp without wasting resolution.
export default function Lights() {
	return (
		<>
			<ambientLight intensity={0.6} />
			<directionalLight
				castShadow
				position={[12, 18, 10]}
				intensity={1.4}
				shadow-mapSize-width={1024}
				shadow-mapSize-height={1024}
				shadow-camera-near={1}
				shadow-camera-far={60}
				shadow-camera-left={-25}
				shadow-camera-right={25}
				shadow-camera-top={25}
				shadow-camera-bottom={-25}
			/>
		</>
	);
}
