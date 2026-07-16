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

## Project structure

Each concern lives in its own file under `src/game/`:

| File | Responsibility |
| --- | --- |
| `config.ts` | Shared constants (gravity, camera, DPR cap, layout) |
| `Scene.tsx` | The 3D world, wrapped in Rapier `<Physics>` |
| `Lights.tsx` | Ambient + shadow-casting directional lighting |
| `Ground.tsx` | Fixed ground slab |

_(more files are added as the game grows across milestones)_

## Performance notes

- Renderer DPR is capped at `Math.min(window.devicePixelRatio, 2)` for mobile.
- Block counts are kept modest and objects are not recreated every frame.
