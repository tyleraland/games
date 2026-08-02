import {
	MIN_VOLTS,
	REFERENCE_VOLTS,
	MAX_YIELD_MULTIPLIER,
	REFUND_FRACTION,
	SAG_BROWNOUT,
	SOURCE_ID,
} from './config';
import { useFlowy } from './store';
import { getNode, type FlowyEdge, type GhostLink } from './world';

const fmt = (n: number, digits = 2) => n.toFixed(digits);

/** Right-hand panel describing whatever is selected. */
export default function Inspector() {
	const selection = useFlowy((s) => s.selection);
	const edges = useFlowy((s) => s.edges);
	const solution = useFlowy((s) => s.solution);
	const ghosts = useFlowy((s) => s.ghosts);
	const mode = useFlowy((s) => s.mode);

	if (!selection) {
		return (
			<aside className="flowy-inspector">
				<div className="flowy-empty">
					<h2>{mode === 'add' ? 'Pick a connection' : 'Nothing selected'}</h2>
					<p>
						{mode === 'add' ? (
							<>
								Every connection you could buy is drawn dashed, priced at its
								midpoint. Tap one to see what it would cost and which way it
								would feed, then confirm. <kbd>Esc</kbd> to stop.
							</>
						) : (
							<>
								Tap a node or a connection to inspect it. Drag to pan, scroll to
								zoom, press <kbd>h</kbd> to return to the source.
							</>
						)}
					</p>
					<Legend />
				</div>
			</aside>
		);
	}

	if (selection.type === 'ghost') {
		const ghost = ghosts.find((g) => g.id === selection.id);
		if (!ghost) return <aside className="flowy-inspector" />;
		return <GhostPanel ghost={ghost} />;
	}

	if (selection.type === 'edge') {
		const edge = edges[selection.id];
		if (!edge) return <aside className="flowy-inspector" />;
		return <EdgePanel edge={edge} />;
	}

	const node = getNode(selection.id);
	if (!node) return <aside className="flowy-inspector" />;

	const volts = solution.volts.get(node.id) ?? 0;
	const amps = solution.amps.get(node.id) ?? 0;
	const live = solution.energized.has(node.id);
	const incoming = Object.values(edges).filter((e) => e.to === node.id);
	const outgoing = Object.values(edges).filter((e) => e.from === node.id);
	const feed = solution.parent.get(node.id);

	return (
		<aside className="flowy-inspector">
			<header className="flowy-panel-head">
				<span
					className="flowy-swatch"
					style={{ background: node.def.color }}
					aria-hidden="true"
				/>
				<div>
					<h2>{node.def.label}</h2>
					<p className="flowy-coords">
						({node.x}, {node.y})
					</p>
				</div>
				<span className={`flowy-pill${live ? ' live' : ''}`}>
					{live ? 'live' : 'dark'}
				</span>
			</header>

			<p className="flowy-blurb">{node.def.blurb}</p>

			{node.id === SOURCE_ID && (
				<dl className="flowy-readout">
					<Row label="Open circuit" value={`${fmt(solution.openVolts)} V`} />
					<Row label="At the terminal" value={`${fmt(solution.terminalVolts)} V`} />
					<Row label="Internal resistance" value={`${fmt(solution.sourceOhms)} Ω`} />
					<Row label="Sagged away" value={`${fmt(solution.sag * 100, 1)}%`} />
					<Row label="Pulled by network" value={`${fmt(solution.totalAmps, 3)} A`} />
					<Row label="Through the source" value={`${fmt(solution.sourceAmps, 3)} A`} />
					<Row label="Cooking the source" value={`${fmt(solution.sourceLossW, 2)} W`} />
				</dl>
			)}

			{node.id === SOURCE_ID && solution.sag > SAG_BROWNOUT && (
				<p className="flowy-hint">
					{fmt(solution.sourceAmps, 2)} A through the source's own resistance is
					costing {fmt(solution.openVolts - solution.terminalVolts, 1)} V before
					the network sees a volt of it. Shed load, stiffen the source, or lean
					on the battery.
				</p>
			)}

			<dl className="flowy-readout">
				<Row label="Potential" value={`${fmt(volts, 2)} V`} />
				<Row label="Current through" value={`${fmt(amps, 3)} A`} />
				<Row label="Power delivered" value={`${fmt(Math.abs(volts) * amps)} W`} />
				<Row label="Series resistance" value={`${fmt(node.def.resistance)} Ω`} />
				<Row
					label="Burned internally"
					value={`${fmt(amps * amps * node.def.resistance, 3)} W`}
				/>
				<Row label="Own draw" value={`${fmt(node.def.draw, 3)} A`} />
				<Row
					label="Hops from source"
					value={
						solution.depth.has(node.id)
							? String(solution.depth.get(node.id))
							: 'unreached'
					}
				/>
				{node.def.yield > 0 && (
					<Row
						label="Yield"
						value={`${fmt(
							live
								? node.def.yield *
										Math.min(
											Math.abs(volts) / REFERENCE_VOLTS,
											MAX_YIELD_MULTIPLIER,
										)
								: 0,
						)} coins/beat`}
					/>
				)}
			</dl>

			{Math.abs(volts) > 0 && !live && (
				<p className="flowy-hint">
					Sagging below the {MIN_VOLTS} V wake threshold. Shorten the run, use
					lower-resistance nodes, or raise the source voltage.
				</p>
			)}

			<EdgeList title="Fed by" items={incoming} side="from" feed={feed} />
			<EdgeList title="Feeds" items={outgoing} side="to" />
		</aside>
	);
}

/** A connection on offer: what it would cost, and what it would do. */
function GhostPanel({ ghost }: { ghost: GhostLink }) {
	const coins = useFlowy((s) => s.coins);
	const solution = useFlowy((s) => s.solution);
	const confirm = useFlowy((s) => s.confirmGhost);
	const select = useFlowy((s) => s.select);

	const from = getNode(ghost.from);
	const to = getNode(ghost.to);
	if (!from || !to) return <aside className="flowy-inspector" />;

	const affordable = coins >= ghost.cost;
	const feeding = solution.energized.has(from.id);
	const alreadyLive = solution.order.includes(to.id);

	return (
		<aside className="flowy-inspector">
			<header className="flowy-panel-head">
				<div>
					<h2>Add connection</h2>
					<p className="flowy-coords">
						({from.x}, {from.y}) → ({to.x}, {to.y})
					</p>
				</div>
				<span className={`flowy-pill cost${affordable ? ' live' : ''}`}>
					{ghost.cost} coins
				</span>
			</header>

			<p className="flowy-blurb">
				Charge would run from the {from.def.label.toLowerCase()} into the{' '}
				{to.def.label.toLowerCase()}
				{to.def.yield > 0 && ', which pays out once it is lit'}.
				{!feeding &&
					' The feeding end is dark right now, so nothing will move until it is lit.'}
				{alreadyLive &&
					' That end is already on the network — this would be a second route into it, idle unless it undercuts the current one, and opposing it if you flip the polarity.'}
			</p>

			<dl className="flowy-readout">
				<Row label="Length" value={`${fmt(ghost.length)} u`} />
				<Row label="Wire resistance" value={`${fmt(ghost.ohms)} Ω`} />
				<Row label="Adds draw" value={`${fmt(to.def.draw, 3)} A`} />
				<Row label="Node resistance" value={`${fmt(to.def.resistance)} Ω`} />
				<Row label="Cost" value={`${ghost.cost} c`} />
				<Row label="You have" value={`${fmt(coins, 1)} c`} />
			</dl>

			{!affordable && (
				<p className="flowy-hint">
					Short by {fmt(ghost.cost - coins, 1)} coins.
				</p>
			)}

			<div className="flowy-actions">
				<button
					className="flowy-btn primary"
					disabled={!affordable}
					onClick={confirm}
				>
					Confirm — {ghost.cost} c
				</button>
				<button className="flowy-btn" onClick={() => select(null)}>
					Cancel
				</button>
			</div>
		</aside>
	);
}

function EdgePanel({ edge }: { edge: FlowyEdge }) {
	const solution = useFlowy((s) => s.solution);
	const flip = useFlowy((s) => s.flipPolarity);
	const reverse = useFlowy((s) => s.reverseLink);
	const toggle = useFlowy((s) => s.toggleEnabled);
	const remove = useFlowy((s) => s.removeLink);

	const from = getNode(edge.from);
	const to = getNode(edge.to);
	const amps = solution.edgeAmps.get(edge.id) ?? 0;
	const drop = amps * edge.ohms;
	const carrying = solution.parent.get(edge.to) === edge.id;

	// Why an enabled run is idle. These are genuinely different faults and the
	// fix for each is different, so saying "a lower-resistance route won" for all
	// of them sends the player looking in the wrong place.
	let idleReason: string | null = null;
	if (edge.enabled && !carrying) {
		if (edge.to === SOURCE_ID) {
			idleReason =
				'This points into the source, which is the root of every supply path — nothing can feed it, so this run can never carry anything. Reverse it.';
		} else if (!solution.order.includes(edge.from)) {
			idleReason =
				'The feeding end is not reachable from the source, so there is nothing here to pass on.';
		} else {
			idleReason =
				'Charge is taking a lower-resistance route into that node, so this run is idle. It still opposes the feed if their polarities disagree.';
		}
	}

	return (
		<aside className="flowy-inspector">
			<header className="flowy-panel-head">
				<div>
					<h2>Connection</h2>
					<p className="flowy-coords">
						({from?.x}, {from?.y}) → ({to?.x}, {to?.y})
					</p>
				</div>
				<span className={`flowy-pill${edge.enabled ? ' live' : ''}`}>
					{edge.enabled ? (carrying ? 'carrying' : 'idle') : 'off'}
				</span>
			</header>

			<p className="flowy-blurb">
				{edge.polarity > 0
					? 'Passes the upstream potential through unchanged.'
					: 'Inverts what it carries — downstream sits on the negative rail.'}
				{idleReason && <> {idleReason}</>}
			</p>

			<dl className="flowy-readout">
				<Row label="Polarity" value={edge.polarity > 0 ? '+' : '−'} />
				<Row label="Length" value={`${fmt(edge.length)} u`} />
				<Row label="Resistance" value={`${fmt(edge.ohms)} Ω`} />
				<Row label="Current" value={`${fmt(amps, 3)} A`} />
				<Row label="Voltage drop" value={`${fmt(drop)} V`} />
				<Row label="Lost to heat" value={`${fmt(amps * amps * edge.ohms, 3)} W`} />
				<Row label="Paid" value={`${edge.paid} c`} />
			</dl>

			<div className="flowy-actions">
				<button className="flowy-btn" onClick={() => flip(edge.id)}>
					Flip to {edge.polarity > 0 ? '−' : '+'}
				</button>
				{/* Free, because it is the same wire — only which end feeds changes. */}
				<button className="flowy-btn" onClick={() => reverse(edge.id)}>
					Reverse direction
				</button>
				<button className="flowy-btn" onClick={() => toggle(edge.id)}>
					{edge.enabled ? 'Disable' : 'Enable'}
				</button>
				<button className="flowy-btn danger" onClick={() => remove(edge.id)}>
					Tear out (+{Math.floor(edge.paid * REFUND_FRACTION)}c)
				</button>
			</div>
		</aside>
	);
}

function EdgeList({
	title,
	items,
	side,
	feed,
}: {
	title: string;
	items: FlowyEdge[];
	/** Which endpoint to name: the far end of an incoming or outgoing run. */
	side: 'from' | 'to';
	feed?: string;
}) {
	const select = useFlowy((s) => s.select);
	if (items.length === 0) return null;
	return (
		<section className="flowy-edgelist">
			<h3>{title}</h3>
			<ul>
				{items.map((edge) => {
					const other = getNode(side === 'from' ? edge.from : edge.to);
					return (
						<li key={edge.id}>
							<button
								className="flowy-link"
								onClick={() => select({ type: 'edge', id: edge.id })}
							>
								<span
									className={`flowy-sign ${edge.polarity > 0 ? 'pos' : 'neg'}`}
								>
									{edge.polarity > 0 ? '+' : '−'}
								</span>
								({other?.x}, {other?.y})
								{!edge.enabled && <em> off</em>}
								{feed === edge.id && <em> · feeding</em>}
							</button>
						</li>
					);
				})}
			</ul>
		</section>
	);
}

function Row({ label, value }: { label: string; value: string }) {
	return (
		<>
			<dt>{label}</dt>
			<dd>{value}</dd>
		</>
	);
}

function Legend() {
	return (
		<ul className="flowy-legend">
			<li>
				<span className="flowy-dot" style={{ background: '#ffe08a' }} /> Source —
				the only thing that makes charge
			</li>
			<li>
				<span className="flowy-dot" style={{ background: '#7fb2d9' }} /> Relay —
				plain conduit
			</li>
			<li>
				<span className="flowy-dot" style={{ background: '#f2c14e' }} /> Tap —
				pays coins, drinks current
			</li>
			<li>
				<span className="flowy-dot" style={{ background: '#b48ead' }} /> Coil —
				high resistance, strangles what follows
			</li>
			<li>
				<span className="flowy-dot" style={{ background: '#8fd6a8' }} /> Hub —
				near-lossless trunk junction
			</li>
		</ul>
	);
}
