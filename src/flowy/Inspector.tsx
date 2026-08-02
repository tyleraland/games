import {
	MIN_VOLTS,
	REFERENCE_VOLTS,
	MAX_YIELD_MULTIPLIER,
	REFUND_FRACTION,
	SAG_BROWNOUT,
	SOURCE_ID,
} from './config';
import { useFlowy } from './store';
import { getNode, type FlowyEdge } from './world';

const fmt = (n: number, digits = 2) => n.toFixed(digits);

/** Right-hand panel describing whatever is selected. */
export default function Inspector() {
	const selection = useFlowy((s) => s.selection);
	const edges = useFlowy((s) => s.edges);
	const solution = useFlowy((s) => s.solution);
	const offers = useFlowy((s) => s.offers);
	const coins = useFlowy((s) => s.coins);

	if (!selection) {
		return (
			<aside className="flowy-inspector">
				<div className="flowy-empty">
					<h2>Nothing selected</h2>
					<p>
						Tap any node to wire from it — everything within reach lights up with
						a ring and a price, and tapping a ring lays the run. Tap a
						connection to inspect it. Drag to pan, <kbd>h</kbd> to return to the
						source.
					</p>
					<Legend />
				</div>
			</aside>
		);
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
	const affordable = offers.filter((o) => coins >= o.cost);
	const cheapest = affordable.reduce<number | null>(
		(best, o) => (best === null || o.cost < best ? o.cost : best),
		null,
	);

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

			{/* The anchor state is the game's main verb, so say what it affords
			    right at the top rather than burying it under the readouts. */}
			<p className="flowy-wiring">
				{offers.length === 0 ? (
					<>Nothing left to reach from here — tap another node to wire from it.</>
				) : affordable.length === 0 ? (
					<>
						{offers.length} within reach, none affordable yet. The cheapest wants{' '}
						{Math.min(...offers.map((o) => o.cost))}c.
					</>
				) : (
					<>
						Wiring from here. {affordable.length} of {offers.length} ringed runs
						are affordable, from {cheapest}c — tap a ring to lay one.
					</>
				)}
			</p>

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
