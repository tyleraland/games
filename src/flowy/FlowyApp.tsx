import { useEffect, useState, type ReactNode } from 'react';
import GridCanvas from './GridCanvas';
import HUD from './HUD';
import Inspector from './Inspector';
import { TICK_MS } from './config';
import { useFlowy } from './store';
import { getNode } from './world';
import './flowy.css';

/**
 * One line naming what is selected, for the collapsed sheet on a phone.
 *
 * This is the only line most players ever read, so it has to carry the warning
 * rather than leave it behind the Details toggle: anchored on an unlit node,
 * "8 of 8 runs affordable" is true and completely misleading, because none of
 * those eight would carry a thing.
 */
function useSelectionSummary(): { text: string; dark: boolean } {
	const selection = useFlowy((s) => s.selection);
	const offers = useFlowy((s) => s.offers);
	const coins = useFlowy((s) => s.coins);
	const solution = useFlowy((s) => s.solution);

	if (!selection) return { text: 'Tap a node to wire from it', dark: false };
	if (selection.type === 'edge')
		return { text: 'Connection selected', dark: false };
	const node = getNode(selection.id);
	if (!node) return { text: 'Nothing selected', dark: false };

	const where = `${node.def.label} (${node.x}, ${node.y})`;
	if (offers.length === 0)
		return { text: `${where} · nothing left in reach`, dark: false };

	// Runs *out* of an unlit node are stillborn; runs *into* it are how you fix
	// that, so those are the ones the line should be counting.
	if (!solution.energized.has(node.id)) {
		const feeds = offers.filter((o) => !o.dead).length;
		return {
			text:
				feeds > 0
					? `${where} · not fed · ${feeds}/${offers.length} rings feed it`
					: `${where} · not fed · nothing in reach feeds it`,
			dark: true,
		};
	}

	const affordable = offers.filter((o) => coins >= o.cost).length;
	return {
		text: `${where} · ${affordable} of ${offers.length} runs affordable`,
		dark: false,
	};
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
						className={`flowy-sheet-tab${summary.dark ? ' dark' : ''}`}
						aria-expanded={sheetOpen}
						onClick={() => setSheetOpen((open) => !open)}
					>
						<span className="flowy-sheet-title">{summary.text}</span>
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
