# MonsterMap — plan

Tooling (own local git repo — `Server/` and `rs2b0t/` stay untouched) that
builds a **monster table** (spawns, stats, drops) and an **interactive map**
for the rs2b2t / Lost City engine in this workspace.

## Directives

- **rs2b0t and Server are untouched.** `git status` there stays clean.
  MonsterMap only imports code from other folders as static references (paths,
  source `import`, or a bundler input).
- **All MonsterMap code lives in `MonsterMap/`.**
- **Committed locally.** `out/`, `node_modules/`, `.env` are gitignored.
- The client (MapView renderer) is `rs2b0t` — imported read-only via `bun build`.

## Goal

1. **`lib/maps/bake.ts`** — bake all three worldmap areas to PNGs via the real
   MapView headless → `out/maps/{surface,dungeon,extra}.png` + `layout.json`.
 2. **`gen.ts`** — decode static NPC spawns (`n{}`) + ground-item spawns (`o{}`) +
    loc spawns (`l{}`) from `maps-server.zip`, plus NPC/Loc/Obj configs (binary)
    and content scripts (drop tables, skill resource tables) →
    `out/data/monsters.tsv` + `monsters.json` (NPCs; fishing spots excluded),
    `out/data/itemspawns.tsv` + `itemspawns.json` (ground items), and
    `out/data/resources.tsv` + `resources.json` (mining rocks, woodcut trees,
    flax, fishing spots). Spawns: 7,181 NPC / 1,151 item / 15,985 resource records.
3. **`map.ts`** — stack the three PNGs vertically (no ocean gaps) and plot
   every spawn → `out/monstermap.html`.

## Architecture — baked PNGs (current)

The classic worldmap asset contains *everything*, not just the surface:

- `$ENGINE_DIR/data/pack/mapview/worldmap.jag` (~425 KB, BZip2-per-file) holds
  floor/underlay/overlay/loc/labels/sprites/fonts for **three map areas**:
  - **surface** (`ai 0`): origin `(32<<6, 44<<6)`, 25×19 regions (1600×1216 tiles)
  - **dungeon** (`ai 1`): origin `(32<<6, 144<<6)`, 25×19 regions (1600×1216 tiles)
    — holds the `maps-server.zip` spawns at Z 9216–10432
  - **extra** (`ai 2`): origin `(28<<6, 65<<6)`, 21×15 regions (1344×960 tiles)

Terrain is **baked once** (not rendered live in the browser):

- `lib/maps/bakeSource.ts` subclasses the unmodified rs2b0t `MapView`
  (`BakeMapView`), feeds `worldmap.jag` from disk, renders each area at
  **1 px per world tile** (north-up) into a `PixMap`, trims the
  transparent/void border, and encodes RGBA PNGs (pure Node zlib).
  Labels/mapfunctions/borders/etc. are disabled via the static
  `MapView.shouldDraw*` flags.
- `lib/maps/bake.ts` rewrites `bakeSource.ts`'s `#/…` imports to rs2b0t's
  absolute source paths, `bun build --target=node`, then runs the bundle with
  `JAG`/`OUT` env. **Nothing in rs2b0t is modified.**
- `lib/maps/domShim.ts` fakes the DOM/canvas so the real `GameShell` boots
  under Node.
- `layout.json` gives, per area: `png`, cropped size `wPx`/`hPx`, and the world
  tile rect `tileX0/tileZTop/tileX1/tileZBot` — so the page maps
  world `(x, z)` → stack pixel `(x - tileX0, tileZTop - z)`.

Since recording render coordinates originally worked in screen space
(`>>> 0` packed pixels with `(px >> 16)` etc.), future coordinate/encoding
utility code should be cleaned up (see Roadmap).

MapView resource note: `worldmap.jag` carries fewer `mapscene`/`mapfunction`
sprites than MapView indexes (56/57 here); `padSpriteArrays()` pads gaps with
the last good sprite (instance-only, no source change).

## Config / env

Bun auto-loads `.env` from the working folder at run time; CLI flags win. All
paths are **fully expanded in `.env`, built from the base dirs**.

```env
ENGINE_DIR=/home/shonc/rs2bot/Server/engine
CONTENT_DIR=/home/shonc/rs2bot/Server/content
CLIENT_DIR=/home/shonc/rs2bot/rs2b0t        # client — MapView renderer (read-only)
```

Derived paths in `.env`:

| Var | Path |
|---|---|
| `MAPS_SERVER_ZIP` | `$ENGINE_DIR/data/pack/.cache/maps-server.zip` (spawns + land) |
| `WORLDMAP_JAG` | `$ENGINE_DIR/data/pack/mapview/worldmap.jag` (all three areas) |
| `DROP_SCRIPTS_DIR` | `$CONTENT_DIR/scripts` |
| `OUT_DIR` | `./out` |

Optional: `MAPS_DIR`, `DATA_DIR`, `BUILD_DIR` default under `OUT_DIR`.
`lib/config.ts` expands `${BASE}` refs flat against the map (base dirs first)
and validates that required paths exist. Defaults mirror the above so flags
alone work. **Stale keys from the old live-render config were removed.**
`.env` is gitignored.

## Files

| File | Purpose |
|---|---|
| `PLAN.md` | This document. |
| `.env` | Fully-expanded path pointers from the base dirs (gitignored). |
| `package.json` | `fflate` runtime dep; `playwright-core` (smoke). |
| `lib/config.ts` | Typed loader for env vars + optional flags; expands `${VAR}` refs; required-path validation. |
| `lib/tiles.ts` | Unzip `maps-server.zip`, parse `n{mapX}_{mapZ}` spawn blocks. |
| `lib/drops.ts` | Drop-block parser + joiner to npc + display names. |
| `lib/maps/bake.ts` | Bundles + runs `bakeSource.ts` (`#/` alias rewrite to `$CLIENT_DIR/src`), `JAG`/`OUT` env. |
| `lib/maps/bakeSource.ts` | Headless bake: real `MapView` subclass renders + crops each area → PNGs + `layout.json`. |
| `lib/maps/domShim.ts` | Fake DOM/canvas to boot the real game `MapView` under Node. |
| `gen.ts` | Pipeline → out/data artifacts. |
| `map.ts` | Builds `out/monstermap.html`: stacks the three baked PNGs, plots every spawn, pan/zoom/hover/area+name+level filters. |
| `tools/smoke.ts` | Headless Playwright smoke: boots page, exercises filters/area toggles/zoom, screenshots, asserts **no page errors**. |

## Data flows

### 1. Spawn locations — binary
`maps-server.zip` is a **Server run-time artifact**: `engine/tools/pack/map/Pack.js`
builds it via `openArtifactStore('maps-server')` into
`$ENGINE_DIR/data/pack/.cache/maps-server.zip` (~15 MB), where it's gitignored
(never committed). MonsterMap reads it read-only from that path. It has one
entry per mapsquare `n{mapX}_{mapZ}` (483 files).
Format (mirror of `GameMap.loadNpc/unpack`):

```
repeat until file end:
  coord : u16 big-endian
  count : u8
  ids   : count * u16 big-endian

coord bits: level=(c>>12)&3, x=(c>>6)&0x3f, z=c&0x3f
absoluteX = (mapX<<6) + x      absoluteZ = (mapZ<<6) + z
```

Validated: `n48_54` → id 1 `Man` (3093,3512); 7,322 spawn records / 1,114
distinct ids / 1,359 configs; X 1884–3646, Z 2887–10362 (surface + dungeon +
extra). Only spawns inside a baked area's tile rect are plotted on the map.

### 2. Names + stats — binary config cache
`NpcType.load(data/pack)` reads `server/npc.dat` (stats, vislevel, debugname)
and the `client/config` Jagfile `npc.dat` (display `name`). Monster `level` =
**`vislevel`**. `ObjType.get` resolves drop item names.

### 3. Drops — rs2 scripts + `.npc` params
- `[ai_queue3,<debugname>]` blocks in `…/scripts/**/*.rs2` → `obj_add(...)` tokens
  and recursive `return` sub-tables;
- `npc_param(death_drop)` → `.npc` `param=death_drop,<obj>`;
- tokens → display names via `ObjType.getId(token).name` (fallback: token).

### 4. Terrain — baked from the real MapView (read-only import, `$CLIENT_DIR`)
`bun lib/maps/bake.ts` bundles `bakeSource.ts`, which **imports the unmodified
`rs2b0t/src/mapview/MapView.js`** headlessly. The `#/…` aliases are rewritten
to rs2b0t's absolute source paths by `bake.ts` (nothing in rs2b0t changes).
Each area renders for real — surface, dungeon and extra all come from the map
renderer's own blend logic.

## Outputs

### `out/data/monsters.tsv`
```
absX absZ level npcId name debugname vislevel att def str hp rng mage members size attackrange drops
```

### `out/data/monsters.json`
```jsonc
{
  "generation": { "revisionTime", "bounds", "land", "spawnRecords", "distinctIds", "configs", ... },
  "spawns": [ { "x": 3073, "z": 3498, "level": 0, "id": 708 }, ... ],
  "monsters": {
    "1": { "id": 1, "name": "Man", "debug": "man", "level": 2,
           "stats": [1,1,1,7,1,1], "members": false, "size": 1, "attackrange": 0,
           "drops": [], "spawns": [ ... ] }, ...
  }
}
```

### `out/maps/{surface,dungeon,extra}.png` + `layout.json`
Baked terrain (1 px/tile, trimmed to land) + per-area world-tile→pixel mapping.

### `out/monstermap.html`
- Self-contained interactive page; ground layer = the **stacked baked area
  PNGs** (surface → dungeon → extra, no ocean gaps).
- **Area checkboxes** show/hide each stack band.
- **Name filter**: text narrows; a unique exact match pulses golden halos over
  every spawn (others dim).
- **Min level** slider; **show drop-table monsters** toggle.
- **Hover tooltip**: name, id, combat level, stats (HP/ATK/DEF/STR), area, tile,
  floor, drops.
- Pan (drag) / zoom (wheel, pivots in stack-pixel space). `image-rendering:
  pixelated`.

## Usage

```bash
cd /home/shonc/rs2bot/MonsterMap
bun install
bun lib/maps/bake.ts   # → out/maps/{surface,dungeon,extra}.png + layout.json
bun gen.ts             # → out/data/monsters.{tsv,json}
bun map.ts             # → out/monstermap.html
open out/monstermap.html
bun tools/smoke.ts     # headless check + screenshots in out/
```

## Validation
- gen.ts 7,322 spawn records / 1,114 ids / 1,359 configs.
- Baked PNGs: surface / dungeon / extra each render real terrain (void trimmed).
- Headless smoke: page boots, ~7.3k spawns drawn, filters + area toggle + zoom
  work, **no page errors**, **rs2b0t and Server `git status` stay clean**.
- Spot checks: `Man` (3093,3512), `Knight of Ardougne` (26) vis 46.

## Roadmap

### Done
1. Surface/dungeon/extra → three PNGs, displayed vertically in one stacked map.
2. Baked-PNG map replaces the old live-MapView/region-dropdown path; dropped
   `lib/mapview/`, `lib/worldmap.ts`, `--region`/`--basemap`, and the stale
   config keys (`MAPS_CLIENT_ZIP`, `MAPS_MANIFEST`, `MAPVIEW_SRC`, `NPC_DAT`,
   `OBJ_DAT`, `CLIENT_CONFIG`, `NPC_SCRIPTS_DIR`, `BUILD_BASEMAP_SCRIPT`,
   `MEDIA_CACHE`).
3. Local git repo initialized; README/plan describe the bake architecture.

### Next — tables (out/data + page sections)
4. **Place names** table + locations (and a toggle to show all place names on
   the map, default **off**).
5. **Icons** table + locations (toggleable, each icon individually, default
   **all off**).
6. **NPCs** table + locations (id/name; combat level for monsters, not drops).
7. **NPC stores** table + location + **default stocks**.
8. **Monsters** table + locations + stats + **drops**.
9. **Drops wrangling** — recursive table probabilities. e.g. "monster drops
   jewel table with chance 1/128; jewel table drops diamond with chance 1/64"
   → diamond overall chance = `1/(128*64)`.
 10. **Gathering locations** + what/location (DONE — emitted as
     `out/data/resources.{tsv,json}`; fishing spots moved out of monsters):
     - Mining rocks (by ore — copper, iron, …)
     - Woodcut trees (by tree — willow, …)
     - Fishing spots (by fish — tuna, …)
     - Flax locations
 11. **Item spawn locations** table (DONE — emitted as `out/data/itemspawns.{tsv,json}`).

### Next — map features
12. **Category picker**: choose a category → search-filtered dropdown → select a
    single thing → it **flashes** on the map; nothing selected ⇒ show all.
13. **Item search across map**: shows all item spawns, the monsters that drop
    it, and the NPCs that sell it (default stock > 0) — all flash.
14. **Click a monster** → detail view with stats + drops.
15. **Click an NPC with a store** → detail view with default stocks.

### Next — code quality
16. **mapCoordUtils.ts** — extract a named imported helper for the bitwise-shift
    packing/unpacking (`(c>>12)&3`, `(x>>6)&0x3f`, `>>> 0`, channel shifts) with
    the multiplier/shift constants defined in `.env`/config, replacing inline
    shifts across `lib/tiles.ts`, `lib/maps/bakeSource.ts`, `map.ts` for clarity.