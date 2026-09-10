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

## Shared page shell + dynamic nav bar

Both generated HTML pages now share a top nav bar so the site reads as one app
and new pages are easy to add.

- `lib/pages.ts` — the single source of truth. Exports `PAGES`
  (`{ name, file }[]`) and `navHtml(currentFile)`, which renders the bar and
  marks the active link. **To add a page: append to `PAGES` here** and create
  its generator + template — the nav updates on every page automatically.
- Templates carry a `__MM_NAV__` token; each generator replaces it with
  `navHtml(<that page's file>)`. `map.ts` → `monstermap.html`, `list.ts` →
  `monsters.html`, `items.ts` → `items.html`.

## Feature: item list page (browser)

Scope (confirmed): a static, filterable table of every item from the engine
`ObjType` cache, no server required.

Steps / implementation:

1. **`items.ts` (port of the standalone `ItemDebug/` gen).** Loads the engine
   `ObjType` cache read-only, iterates every id with a debug name, and dumps
   `out/data/items.tsv` (id, debug, name, stackable, members, noted, dummy,
   weight in grams, value, lendable, tradeable, examine). This folded the
   ItemDebug logic into this repo so item data is generated alongside the map
   and monster list.
2. **Reuses the list builder.** `lib/listpage.ts` is the shared filterable-table
   engine (per-column substring for text, `min`/`max` range for numeric,
   sortable headers, live count) used by both `list.ts` and `items.ts`. The
   list template (`template_list.html`) is token-filled with `__MM_DATA__` /
   `__MM_NAV__` / `__MM_TITLE__`. A fully-empty column is treated as text (not
   numeric) so `examine` — empty in this engine build — stays a text filter.
3. **`bun build.ts`** runs all three generators; add a new page by appending to
   `PAGES` and importing its generator in `build.ts`.

## Feature: monster list page (browser)

Scope (confirmed): a static, filterable table of every monster from
`out/data/monsters.tsv`, no server required.

Steps / implementation:

1. **Generator `list.ts`.** Reads `monsters.tsv` (from `gen.ts`), parses it,
   decides per-column type (numeric only if *every* non-empty value parses as a
   number — so `members` stays text, `attackrange`/`hp`/`att`/… become numeric),
    drops the spawn-coordinate columns `absX`/`absZ` (already plotted on the map
    and clutter the table), de-duplicates rows on content (every displayed
    column, so a monster listed once per spawn point appears once while genuine
    stat/level variants are kept), and inlines `{ columns, rows }` as JSON into
    `template_list.html` → `out/monsters.html`.
2. **Filters.** One control per column:
   - text columns → substring match (same spirit as the map's name search);
   - numeric columns → optional `min` / `max` inputs → "between" range filter
     (either bound may be left empty).
   Filters combine with AND and re-run live on every keystroke.
3. **Table.** Sticky header, click a column to sort asc/desc, live result
   count (`N / total`). Vanilla JS inlined — no table library / bundler needed,
   consistent with how `map.ts` inlines the clustering source.

## Feature: per-plane (level) terrain PNGs + level selector

**Confirmed blocker (why the current bake can't do it):** MonsterMap's map is
baked from `worldmap.jag` via `Server/webclient`'s `MapView`. `MapView` has
exactly **3 areas** (`mapArea` 0/1/2 = surface/dungeon/extra, `MapView.ts`
`reloadMain/Dungeon/Extra`) and a single 2D tile grid (`floort1/floort2/
floorsr`). Every game plane is flattened into one ground colour — there is **no
plane/level axis** in that data, so it is impossible to derive a "plane 1 vs
plane 0" terrain PNG from it. The spawn `level` (0–3) exists only in the spawn
data, not in the rendered terrain.

**Where real per-plane terrain lives:** the engine's mapsquare land data
(underlay/overlay per tile per plane) in `Server/engine` — floor colours via
`FloType` (`engine/src/cache/config/FloType.ts`) plus the per-plane land the
client's `dash3d` scene reads (`webclient/src/dash3d/{World,Square,Ground}.ts`).
That scene renderer draws the live 3D world per plane; **not** `MapView`.

**Approach — a new bake, separate from the worldmap one:**
1. Load engine per-plane land for the target region: for each mapsquare, each
   plane (0–3), the underlay id + overlay id/shape per tile — the same source
   the client `Ground`/`Square` use.
2. Load colour configs (`FloType` underlay colours + overlay equivalents),
   mirroring `MapView.getBlendedGroundColour`.
3. Paint a flat, north-up PNG per plane (1 px/tile) for the covered region,
   reusing the crop logic + the pure-Node PNG encoder already in
   `lib/maps/bakeSource.ts`.
4. Emit e.g. `out/maps/{surface,dungeon,extra}-l{0,1,2,3}.png` (+ a small
   manifest mapping plane → world-tile rect), one set per area.
5. UI: add a **level selector** to `monstermap.html` that swaps the displayed
   area PNG to that plane while leaving dots unchanged (dots already carry
   `level`; tinting/hiding dots per plane is a later, optional step).

**Risks / open questions:**
- Exact mapsquare land binary format + how the client unpacks per-plane
  underlay/overlay (trace the `dash3d`/land loader — the biggest unknown).
- Scope: full world per plane vs. just the spawn-covered mapsquares
  (recommend the latter to bound PNG size/count).
- Start with flat ground fill; add overlay shapes/walls only if needed.
- This is a **separate, sizable** renderer — not a tweak of the existing
  `bake.ts`/`MapView` path.

### Consolidation with nav: one cache reader, two artifacts

The route planner's walkability input and per-plane terrain look like two
features in the sections above, but they are the **same cache read** — there is
no second bake.

**Walkability (nav) is already solved in rs2b0t.** `rs2b0t/tools/nav/lib.ts`
(`loadMapsquares` / `parseLands` / `forEachLoc`) reads `maps-server.zip`
engine per-plane land (`m*`) + loc (`l*`) archives — the exact archive
`Server/engine`'s `GameMap` loads — and `tools/nav/build-collision.ts` builds a
`CollisionEngine` and packs it to `collision.lcnav.gz`. So the plan's open
question *"Can Server/engine export collision flags?"* is answered **yes**, and
the route planner can reuse that reader (or its pack) directly. No separate
flag-bake design is needed beyond pointing at this.

**Per-plane terrain reuses the same reader.** `parseLands` already walks every
plane of every mapsquare; today it only extracts the collision opcodes
(opcode > 49 → roof/block flag). The underlay/overlay floor **ids** (the data
needed to colour a tile) are in the *same* land packet at different opcodes —
the client's `dash3d/{World,Square,Ground}.ts` + `FloType` (`engine …/cache/config/FloType.ts`)
show how to decode + blend them (mirror `MapView.getBlendedGroundColour`). So
the per-plane bake is *extend* `parseLands` to also capture underlay/overlay
per tile per plane, then paint via `FloType` — using the pure-Node PNG encoder
already in `tools/map/encodePng.ts` (rs2b0t) / `lib/maps/bakeSource.ts`.

**Net:** one cache-based bake (reads `maps-server.zip`, the engine per-plane
land+loc archive) emits both:
1. per-area walkability flag grids (for the route planner), and
2. per-plane terrain PNGs + manifest (for the level selector).

This collapses the plan's "feature: route planner — walkability data" step 1
and "feature: per-plane terrain" into a single shared core module, and removes
the collision-flags open question.

## Open questions

- Per-plane underlay/overlay id extraction: confirm the exact land-packet
  opcode layout by tracing `dash3d/{World,Square,Ground}.ts` (the remaining
  unknown for terrain colouring — collision flags are already decoded).
- Bun workspace vs plain folders for the split (tooling, not architecture)

- Change click to add points and show a list of points, right to wipe all points, copies as (x1,y1,z1),(x2,y2,z2),(x3,y3,z3),... - need some good UI/UX to have multiple lists of points at a time and show total distance (for now just linear) between all points in a list e.g. p2-p1, p3-p2, etc. - can delete individual points? Can move points up or down list?