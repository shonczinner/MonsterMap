# worldmap.jag — format & contents

The world map is shipped as one `JagFile` archive: `Server/engine/data/pack/mapview/worldmap.jag`.
This document describes what's inside it, how `MapView` (in `rs2b0t/src/mapview/MapView.ts`)
loads and renders it, and the coordinate model that makes all three map areas
(surface / dungeon / extra) coexist in a single jag.

---

## 1. JAG container format (`rs2b0t/src/io/JagFile.ts`)

A JAG file is a single blob with a small header followed by a directory of named
entries. Entries are looked up by **hash of their name**, not by position.

```
3 bytes  unpacked size of the whole uncompressed archive (or BZip2 payload)
3 bytes  packed size
         if packed == unpacked   -> archive stored raw
         else                    -> rest of file is one BZip2 stream, decompressed
         `JagFile.bunzip2()` expands it before the directory is read.
```

After decompression the directory is:

```
2 bytes  entry count (fileCount)
fileCount × :
    4 bytes  hash            (JagFile.genHash(name.lower -> uppercase 61-based))
    3 bytes  unpacked size   (of this entry, after its own BZip2)
    3 bytes  packed size     (of this entry, as stored)
offsets are implicit: entry i data starts after the directory + sum of prior packed sizes
```

`JagFile.read(name)` recomputes `genHash(name)`, scans `fileHash`, then pulls the
entry, BZip2-decompressing it on first access (`readIndex` caches the result).
`genHash` is `h = h*61 + (charCode - 32)` iterated over the uppercased name.

Sprites are *not* stored as separate individual entries; see `Pix8.Depack`
(`rs2b0t/src/graphics/Pix8.ts`) — a sprite family (e.g. `mapscene`) is one
`mapscene.dat` entry plus a shared `index.dat` that holds per-frame headers.

---

## 2. Entries inside worldmap.jag

`MapView.maininit()` reads these entry names in order:

### Tile data — one 64×64 mapsquare block per record

| entry          | loader                | per-block size | payload |
|----------------|-----------------------|----------------|---------|
| `labels.dat`   | (inline)              | —              | map labels: count, then per label `gjstr` name, `g2` x, `g2` y, `g1` size |
| `floorcol.dat` | (inline)              | —              | floor colour table: count, then per colour `g4` rgb1, `g4` rgb2 |
| `underlay.dat` | `loadUnderlay`        | 4096 bytes     | 64×64 underlay (ground) colour ids → `floort1` |
| `overlay.dat`  | `loadOverlay`         | ≤8192 bytes    | 64×64 overlay cells: `g1` opcode (0 = none), plus when opcode≠0 another `g1` shape byte → `floort2` (colour) + `floorsr` (shape) |
| `loc.dat`      | `loadLoc`             | var (RLE)      | walls / mapscenes / mapfunctions, see below |
| `obj.dat`      | `loadObj`             | 4096 bytes     | object-present flags (1 byte per cell) |
| `npc.dat`      | `loadNpc`             | 4096 bytes     | npc-present flags |
| `multi.dat`    | `loadMulti`           | var            | multicombat area flags |
| `free.dat`     | `loadFree`            | var            | free-to-play area flags |

`loc.dat` cells are run-length encoded: a `g1` opcode per cell; `0` ends the
cell; `1..28` → `locWall` (drawing id); `29..159` → `locMapscene` (sprite id =
opcode − 28); `160+` → `locMapfunction` (key id = opcode − 159) and registers the
function in `activeMapFunctions`.

### Sprite + font entries

| entry                | code                                 | usage |
|----------------------|--------------------------------------|-------|
| `mapscene.dat`       | `Pix8.depack(wm, 'mapscene', i)`     | scene icons (trees, rocks…) |
| `index.dat`          | shared frame-header table            | offsets/sizes for all sprite families |
| `mapfunction.dat`    | `Pix32.depack(wm, 'mapfunction', i)` | legend icons (bank, shops…) |
| `mapdots.dat`        | `Pix32.depack(wm, 'mapdots', i)`     | you-are-here marker dots |
| `b12_full.dat`       | `PixFont.depack(wm, 'b12_full', …)`  | classic map font |
| `f11.dat` … `f30.dat`| `WorldMapFont.load(wm, 'f11'…)`     | place-name fonts (sizes 11…30) |

`Pix8.depack` reads the opening `g2` of `mapscene.dat` as an offset into
`index.dat`, then per-sprite frame headers (`g2` ow, `g2` oh, palette count, then
for each requested sprite skipping 2+2 header bytes). The word "Pix8" = palette
(8-bit indexed) image; "Pix32" = direct ARGB.

---

## 3. Coordinate model — the whole jag is one world grid

Every tile-data entry is keyed by a **mapsquare coordinate** (the 64-tile block
index in the full world), stored as a byte pair:

```
mx = g1() * 64 - mapOriginX
mz = g1() * 64 - mapOriginZ
```

`g1()` returns the mapsquare index (0–255) on the *absolute* world grid; `*64`
converts to tile coords; subtracting `mapOrigin*` re-bases it into the current
view. The block is then a 64×64 span, top-aligned to this mapsquare:

```
for x in 0..64:
    zIndex = mapHeight - mz - 1
    for z in -64..0:
        floort1[mx + x][zIndex--] = g1()      // flipped Z
```

So **all three areas live in the same jag, addressed by the same absolute
mapsquare grid**; the area is purely which slice of that grid you load. The
loaders even skip blocks outside the current window (the `else` branch advances
the data position by the block size instead of decoding).

### The three areas (`MapView.reloadMain/Dungeon/Extra`)

| area   | mapArea | origin (mapsq) | origin (tile)     | size (mapsq) | size (tile) |
|--------|---------|----------------|-------------------|--------------|-------------|
| surface| 0       | 32, 44         | 2048, 2816        | 25 × 19      | 1600 × 1216 |
| dungeon| 1       | 32, 144        | 2048, 9216        | 25 × 19      | 1600 × 1216 |
| extra  | 2       | 28, 65         | 1792, 4160        | 21 × 15      | 1344 × 960  |

`reloadMain`/`reloadDungeon`/`reloadExtra` simply set `mapOriginX/Z`,
`mapWidth/Height` and re-run `maininit()` — the **same jag, same loader passes**.
Because the dat loaders key off the absolute mapsquare grid, the nominal windows
are: "surface" = the z-slice `44..62`, "dungeon" = `144..162`, "extra" =
`28..48 × 65..79` (i.e. origin mapsq + size mapsqs). Conceptually they are the
same object set placed at different world-bands (the game model: overlays up,
dungeons way up), all inside one coordinated grid.

Note the loaders skip the **outer ring**: the guard `mx > 0 && mz > 0 &&
mx + 64 < mapWidth && mz + 64 < mapHeight` means the first/last mapsquare row and
column of the window are skipped (edge data is instead advanced past), so the
actually-decoded span is inset by one mapsquare on each side — surface x/z
`33..55 × 45..61`, dungeon x/z `33..55 × 145..161`, extra `29..47 × 66..78`.

### Applying this to a bigger bake

The current `bakeSource.ts` keeps the three slices separate: it runs `maininit()`
once per area and renders each into its own PNG. Merging all three into **one
render pass** is valid precisely because the jag is a single grid — instead of
reloading per area you could:

```ts
// load the whole-span slice:
mapOriginX = 28 << 6          // cover "extra" x (28..48) and surface/dungeon x (32..56)
mapOriginZ = 44 << 6          // cover surface z, extra z (65..80), dungeon z (144..163)
mapWidth   = (57 - 28) << 6   // 29 mapsquares wide
mapHeight  = (163 - 44) << 6  // 119 mapsquares tall
```

then run `loadUnderlay/loadOverlay/loadLoc` once against a `TypedArray2d` sized to
that span. But note the loader guard `mx > 0 && mz > 0 && mx + 64 < mapWidth && …`
— anything on the 0 or `mapWidth`/`mapHeight` edge of the array isn't decoded, so
pad the span by one mapsquare on each side (or loosen the boundary checks) if the
outer blocks matter. `renderWorldMap(left, top, right, bottom, wOff, hOff, w, h)`
then draws any sub-rect of that one grid.

---

## 4. Rendering pipeline (`renderWorldMap`)

1. `getBlendedGroundColour()` precomputes a blended colour per tile from two
   `floorcol` shades and underlay/overlay ids → `blendedGroundColour`.
2. `renderWorldMap` walks the requested tile rect; for each *output* cell it
   scales tile→pixel (via `widthRatio`/`heightRatio` `<<16` fixed point), draws
   the ground fill (Pix2D `fillRect` or `drawOverlayShape` when there's an
   overlay shape), then:
   - walls → 1px edge lines (white/red/grey, `Pix2D.vline/hline`)
   - mapscenes → `scalePlotSprite(...)` scaled sprite blits
   - mapfunctions → `plotSprite` at cell center − 7 (only if
     `MapView.shouldDrawMapfunctions`)
   - labels / free / multi layers gated by the respective static `shouldDraw*`
     flags.
3. `renderWorldMap` may render any sub-rect *at any scale*: the first two args
   are the world-tile rect to cover, and `width`/`height` the output pixel size.
   The whole render is **north-up** — world tile-Z decreases as the output row
   increases (the loaders flipped Z at decode time, see §3). It renders purely
   into whatever `Pix2D` is parked on: in the real client that's the screen
   canvas, in a bake it's a standalone `PixMap` (see below).

### Baked PNGs — how MonsterMap visualizes surface / dungeon / extra

Terrain is **baked once**, not rendered live. `bun lib/maps/bake.ts` bundles
`lib/maps/bakeSource.ts` and runs it with `JAG`/`OUT` env; it drives the *real*
`MapView` headless three times — once per area — and writes
`out/maps/{surface,dungeon,extra}.png` + `layout.json`:

- `lib/maps/domShim.ts` fakes `window`/`document`/`canvas` + a 2D context so the
  real `GameShell` boots under Node (imported as a side-effect before `MapView`).
- `BakeMapView extends MapView` (`lib/maps/bakeSource.ts`):
  - `run()` waits on `initDone` (no input/event loop); `drawProgress()` is a no-op;
  - `loadWorldmap()` builds `JagFile` from `process.env.JAG` on disk;
  - `resize()` swaps the render target for a plain `PixMap`;
  - `padSpriteArrays()` fills undefined `mapscene`/`mapfunction` slots — this jag
    ships 56 scene / 57 function sprites, not the 100 the loader indexes, so an
    unpadded reference to a missing sprite id crashed with `Cannot read
    properties of undefined (reading 'scalePlotSprite')` (instance-only).
- Each bake pass sets `mapArea`/`mapOriginX`/`mapOriginZ`/`mapWidth`/`mapHeight`
  to one of the §3 areas, forces `zoom = targetZoom = 1` (so **1 tile = 1 px**),
  turns every `MapView.shouldDraw*` static flag off (labels, key icons, borders,
  npc/item dots, multi, free), then calls `maininit()` and
  `renderWorldMap(0, 0, w, h, 0, 0, w, h)` into a fresh `PixMap(w, h)`.
- The 0 pixel value doubles as void/sea: a bounding box over non-zero pixels is
  cropped, and the RGBA (`0x00RRGGBB`, filter-none) PNG is written with the
  small pure-Node encoder in `bakeSource.ts` (mirrors `rs2b0t/tools/map/
  encodePng.ts`). Pixel (0, 0) of the cropped image = world tile
  `(originX + cropLeft, originZ + height − cropTop)`.

`layout.json` records, per area: `ai`, `png`, cropped size `wPx`/`hPx`, and the
world-tile rectangle `tileX0`/`tileZTop`/`tileX1`/`tileZBot`, so the page maps
world `(x, z)` → **stack pixel** with just an offset+flip:

```
area band:   px = x − tileX0            py = tileZTop − z      (1 px = 1 tile)
stack pixel: sx = px                    sy = yOff + py         (yOff = Σ hPx above)
```

`map.ts` then:

- stacks the three bands top→bottom (**surface, dungeon, extra**) with **no
  ocean gaps**, drawn as three `drawImage` calls (`image-rendering: pixelated`);
- shows/hides each band via **area checkboxes**;
- drops any spawn outside every band's tile rect (`x ∈ [tileX0, tileX1)` and
  `z ∈ [tileZBot, tileZTop]`);
- plots each remaining spawn dot coloured by vislevel, with pan/zoom/hover/filters.

So nothing in `monstermap.html` runs `MapView` at load time — the jag is only
read once during `bake.ts`. Changing what's drawn is a matter of re-baking with
different `MapView.shouldDraw*` flags (e.g. `shouldDrawLabels = true` for named
map labels, `shouldDrawMapfunctions` for the key icons, `shouldDrawNpcs` /
`shouldDrawItems` for the dot layers).

`rs2b0t/tools/map/build-basemap.ts` does the same trick for the game client's
map picker: happy-dom canvas shim + a `MapView` subclass + `encodePng.ts`. Our
`bake.ts` differs by wiring `#/…` import aliases to rs2b0t's absolute source
paths and running the bundle under Node — otherwise it's the same
"subclass, `maininit()`, render, encode PNG" pattern.