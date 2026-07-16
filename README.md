# 3D Slingshot Game

A physics-based 3D slingshot game built with **React Three Fiber**, **Vite**,
**TypeScript**, **@react-three/rapier** (physics) and **zustand** (state).

Launch a projectile at a stack of blocks, knock them over, and score points for
every block you displace.

> Scaffolded from the [renoiser/r3f-vite-starter](https://github.com/renoiser/r3f-vite-starter)
> template.

## Tech stack

- [React Three Fiber](https://github.com/pmndrs/react-three-fiber) — declarative
  three.js in React
- [@react-three/rapier](https://github.com/pmndrs/react-three-rapier) — Rapier
  physics bindings
- [zustand](https://github.com/pmndrs/zustand) — lightweight game state
- [Vite](https://vitejs.dev/) + TypeScript

## Getting started

```bash
npm install
npm run dev      # start the dev server
npm run build    # type-check + production build
```

Then open the printed local URL.

## How to play

- **Angle** / **Power** sliders set the shot; their current values are shown.
- **Launch** fires a single impulse — the ball arcs into the brick pyramid.
- **Score** counts how many bricks were knocked past a displacement threshold.
- **Reset** restores the pyramid, zeroes the score, and gives a fresh ball.

## Project structure

Each concern lives in its own file under `src/game/`:

| File | Responsibility |
| --- | --- |
| `config.ts` | Shared constants (gravity, camera, DPR cap, layout, launch tuning) |
| `store.ts` | zustand game state (angle, power, score, launch/reset signals) |
| `Scene.tsx` | The 3D world, wrapped in Rapier `<Physics>` |
| `Lights.tsx` | Ambient + shadow-casting directional lighting |
| `Ground.tsx` | Fixed ground slab |
| `Blocks.tsx` | Dynamic brick pyramid + per-frame displacement scoring |
| `Projectile.tsx` | Slingshot projectile; applies the launch impulse |
| `UI.tsx` | HTML overlay: sliders, Launch/Reset, score |

## Performance notes

- Renderer DPR is capped at `Math.min(window.devicePixelRatio, 2)` for mobile.
- Brick count is modest (10) and the layout is built once, not per frame.
- `Reset` remounts via a React `key` bump rather than mutating bodies by hand.
