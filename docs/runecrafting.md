# Runecrafting data for the map

This records where runecrafting definitions, packed engine data, and world coordinates live, plus how MonsterMap should derive a dedicated runecrafting layer. Paths are relative to the `MonsterMap` repository; `../Server` is the read-only server checkout.

## Authoritative runecrafting content

The main implementation is under:

- `../Server/content/scripts/skill_runecraft/configs/runecraft.loc`
  - Defines the ruined temple entrance locs and rune altars.
  - Ruins use `category=rc_ruins`; crafting altars use `category=rc_altar`.
  - Each supported loc also has `param=rune_type,<type>`.
  - These categories, rather than the generic display names `Mysterious ruins` and `Altar`, are the safe classification keys. Many unrelated objects share those display names.
- `../Server/content/scripts/skill_runecraft/configs/runecraft.dbrow`
  - Contains one row per supported rune type.
  - Supplies the rune name, Runecrafting level, talisman, altar coordinate, temple entrance coordinates, and exit coordinates.
  - Use this file for descriptive data such as required level, but use actual loc spawns for plotted coordinates.
- `../Server/content/scripts/skill_runecraft/configs/runecraft.dbtable`
  - Defines the columns used by the rows above, including `rune_type`, `level`, `talisman`, `altar_coord`, `enter_coord`, and `exit_coord`.
- `../Server/content/scripts/skill_runecraft/configs/runecraft.param`
  - Declares the integer `rune_type` parameter used by locs and talismans.
- `../Server/content/scripts/skill_runecraft/configs/runecraft.constant`
  - Declares the numeric rune types and the essence-mine return zones.
- `../Server/content/scripts/skill_runecraft/scripts/runecraft.rs2`
  - Confirms the gameplay chain: a talisman operates the matching `rc_ruins` loc, the player enters a temple, and blank runes are crafted at an `rc_altar` loc.
  - `loc_param(rune_type)` is the join used by the server to select the matching runecrafting row.
- `../Server/content/scripts/skill_runecraft/scripts/essence_mine.rs2`
  - Implements the essence-mine entrance and exit behavior.
- `../Server/content/scripts/skill_runecraft/configs/essence_mine_teleports.enum`
  - Lists the coordinates inside the random essence-mine destination.
- `../Server/content/scripts/skill_runecraft/configs/runecraft.obj`
  - Defines talismans and blank runes. It is packed/binary in this checkout, so readable behavior and relationships are better inspected through the dbrow and scripts.
- `../Server/content/scripts/skill_mining/configs/mine.dbrow`
  - Defines `blankrunestone` as the level-1 source of blank runes. MonsterMap's mining parser already knows how to classify this loc if it is present in `maps-server.zip`.

The file `../Server/content/pack/category.pack` confirms the packed names `rc_ruins`, `rc_altar`, and `rc_exit_portal`. It is generated registry data and should not be edited as the source.

## Engine packing and caches

MonsterMap reads the same packed engine caches used by the server:

- `../Server/engine/src/cache/config/LocType.ts`
  - `LocType.load()` reads `../Server/engine/data/pack/server/loc.dat` and the matching client loc config.
  - The packed loc type exposes `debugname`, numeric `category`, and decoded `params`.
- `../Server/engine/src/cache/config/ParamType.ts`
  - Resolves the packed name `rune_type` to its numeric parameter id.
- `../Server/engine/src/cache/config/CategoryType.ts`
  - Resolves the numeric `LocType.category` to a category debugname.
- `../Server/engine/tools/pack/config/LocConfig.ts`
  - Shows how source fields become packed loc data: `category`, `param`, display fields, and `mapfunction` are decoded here.
- `../Server/engine/data/pack/server/loc.dat`, `param.dat`, and `category.dat`
  - Generated engine cache files. They are useful for inspection but are not source files to modify.

The runecrafting loc definitions do not set `mapfunction`. Consequently, they do not become generic world-map altar icons in `out/data/minimapicons.json`; they need a dedicated classification.

## World-coordinate source chain

Runecrafting markers are static loc spawns, not coordinates hardcoded into the map UI:

1. `../Server/content/maps/m<mapX>_<mapZ>.jm2`
   - Plain-text map source. Its `LOC` section contains lines in the form `level localX localZ: locId shape angle`.
2. `../Server/engine/tools/pack/map/Pack.js`
   - Reads the `LOC` entries and delta-encodes each mapsquare into an `l<mapX>_<mapZ>` archive entry.
3. `../Server/engine/tools/pack/ArtifactCache.ts`
   - Stores all generated entries in `../Server/engine/data/pack/.cache/maps-server.zip`.
4. `../Server/engine/src/engine/GameMap.ts`
   - Demonstrates the server's decode logic for `l{}` entries in `loadLocations()`.
5. `MonsterMap/lib/tiles.ts`
   - Already implements the same `gsmarts` loc decode in `loadMaps()` and returns `locSpawns` with absolute `x`, `z`, `level`, `id`, `shape`, and `angle`.
6. `MonsterMap/gen.ts`
   - Already loads `LocType` and iterates `maps.locSpawns` for resources and minimap icons.

The source maps and `maps-server.zip` are separate stages. Rebuild the server pack after changing a `.jm2`; editing only the zip would be lost on the next server build.

## Current MonsterMap integration points

- `gen.ts` already has the required `maps.locSpawns` and `LocType` inputs.
- `lib/colors.ts` is the single source of truth for map layer order, labels, and colors.
- `map.ts` converts generated resource/POI records into plotted points and searchable names.
- `tools/smoke.ts` can validate the generated layer, category toggle, and search behavior in the rendered page.
- `out/data/minimapicons.json` is not the right export for this feature because it only includes locs with a non-negative `LocType.mapfunction`.

## Implementation plan

1. Parse `runecraft.loc` and `runecraft.dbrow` from `config.contentDir`.
2. Build exact loc-debugname sets for the `rc_ruins` and `rc_altar` categories, keyed by `rune_type`.
3. Join those debugnames to `maps.locSpawns` through `LocType.get(id).debugname`.
4. Emit `out/data/runecrafting.tsv` and `out/data/runecrafting.json` with the rune name/type, required level, marker kind, loc id/debugname, and actual spawn coordinates.
5. Add a `Runecrafting` category to `lib/colors.ts` and a dedicated load/render loop in `map.ts`.
6. Search names should identify both the rune and marker kind, for example `Air temple ruins` and `Air rune altar`.
7. Verify generated counts against actual `l{}` spawns, then run the headless smoke test, TypeScript typecheck, and full build.

Do not hardcode current loc ids or coordinates: both are revision-dependent. Unspawned definitions such as unfinished Soul/Blood content naturally produce no points because the final export is driven by actual loc spawns.

## Validation queries

Useful read-only checks are:

- Search `../Server/content/maps/*.jm2` for the current numeric ids returned by `LocType.getId(<runecraft debugname>)`; this finds the source `LOC` lines.
- Load `maps-server.zip` through `lib/tiles.ts` and join `locSpawns` to `LocType` to inspect the actual exported locations.
- Compare those loc spawns with `runecraft.dbrow` altar coordinates. Small offsets are expected because gameplay sometimes uses a nearby navigable tile while the map plots the object tile.
- Confirm rune essence separately through `mine.dbrow` and `resources.json`; it is a mining resource rather than a temple ruin or altar.
