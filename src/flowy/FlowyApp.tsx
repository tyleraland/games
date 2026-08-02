import { useEffect, useState, type ReactNode } from 'react';
import GridCanvas from './GridCanvas';
import HUD from './HUD';
import Inspector from './Inspector';
import { TICK_MS } from './config';
import { useFlowy } from './store';
import { getNode } from './world';
import './flowy.css';

/** One line naming what is selected, for the collapsed sheet on a phone. */
function useSelectionSummary(): string {
	const selection = useFlowy((s) => s.selection);
	const offers = useFlowy((s) => s.offers);
	const coins = useFlowy((s) => s.coins);

	if (!selection) return 'Tap a node to wire from it';
	if (selection.type === 'edge') return 'Connection selected';
	const node = getNode(selection.id);
	if (!node) return 'Nothing selected';
	const affordable = offers.filter((o) => coins >= o.cost).length;
	const where = `${node.def.label} (${node.x}, ${node.y})`;
	if (offers.length === 0) return `${where} · nothing left in reach`;
	return `${where} · ${affordable} of ${offers.length} runs affordable`;
}

/**
 * The game itself: HUD above, canvas and inspector below. Deliberately free of
 * any router dependency so it can be mounted on its own — the route wrapper
 * supplies the "back to all games" link through `corner`.
 *
 * On a phone the inspector becomes a sheet that sits over the bottom of the
 * board and is collapsed by default. Building is done entirely on the canvas
 * now, so the readouts are reference material rather than a control surface,
 * and the board is worth far more of the screen than they are.
 *
 * The beat runs on a plain interval; the solve is cheap and only the economy
 * advances per tick, so there is nothing to gain from tying it to rAF.
 */
export default function FlowyApp({ corner }: { corner?: ReactNode }) {
	const [sheetOpen, setSheetOpen] = useState(false);
	const summary = useSelectionSummary();

	useEffect(() => {
		const id = window.setInterval(() => useFlowy.getState().tick(), TICK_MS);
		return () => window.clearInterval(id);
	}, []);

	return (
		<div className="flowy-root">
			<HUD />
			<div className={`flowy-body${sheetOpen ? ' sheet-open' : ''}`}>
				<GridCanvas />
				<div className="flowy-sheet">
					<button
						type="button"
						className="flowy-sheet-tab"
						aria-expanded={sheetOpen}
						onClick={() => setSheetOpen((open) => !open)}
					>
						<span className="flowy-sheet-title">{summary}</span>
						<span className="flowy-sheet-caret" aria-hidden="true">
							{sheetOpen ? 'Hide ▾' : 'Details ▴'}
						</span>
					</button>
					<Inspector />
				</div>
			</div>
			{corner}
		</div>
	);
}
