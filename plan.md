# MonsterMap — Roadmap & Architecture Plan

> Status: conceptual. Nothing here is committed code yet — this file is a
> decision log so the direction is captured before implementation.

## Current state

`MonsterMap` is a **build-time tool**: it bakes three worldmap-area PNGs from
the game cache, plots points of interest, and emits a single static
`out/monstermap.html` (canvas + side panel). It has no runtime server and no
live data.

Relevant existing pieces:

- `map.ts` — generates `out/monstermap.html` from baked data + `template.html`
- `gen.ts`, `lib/` — data pipeline (monsters, items, resources, drops, etc.)
- `lib/maps/bake.ts` — bakes the area PNGs from `worldmap.jag` via `rs2b0t` code
- `template.html` + inline `<script>` — the browser viewer (pan/zoom/hover/flash)
- Coordinate system: each area has `tileX0/tileX1/tileZBot/tileZTop` and a
  `yOff` for vertical stacking. `screenToTile()` already converts screen → tile.

## Decision: interactive features belong in a separate app, sharing a core

Two distinct concerns:

1. **Data / atlas generation** (bake PNGs + flags, emit static viewer).
2. **Interactive navigation** (route planner now; possibly live bot nav later).

These should be split so the interactive side can grow without bloating the
static artifact. The bridge is a **shared core** of pure functions/types so the
tile↔screen math, area model, and flag format aren't duplicated (and don't
drift).


### Proposed structure (monorepo)

```
MonsterMap/
  packages/
    core/     shared lib: tile↔screen math, area layout model,
              flag-grid format, A* pathfinding, types
    map/      existing generator (map.ts, gen.ts, template.html)
              → outputs out/monstermap.html
    nav/      future interactive route planner (consumes baked data)
  package.json   bun workspace (packages/*)
  out/ data/ tools/ docs/   root, shared between packages
```

`core` = the extractable parts of today's `lib/` (config, colors, conddrops,
mapClustering, maps/*) plus the viewer's coordinate helpers. `map` and `nav`
both import it.

## Feature: route planner (browser)

Scope (confirmed): static route planner — click two points, draw a path. No
live game data.

Steps:

1. **Walkability data (the only new input).** No collision flags exist today.
   The `Server/engine` likely already parses map archives into a collision grid.
   Add a bake step emitting one boolean per tile per area
   (`out/maps/{surface,dungeon,extra}.flags.json` or a packed PNG) alongside
   `layout.json`.
2. **UI.** Reuse the pin box / `screenToTile()`: first click = start, second =
   end (or a small "route" mode toggle). Routing is **per-area** — the
   surface/dungeon/extra stacks are separate maps; no cross-area paths.
3. **A\*** over the flag grid in JS; draw the polyline in `draw()` reusing the
   pin crosshair style. Tile coords → screen via existing `areaScreenX` /
   `areaScreenY`.
4. **MVP shortcut:** ship a straight/Manhattan tile path that ignores walls to
   validate UX, then swap in real flags.

## Open questions

- Can `Server/engine` export collision flags? (needs verification before the
  bake step is designed)
- Bun workspace vs plain folders for the split (tooling, not architecture)
