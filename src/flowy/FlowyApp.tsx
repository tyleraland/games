import { useEffect, type ReactNode } from 'react';
import GridCanvas from './GridCanvas';
import HUD from './HUD';
import Inspector from './Inspector';
import { TICK_MS } from './config';
import { useFlowy } from './store';
import './flowy.css';

/**
 * The game itself: HUD above, canvas and inspector below. Deliberately free of
 * any router dependency so it can be mounted on its own — the route wrapper
 * supplies the "back to all games" link through `corner`.
 *
 * The beat runs on a plain interval; the solve is cheap and only the economy
 * advances per tick, so there is nothing to gain from tying it to rAF.
 */
export default function FlowyApp({ corner }: { corner?: ReactNode }) {
	useEffect(() => {
		const id = window.setInterval(() => useFlowy.getState().tick(), TICK_MS);
		return () => window.clearInterval(id);
	}, []);

	return (
		<div className="flowy-root">
			<HUD />
			<div className="flowy-body">
				<GridCanvas />
				<Inspector />
			</div>
			{corner}
		</div>
	);
}
