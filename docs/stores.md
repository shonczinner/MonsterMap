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

**From the content source (recommended for NPC + pricing info)** — there is
already a parser in `rs2b0t/tools/shops/`:

- `rs2b0t/tools/shops/parse.ts`
  - `parseInvShops(text)` → `{ inv, scope, allstock, stock:[{obj,baseline,restockTicks}] }`
  - `parseNpcKeepers(text)` → `{ npc, name, ownedShops[], sell, buy, delta, title }`
  - `parseObjDefs(text)` → item name / cost / stackable / members
  - `joinShopDb(...)` merges them into a per-shop record keyed by inv name.
- `rs2b0t/tools/shops/gen-shopdb.ts` walks `Server/content/scripts/**` (override
  with `CONTENT_DIR=...`), runs the parsers, and writes
  `rs2b0t/src/bot/shops/data/shopdb.ts` (`SHOP_DB`). Run it with
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
| Generated combined DB | — | `rs2b0t/src/bot/shops/data/shopdb.ts` |
