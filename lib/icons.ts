/**
 * World-map minimap icon legend.
 *
 * `LocType.mapfunction` is a numeric id that indexes this list to the symbol
 * name drawn on the world map (e.g. 5 = "Bank", 26 = "Fishing Spot").
 *
 * Source: `rs2b0t/src/mapview/worldmapKeyNames.ts` (the 2004scape worldmap Key
 * legend). Copied here so MonsterMap has no runtime dependency on rs2b0t's
 * build. Index 0..48.
 */
export const WORLDMAP_KEY_NAMES: readonly string[] = [
    'General Store',
    'Sword Shop',
    'Magic Shop',
    'Axe Shop',
    'Helmet Shop',
    'Bank',
    'Quest Start',
    'Amulet Shop',
    'Mining Site',
    'Furnace',
    'Anvil',
    'Combat Training',
    'Dungeon',
    'Staff Shop',
    'Platebody Shop',
    'Platelegs Shop',
    'Scimitar Shop',
    'Archery Shop',
    'Shield Shop',
    'Altar',
    'Herbalist',
    'Jewelery',
    'Gem Shop',
    'Crafting Shop',
    'Candle Shop',
    'Fishing Shop',
    'Fishing Spot',
    'Clothes Shop',
    'Apothecary',
    'Silk Trader',
    'Kebab Seller',
    'Pub/Bar',
    'Mace Shop',
    'Tannery',
    'Rare Trees',
    'Spinning Wheel',
    'Food Shop',
    'Cookery Shop',
    '???',
    'Water Source',
    'Cooking Range',
    'Skirt Shop',
    'Potters Wheel',
    'Windmill',
    'Mining Shop',
    'Chainmail Shop',
    'Silver Shop',
    'Fur Trader',
    'Spice Shop'
];

/** mapfunction id -> symbol name (or '?' if out of range). */
export function iconName(mapfunction: number): string {
    if (mapfunction < 0 || mapfunction >= WORLDMAP_KEY_NAMES.length) {
        return '?';
    }
    return WORLDMAP_KEY_NAMES[mapfunction];
}

/** Case-insensitive lookup of an icon name by an npc/loc display name. */
export function iconNameForLabel(label: string | null | undefined): string | null {
    if (!label) {
        return null;
    }
    const lower = label.toLowerCase();
    for (const name of WORLDMAP_KEY_NAMES) {
        if (name.toLowerCase() === lower) {
            return name;
        }
    }
    return null;
}
