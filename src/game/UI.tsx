import { useGame } from './store';

// HTML overlay (rendered outside the Canvas) with the launch controls and
// score. Reads/writes the shared zustand store.
export default function UI() {
	const angle = useGame((s) => s.angle);
	const power = useGame((s) => s.power);
	const score = useGame((s) => s.score);
	const hasLaunched = useGame((s) => s.hasLaunched);
	const setAngle = useGame((s) => s.setAngle);
	const setPower = useGame((s) => s.setPower);
	const launch = useGame((s) => s.launch);
	const reset = useGame((s) => s.reset);

	return (
		<div className="ui-overlay">
			<div className="ui-panel">
				<div className="ui-title">Slingshot</div>
				<div className="ui-score">Score: {score}</div>

				<label className="ui-control">
					<span>Angle</span>
					<input
						type="range"
						min={0}
						max={90}
						step={1}
						value={angle}
						onChange={(e) => setAngle(Number(e.target.value))}
					/>
					<span className="ui-value">{angle}°</span>
				</label>

				<label className="ui-control">
					<span>Power</span>
					<input
						type="range"
						min={0}
						max={100}
						step={1}
						value={power}
						onChange={(e) => setPower(Number(e.target.value))}
					/>
					<span className="ui-value">{power}</span>
				</label>

				<div className="ui-buttons">
					<button onClick={launch} disabled={hasLaunched}>
						Launch
					</button>
					<button onClick={reset}>Reset</button>
				</div>
			</div>
		</div>
	);
}
