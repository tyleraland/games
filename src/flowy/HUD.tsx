import {
	SAG_BROWNOUT,
	SAG_SEVERE,
	SAG_TRIP,
	batteryJoules,
	sourceMaxWatts,
	sourceOhms,
	sourceVolts,
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
		effect:
			'Raises open-circuit volts. Pushes charge further before it sags, and taps pay out more.',
	},
	watts: {
		name: 'Capacity',
		effect:
			'Stiffens the source by lowering its internal resistance, so the bus holds up under more current.',
	},
	battery: {
		name: 'Battery',
		effect:
			'Injects current at the bus to prop the voltage up, and soaks up the surplus when there is headroom.',
	},
};

/** Which band of undervoltage the bus is sitting in. */
function sagBand(sag: number, tripped: boolean) {
	if (tripped) return { key: 'blackout', label: 'Blackout' } as const;
	if (sag >= SAG_SEVERE) return { key: 'severe', label: 'Severe brownout' } as const;
	if (sag >= SAG_BROWNOUT) return { key: 'brownout', label: 'Brownout' } as const;
	return { key: 'ok', label: 'Nominal' } as const;
}

/** Top bar: the source's vital signs plus the upgrade shop. */
export default function HUD() {
	const coins = useFlowy((s) => s.coins);
	const meters = useFlowy((s) => s.meters);
	const solution = useFlowy((s) => s.solution);
	const levels = useFlowy((s) => s.levels);
	const stored = useFlowy((s) => s.stored);
	const tripped = useFlowy((s) => s.tripped);
	const offers = useFlowy((s) => s.offers);
	const history = useFlowy((s) => s.history);
	const notice = useFlowy((s) => s.notice);
	const stuck = useFlowy((s) => s.stuck);
	const buy = useFlowy((s) => s.buy);
	const undo = useFlowy((s) => s.undo);
	const goHome = useFlowy((s) => s.goHome);
	const resetBreaker = useFlowy((s) => s.resetBreaker);

	const openVolts = sourceVolts(levels.volts);
	const ohms = sourceOhms(levels.watts);
	const capJ = batteryJoules(levels.battery);
	// The gauge reads the live solve rather than last beat's meters, so it is
	// right from the first frame and reacts the instant a connection is built
	// instead of lagging a beat behind.
	const terminal = tripped ? 0 : solution.terminalVolts;
	const sag = tripped ? 1 : solution.sag;
	const band = sagBand(sag, tripped);

	// The gauge runs from a dead bus to open-circuit, so the bar length *is* the
	// terminal voltage and the gap on the right is literally what has sagged away.
	const held = Math.max(0, Math.min(1, 1 - sag)) * 100;

	return (
		<div className={`flowy-hud band-${band.key}`}>
			<div className="flowy-hud-row">
				<Stat label="Coins" value={fmt(coins, coins < 1000 ? 1 : 0)} strong />
				<Stat label="Per beat" value={`+${fmt(meters.incomeC, 2)}`} />
				<Stat label="Current" value={`${fmt(solution.totalAmps, 2)} A`} />
				<Stat
					label="Delivered"
					value={`${fmt(solution.demandW)} / ${fmt(sourceMaxWatts(openVolts, ohms), 0)} W`}
				/>
				<Stat label="Source Ω" value={`${fmt(ohms, 2)} Ω`} />
				<Stat
					label="Heat"
					value={`${fmt(solution.lossW + solution.sourceLossW, 2)} W`}
				/>
				<Stat
					label="Battery"
					value={capJ > 0 ? `${Math.round(stored)} / ${capJ} J` : '—'}
					tone={
						meters.batteryAmps > 0.001
							? 'warn'
							: meters.batteryAmps < -0.001
								? 'good'
								: undefined
					}
				/>
			</div>

			{/* The headline reading: what the terminal is actually holding against
			    what it would read open-circuit. The gap is the brownout. */}
			<div className="flowy-bus">
				<div className="flowy-bus-readout">
					<span className={`flowy-bus-volts tone-${band.key}`}>
						{fmt(terminal, 1)} V
					</span>
					<span className="flowy-bus-of">of {openVolts} V</span>
					<span className={`flowy-bus-band tone-${band.key}`}>
						{band.label}
						{sag > SAG_BROWNOUT && !tripped && ` · −${fmt(sag * 100, 0)}%`}
					</span>
				</div>
				<div className="flowy-bus-gauge">
					<div
						className={`flowy-bus-fill tone-${band.key}`}
						style={{ width: `${held}%` }}
					/>
					{/* Where the protective gear gives up. */}
					<div
						className="flowy-bus-trip"
						style={{ left: `${(1 - SAG_TRIP) * 100}%` }}
						title={`Undervoltage trip at −${SAG_TRIP * 100}%`}
					/>
				</div>
			</div>

			<div className="flowy-hud-row flowy-hud-actions">
				{/* Never disabled: on a phone a greyed-out button explains nothing,
				    whereas pressing this one says what it would have done. */}
				<button
					className={`flowy-btn undo${history.length > 0 ? ' armed' : ''}`}
					onClick={undo}
				>
					Undo
					{history.length > 0 && (
						<span className="flowy-cost">
							+{history[history.length - 1].paid}c
						</span>
					)}
				</button>

				{/* Touch has no keyboard, so "press h" was no way home at all. */}
				<button className="flowy-btn" onClick={goHome}>
					Find source
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

			<div className={`flowy-notice${!notice && stuck ? ' stuck' : ''}`}>
				{notice ??
					stuck ??
					(tripped
						? `Breaker open — the bus fell past −${SAG_TRIP * 100}% and the protection dropped the load.`
						: sag >= SAG_SEVERE
							? `The bus is down to ${fmt(terminal, 1)} V. Taps earn in proportion to what reaches them, and the far grid is falling below its ${6} V wake threshold.`
							: sag >= SAG_BROWNOUT
								? `Browning out — ${fmt(solution.totalAmps, 2)} A through ${fmt(ohms, 2)} Ω is costing ${fmt(openVolts - terminal, 1)} V at the terminal.`
								: offers.length > 0
									? 'Tap any ringed node to wire it. The ring shows the price, and what it adds per beat.'
									: 'Tap a node to wire from it. Drag to pan, pinch to zoom.')}
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
