# level-plan.md — Baking per-plane (level) terrain PNGs from the cache

> Status: design. Grounded in the actual decoder + colour logic found in the
> `rs2b0t` client (`src/client/shell/ClientBuild.ts`, `src/client/mapview/MapView.ts`,
> `src/client/config/FloType.ts`) and the existing nav cache reader
> (`rs2b0t/tools/nav/lib.ts`). The goal: produce one flat, north-up terrain PNG
> **per game plane** (0–3) for each area, so the map viewer can switch planes
> with the level selector — something the current `worldmap.jag`/`MapView` bake
> cannot do (it flattens every plane into one ground colour).

---

## 0. Why this is a different bake than today's

Today `lib/maps/bake.ts` → `bakeSource.ts` runs `rs2b0t`'s `MapView` against
`worldmap.jag`. `MapView` keeps a **single** 2D tile grid (`floort1/floort2/
floorsr`, `MapView.ts:162-173`) and `reloadMain/Dungeon/Extra` (`MapView.ts:452`)
just reload different *regions* of the same world into that one grid. There is
**no plane/level axis**. So the rendered PNG is ground-only and plane-agnostic.

The real per-plane terrain lives in the **engine land archive**
`data/pack/.cache/maps-server.zip` (relative to `ENGINE_DIR`), in the `m{mx}_{mz}`
entries — the same archive `Server/engine`'s `GameMap` loads, and the same one
`rs2b0t/tools/nav/lib.ts:loadMapsquares` already opens for collision. Each
`mx/mz` mapsquare is **64×64 tiles × 4 planes**, and the land packet carries a
per-tile-per-plane underlay id, overlay id, overlay shape/rotation, height, and
the `mapl` flag (which includes roof/block/wall bits). The client decodes this in
`ClientBuild.loadGround` (`src/client/shell/ClientBuild.ts:569`).

So a per-plane bake = decode that archive per plane and paint one PNG per plane.
No `worldmap.jag`, no `MapView`.

---

## 1. Source data (exact)

`maps-server.zip` entries (one per mapsquare, confirmed in `loadMapsquares`,
`rs2b0t/tools/nav/lib.ts:286`):

| entry        | contents                                  | needed for |
|--------------|-------------------------------------------|------------|
| `m{mx}_{mz}` | land: per-plane underlay/overlay/height/flags | **terrain + walkability** |
| `l{mx}_{mz}` | locs (walls/objects)                       | walkability (block flags) — already in nav reader |
| `n{mx}_{mz}` | npc spawns                                | not needed here |
| `o{mx}_{mz}` | obj spawns                                | not needed here |

- Mapsquare size: `MAP_X = MAP_Z = 64`, `LEVELS = 4` (`rs2b0t/tools/nav/lib.ts:259`).
- Absolute world tile coord of a local tile: `(mx << 6) + localX`, `(mz << 6) + localZ`.
- Fallback: a plain directory `data/pack/server/maps` with raw `m*`/`l*` files is
  also supported by `loadMapsquares` (use it if the zip is absent).
- `FloType` config (underlay/overlay colour tables) lives at
  `engine/src/cache/config/FloType.ts` (mirrored at `rs2b0t/src/client/config/FloType.ts`).

---

## 2. The land decode (authoritative — `ClientBuild.loadGround`)

For each `level` in `0..3`, each `x,z` in `0..63`, the packet emits a stream of
opcodes terminated by a `0`:

| opcode        | meaning                                              | field written |
|---------------|------------------------------------------------------|---------------|
| `0`           | end-of-tile; height derived (perlin for L0, else parent L−1 − 240) | `groundh` |
| `1`           | explicit height: `h = g1()` (1→0); `height = -h*8` (L0) or parent−240 | `groundh` |
| `2..49`       | **overlay**: `floort2 = g1b()` (overlay id); `floors = (op-2)/4` (shape); `floorr = (op-2)&3` (rotation) | `floort2/floors/floorr` |
| `50..81`      | **mapl flag**: `mapl = op-49` (roof/block/wall bits; includes `LINK_BELOW`) | `mapl` |
| `82..255`     | **underlay**: `floort1 = op-81` (underlay id)        | `floort1` |

Important for this plan:

- **`rs2b0t/tools/nav/lib.ts:parseLands` only captures `mapl`** (stored as
  `lands[coord] = opcode-49`) plus a `ground` presence bit for `opcode <= 49`.
  It deliberately throws away `floort1`/`floort2`. The terrain bake must capture
  the *underlay id* (`floort1`, opcode > 81) and *overlay id* (`floort2`,
  opcode 2–49) in addition — ideally **in the same decode loop** (see §7).
- `mapl` flags overlap with the nav collision flags. `LINK_BELOW` (0x2) is the
  bridge bit used by `bridgedLevel` (`rs2b0t/tools/nav/lib.ts`) to make a tile on
  plane *N* show the ground of plane *N−1* when linked. The terrain bake must
  apply the **same** bridge logic or planes will look wrong (e.g. an open
  upstairs rendered as solid ground).

---

## 3. Colour resolution (`FloType` + blend)

Two fidelity tiers. Pick one for MVP, keep the other as an upgrade.

### 3a. MVP — direct per-tile colour (recommended first cut)

For each tile, per plane:

1. `t1 = floort1[level][x][z]` (underlay id). If `t1 > 0`,
   `colour = FloType.list[t1-1].colour` (the 24-bit RGB already parsed in
   `FloType` from `dat.g3()`, `FloType.ts:45` → `getHsl`). This is the base
   ground colour. (No 11×11 averaging — slight banding vs. live client, fine for
   a 1px/tile selector.)
2. `t2 = floort2[level][x][z]` (overlay id). If `t2 > 0`:
   - `flo = FloType.list[t2-1]`.
   - If `flo.texture >= 0`: use a flat representative colour (texture averaging
     needs `Pix3D.getTextureAverage`; defer — see 3b). Or approximate with
     `flo.colour`.
   - Else if `flo.colour === MAGENTA`: transparent overlay → keep underlay.
   - Else: `colour = flo.colour` (or better, `flo.overlayHsl` resolved via
     `ClientBuild.getTable`, `ClientBuild.ts:1166`).
   - Overlay shape/rotation (`floors`, `floorr`) are **ignored** at 1px/tile —
   the whole tile is filled with the overlay colour. Shape only matters at
   higher resolution (`Ground.ts` `defShapeP/defShapeF`); skip for now.

Result: flat north-up fill, underlay with optional overlay override.

### 3b. High fidelity — replicate the client blend

The live client blends underlays over an **11×11 sliding window** and shades
per-corner by a `lightmap` — this is what gives OSRS ground its soft gradients.
It lives in `ClientBuild` (≈`ClientBuild.ts:134-313`):

- For every underlay id `t1>0`, accumulate per column the `FloType`
  `underlayHue / saturation / lightness / chroma` over a ±5 tile window
  (`huetot/sattot/ligtot/comtot/tot`); then
  `hue = (blendHue*256/blendCom)`, `sat = blendSat/blendTot`,
  `lig = blendLig/blendTot`; `t1Colour = ClientBuild.getTable(hue,sat,lig)`.
- A per-tile random jitter is added (`hueOff/lgOff`, `ClientBuild.ts:28-29`)
  for the `t1RandColour` underlay tint.
- `underlay = Pix3D.colourTable[ClientBuild.getUCol(t1RandColour, 96)]`.
- Overlay: if `texture >= 0` → `Pix3D.getTextureAverage(texture)`; else if
  `colour === MAGENTA` → `0`; else `overlay = Pix3D.colourTable[getOCol(flo.overlayHsl, 96)]`.
- Per-corner shading via `getUCol(t1Colour, light{corner})` /
  `getOCol(t2Colour, light{corner})` using the `lightmap` computed from
  `groundh` height gradients (`ClientBuild.ts:118-130`).

To reuse *exactly* this, port `ClientBuild`'s `getTable`/`getUCol`/`getOCol` +
`Pix3D.colourTable`/`getTextureAverage` + the `FloType` HSL→RGB pipeline into the
Node bake (no DOM). That is more work but yields pixel-faithful ground. **MVP
does 3a; 3b is an optional later pass** once the pipeline + viewer toggle work.

Note: `MapView.getBlendedGroundColour` (`MapView.ts:663`) does a *similar* 11×11
average but on **pre-coloured** `floorcol1` tables from `worldmap.jag` — a
different (already-coloured) source. For the cache bake we resolve colours from
`FloType` ids (post-decode), not from `worldmap.jag`, so follow `ClientBuild`,
not `MapView`, for colour.

---

## 4. Output layout

Two packaging options; recommend **A then stitch to B** for the viewer.

### 4a. Per-mapsquare per-plane (what the decoder naturally produces)

```
out/maps/level/{mx}_{mz}-l{0,1,2,3}.png   (64×64, RGBA, 1px/tile)
out/maps/level/manifest.json              (list of covered squares + plane count)
```

Small, cacheable, matches how the engine streams mapsquares. Stitching later is
trivial (fixed 64×64 tiles, known `mx/mz`).

### 4b. Stitched per-area per-plane (matches current viewer model)

Mirror the existing `surface/dungeon/extra.png` but split by plane:

```
out/maps/{surface,dungeon,extra}-l{0,1,2,3}.png
out/maps/layout-levels.json   (per area: plane → world-tile rect, pixelsPerTile=1)
```

Use the existing crop/stitch logic + the pure-Node PNG encoder
`rs2b0t/tools/map/encodePng.ts` (`encodePngRgba(rgba, w, h)` — zlib, no canvas).
MonsterMap's `lib/maps/bakeSource.ts` already has an equivalent encoder; reuse
whichever is cleaner.

### 4c. Scope — how many mapsquares

Full world ≈ thousands of mapsquares × 4 planes. **Recommend spawning-covered
only**: reuse `gen.ts`'s `boundsOf(maps.spawns)` to compute the set of
`mx/mz` actually referenced by monster/item/resource spawns, and bake just
those. Keeps PNG count/size bounded and matches what the map actually shows.
(Leave a `--full-world` flag for completeness.)

---

## 5. Aligning with the existing area + dot model

This is the one genuinely open integration question.

- The current 3 "areas" (`surface/dungeon/extra`) are **not** native cache
  concepts — they are `MapView` viewport regions (`mapArea` 0/1/2,
  `reloadMain/Dungeon/Extra`) over the *single* `worldmap.jag` world grid
  (size `mapWidth = 25<<6`, `mapHeight = 19<<6`, `MapView.ts:31-32`).
- The cache bake works in **absolute world tile coords** `(mx<<6+localX,
  mz<<6+localZ)` with a `z`-flip convention: `MapView.loadUnderlay/Overlay`
  place a square at row `mapHeight - mz - 1` (`MapView.ts:683+`). `ClientBuild`
  uses its own `BuildArea` origin.

To make the new per-plane PNGs line up with today's dots (`screenToTile`,
`areaScreenX/Y`, `tileX0/tileX1/tileZBot/tileZTop` in `map.ts`):

1. Read the existing `out/maps/layout.json` to get each area's world-tile rect
   (`tileX0/tileX1/tileZBot/tileZTop`) and `yOff` stacking.
2. Bake the per-plane PNG as **the same rect, same z-flip, per plane**. I.e. for
   area *A* and plane *P*, composite the covered `mx/mz` squares into the rect
   `A` already defines, applying `MapView`'s z-flip so a dot at world tile
   `(tx,tz,level=P)` lands on the same pixel as it does today.
3. Viewer change: `screenToTile` already returns a tile; extend it (or the dot
   lookup) to be plane-aware. Dots already carry `level`; the level selector
   swaps the displayed area PNG while leaving dots unchanged (per original plan).
   Per-plane dot tinting/hiding is a later, optional step.

If the 3-area model proves too rigid to reconcile with absolute cache coords,
fall back to a **world-tile-rect model** (one big per-plane world PNG + manifest
of rects) and re-derive dot placement from absolute coords. Decide during
implementation; flag as the main risk.

---

## 6. Walkability (nav) is the same reader — build it together

Do **not** write a second cache reader for nav. `rs2b0t/tools/nav/lib.ts` +
`build-collision.ts` already:
- opens `maps-server.zip`,
- runs `parseLands` (extracts `mapl` flags per plane),
- runs `forEachLoc` + `changeLocCollision` (loc block flags),
- builds a `CollisionEngine` packed to `collision.lcnav.gz`.

The terrain bake needs `floort1`/`floort2` from the **same** `m*` packet. So:

- Write **one** MonsterMap-side module `lib/maps/cache.ts` that decodes a
  mapsquare's land packet **fully** (capture `floort1`, `floort2`, `floors`,
  `floorr`, `mapl`, `groundh`, plus the `LINK_BELOW` bridge via `bridgedLevel`)
  in a single pass, mirroring `ClientBuild.loadGround` + `parseLands`.
- From that one decode, emit:
  - **terrain**: per-plane underlay/overlay PNGs (§3–§4), and
  - **walkability**: per-area/per-plane boolean flag grids for the route planner
    (the plan's "walkability data" step) — either as packed flags or by reusing
    the nav `CollisionEngine` pack directly.

This collapses the plan's separate "route planner walkability bake" and "per-plane
terrain bake" into a single shared core, and removes the old open question
*"Can Server/engine export collision flags?"* — yes, from `maps-server.zip`
exactly as `GameMap`/`build-collision.ts` do.

---

## 7. Implementation checklist (proposed)

1. **Port the land decoder.** Copy `ClientBuild.loadGround`'s opcode loop
   (`ClientBuild.ts:569-612`) into `lib/maps/cache.ts`, extending `parseLands`
   to also capture `floort1`/`floort2`/`floors`/`floorr`. Keep `mapl` for
   nav/bridge. Add `bridgedLevel` (from `rs2b0t/tools/nav/lib.ts`).
2. **Port colour tables.** `FloType` (engine copy loads read-only via
   `FloType.load(dataPack)`, see `gen.ts`). For MVP use `FloType.list[id-1].colour`.
   For 3b, port `ClientBuild.getTable/getUCol/getOCol` + `Pix3D.colourTable`.
3. **Paint.** For each covered mapsquare × plane: build a 64×64 RGBA buffer
   (underlay, overlay override), encode via `encodePngRgba`.
4. **Stitch / manifest.** Per area (rect from `layout.json`) × plane → PNG +
   `layout-levels.json` with plane→rect + pixelsPerTile.
5. **Scope guard.** Limit to spawn-covered mapsquares (`boundsOf` from `gen.ts`);
   `--full-world` opt-out.
6. **Viewer.** Add level selector to `monstermap.html`; swap area PNG by plane;
   make `screenToTile`/dot lookup plane-aware.
7. **Nav wiring (later).** Expose the same decoded flags as walkability grids for
   the route planner (A* over `flag grid` per original plan).

---

## 8. Risks / unknowns

- **Area↔cache coord reconciliation (§5)** — the main integration risk; the
  z-flip and the 3-area-vs-absolute-coords mismatch must be verified against a
  known landmark dot before trusting alignment.
- **Texture overlays** — `flo.texture >= 0` needs `Pix3D.getTextureAverage`;
  MVP approximates with flat colour. Visual only.
- **Bridge planes** — must apply `LINK_BELOW`/`bridgedLevel` or planes render
  wrong; logic already exists in the nav reader, reuse it.
- **Members vs free** — nav reader skips non-member tiles outside `freemap`
  (`free2play.csv`). Terrain bake should paint the full (members) world for
  simplicity; free-mode filtering is a later option.
- **11×11 blend (3b)** — faithful but heavier; defer until after MVP validates
  the pipeline + viewer toggle.
- **Encode choice** — `rs2b0t/tools/map/encodePng.ts` (zlib, no canvas) or
  MonsterMap's existing `bakeSource.ts` encoder; pick one, don't duplicate.

---

## 9. Existing files, functions & inputs — and what this plan reimplements

> ### Canonical reference (track changes here; in case `rs2b0t` / `Server` ever merge with MonsterMap)
> These are the authoritative implementations this plan ports from. If the
> upstream files change, re-sync the MonsterMap copies against them.
>
> **`rs2b0t` (the bot) — terrain/land + nav cache reader:**
> - `rs2b0t/src/client/shell/ClientBuild.ts` — `loadGround` (full land decode, `:569`), `getTable` (`:1166`), `getUCol` (`:1417`), `getOCol` (`:1432`), 11×11 underlay blend (≈`:134-313`).
> - `rs2b0t/src/client/mapview/MapView.ts` — `getBlendedGroundColour` (`:663`), `loadUnderlay`/`loadOverlay` (worldmap.jag path, `:683+`), `reloadMain/Dungeon/Extra` (`:452`), map sizes (`:31-32`).
> - `rs2b0t/src/client/config/FloType.ts` — client `FloType` mirror (ids → HSL/RGB).
> - `rs2b0t/tools/nav/lib.ts` — `loadMapsquares` (`:286`), `parseLands` (`:315`), `forEachLoc`, `bridgedLevel`, `Reader`, `LocDef`, `loadLocTypes`, `MAP_X/MAP_Z/LEVELS` (`:259`).
> - `rs2b0t/tools/nav/build-collision.ts` — `CollisionBuilder`, packs `collision.lcnav.gz`.
> - `rs2b0t/tools/map/encodePng.ts` — `encodePngRgba` (pure-Node zlib PNG).
> - `rs2b0t/src/bot/event/webwalk/rsmod/` — `CollisionEngine.ts`, `collision.ts`, `flags.ts` (the route/nav engine + `CollisionFlag`).
>
> **`Server` (the engine) — authoritative config + server-side load:**
> - `Server/engine/src/engine/GameMap.ts` — loads `maps-server.zip` (`:66`), `multiway.csv`/`free2play.csv` (`:58-63`), `loadGround`/`loadLocations` (`:181`/`:241`).
> - `Server/engine/src/cache/config/FloType.ts` — **authoritative** `FloType` (ids/colours).
> - `Server/engine/src/engine/routefinder/flags.ts` — `CollisionFlag` constants.
>
> **MonsterMap (this repo) — current pieces this plan builds on:**
> - `lib/maps/bake.ts` + `lib/maps/bakeSource.ts` — today's `worldmap.jag`/`MapView` bake; `bakeSource.ts` already has its own `encodePngRgba` (`:188`, `:229`, mirrors `rs2b0t/tools/map/encodePng.ts`).
> - `lib/config.ts` — `Config` (`engineDir`, `clientDir`, `mapsServerZip`, `worldmapJag`).
> - `gen.ts` + `lib/tiles.ts` — `loadMaps`, `boundsOf` (spawn-covered mapsquare set).
> - `map.ts` — viewer (`screenToTile`, `areaScreenX/Y`, area rects, `layout.json`).
> - `plan.md` — original roadmap (this plan refines the per-plane + nav sections).

### 9.1 Inputs from `Server` (the engine)

These are **data/config inputs**, not code we copy — they come from the
`Server` project and are read at bake time:

| Input | Source (Server) | Used for |
|-------|-----------------|----------|
| `maps-server.zip` | `data/pack/.cache/maps-server.zip` (`GameMap.ts:66`) — entries `m*` land, `l*` locs, `n*` npcs, `o*` objs | primary terrain + walkability source |
| `FloType` config | `Server/engine/src/cache/config/FloType.ts`, loaded via `FloType.load(dataPack)` (see `gen.ts`) | authoritative underlay/overlay ids → colours |
| `multiway.csv` / `free2play.csv` | `Environment.build.srcDir/maps/` (`GameMap.ts:58-63`) | free-to-play tile masking (optional) |
| `CollisionFlag` constants | `Server/engine/src/engine/routefinder/flags.ts` | nav flag-grid semantics (reuse as-is) |

### 9.2 Bake things — what exists vs. what this plan reimplements

| Concern | Existing owner | Reimplemented in MonsterMap (this plan)? |
|---------|----------------|------------------------------------------|
| Open `maps-server.zip` / maps dir | `rs2b0t/tools/nav/lib.ts:loadMapsquares` | **YES** — port to open the same zip in MonsterMap (`lib/maps/cache.ts`) |
| Full land decode (opcodes → `floort1`/`floort2`/`floors`/`floorr`/`mapl`/`groundh`) | `rs2b0t/src/client/shell/ClientBuild.ts:loadGround` | **YES** — full decode; today only `mapl` is kept (`parseLands`) |
| `parseLands` (flag-only extract) | `rs2b0t/tools/nav/lib.ts:parseLands` | **YES** — superseded by the full decode; `mapl` retained for nav/bridge |
| Plane bridge (`LINK_BELOW` / `bridgedLevel`) | `rs2b0t/tools/nav/lib.ts:bridgedLevel` | **YES** — reuse/port so planes render correctly |
| Loc block flags (`forEachLoc` / `changeLocCollision`) | `rs2b0t/tools/nav/lib.ts` + `rs2b0t/.../rsmod/collision.ts` | REUSE for nav flags; **not** needed for terrain |
| Collision engine / A* (route) | `rs2b0t/.../rsmod/CollisionEngine.ts` + navigator | **NO** — stays in `rs2b0t`; we only emit flag grids |
| Colour resolution (`FloType` + blend) | `rs2b0t/src/client/config/FloType.ts`, `ClientBuild.getTable/getUCol/getOCol` | **YES** — MVP direct `.colour`; 3b ports the 11×11 blend |
| PNG encode | `rs2b0t/tools/map/encodePng.ts` **and** MonsterMap `lib/maps/bakeSource.ts` (`encodePngRgba`) | **REUSE** MonsterMap's existing encoder — don't duplicate |
| Per-area rect / `layout.json` | MonsterMap `lib/maps/bake.ts` | **REUSE** — read area rects for stitching (§5) |
| Viewer plane toggle | (none today) | **NEW** in `map.ts` (level selector + plane-aware `screenToTile`) |

### 9.3 What this plan newly introduces (not in `rs2b0t` / `Server`)

- `lib/maps/cache.ts` (proposed) — **one** full land decode feeding both terrain
  PNGs and walkability flag grids.
- Per-plane terrain PNGs + `layout-levels.json` (§4).
- Viewer level selector (`map.ts`) with plane-aware `screenToTile`/dot lookup.
- Optional 11×11 underlay blend port (§3b) for faithful ground colouring.
