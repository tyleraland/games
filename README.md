# Games

A small collection of browser games built with **Vite** + **TypeScript** +
**React**, served from a single landing page. Pick one from the list and play.

| Game | What it is |
| --- | --- |
| [3D Slingshot](#3d-slingshot) | Arc a ball into a brick pyramid and knock it down |
| [Flowy](#flowy) | Wire a grid of nodes to a pulsing source and keep the volts up |

## Getting started

```bash
npm install
npm run dev      # start the dev server
npm run build    # type-check + production build
npm run lint
```

Then open the printed local URL.

---

## 3D Slingshot

A physics-based 3D slingshot game built with **React Three Fiber**,
**@react-three/rapier** (physics) and **zustand** (state).

> Scaffolded from the [renoiser/r3f-vite-starter](https://github.com/renoiser/r3f-vite-starter)
> template.

### How to play

- **Angle** / **Power** sliders set the shot; their current values are shown.
- **Launch** fires a single impulse — the ball arcs into the brick pyramid.
- **Score** counts how many bricks were knocked past a displacement threshold.
- **Reset** restores the pyramid, zeroes the score, and gives a fresh ball.

### Structure

| File | Responsibility |
| --- | --- |
| `src/game/config.ts` | Shared constants (gravity, camera, DPR cap, layout, launch tuning) |
| `src/game/store.ts` | zustand game state (angle, power, score, launch/reset signals) |
| `src/game/Scene.tsx` | The 3D world, wrapped in Rapier `<Physics>` |
| `src/game/Lights.tsx` | Ambient + shadow-casting directional lighting |
| `src/game/Ground.tsx` | Fixed ground slab |
| `src/game/Blocks.tsx` | Dynamic brick pyramid + per-frame displacement scoring |
| `src/game/Projectile.tsx` | Slingshot projectile; applies the launch impulse |
| `src/game/UI.tsx` | HTML overlay: sliders, Launch/Reset, score |

---

## Flowy

An incremental game about running a power grid. A source sits at the origin of
an infinite lattice of unconnected nodes and beats once a second. You pay coins
to wire nodes into the network, and taps convert the charge that reaches them
back into coins.

The pressure is that reaching further is not free. Every node you light draws
current, every wire drops voltage, and the source only has so many watts.

### How to play

- **Drag** to pan, **scroll** to zoom, <kbd>h</kbd> to fly back to the source.
  An arrow at the screen edge points home when the source is off-view.
- **Build connection** (or <kbd>b</kbd>), then click a node and another within
  3 units. Building chains from the node you just placed, so a long run is a
  series of clicks. <kbd>Esc</kbd> cancels.
- **Click** any node or connection to inspect its volts, amps, ohms and watts.
- Selected connections can be **flipped** between `+` and `−`, **disabled**, or
  torn out for half their cost.
- Spend coins on **Voltage**, **Capacity** and **Battery** upgrades.

### The model

It is a game model rather than a circuit simulator, but the pieces are honest
Ohm's law, and the numbers in the inspector are the ones the sim actually used.

**Current is demanded at the leaves.** Each energised node draws a fixed
operating current to stay awake — a tap drinks five times what a relay does.
A wire carries the sum of everything downstream of it.

**Voltage falls by I·R.** Across every wire (resistance proportional to its
length) and through every node's own series resistance. Long chains and fat
loads sag. A node below **6 V** goes dark: it earns nothing and lights nothing,
but it *keeps drawing its current*, so overextending costs watts and returns
nothing. That is the main thing pushing you toward short trunk runs, hubs, and
voltage upgrades.

**Charge follows the path of least resistance.** A Dijkstra tree over
(wire Ω + node Ω) decides which connection actually feeds each node. The others
stay live but idle — redundant paths, not extra throughput.

**Polarity is the interesting part.** A `−` connection inverts the potential it
passes on; everything downstream sits on the negative rail and works fine there.
But a node fed `+` by its supply path and `−` by a spare connection sees the two
oppose, and only the difference survives — which is how you switch a branch off
without disabling anything. Two feeds of the *same* sign do not stack; parallel
supplies never do.

**The source is finite.** Draw past its wattage and it browns out, with output
multiplied by `1/load²` — 110% load costs you 17% of your yield, 150% costs you
56%. Hit **twice** capacity and the breaker trips: the whole network goes dark
until you shed load and reset it.

**The battery** absorbs surplus watts and spends them to cover a shortfall,
which is what keeps a network flirting with its ceiling out of brownout. (The
spec left its use open; buffering is the interpretation here. Storing whole
beats to fire a burst later is the obvious next thing to try.)

Taps pay out in proportion to how well they are fed — a tap at half its rated
48 V returns half a coin — so voltage upgrades raise income as well as reach,
up to a 2× cap. They also raise draw, since `P = V·I`, which is a real tradeoff
rather than a free win.

### Node kinds

Roughly one cell in five holds a node, and one node in ten is a tap.

| Kind | Series Ω | Draw | Yield | Role |
| --- | --- | --- | --- | --- |
| Source | 0 | — | — | The only thing that makes charge |
| Relay | 0.6 | 0.05 A | — | Plain conduit |
| Tap | 1.2 | 0.25 A | 1 coin/beat | Pays out, drinks current, drops volts |
| Coil | 2.4 | 0.02 A | — | Sips current, strangles anything downstream |
| Hub | 0.15 | 0.12 A | — | Near-lossless junction for a trunk line |

The lattice is procedural: nodes are derived from their coordinates by a hash
rather than stored, so panning to a fresh region always yields the same layout
and the world costs nothing to keep around.

### Structure

| File | Responsibility |
| --- | --- |
| `src/flowy/config.ts` | Every tunable number — grid, electrical model, economy, palette |
| `src/flowy/world.ts` | Procedural lattice, node kinds, connection cost and validity |
| `src/flowy/sim.ts` | The solve: supply tree, currents, voltage drops, polarity |
| `src/flowy/store.ts` | zustand state, the beat, and every player action |
| `src/flowy/render.ts` | Canvas painter — pure function of camera, state and clock |
| `src/flowy/GridCanvas.tsx` | Canvas element, rAF loop, pan/zoom/hit-testing |
| `src/flowy/HUD.tsx` | Top bar: meters, load bar, upgrade shop |
| `src/flowy/Inspector.tsx` | Side panel for the selected node or connection |

Camera and pointer state live in refs rather than React state — panning happens
at frame rate, and the surrounding panels only need to re-render once a beat.

## Adding a game

Add an entry to `src/games.ts` and a matching `<Route>` in `src/App.tsx`.

## Performance notes

- Renderer DPR is capped at `Math.min(window.devicePixelRatio, 2)` for mobile.
- Slingshot's brick count is modest (10) and the layout is built once, not per
  frame; `Reset` remounts via a React `key` bump rather than mutating bodies.
- Flowy's solve is O(E log V) and runs only when the graph or the source
  changes, not per frame.
- Only nodes inside the viewport are drawn; the lattice outside it does not
  exist until something asks for it.
