# maps-server.zip — static map content for the server

`maps-server.zip` is the **server-side** half of the packed map data: it holds
the static NPC spawns, ground/collision, object and location data for every
mapsquare in the world. It is a **run-time artifact of the Server** — it does
not live in `MonsterMap/` and is never committed anywhere.

- On disk: `Server/engine/data/pack/.cache/maps-server.zip` (`$ENGINE_DIR/data/pack/.cache`, ~15 MB)
- Built by: `engine/tools/pack/map/Pack.js` → `openArtifactStore('maps-server', rebuildMapArchive)`
- Git status: gitignored in `Server/` (`.cache/`); MonsterMap only reads it from
  that path (see `.env` → `MAPS_SERVER_ZIP`).
- Consumed by: the engine at boot (`GameMap.load` in `engine/src/engine/GameMap.ts`,
  which also keeps a fallback directory form at `data/pack/server/maps/`), and by
  MonsterMap's `lib/tiles.ts`.

---

## 1. Container format

A vanilla `zip` archive (inflated by `fflate.unzipSync`). One entry per
mapsquare per family, keyed as `<family><mapX>_<mapZ>` where `mapX`/`mapZ` are
the **mapsquare indices** (the 64-tile block position on the absolute world grid).

Four entry families × 483 mapsquares:

| family | name pattern | payload |
|--------|--------------|---------|
| `m` | `m{mapX}_{mapZ}` | ground/collision land flags (4 × 64 × 64 bytes = 16384) |
| `n` | `n{mapX}_{mapZ}` | static NPC spawns (see §2) |
| `o` | `o{mapX}_{mapZ}` | object spawns (items on the ground) |
| `l` | `l{mapX}_{mapZ}` | location / loc spawns |

MonsterMap uses only two of them: the `m` names as the **land** set (which
mapsquares are land, used to drop ocean/void spawn dots) and the `n` spawn
blocks. It ignores `o`/`l`.

---

## 2. Spawn format (`n{mapX}_{mapZ}`)

Mirror of `GameMap.loadNpcs` / `CoordGrid.unpackCoord`:

```
repeat until file end:
  coord : u16 big-endian
  count : u8
  ids   : count × u16 big-endian

coord bits:
  level = (coord >> 12) & 0x3
  x     = (coord >>  6) & 0x3f
  z     = coord        & 0x3f

absolute (world tile) coords:
  absoluteX = (mapX << 6) + x
  absoluteZ = (mapZ << 6) + z
```

`level` is the map-floor ('plane') on the local map-file convention (0–3); the
`x`/`z` are 6-bit offsets *within* the mapsquare. Note this is **not** the same
packed format as `CoordGrid`'s world-level `packCoord` (that one uses 14-bit
`x`/`z` and `level` at bit 28) — the file format is the mapsquare-local variant
above.

The server consumes each `id` with `NpcType.get(id)` and instantiates a
respawnable `Npc`, skipping ids that are members-only on a free world or outside
the free-to-play area (`GameMap.loadNpcs`).

---

## 3. Bounds / coverage

The zip covers the whole world grid the server boots with, spanning every zone
the client can reach (surface, dungeon and extra all live in the same
mapsquare grid, exactly as in `worldmap.jag`). For MonsterMap's bake:

- spawn records: 7,322 · distinct spawn ids: 1,114 · npc configs: 1,359
- world-tile bounds: X 1884–3646, Z 2887–10362
- only spawns that fall inside a baked area's trimmed tile rect are plotted.

The dungeon band holds spawns at Z 9216–10432 (the `ai 1` area of
`worldmap.jag`), which is why the stacked map includes the dungeon blob.

---

## 4. How MonsterMap reads it

`lib/tiles.ts`:

```ts
const entries = unzipSync(readFileSync(zipPath));
// m{mapX}_{mapZ}  -> land.set(`${mapX}_${mapZ}`)         // land flags
// n{mapX}_{mapZ}  -> decode u16/u8 loop per block        // spawn records
```

`lib/config.ts` resolves the path via `MAPS_SERVER_ZIP` (default
`$ENGINE_DIR/data/pack/.cache/maps-server.zip`), and `gen.ts` joins the decoded
spawns with NPC configs and drop tables to produce `out/data/monsters.{tsv,json}`.