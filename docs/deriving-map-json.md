# Deriving `monsters.json`, `itemspawns.json`, and `resources.json` from game files

This document records how the MonsterMap data exports are identified and produced
from the rs2b2t / "Lost City" engine game files. It complements
[`maps-server-zip.md`](./maps-server-zip.md), which describes the binary
container format in detail. Here we focus on the *what* and *how*: which game
files each JSON is built from, how a record is recognized as a "monster", an
"item spawn", or a "resource", and how the pipeline turns that into the final
file.

## Shared pipeline

All three exports follow the same shape and source from the same place:

- **Map data**: `maps-server.zip` at
  `$ENGINE_DIR/data/pack/.cache/maps-server.zip`
  (in this repo the path is resolved by `loadConfig()` → `config.mapsServerZip`).
  That archive is a Server run-time artifact built by
  `Server/engine/tools/pack/map/Pack.js`; it is not committed to the Server repo.
  It contains four entry families × 483 mapsquares:
  - `m<mx>_<mz>` — land/collision tiles (not used for these exports)
  - `n<mx>_<mz>` — NPC spawns
  - `o<mx>_<mz>` — ground-item spawns
  - `l<mx>_<mz>` — loc (game-object) spawns

- **Config data**: the engine `NpcType`, `ObjType`, and `LocType` cache configs
  (`NpcType.load(dataPack)`, `ObjType.load(dataPack)`, `LocType.load(dataPack)`)
  resolve raw ids into names/debugnames and stats.

- **Content data**: skill scripts under the Server `content/scripts` tree
  (drop tables live in `config.dropScriptsDir`; resource tables are read directly
  from `skill_*/configs/*.dbrow` and `fishing_spots/*.rs2`).

- **Generator**: `gen.ts` opens the zip, decodes each mapsquare, joins with the
  configs, and writes the exports under `out/data/`.

### Shared coordinate decode

Every `n{}` / `o{}` / `l{}` record carries a packed `coord` u16:

```
level = (coord >> 12) & 3
x     = (coord >> 6)  & 0x3f   // 0..63 within the mapsquare
z     =  coord         & 0x3f
absX  = (mapX << 6) + x
absZ  = (mapZ << 6) + z
```

`mapX`/`mapZ` are the mapsquare indices from the entry name. This same formula
is used by `GameMap.loadNpcs` / `loadObjs` / `loadLocations` in the engine.

### Shared output shape

Each JSON mirrors `monsters.json`:

```jsonc
{
  "generation": { "source": "...", "generatedAt": "...", "mapsquares": 483 },
  "spawns": [ /* one entry per spawn */ ],
  "byX": { "<absX>": { "<absZ>": [ ...spawns at that tile... ] } }
}
```

## `monsters.json` (done)

**Source**: `n<mx>_<mz>` spawns + `NpcType` cache + drop tables.

**Identification**: every record in an `n{}` entry is an NPC. We keep all of
them, then enrich:
- `NpcType` supplies the display `name`, `combatLevel`, and stat block
  (attack/defence/strength/hitpoints/ranged/magic/prayer).
- Drops come from the NPC's drop table. `lib/drops.ts` (`DropResolver`)
  follows the engine's drop-table format in `config.dropScriptsDir` to turn a
  drop table into a flat list of `{ objId, objName, min, max, rarity }`.

**Output columns** (also emitted to `monsters.tsv`):
`npcId, name, level, absX, absZ, mapsquare, count, drops`.

Note: "Fishing spot" NPCs appear here too — they are simply NPCs whose
`NpcType.name == "Fishing spot"`. They are the basis for the fishing portion of
`resources.json` (see below).

## `itemspawns.json` (designed — not yet implemented)

**Source**: `o<mx>_<mz>` ground-item spawns + `ObjType` cache.

**Binary format** (`o{}`): `coord` u16, then `count` u8 (# of distinct item
stacks at that tile), then `count` × (`objId` u16, `stackCnt` u8). Consumed by
the engine's `GameMap.loadObjs`.

**Identification**: trivial — every `o{}` record is a ground item. `ObjType`
resolves `objId` → `name`. "Ground item" vs "inventory item" is not distinguished
in the data; all are surface world spawns here.

**Enrichment**: group by `objId`/`name` and by mapsquare so the UI can filter
(e.g. "where does raw shark drop?"). Expected volume: ~1,151 item records /
~1,609 total obj stacks across the world.

**Planned output**: `spawns[]` of `{ objId, name, absX, absZ, mapsquare, count }`
plus `byX` grouping, mirroring `monsters.json`.

## `resources.json` (designed — not yet implemented)

**Source**: `l<mx>_<mz>` loc spawns + `LocType` cache + skill content configs,
plus fishing spots lifted from `n{}` NPC spawns.

**Binary format** (`l{}`): gsmarts delta-encoded. Start `locId = -1`; read
`locIdOffset = gsmarts()` (0 ends the mapsquare); `locId += offset`; then
`coord = 0`; read `coordOffset = gsmarts()` (0 ends the loc); `coord += coordOffset - 1`;
unpack to x/z/level; read `info` byte = `(shape << 2) | angle`.
`gsmarts`: if next byte < 0x80 → `g1()` else `g2() - 0x8000`. The encoder side is
`psmart` in `Pack.js` (`< 128 → p1(v)`, else `p2(v + 0x8000)`). Consumed by
`GameMap.loadLocations`.

**Identification / classification**: a loc is a resource when its
`LocType.debugname` matches a known skill config. Four categories:

1. **Mining rocks** — `skill_mining/configs/mine.dbrow`. Each `rock,<locdebugname>`
   row maps to `ore_name`, `rock_level`, `rock_output`. Validated loc ids:
   `copperrock1`=2090, `copperrock2`=2091, `ironrock1/2`, `tinrock1/2`,
   `coalrock1/2`, `goldrock1/2`, `silverrock1/2`, `mithrilrock1/2`,
   `adamantiterock1/2`, `runiterock1/2`, `clayrock1/2`, `bluriterock`, `gemrock`,
   `blankrunestone` (rune essence), `limestone` (loc ids 4027–4030).
2. **Woodcut trees** — `skill_woodcutting/configs/trees.dbrow`. Each `tree,<locdebugname>`
   row maps to `product` and `levelrequired`. **Include all trees** (per user
   decision, including normal/jungle/burnt/achey as well as oak+). Validated ids:
   `oaktree`=1281 (1068 instances), `willowtree`=1308 (285),
   `mapletree`=1307 (89), `yewtree`=1309 (56), `magictree`=1306 (13),
   `achey_tree`=2023 (24), `hollow_tree`=2289 (55), `deadtree_burnt`=1384 (420),
   plus `normal_tree_table` (logs, level 0).
3. **Flax** — loc debugname `"flax"` (`skill_crafting/configs/spinning/spinning_wheels.loc`),
   `LocType` id 2646, 133 instances.
4. **Fishing spots** — not locs but NPCs: `n{}` records whose `NpcType.name ==
   "Fishing spot"`. The spot's category is encoded in its `debugname`
   (`freshfish`, `saltfish`, `rarefish`, `memberfish`, `slimeyfish`, `lavafish`,
   `karambwan`). The fish yielded per category are read from
   `skill_fishing/scripts/fishing_spots/<category>.rs2` via the `fish_roll`
   token: freshfish→raw_trout/raw_salmon/raw_pike; saltfish→raw_shrimp/
   raw_anchovies/raw_sardine/raw_herring; rarefish→raw_lobster/raw_tuna/
   raw_swordfish; memberfish→raw_shark; slimeyfish→mort_slimey_eel;
   lavafish→raw_lava_eel.

**Planned output**: a `resources` object grouped by category (mining / woodcut /
flax / fishing), each entry `{ id, name, level, product, absX, absZ, mapsquare }`
so the map UI can toggle "show all trees", "show only yews", etc. Total loc
instances ≈ 818,801 across 3,861 distinct loc ids (maxLocId 4670); only the
resource-matching subset is exported.

## Status

| Export           | Status      | Notes                                          |
|------------------|-------------|------------------------------------------------|
| `monsters.json`  | done        | generated; `monsters.tsv` too                  |
| `itemspawns.json`| designed    | decoder prototyped; not yet committed          |
| `resources.json` | designed    | classification spec above; not yet implemented |

## Where the code lives

- `lib/tiles.ts` — map/zip decoding (`loadSpawns`, `boundsOf`); will gain
  `loadItemSpawns` / `loadLocSpawns`.
- `lib/drops.ts` — `DropResolver`, the model for parsing content configs.
- `lib/config.ts` — `loadConfig()` (engine/content/zip/drop dirs).
- `gen.ts` — orchestrates load → enrich → write of `out/data/*`.
- `docs/maps-server-zip.md` — container + binary format reference.
