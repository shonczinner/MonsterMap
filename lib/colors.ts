/**
 * Single source of truth for category colours + labels in MonsterMap.
 *
 * Used by the sidebar layer toggles, the plotted dots, and the search flash,
 * so all three always agree. Keep `CATEGORY_ORDER` in the display order you
 * want in the sidebar.
 */
export const CATEGORY_ORDER = [
    'monster',
    'shop',
    'item',
    'mining',
    'woodcut',
    'fish',
    'flax',
    'poi',
    'place'
];

export const CATEGORY_LABELS: Record<string, string> = {
    monster: 'Monsters / drops',
    shop: 'NPCs / stores',
    item: 'Item spawns',
    mining: 'Mining rocks',
    woodcut: 'Woodcut trees',
    fish: 'Fishing spots',
    flax: 'Flax',
    poi: 'Map icons',
    place: 'Place names'
};

// hues spread around the wheel so neighbouring layers stay distinguishable
export const CATEGORY_COLORS: Record<string, string> = {
    monster: '#ffe14d', // yellow
    shop: '#ff9f43',    // orange
    item: '#ff5b5b',    // red (item spawns / drops)
    mining: '#9aa0a6',  // grey
    woodcut: '#4caf50', // green
    fish: '#2f7bff',    // blue
    flax: '#b388ff',    // light purple
    poi: '#18c2c2',     // cyan/teal
    place: '#e7e7e7'    // white
};
