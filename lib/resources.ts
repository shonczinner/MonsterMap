/**
 * Resource classification for MonsterMap.
 *
 * Turns the skill content scripts into lookup tables that map a loc/npc
 * debugname to its gathering yield, so `gen.ts` can tag `l{}`/`n{}` spawns as
 * resources (and move fishing spots out of the monster table).
 *
 *   mining   skill_mining/configs/mine.dbrow    rock debugname -> ore/level
 *   woodcut  skill_woodcutting/configs/trees.dbrow  tree debugname -> product/level
 *   flax     loc debugname "flax"
 *   fishing  skill_fishing/configs/fishing.npc (category) +
 *            skill_fishing/scripts/fishing_spots/*.rs2 (fish per category)
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

type TokenResolver = (token: string) => string | null;

type DRowBlock = { name: string; fields: Map<string, string[]> };

function loadBlocks(path: string): DRowBlock[] {
    if (!existsSync(path)) {
        return [];
    }
    const blocks: DRowBlock[] = [];
    let cur: DRowBlock | null = null;
    for (const raw of readFileSync(path, 'utf8').split('\n')) {
        const head = /^\[([a-z0-9_]+)\]/.exec(raw.trim());
        if (head) {
            if (cur) {
                blocks.push(cur);
            }
            cur = { name: head[1]!, fields: new Map() };
            continue;
        }
        if (!cur) {
            continue;
        }
        const eq = raw.indexOf('=');
        if (eq <= 0) {
            continue;
        }
        const key = raw.slice(0, eq).trim();
        const value = raw.slice(eq + 1).trim();
        const list = cur.fields.get(key) ?? [];
        list.push(value);
        cur.fields.set(key, list);
    }
    if (cur) {
        blocks.push(cur);
    }
    return blocks;
}

function dataValues(block: DRowBlock, key: string): string[] {
    return block.fields.get(key) ?? [];
}

/** rock debugname -> { ore, output, level } (macro_ variants excluded). */
export function parseMiningRocks(contentDir: string): Map<string, { ore: string; output: string; level: number }> {
    const out = new Map<string, { ore: string; output: string; level: number }>();
    const blocks = loadBlocks(join(contentDir, 'scripts/skill_mining/configs/mine.dbrow'));
    for (const block of blocks) {
        const rocks: string[] = [];
        let ore = '';
        let output = '';
        let level = 0;
        for (const entry of dataValues(block, 'data')) {
            const comma = entry.indexOf(',');
            if (comma < 0) {
                continue;
            }
            const sub = entry.slice(0, comma).trim();
            const value = entry.slice(comma + 1).trim();
            if (sub === 'rock') {
                for (const r of value.split(',')) {
                    const t = r.trim();
                    if (t && !t.startsWith('macro_')) {
                        rocks.push(t);
                    }
                }
            } else if (sub === 'ore_name') {
                ore = value;
            } else if (sub === 'rock_output') {
                output = value;
            } else if (sub === 'rock_level') {
                level = Number(value);
            }
        }
        for (const rock of rocks) {
            out.set(rock, { ore, output, level });
        }
    }
    return out;
}

/** tree debugname -> { product, level } (macro_ variants excluded). */
export function parseWoodcutTrees(contentDir: string): Map<string, { product: string; level: number }> {
    const out = new Map<string, { product: string; level: number }>();
    const blocks = loadBlocks(join(contentDir, 'scripts/skill_woodcutting/configs/trees.dbrow'));
    for (const block of blocks) {
        const trees: string[] = [];
        let product = '';
        let level = 0;
        for (const entry of dataValues(block, 'data')) {
            const comma = entry.indexOf(',');
            if (comma < 0) {
                continue;
            }
            const sub = entry.slice(0, comma).trim();
            const value = entry.slice(comma + 1).trim();
            if (sub === 'tree') {
                for (const t of value.split(',')) {
                    const v = t.trim();
                    if (v && !v.startsWith('macro_')) {
                        trees.push(v);
                    }
                }
            } else if (sub === 'product') {
                product = value;
            } else if (sub === 'levelrequired') {
                level = Number(value);
            }
        }
        for (const tree of trees) {
            out.set(tree, { product, level });
        }
    }
    return out;
}

/** fishing npc debugname -> raw category string (e.g. "freshfish", "category_632"). */
export function parseFishingNpcCategories(contentDir: string): Map<string, string> {
    const out = new Map<string, string>();
    const blocks = loadBlocks(join(contentDir, 'scripts/skill_fishing/configs/fishing.npc'));
    for (const block of blocks) {
        const category = dataValues(block, 'category')[0];
        if (category) {
            out.set(block.name, category);
        }
    }
    return out;
}

/**
 * key (last segment of an npc debugname, e.g. "freshfish", "karambwan")
 * -> catchable fish display names. Resolves tokens through ObjType.
 */
export function parseFishingFish(contentDir: string, resolve: TokenResolver): Map<string, string[]> {
    const dir = join(contentDir, 'scripts/skill_fishing/scripts/fishing_spots');
    const out = new Map<string, Set<string>>();
    if (!existsSync(dir)) {
        return new Map();
    }

    const addFish = (key: string, token: string): void => {
        const name = resolve(token);
        if (!name) {
            return;
        }
        if (!out.has(key)) {
            out.set(key, new Set());
        }
        out.get(key)!.add(name);
    };

    // filenames whose catch category differs from the npc debugname suffix
    const fileKeyOverride: Record<string, string> = { tbwt: 'karambwanji', waterfall: 'karambwan' };
    for (const file of readdirSync(dir)) {
        if (!file.endsWith('.rs2')) {
            continue;
        }
        const base = file.replace(/\.rs2$/, '').replace(/_loc$/, '');
        const key = fileKeyOverride[base] ?? base;
        const body = readFileSync(join(dir, file), 'utf8');
        for (const m of body.matchAll(/~fish_roll(?:_loc)?\s*\(\s*([a-z0-9_]+)\s*(?:,\s*([a-z0-9_]+)\s*)?/g)) {
            addFish(key, m[1]!);
            if (m[2] && m[2] !== 'null') {
                addFish(key, m[2]!);
            }
        }
        for (const m of body.matchAll(/inv_add\s*\(\s*inv\s*,\s*([a-z0-9_]+)\s*,/g)) {
            addFish(key, m[1]!);
        }
    }

    const resolved = new Map<string, string[]>();
    for (const [k, set] of out) {
        resolved.set(k, [...set].sort((a, b) => a.localeCompare(b)));
    }
    return resolved;
}
