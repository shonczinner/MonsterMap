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

## Open questions

- Can `Server/engine` export collision flags? (needs verification before the
  bake step is designed)
- Bun workspace vs plain folders for the split (tooling, not architecture)
