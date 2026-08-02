import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import GridCanvas from '../flowy/GridCanvas';
import HUD from '../flowy/HUD';
import Inspector from '../flowy/Inspector';
import { TICK_MS } from '../flowy/config';
import { useFlowy } from '../flowy/store';
import '../flowy/flowy.css';

/**
 * Flowy: a 2D canvas grid, an HTML HUD above it and an inspector beside it.
 * The beat runs on a plain interval — the solve is cheap and only the economy
 * advances per tick, so there is nothing to gain from tying it to rAF.
 */
export default function FlowyGame() {
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
			<Link className="back-link" to="/">
				← All games
			</Link>
		</div>
	);
}
