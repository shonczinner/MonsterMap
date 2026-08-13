# Monster Drops

Where the "what does this NPC drop when killed" data lives, and how it relates
to the other per-NPC files. This is the **kill loot** table — distinct from
`stores.md` (what an NPC *sells*).

## File

- `out/data/drops.json` — keyed by **NPC id**, value is a `string[]` of item
  display names (already resolved via `ObjType`, so no id→name lookup needed):

  ```jsonc
  {
    "generation": { "revisionTime": "...", "engine": "...", "content": "..." },
    "drops": {
      "7": ["Bronze arrow", "Bronze med helm", "Cabbage", "Chaos rune", "Coins"],
      "...": ["..."]
    }
  }
  ```

Only NPCs that actually have a drop table are present (no entry = no drops).

## Source & generation

- Drops are resolved by `MonsterMap/lib/drops.ts` (`DropResolver`), built as
  `new DropResolver(config.dropScriptsDir, resolveObjDisplay)` in `gen.ts`.
- `DropResolver.dropsFor(npcDebugname)` returns the drop list for an NPC, read
  from the content drop scripts (`config.dropScriptsDir`, i.e. the engine's
  `Server/content/scripts/**` drop tables). The second arg (`resolveObjDisplay`)
  turns item ids into display names so `drops.json` stores names directly.
- `gen.ts` writes `drops.json` in the same pass that writes `monsters.json`,
  reusing the same `monstersMeta`. Run `bun gen.ts` to (re)generate.

## Relationship to the other per-NPC files

All three are keyed by the same **NPC id** and merged in `map.ts` by id:

| File | Contents | Source |
|------|----------|--------|
| `monsters.json` | combat stats + spawns (`name`, `level`, `att/def/...`, `members`, `size`, `attackrange`) — **no drops** | `NpcType` + spawn scan (`gen.ts`) |
| `drops.json` | kill loot (item names) | `DropResolver` over content drop scripts |
| `stores.json` *(planned)* | shop stock the NPC sells | `SHOP_DB` (content `.npc` `owned_shop`) |

In `map.ts` the monster point is built from `monsters.json`, then
`dropsData.drops[id]` is attached as `point.drops`; the hover tooltip renders it
as a `Drops:` line. The planned `stores.json` would merge the same way (a
`shop` field), so a single id-keyed merge covers stats + drops + stores.

## Conditional shared drop table: `randomjewel` → chaos / nature talisman

The only **location-dependent** conditional in the shared drop tables is the
`randomjewel` proc, defined in
`Server/content/scripts/drop tables/scripts/shared_droptables.rs2`
(`[proc,randomjewel]`, lines 37–77). It is invoked from ~80
`obj_add(npc_coord, ~randomjewel, ...)` call sites across the monster drop
tables (e.g. `hobgoblin.rs2`, `tribesman.rs2`, `skeleton.rs2`,
`green_dragon.rs2`, `lesser_demon.rs2`, `fire_giant.rs2`, …).

The tail of the proc — only reached when `map_members` is true and the roll
lands in `[61,65)` — is:

```rs2
} else if ($random < 65) {
    if (map_members = ^true) {
        if ($random < 62 & %legendsquest = ^legends_complete) {
            return (~megararetable);
        }
        if (coordz(coord) > 6400) {
            return (chaos_talisman, 1);
        } else {
            return (nature_talisman, 1);
        }
    }
}
```

`coordz(coord)` is the **Z of the NPC's spawn/death coordinate**. In the baked
world grid the dungeon band sits at Z ≥ 9216, while the surface and extra bands
are below Z 6400, so this resolves to:

| Spawn area (by Z) | Result |
|-------------------|--------|
| surface / extra (coordz ≤ 6400) | `nature_talisman` |
| dungeon (coordz > 6400) | `chaos_talisman` |
| (any, with Legends' Quest complete and roll < 62) | `megararetable` instead |

This matches the observed behavior: on the surface the jewel table yields a
nature talisman; in the dungeon it yields a chaos talisman.

### Current handling (`lib/drops.ts`) — GitHub issue #2

`DropResolver.itemsIn` extracts every `return (<tok>)` / `obj_add(..., <tok>)`
token from the **entire** proc body, including all `if/else` branches, and never
evaluates `coordz(coord)`. So the current `drops.json` for every NPC that drops
`~randomjewel` lists **both** `chaos_talisman` **and** `nature_talisman` (plus
`megararetable`), flattened — the conditional is ignored.

### Why fixing it needs per-spawn resolution

`coordz(coord)` is a property of the individual **spawn**, not the NPC type.
Today `DropResolver.dropsFor(npcDebugName)` resolves drops once per NPC and
`gen.ts` attaches `dropsData.drops[id]` to every spawn of that id. To resolve
the talisman correctly you must evaluate the branch **per plotted dot**, where
the spawn's `(x, z, level)` is known (see `lib/tiles.ts` spawns and the
`spawnAreaIndex` / area `tileZTop` mapping in `map.ts`). The
surface/dungeon/extra split is already encoded in `layout.json`
(`tileZTop` / `tileZBot` per area), so a per-spawn lookup can pick `chaos` vs
`nature` directly from the spawn's area.

### Implemented — `lib/conddrops.ts`

The conditional is now re-applied **per spawn at build time** in `map.ts`:

- `lib/conddrops.ts` holds the transparent rule: when a spawn's drop list
  contains both `Chaos talisman` and `Nature talisman` (the `randomjewel`
  signature), the one its area would *not* drop is stripped — `chaos` in the
  dungeon (area index 1), `nature` everywhere else. The `megararetable` branch
  is left untouched (per-player quest state, not statically resolvable).
- `map.ts` computes each spawn's area via `areaIndexOf(x, z)` (a coordinate
  range lookup against `layout.json`) and calls `resolveConditionalDrops(...)`
  before attaching `drops` to the dot. So `point.drops`, the hover tooltip, and
  the drop flash-search are all correct per spawn.
- `drops.json` remains id-keyed and flattened (both talismans); the split is
  applied in `map.ts` only. Verified after a regen: chaos talisman appears on
  dungeon spawns exclusively, nature talisman on surface spawns exclusively, and
  no dot shows both.

## Why it was split out

Drops were originally embedded in `monsters.json`. They were separated because:
- drop tables are generated by a different concern (loot tables) than combat
  stats, and can be large;
- keeping `monsters.json` as pure stat+spawn data matches the planned
  `stores.json` split, giving one uniform id-keyed merge path in `map.ts`
  instead of one inline field and one external file.
