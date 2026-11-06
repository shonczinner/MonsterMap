/**
 * Wear-slot names from the Server content source.
 *
 * `ObjType.wearpos` / `wearpos2` / `wearpos3` are packed ints in `obj.dat`.
 * The canonical int -> name mapping lives in content:
 *
 *   Server/content/scripts/player/configs/equip.constant
 *     ^wearpos_hat = 0
 *     ...
 *     ^wearpos_quiver = 13
 *
 * Parsing that file keeps the item list's slot column in sync with the content
 * instead of duplicating a hardcoded table (same idea as the `*_DIR` content
 * readers in `lib/drops.ts` / `lib/shops.ts`).
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const EQUIP_CONSTANT = join('scripts', 'player', 'configs', 'equip.constant');

/** `^wearpos_hat = 0` lines -> `{ 0: 'hat', ... }`. */
export function parseWearSlots(text: string): Record<number, string> {
    const out: Record<number, string> = {};
    for (const raw of text.split('\n')) {
        const line = raw.trim();
        if (!line || line.startsWith('//')) continue;
        const m = /^\^wearpos_([a-z0-9_]+)\s*=\s*(\d+)$/i.exec(line);
        if (m) out[Number(m[2])] = m[1]!;
    }
    return out;
}

/** Read the content's wear-slot constants, keyed by the packed `wearpos` int. */
export function loadWearSlots(contentDir: string): Record<number, string> {
    const path = join(contentDir, EQUIP_CONSTANT);
    if (!existsSync(path)) {
        throw new Error(`${path} missing — cannot resolve equipment slot names`);
    }
    const slots = parseWearSlots(readFileSync(path, 'utf8'));
    if (Object.keys(slots).length === 0) {
        throw new Error(`${path} defines no ^wearpos_* constants`);
    }
    return slots;
}
