# Multi-combat overlay

The map's **Overlays → Multi-combat zones** checkbox paints the server's
multiway areas as translucent red rectangles under the dots.

## Source

`Server/content/maps/multiway.csv` — the same file the engine loads in
`GameMap.init()` (`loadCsvMap` → `multimap`). Each non-comment line is one
8×8-tile zone:

```
level_mapX_mapZ_localX_localZ
0_50_61_0_0
```

`// ...` lines name the region that follows (e.g. `// scorpion valley`), and the
capital coordinates are the north-west corner of the zone.

This is the map-wide multi-combat flag. Individual NPCs can also force
multi-combat via `param=npc_forcemulti,^true` (see
`skill_combat/configs/combat.param`); those are not part of this overlay.

## Pipeline

`map.ts` reads the CSV, expands each line to `(x, z)`, keeps zones that fall
inside a baked area, and merges adjacent zones into rectangles per
region/area. The merged list is embedded in `out/monstermap.html` as
`data.multi`:

```json
{ "x0": 3200, "z0": 3904, "x1": 3264, "z1": 3968, "region": "scorpion valley" }
```

`template.html` draws the rectangles between the terrain PNGs and the dots, so
dots stay on top. Hovering a zone (with the overlay on) shows the region name.

The merge keeps the payload to a few hundred rectangles instead of ~4.7k
individual zones; no runtime parse of the CSV is needed.
