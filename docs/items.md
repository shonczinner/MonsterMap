# Items Tab

Where the item data comes from, how it's generated, and how it feeds the
filterable `out/items.html` table.

## Output files

| File | Contents |
|------|----------|
| `out/data/items.tsv` | One row per item (all properties + combat bonuses) |
| `out/items.html` | Filterable/sortable table built from `items.tsv` |

## Source data

### Item config — `ObjType` (engine binary cache)

Loaded in `items.ts` from the engine's binary item config:

```ts
const { default: ObjType } = await import(...'ObjType.ts'...);
ObjType.load(join(config.engineDir, 'data/pack'));
```

`ObjType.get(id)` returns the item's properties:

| Field | Description |
|-------|-------------|
| `name` | Display name |
| `debugname` | Internal name (e.g. `dragon_scimitar`) |
| `stackable` | Stackable flag |
| `members` | Members-only flag |
| `certtemplate` | Certificate template id (-1 if not noted) |
| `dummyitem` | Dummy item type (0 = normal) |
| `weight` | Weight in grams |
| `value` | High alchemy value |
| `tradeable` | Tradeable flag |
| `examine` | Examine text |
| `wearpos` | Primary equipment slot as a packed int (see below) |
| `wearpos2`, `wearpos3` | Extra slots the item also occupies (-1 = none) |
| `params` | Key-value param map (combat bonuses, etc.) |

Only items with a `debugname` are included — unnamed items (id-only) are
excluded.

### Wear-slot names — `equip.constant` (content source)

`obj.dat` packs the wear slot as an integer (`ObjType.decode` codes 13/14/27).
The int → name mapping comes from the Server content source:

`Server/content/scripts/player/configs/equip.constant`

```
^wearpos_hat = 0      ^wearpos_torso = 4     ^wearpos_hands = 9
^wearpos_back = 1     ^wearpos_lhand = 5     ^wearpos_feet = 10
^wearpos_front = 2    ^wearpos_arms = 6      ^wearpos_jaw = 11
^wearpos_rhand = 3    ^wearpos_legs = 7      ^wearpos_ring = 12
                      ^wearpos_head = 8      ^wearpos_quiver = 13
```

`lib/wearpos.ts` parses that file programmatically (no hardcoded slot table, no
rs2b0t dependency) and `items.ts` joins it to `ObjType.wearpos`. The `slot`
column therefore uses the content's own names (`hat`, `torso`, `hands`, `feet`,
`front`, `quiver`, …) and is `null` when `wearpos === -1`.

### Combat bonus params — `ObjType.params`

Items carry combat bonuses as **params**, defined in the content source at
`Server/content/scripts/skill_combat/configs/combat.param` and packed into
`obj.dat`. These are the same param IDs used by NPCs:

| Param ID | Name | Default | Notes |
|----------|------|---------|-------|
| 101 | `stabattack` | 0 | Attack bonuses |
| 102 | `slashattack` | 0 | |
| 103 | `crushattack` | 0 | |
| 104 | `magicattack` | 0 | |
| 105 | `rangeattack` | 0 | |
| 106 | `stabdefence` | 0 | Defence bonuses |
| 107 | `slashdefence` | 0 | |
| 108 | `crushdefence` | 0 | |
| 109 | `magicdefence` | 0 | |
| 110 | `rangedefence` | 0 | |
| 111 | `strengthbonus` | 0 | Max hit modifier |
| 112 | `attackbonus` | 0 | General attack bonus |
| 114 | `rangebonus` | 0 | Ranged strength (arrows, bolts) |
| 116 | `attackrate` | 4 | Ticks between attacks |

Not all items have all params. Weapons typically have attack bonuses;
armour has defence bonuses; arrows have `rangebonus`; most non-combat items
have none.

### `attackrate` default handling

The param-type default for `attackrate` is 4 (from `combat.param`). However,
`items.ts` only applies this default to **wieldable weapons** — items with
`wearpos === 3` (the weapon equipment slot). This prevents non-weapon items
(food, armour, arrows, quest items) from incorrectly showing an attack rate.

The check:

```ts
if (rec.attackrate === '' && obj.wearpos === 3) {
    rec.attackrate = 4;
}
```

So scimitars show `attackrate: 4` (default), staves with explicit
`attackrate: 5` show that, and shrimps show nothing.

## Generation pipeline (`items.ts`)

```
ObjType (obj.dat) ──→  for each item with a debugname:
                          read base properties (name, slot, stackable, weight, etc.)
                          decode wearpos via content equip.constant
                          extract combat params from ObjType.params
                          apply attackrate default for weapons (wearpos 3)
                              │
                              ▼
                         items.tsv  ──→  lib/listpage.ts  ──→  items.html
```

### TSV columns (`items.tsv`)

| Column | Source | Description |
|--------|--------|-------------|
| `id` | ObjType id | Item config id |
| `debug` | `ObjType.debugname` | Internal name |
| `name` | `ObjType.name` | Display name |
| `slot` | `ObjType.wearpos` + `equip.constant` | Primary worn slot name (`hat`, `torso`, …), or `null` if not equippable |
| `stackable` | `ObjType.stackable` | `yes`/`no` |
| `members` | `ObjType.members` | `yes`/`no` |
| `noted` | `ObjType.certtemplate` | Certificate template id (-1 = not noted) |
| `dummy` | `ObjType.dummyitem` | Dummy item type (0 = normal) |
| `weight` | `ObjType.weight` | Grams |
| `value` | `ObjType.value` | High alchemy value |
| `lendable` | `ObjType.lendable` | `yes`/`no` |
| `tradeable` | `ObjType.tradeable` | `yes`/`no` |
| `examine` | `ObjType.examine` | Examine text |
| `stabatt` … `rngatt` | `ObjType.params` (101–105) | Attack bonuses |
| `stabdef` … `rngdef` | `ObjType.params` (106–110) | Defence bonuses |
| `strbonus`, `attbonus` | `ObjType.params` (111–112) | Strength/attack bonus |
| `rangebonus` | `ObjType.params` (114) | Ranged strength (arrows) |
| `attackrate` | `ObjType.params` (116) | Ticks between attacks (weapons only) |

## How `listpage.ts` renders it

`lib/listpage.ts` is the shared filterable-table builder used by both the
monsters and items pages:

1. Reads the TSV, classifies each column as **text** or **numeric** (a column
   is numeric only if every non-empty value parses as a number).
2. Per-column filter controls: text columns get substring match; numeric columns
   get optional `min`/`max` range inputs.
3. Filters combine with AND — all active filters must pass for a row to show.
4. Sortable column headers (click to toggle asc/desc).
5. Empty values in numeric columns are excluded when any min/max filter is active
   (prevents `NaN` comparisons from letting unvalued rows through).
6. Live result count: `N / total`.

### Example items with combat bonuses

| Item | Attack bonuses | Defence bonuses | Notes |
|------|---------------|-----------------|-------|
| `dragon_dagger` | stab +40, slash +25, crush -4, magic +1, str +40 | — | Weapon (wearpos 3) |
| `dragon_chainbody` | magic -15 | stab 81, slash 93, crush 98, magic -3, range 82 | Armour (wearpos 4) |
| `rune_arrow` | — | — | Ammo (wearpos 13), rangebonus +49 |
| `staff_of_fire` | stab +3, slash -1, crush +9, magic +10, str +6 | stab 2, slash 3, crush 1, magic 10 | Weapon (wearpos 3), attackrate 5 |
| `shrimps` | — | — | Food (no wearpos), no combat params |
