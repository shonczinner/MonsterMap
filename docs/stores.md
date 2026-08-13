# Game Stores (Shops)

Where shop / store data lives in the codebase and how to get at it. This is a
reference for *locating and parsing* the data — not a dump of every shop's stock
(that lives in the content/source files and the generated `SHOP_DB`, see below).

## Two layers of truth

1. **Compiled/packed (what the server actually loads)**
   - `Server/engine/data/pack/server/inv.dat` → parsed by
     `Server/engine/src/cache/config/InvType.ts`.
   - A shop is any `InvType` whose `scope === InvType.SCOPE_SHARED` (the engine
     comments these as "shared inventories (shops)"). Banks/quest inventories are
     *not* shared, so they are excluded.
   - Default stock lives on the `InvType`: `stockobj[]` (item ids),
     `stockcount[]` (how many at restock baseline), `stockrate[]` (restock speed,
     ticks per 1 unit; engine constant `INV_STOCKRATE = 100`).
   - Item **display names** come from `ObjType` (`server/obj.dat`,
     `Server/engine/src/cache/config/ObjType.ts`).

2. **Human-editable source (content scripts)** under `Server/content/scripts/`
   - `.inv` files — the shop's stock. Lines look like
     `stockN=<obj>,<baseline>,<restockTicks>` plus `size=`, `allstock=`, etc.
     The `[block id]` matches the inv name used by the keeper.
   - `.npc` files — the shopkeeper NPCs (see "Tied to NPCs" below).
   - `.obj` files — item name / `cost` / `stackable` / `members`.
   - These get compiled/packed into the `.dat` files above.

## How to access it

**From the engine (compiled data)** — load and filter:

```ts
InvType.load('data/pack');
ObjType.load('data/pack');
for (let id = 0; id < InvType.count; id++) {
  const inv = InvType.get(id);
  if (!inv || inv.scope !== InvType.SCOPE_SHARED) continue;
  // inv.debugname, inv.size, inv.stockobj / inv.stockcount / inv.stockrate
}
```

A quick dump of the packed data yields **119 shared inventories** (shops) with
**1037 stock lines** total. Two shared invs (`gemshop3`, `partyroom_dropinv`)
have no default stock configured — they are filled dynamically by scripts.

**From the content source (recommended for NPC + pricing info)** — the client
ships equivalent parsers in `tools/shops/` (the upstream origin of MonsterMap's
port):

- `tools/shops/parse.ts`
  - `parseInvShops(text)` → `{ inv, scope, allstock, stock:[{obj,baseline,restockTicks}] }`
  - `parseNpcKeepers(text)` → `{ npc, name, ownedShops[], sell, buy, delta, title }`
  - `parseObjDefs(text)` → item name / cost / stackable / members
  - `joinShopDb(...)` merges them into a per-shop record keyed by inv name.
- `tools/shops/gen-shopdb.ts` walks `Server/content/scripts/**` (override
  with `CONTENT_DIR=...`), runs the parsers, and writes the client's
  `SHOP_DB` (`src/bot/shops/data/shopdb.ts`). Run it with
  `bun tools/shops/gen-shopdb.ts` (add `--check` to flag drift vs the content pack).

`SHOP_DB` is the richest view: it joins the keeper NPC names, the shop title, the
buy/sell/delta multipliers, and each item's name + cost.

## How shops are tied to NPCs

There is **no NPC→shop field in the engine config** (`InvType` / `NpcType` have no
such link). The binding lives entirely in the **content scripts**:

A shopkeeper is an NPC block in a `.npc` file that declares the shop it owns:

```rs2
[tbwt_tiadeche_final]
name=Tiadeche
param=owned_shop,tbwt_tiadeche_final_inventory
param=shop_sell_multiplier,550
param=shop_buy_multiplier,60
param=shop_delta,10
param=shop_title,Tiadeche's Karambwan Stall
```

- `param=owned_shop,<inv>` points at the `[<inv>]` block id in a `.inv` file
  (which holds the stock). `owned_shop` (and the other `shop_*` params) are
  defined in `Server/content/scripts/shop/configs/shopkeeper.param`.
- `shop_sell_multiplier` / `shop_buy_multiplier` / `shop_delta` tune pricing;
  `shop_title` is the shop's display name.
- An NPC may own more than one shop (`ownedShops[]` can list several invs).

At runtime the keeper's dialogue script opens that shared inventory as the shop
interface (`InvType.scope === SCOPE_SHARED` → `World.getInventory(inv)`), and the
player trades against its `stockobj`/`stockcount` baseline.

### Quick map of the files

| What | Packed (engine) | Source (content) |
|------|-----------------|------------------|
| Shop inventory + stock | `data/pack/server/inv.dat` (`InvType`) | `**/*.inv` (`stockN=...`) |
| Item names / cost | `data/pack/server/obj.dat` (`ObjType`) | `**/*.obj` (`name=`,`cost=`) |
| Shop ↔ NPC link | *(none)* | `**/*.npc` (`param=owned_shop,...`) |
| Generated combined DB | — | the client's `src/bot/shops/data/shopdb.ts` (`SHOP_DB`) |

## Mapping NPCs to their stores (implemented)

Goal: a single lookup of **which NPC(s) run which store, and where they stand**,
so the map can mark shopkeepers and show the store's stock on hover.

### Why it works the way it does
The NPC→shop edge is not in any engine config — it only exists as
`param=owned_shop,<inv>` inside content `.npc` files. So the mapping is derived
from the content source, then joined to (a) the shop stock and (b) the in-world
NPC spawn positions (already plotted as the `monster` category).

### Implementation (MonsterMap)
- `lib/shops.ts` is a **standalone port** of the client's shop-join logic
  (originally `tools/shops/parse.ts`): `parseNpcKeepers` / `parseInvShops` /
  `parseObjDefs` walk `config.dropScriptsDir` (`Server/content/scripts`), then
  `buildStores` resolves each keeper's `[block]` id (the NPC `debugname`) to its
  id via `NpcType.getId`, and emits a map **keyed by NPC id**. It has no
  build-time dependency on the client.
- `gen.ts` writes `out/data/stores.json`:
  ```jsonc
  { "generation": { ... }, "note": "...", "stores": { "<npcId>": { "name": "Tiadeche", "shops": [ { "inv": "...", "title": "...", "sell": 550, "buy": 60, "delta": 10, "items": [ { "obj": "raw_karambwan", "name": "Raw karambwan", "baseline": 5, "restockTicks": 100, "cost": 1 } ] } ] } } }
  ```
- **Stock gating:** only shops (and NPCs) with at least one item whose default
  stock `baseline > 0` are included — empty-stock shops are not shown on the map.
- `map.ts` merges `stores.json` into each shopkeeper NPC point by id
  (`point.shop`, `point.hasShop`). Shopkeepers get a gold ring marker, the hover
  tooltip shows the store `title` + `name x baseline` stock, and shop titles are
  added to the search dropdown (typing a shop name flashes its keeper(s)).

### Notes / edge cases
- One NPC can own several invs (`ownedShops[]`); one inv can have several keepers
  (e.g. a stall with multiple NPCs) — the join dedupes per inv per NPC.
- Some shared invs have no keeper (`gemshop3`, `partyroom_dropinv`) and are
  filled by scripts, not an NPC — they won't appear in the NPC→store map.
- NPC `debugname` is the stable key; display `name` may repeat across NPCs, so
  the join uses `debugname`/id, not the human name.
- The client's `tools/shops/` provides an equivalent, inv-keyed `SHOP_DB`
  (`gen-shopdb.ts`) if you need the shop-centric (rather than NPC-centric) view.


