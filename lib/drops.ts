/**
 * Drop-table resolution for MonsterMap.
 *
 * Port of the proven gen-dropdb.ts approach, extended to scan ALL content
 * scripts (so `~proc` sub-tables defined outside the drop-table folder still
 * resolve):
 *
 *   - parse `[type,name]` blocks from every *.rs2 under content/scripts
 *   - for each NPC's `[ai_queue3,<debugname>]` block (and any referenced
 *     `[proc,<x>]` blocks) collect obj tokens. A leading-underscore block name
 *     is a CATEGORY script (`[ai_queue3,_unicorn]` applies to every NPC with
 *     `category=unicorn`, e.g. black_unicorn): dropsFor tries the id-named
 *     block, then the category-named `_<category>` block (read from each
 *     NPC's `.npc` `category=`), then a legacy `_<debugname>` fallback:
 *        obj_add(npc_coord, <tok>, ...)
 *        return ( <tok> )     (~foo = recursive proc, npc_param = death_drop)
 *        <var> = <tok>;        (staged drops like megararetable)
 *   - `npc_param(death_drop)` resolves via the `.npc` `param=death_drop,<x>`
 *   - cert_<x> strips the noted-form prefix
 *   - tokens → display names through the caller-supplied resolver (ObjType)
 *     falling back to the raw token.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

type Block = { type: string; name: string; body: string };

type TokenResolver = (token: string) => string | null;

function filesUnder(root: string, ext: string): string[] {
    if (!existsSync(root)) {
        return [];
    }
    const out: string[] = [];
    const walk = (dir: string): void => {
        for (const entry of readdirSync(dir, { withFileTypes: true })) {
            const full = join(dir, entry.name);
            if (entry.isDirectory()) {
                walk(full);
            } else if (entry.name.endsWith(ext)) {
                out.push(full);
            }
        }
    };
    walk(root);
    return out;
}

function loadBlocks(scriptsDir: string): Map<string, Block> {
    const blocks = new Map<string, Block>();
    for (const file of filesUnder(scriptsDir, '.rs2')) {
        let cur: Block | null = null;
        const lines: string[] = [];
        const flush = (): void => {
            if (cur) {
                cur.body = lines.join('\n');
                blocks.set(`${cur.type}:${cur.name}`, cur);
                lines.length = 0;
            }
        };
        for (const raw of readFileSync(file, 'utf8').split('\n')) {
            const head = /^\[([a-z0-9_]+)\s*,\s*([a-z0-9_]+)\]/.exec(raw.trim());
            if (head) {
                flush();
                cur = { type: head[1], name: head[2], body: '' };
                const rest = raw.trim().slice(head[0].length);
                if (rest.trim()) {
                    lines.push(rest);
                }
            } else if (cur) {
                lines.push(raw);
            }
        }
        flush();
    }
    return blocks;
}

function loadDeathDrops(scriptsDir: string): Map<string, string> {
    const deathDrops = new Map<string, string>();
    for (const file of filesUnder(scriptsDir, '.npc')) {
        let cur: string | null = null;
        for (const raw of readFileSync(file, 'utf8').split('\n')) {
            const line = raw.trim();
            const head = /^\[([a-z0-9_]+)\]$/.exec(line);
            if (head) {
                cur = head[1];
            } else if (cur && line.startsWith('param=death_drop,')) {
                const value = line.slice('param=death_drop,'.length).trim();
                if (value && value !== 'null') {
                    deathDrops.set(cur, value.split(',')[0].trim());
                }
            }
        }
    }
    return deathDrops;
}

// A leading-underscore name in a drop-table block (e.g. `[ai_queue3,_unicorn]`)
// is a CATEGORY script: it applies to every NPC whose `.npc` `category=` matches
// (black_unicorn has category=unicorn, so it shares the _unicorn table). Capture
// each NPC's category so dropsFor can resolve category-bound tables.
function loadCategories(scriptsDir: string): Map<string, string> {
    const categories = new Map<string, string>();
    for (const file of filesUnder(scriptsDir, '.npc')) {
        let cur: string | null = null;
        for (const raw of readFileSync(file, 'utf8').split('\n')) {
            const line = raw.trim();
            const head = /^\[([a-z0-9_]+)\]$/.exec(line);
            if (head) {
                cur = head[1];
            } else if (cur && line.startsWith('category=')) {
                const value = line.slice('category='.length).trim();
                if (value) {
                    categories.set(cur, value);
                }
            }
        }
    }
    return categories;
}

export class DropResolver {
    private readonly blocks: Map<string, Block>;
    private readonly deathDrops: Map<string, string>;
    private readonly categories: Map<string, string>;
    private readonly toDisplay: TokenResolver;

    constructor(scriptsDir: string, toDisplay: TokenResolver) {
        this.blocks = loadBlocks(scriptsDir);
        this.deathDrops = loadDeathDrops(scriptsDir);
        this.categories = loadCategories(scriptsDir);
        this.toDisplay = toDisplay;
    }

    private itemsIn(key: string, deathDrop: string | null, seen: Set<string>): Set<string> {
        const out = new Set<string>();
        const block = this.blocks.get(key);
        if (!block || seen.has(key)) {
            return out;
        }
        seen.add(key);

        const tokens: string[] = [];
        for (const m of block.body.matchAll(/obj_add\s*\(\s*npc_coord\s*,\s*(~?[a-z0-9_]+)/g)) {
            tokens.push(m[1]);
        }
        for (const m of block.body.matchAll(/return\s*\(\s*(~?[a-z0-9_]+)/g)) {
            tokens.push(m[1]);
        }
        for (const m of block.body.matchAll(/=\s*([a-z][a-z0-9_]*)\s*;/g)) {
            tokens.push(m[1]);
        }
        for (const m of block.body.matchAll(/@([a-z0-9_]+)/g)) {
            tokens.push(`~label${m[1]}`);
        }

        for (const tok of tokens) {
            if (tok.startsWith('~label')) {
                for (const it of this.itemsIn(`label:${tok.slice('~label'.length)}`, deathDrop, seen)) {
                    out.add(it);
                }
            } else if (tok.startsWith('~')) {
                for (const it of this.itemsIn(`proc:${tok.slice(1)}`, deathDrop, seen)) {
                    out.add(it);
                }
            } else if (tok === 'npc_param') {
                if (deathDrop) {
                    out.add(deathDrop);
                }
            } else {
                const bare = tok.startsWith('cert_') ? tok.slice('cert_'.length) : tok;
                if (this.toDisplay(bare)) {
                    out.add(bare);
                }
            }
        }
        return out;
    }

    /** Unique display names (via ObjType+fallbacks) for an npc debugname. */
    dropsFor(npcDebugName: string, deathDropHint?: string | null): string[] {
        const deathDrop = deathDropHint ?? this.deathDrops.get(npcDebugName) ?? null;
        let items = this.itemsIn(`ai_queue3:${npcDebugName}`, deathDrop, new Set<string>());
        // A leading-underscore block name (e.g. `[ai_queue3,_unicorn]`) is a
        // CATEGORY script: it applies to every NPC whose `.npc` `category=`
        // matches. Try that form when the plain debugname block yields nothing.
        if (items.size === 0) {
            const category = this.categories.get(npcDebugName);
            if (category) {
                const byCategory = this.itemsIn(`ai_queue3:_${category}`, deathDrop, new Set<string>());
                if (byCategory.size > 0) {
                    items = byCategory;
                }
            }
        }
        // Legacy fallback: some tables are simply named `_<debugname>`.
        if (items.size === 0) {
            const alt = this.itemsIn(`ai_queue3:_${npcDebugName}`, deathDrop, new Set<string>());
            if (alt.size > 0) {
                items = alt;
            }
        }
        if (items.size === 0) {
            return [];
        }
        const display = new Set<string>();
        for (const item of items) {
            display.add(this.toDisplay(item) ?? item);
        }
        return [...display].sort((a, b) => a.localeCompare(b));
    }
}