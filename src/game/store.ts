import { create } from 'zustand';

// Central game state, shared between the HTML overlay (outside the Canvas) and
// the 3D components (inside it). zustand is an external store, so it crosses the
// react-three-fiber renderer boundary without any context plumbing.
interface GameState {
	// Launch controls.
	angle: number; // degrees above horizontal, 0..90
	power: number; // 0..100, scaled to launch speed at fire time
	// Gameplay.
	score: number;
	hasLaunched: boolean; // true once the current projectile has been fired
	// Signals consumed by the 3D scene.
	launchId: number; // bumped once per launch; the projectile fires on change
	resetKey: number; // bumped on reset; remounts blocks + projectile fresh

	setAngle: (v: number) => void;
	setPower: (v: number) => void;
	setScore: (v: number) => void;
	launch: () => void;
	reset: () => void;
}

export const useGame = create<GameState>((set, get) => ({
	angle: 35,
	power: 55,
	score: 0,
	hasLaunched: false,
	launchId: 0,
	resetKey: 0,

	setAngle: (v) => set({ angle: v }),
	setPower: (v) => set({ power: v }),
	// Avoid needless notifications when the score is unchanged (called per frame).
	setScore: (v) => set((s) => (s.score === v ? s : { score: v })),

	// One shot per projectile: ignored until reset provides a fresh one.
	launch: () => {
		if (get().hasLaunched) return;
		set((s) => ({ hasLaunched: true, launchId: s.launchId + 1 }));
	},

	// Restore the wall and hand out a fresh projectile. Resetting launchId to 0
	// means the freshly-mounted projectile does not auto-fire.
	reset: () =>
		set((s) => ({
			hasLaunched: false,
			launchId: 0,
			score: 0,
			resetKey: s.resetKey + 1,
		})),
}));
