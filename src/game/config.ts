// Shared world/game constants. Kept in one place so tuning is easy and the
// same numbers drive physics, camera and gameplay logic across files.
import type { Vector3Tuple } from 'three';

// Physics gravity (m/s^2). Standard earth gravity pulling down the y axis.
export const GRAVITY: Vector3Tuple = [0, -9.81, 0];

// Fixed perspective camera. We deliberately avoid OrbitControls so the shot
// framing stays consistent between launches.
export const CAMERA = {
	position: [14, 8, 18] as Vector3Tuple,
	fov: 45,
	near: 0.1,
	far: 200,
	// Point the camera looks at (roughly the middle of the play field).
	target: [0, 2, -2] as Vector3Tuple,
};

// Cap renderer device-pixel-ratio for mobile performance.
export const MAX_DPR = Math.min(
	typeof window !== 'undefined' ? window.devicePixelRatio : 1,
	2,
);

// Ground is a large thin fixed box whose top surface sits at y = 0.
export const GROUND_SIZE = 80;

// --- Block wall (Milestone 2) ---
// A brick is [width, height, depth]. Bricks are stacked in aligned columns so
// the wall is stable at rest, and touch along x so it reads as one wall.
export const BRICK: Vector3Tuple = [1, 0.6, 0.7];
// cols * rows bricks. 5 * 2 = 10.
export const WALL = { cols: 5, rows: 2, z: -3 };
