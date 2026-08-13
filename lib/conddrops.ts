/**
 * Per-spawn conditional drop resolution for MonsterMap.
 *
 * The only location-dependent conditional in the shared drop tables is the
 * `randomjewel` proc, defined in:
 *
 *   Server/content/scripts/drop tables/scripts/shared_droptables.rs2
 *   ([proc,randomjewel], lines 37–77)
 *
 * When the roll lands in [61,65) (and the world is members), it returns:
 *
 *   if (coordz(coord) > 6400) return (chaos_talisman, 1);
 *   else                       return (nature_talisman, 1);
 *
 * `coordz(coord)` is the spawned NPC's Z. In the baked world grid the dungeon
 * band sits at Z ≥ 9216 (> 6400) while the surface / extra bands are below
 * 6400, so this resolves to chaos talisman in the dungeon and nature talisman
 * everywhere else.
 *
 * `lib/drops.ts` resolves drop tables per NPC id (DropResolver.dropsFor), so it
 * flattens every branch of the proc and lists BOTH talismans on every monster
 * that drops `~randomjewel` — it cannot see the spawn's coordinate. This module
 * re-applies the location rule **per plotted spawn** (whose area is known at
 * render time) so each dot carries the talisman it would actually drop.
 *
 * The `megararetable` branch (Legends' Quest complete + roll < 62) is a
 * per-player quest state we cannot resolve statically, so it is left untouched.
 *
 * Area indices match lib/maps/bake.ts / layout.json: 0 = surface, 1 = dungeon,
 * 2 = extra. A spawn's area is supplied by the caller (map.ts).
 */

// surface / extra → nature; dungeon (index 1) → chaos
const DUNGEON_AREA_INDEX = 1;

// Display names as they appear in drops.json (resolved from ObjType). Matched
// case/space-insensitively so the rule survives formatting changes.
const CHAOS_TALISMAN = 'Chaos talisman';
const NATURE_TALISMAN = 'Nature talisman';

const normalize = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]/g, '');
const findByName = (drops: string[], target: string): string | undefined =>
    drops.find(d => normalize(d) === normalize(target));

/**
 * Given a monster's resolved drop list (id-keyed, possibly containing both
 * talismans) and the area index of the specific spawn, return the drop list
 * with the location-wrong talisman removed. If the pair isn't present (not the
 * randomjewel table) or the area is unknown, the list is returned unchanged.
 */
export function resolveConditionalDrops(
    drops: string[] | undefined,
    areaIndex: number
): string[] | undefined {
    if (!drops) {
        return drops;
    }
    const chaos = findByName(drops, CHAOS_TALISMAN);
    const nature = findByName(drops, NATURE_TALISMAN);
    if (!chaos || !nature) {
        return drops; // not the randomjewel talisman pair
    }
    if (areaIndex < 0) {
        return drops; // spawn outside every baked area — leave as-is
    }
    // strip the talisman that this spawn's area would NOT drop (exact display string)
    const wrong = areaIndex === DUNGEON_AREA_INDEX ? nature : chaos;
    return drops.filter(d => d !== wrong);
}

export { DUNGEON_AREA_INDEX };
