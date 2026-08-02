import {
	BLACKOUT_LOAD,
	MAX_LINK_DIST,
	batteryJoules,
	batteryWatts,
	sourceVolts,
	sourceWatts,
	upgradeCost,
	type UpgradeKind,
} from './config';
import { useFlowy } from './store';

const fmt = (n: number, digits = 1) =>
	n.toLocaleString(undefined, {
		minimumFractionDigits: digits,
		maximumFractionDigits: digits,
	});

const UPGRADE_LABELS: Record<UpgradeKind, { name: string; effect: string }> = {
	volts: {
		name: 'Voltage',
		effect: 'Pushes charge further before it sags, and taps pay out more.',
	},
	watts: { name: 'Capacity', effect: 'Raises the wattage the source can hold.' },
	battery: {
		name: 'Battery',
		effect: 'Stores surplus joules and spends them to cover a shortfall.',
	},
};

/** Top bar: the source's vital signs plus the upgrade shop. */
export default function HUD() {
	const coins = useFlowy((s) => s.coins);
	const meters = useFlowy((s) => s.meters);
	const levels = useFlowy((s) => s.levels);
	const stored = useFlowy((s) => s.stored);
	const tripped = useFlowy((s) => s.tripped);
	const mode = useFlowy((s) => s.mode);
	const notice = useFlowy((s) => s.notice);
	const beat = useFlowy((s) => s.beat);
	const setMode = useFlowy((s) => s.setMode);
	const buy = useFlowy((s) => s.buy);
	const resetBreaker = useFlowy((s) => s.resetBreaker);

	const volts = sourceVolts(levels.volts);
	const capacityW = sourceWatts(levels.watts);
	const capJ = batteryJoules(levels.battery);
	const loadPct = capacityW > 0 ? (meters.demandW / capacityW) * 100 : 0;
	const brownedOut = !tripped && meters.load > 1;

	return (
		<div className="flowy-hud">
			<div className="flowy-hud-row">
				<Stat label="Coins" value={fmt(coins, coins < 1000 ? 1 : 0)} strong />
				<Stat label="Per beat" value={`+${fmt(meters.incomeC, 2)}`} />
				<Stat label="Source" value={`${volts} V`} />
				<Stat
					label="Draw"
					value={`${fmt(meters.demandW)} / ${capacityW} W`}
					tone={tripped ? 'bad' : brownedOut ? 'warn' : undefined}
				/>
				<Stat label="Lost to heat" value={`${fmt(meters.lossW, 2)} W`} />
				<Stat
					label="Battery"
					value={capJ > 0 ? `${Math.round(stored)} / ${capJ} J` : '—'}
					tone={
						capJ > 0 && meters.batteryW > 0
							? 'warn'
							: capJ > 0 && meters.batteryW < 0
								? 'good'
								: undefined
					}
				/>
				<Stat label="Beat" value={String(beat)} />
			</div>

			{/* Load bar. The segment past 100% is the brownout region; the whole bar
			    goes red once the breaker has let go. */}
			<div className="flowy-loadbar" title={`${fmt(loadPct, 0)}% of capacity`}>
				<div
					className={`flowy-loadbar-fill${brownedOut ? ' warn' : ''}${
						tripped ? ' bad' : ''
					}`}
					style={{ width: `${Math.min(100, loadPct / BLACKOUT_LOAD)}%` }}
				/>
				<div className="flowy-loadbar-mark" style={{ left: '50%' }} />
			</div>

			<div className="flowy-hud-row flowy-hud-actions">
				<button
					className={`flowy-btn${mode === 'build' ? ' active' : ''}`}
					onClick={() => setMode(mode === 'build' ? 'select' : 'build')}
				>
					{mode === 'build' ? 'Building…' : 'Build connection'}
				</button>

				{(Object.keys(UPGRADE_LABELS) as UpgradeKind[]).map((kind) => {
					const cost = upgradeCost(kind, levels[kind]);
					return (
						<button
							key={kind}
							className="flowy-btn"
							disabled={coins < cost}
							title={UPGRADE_LABELS[kind].effect}
							onClick={() => buy(kind)}
						>
							{UPGRADE_LABELS[kind].name} {levels[kind]} → {levels[kind] + 1}
							<span className="flowy-cost">{cost}c</span>
						</button>
					);
				})}

				{tripped && (
					<button className="flowy-btn danger" onClick={resetBreaker}>
						Reset breaker
					</button>
				)}
			</div>

			<div className="flowy-notice">
				{notice ??
					(tripped
						? `Breaker open. Draw hit ${fmt(BLACKOUT_LOAD * 100, 0)}% of capacity.`
						: brownedOut
							? `Brownout — output scaled to ${fmt(meters.factor * 100, 0)}%.`
							: mode === 'build'
								? `Click a node, then another within ${MAX_LINK_DIST}u. Esc cancels.`
								: `Battery rate ${batteryWatts(levels.battery)} W · drag to pan, scroll to zoom.`)}
			</div>
		</div>
	);
}

function Stat({
	label,
	value,
	strong,
	tone,
}: {
	label: string;
	value: string;
	strong?: boolean;
	tone?: 'good' | 'warn' | 'bad';
}) {
	return (
		<div className={`flowy-stat${strong ? ' strong' : ''}`}>
			<span className="flowy-stat-label">{label}</span>
			<span className={`flowy-stat-value${tone ? ` ${tone}` : ''}`}>
				{value}
			</span>
		</div>
	);
}
