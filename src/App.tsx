import { Canvas } from '@react-three/fiber';
import Scene from './game/Scene';
import { CAMERA, MAX_DPR } from './game/config';

function App() {
	return (
		<div className="canvas-container">
			<Canvas
				shadows
				// Cap device pixel ratio for mobile performance.
				dpr={MAX_DPR}
				camera={{
					position: CAMERA.position,
					fov: CAMERA.fov,
					near: CAMERA.near,
					far: CAMERA.far,
				}}
				onCreated={({ camera }) => camera.lookAt(...CAMERA.target)}
			>
				<Scene />
			</Canvas>
		</div>
	);
}

export default App;
