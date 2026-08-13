# Minimap icons & location names

Where the world-map **minimap icons** (bank/shop/fishing-spot symbols) and
**location names** (cities / areas / points of interest like "Lumbridge",
"Boneyard") come from, and how to turn them into `minimapicons.json` /
`locationnames.json` for MonsterMap.

## Location names (cities, areas, POIs)

These live in a plain text file, **not** a binary cache:

- Path: `Server/content/maps/labels.txt` (136 lines).
- Format: one label per line, `=Name,x,z,type`
  - `Name` — the label text. A `/` splits it into a **two-line** label
    (e.g. `Kingdom Of/Misthalin`, `Shantay/Pass`).
  - `x`, `z` — **world tile coordinates** (absolute `absX`, `absZ`), same space
    as the spawn coords in `maps-server.zip`. (Stored as `p2` u16 in
    `worldmap.jag → labels.dat`, so 0..65535 tile range.)
  - `type` — label style / importance:
    - `1` — town / city (Lumbridge, Varrock, Al Kharid, Falador, Edgeville, …)
    - `2` — region / island / kingdom (Karamja, Crandor, Entrana, Misthalin, …)
    - `0` — minor landmark / POI (Shantay Pass, Toll Gate, Jail, Market, …)
- `Worldmap.ts` packs this file into `worldmap.jag` as `labels.dat`:
  `count u16`, then per label `text gjstr`, `x u16`, `z u16`, `type u8`.
  `Server/webclient/src/mapview/MapView.ts` reads `labels.dat` (`mapLabelX/Y` = those
  world-tile coords) and draws the text on the world map.

### `locationnames.json` (+ `.tsv`)

```jsonc
"places": [
  { "name": "Lumbridge", "x": 3239, "z": 3233, "type": 1, "lines": ["Lumbridge"] },
  { "name": "Kingdom Of/Misthalin", "x": 3217, "z": 3321, "type": 2,
    "lines": ["Kingdom Of", "Misthalin"] }
]
```
- `.tsv` columns: `name, type, absX, absZ` (or split `name` on `/`).
- Generation: read `Server/content/maps/labels.txt`, keep lines starting with
  `=`, split on `,`, parse `x`/`z` as numbers, split `name` on `/` into `lines`.
  No engine config load needed.

## Minimap icons (bank / shop / fishing-spot symbols)

Each world-map marker **symbol** is identified by a numeric **`mapfunction`** id
on a loc config.

- Source: `LocType.mapfunction` (`engine/src/cache/config/LocType.ts`, decode code
  `60` → `this.mapfunction = dat.g2()`, default `-1`).
- The id indexes a 0-based legend of symbol names: the client's
  `mapview/worldmapKeyNames.ts` (`WORLDMAP_KEY_NAMES`, 49 entries, `0..48`).
  Examples: `5 → "Bank"`, `8 → "Mining Site"`, `26 → "Fishing Spot"`,
  `34 → "Rare Trees"`, `35 → "Spinning Wheel"`.
- `Worldmap.ts` bakes `160 + mapfunction` into the worldmap `loc` layer, so
  `mapfunction` is the canonical "which symbol" field. The actual pixel art for
  each symbol lives in the **client** sprite archive (`mapfunction` sprite) — for
  a data table we only need the *name* from `WORLDMAP_KEY_NAMES`.

### NPCs

NPCs have **no** numeric `mapfunction`. Their world-map marker is the boolean
`NpcType.minimap` flag (`engine/src/cache/config/NpcType.ts`, decode code `93`
sets `this.minimap = false`; default `true`). `Worldmap.ts` writes an `npc`
marker when `type.minimap` is true. Resolve the symbol for a POI npc by matching
`NpcType.name` to the key legend (e.g. `"Fishing spot"` → `26 "Fishing Spot"`);
if no key matches, label by the npc name.

### `minimapicons.json` (+ `.tsv`)

Two parts:

1. `icons` — the static legend (from `WORLDMAP_KEY_NAMES`):
   ```jsonc
   "icons": [ { "mapfunction": 0, "name": "General Store" }, ... { "mapfunction": 48, "name": "Spice Shop" } ]
   ```
2. `locations` — every POI spawn in the world, resolved to its symbol:
   ```jsonc
   "locations": [
     { "kind": "loc", "mapfunction": 5, "icon": "Bank",
       "name": "Bank", "id": 1234, "x": 2442, "z": 3089, "level": 0 },
     { "kind": "npc", "icon": "Fishing Spot", "name": "Fishing spot",
       "id": 321, "x": 2208, "z": 3140, "level": 0 }
   ]
   ```
   - `.tsv` columns: `kind, mapfunction, icon, name, id, absX, absZ, level`.
   - Generation: iterate `maps.locSpawns`; `LocType.get(id).mapfunction`, if
     `>= 0` push a loc POI (`icon = WORLDMAP_KEY_NAMES[mapfunction]`). Iterate
     `maps.spawns`; `NpcType.get(id).minimap`, if true push an npc POI (`icon` =
     key-name match on `name`, else `name`).

## Summary of sources

| Output            | Source                                                          |
|-------------------|----------------------------------------------------------------|
| `locationnames`   | `Server/content/maps/labels.txt` (`=Name,x,z,type`)            |
| `minimapicons`    | `LocType.mapfunction` + `WORLDMAP_KEY_NAMES` (legend); POIs from `l{}`/`n{}` spawns |

## How gen.ts would produce them

`gen.ts` already loads `LocType`/`NpcType` and decodes `l{}`/`n{}` via
`loadMaps(config.mapsServerZip)`. Add:

- `lib/icons.ts` — export `WORLDMAP_KEY_NAMES` (copied from the client's
  `mapview/worldmapKeyNames.ts`) so the legend + `mapfunction → name`
  lookup live in one place. (That legend lives in the **client**, not `Server` —
  `Server/webclient` no longer ships `worldmapKeyNames.ts` — so MonsterMap
  keeps its own copy to avoid a dependency on the client build.)
- `lib/labels.ts` — parse `Server/content/maps/labels.txt`.
- In `gen.ts`: emit `locationnames.json`/`.tsv` from the labels file, and
  `minimapicons.json`/`.tsv` (legend + POI spawns) using `lib/icons.ts`.
