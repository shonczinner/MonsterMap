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
Because the dat loaders key off the absolute mapsquare grid, "surface" is just
the z-slice `44..63`, "dungeon" is `144..163`, "extra" is `28..48 × 65..80`.
Conceptually they are the same object set placed at different world-bands (the
game model: overlays up, dungeons way up), all inside one coordinated grid.

### Applying this to a bigger bake

Wanting all three areas in **one render pass** is valid precisely because the jag
is a single grid. Instead of reloading per area you can:

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
3. `MonsterMap`'s harness (`lib/mapview/harness.ts`) is a `MapView` subclass that:

   - overrides `run()`/`drawProgress()` to a no-op (no input/DOM loop),
   - overrides `loadWorldmap()` to build `JagFile` straight from the embedded
     base64 bytes we ship in `monstermap.html`,
   - exposes `start()`, `switchArea(i)` (0 surface / 1 dungeon / 2 extra), and
     `renderArea(x0, zTop, x1, zBot, outW, outH) -> Int32Array` which points
     `Pix2D` at a fresh `PixMap` and calls `renderWorldMap`, returning raw
     `0x00RRGGBB` pixels (0 = transparent).
   - `padSpriteArrays()` fills undefined `mapscene`/`mapfunction` slots: the jag
     here contains 56 scene sprites (not the 100 the loader indexes), so without
     padding a region that references a missing sprite id crashed with
     `Cannot read properties of undefined (reading 'scalePlotSprite')`.

The page (`map.ts`) converts that pixel buffer to an `ImageData`, blits it to an
offscreen canvas and draws it scaled onto the screen canvas — the terrain you see
in MonsterMap is generated live on every area/region switch, nothing is stored.

---

## 5. Why `build-basemap.ts` (rs2b0t) renders the same jag to PNG

`rs2b0t/tools/map/build-basemap.ts` is the sibling of our harness: it installs a
fake canvas via `@happy-dom/global-registrator`, subclasses `MapView` the same
way, runs `maininit()` headless, then encodes `pix2dToRgba` output to PNG with
`encodePng.ts` (pure Node zlib). It bakes a full-world **terrain-only** basemap
plus pre-baked transparent overlays (label/multi/free/key) for the game-client map
picker. Our `bundle.ts` instead keeps the harness in the page and renders on the
fly.