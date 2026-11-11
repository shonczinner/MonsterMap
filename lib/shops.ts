/**
 * Shop / store resolution for MonsterMap.
 *
 * Port of the join logic in rs2b0t/tools/shops/parse.ts, extended to key the
 * result by NPC id so it can be merged into the map the same way as drops.
 *
 * Sources (all under the content scripts dir, e.g. Server/content/scripts):
 *   - *.npc  keeper NPCs: `param=owned_shop,<inv>` links an NPC to a shop inv,
 *           plus shop_title / shop_sell_multiplier / shop_buy_multiplier /
 *           shop_delta. The `[block]` id is the NPC's debugname.
 *   - *.inv  shop inventories: `stockN=<obj>,<baseline>,<restockTicks>` plus
 *           scope= / allstock=.
 *   - *.obj  item display name + cost.
 *
 * The keeper's debugname is resolved to its NPC id through NpcType, so the
 * output is keyed by the same NPC id used for spawns / monsters.json / drops.json.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/* eslint-disable @typescript-eslint/no-explicit-any */
type AnyConfig = any;

interface Block { id: string; lines: string[] }
interface ParsedInv { inv: string; scope: string; allstock: boolean; stock: { obj: string; baseline: number; restockTicks: number }[] }
interface ParsedKeeper { npc: string; name: string; ownedShops: string[]; sell: number; buy: number; delta: number; title: string }
interface ParsedObj { name: string; cost: number }

function filesUnder(root: string, ext: string): string[] {
    if (!existsSync(root)) return [];
    const out: string[] = [];
    const walk = (dir: string): void => {
        for (const entry of readdirSync(dir, { withFileTypes: true })) {
            const full = join(dir, entry.name);
            if (entry.isDirectory()) walk(full);
            else if (entry.name.endsWith(ext)) out.push(full);
        }
    };
    walk(root);
    return out;
}

function blocks(text: string): Block[] {
    const out: Block[] = [];
    let cur: Block | null = null;
    for (const raw of text.split('\n')) {
        const line = raw.trim();
        const head = /^\[([a-z0-9_]+)\]$/.exec(line);
        if (head) {
            cur = { id: head[1]!, lines: [] };
            out.push(cur);
        } else if (cur && line.length > 0 && !line.startsWith('//')) {
            cur.lines.push(line);
        }
    }
    return out;
}

function field(lines: string[], key: string): string | undefined {
    const prefix = `${key}=`;
    const hit = lines.find(l => l.startsWith(prefix));
    return hit?.slice(prefix.length);
}

export function parseInvShops(text: string): ParsedInv[] {
    const out: ParsedInv[] = [];
    for (const b of blocks(text)) {
        const stock: ParsedInv['stock'] = [];
        for (const line of b.lines) {
            const m = /^stock\d+=([a-z0-9_]+),(\d+),(\d+)$/.exec(line);
            if (m) stock.push({ obj: m[1]!, baseline: Number(m[2]), restockTicks: Number(m[3]) });
        }
        if (stock.length > 0) out.push({ inv: b.id, scope: field(b.lines, 'scope') ?? '', allstock: field(b.lines, 'allstock') === 'yes', stock });
    }
    return out;
}

export function parseNpcKeepers(text: string): ParsedKeeper[] {
    const out: ParsedKeeper[] = [];
    for (const b of blocks(text)) {
        const owned = b.lines
            .map(l => /^param=owned_shop,([a-z0-9_]+)$/.exec(l)?.[1])
            .filter((s): s is string => s !== undefined);
        if (owned.length === 0) continue;
        const num = (key: string, fallback: number): number => {
            const m = b.lines.find(l => l.startsWith(`param=${key},`));
            return m ? Number(m.slice(`param=${key},`.length)) : fallback;
        };
        const title = b.lines.find(l => l.startsWith('param=shop_title,'))?.slice('param=shop_title,'.length) ?? '';
        out.push({
            npc: b.id,
            name: field(b.lines, 'name') ?? b.id,
            ownedShops: owned,
            sell: num('shop_sell_multiplier', 100),
            buy: num('shop_buy_multiplier', 60),
            delta: num('shop_delta', 10),
            title
        });
    }
    return out;
}

export function parseObjDefs(text: string): Record<string, ParsedObj> {
    const out: Record<string, ParsedObj> = {};
    for (const b of blocks(text)) {
        out[b.id] = {
            name: field(b.lines, 'name') ?? b.id,
            cost: Number(field(b.lines, 'cost') ?? '1')
        };
    }
    return out;
}

// ---------------------------------------------------------------------------
// Script-opened shops
//
// Not every keeper uses `param=owned_shop` (which the engine's generic
// `~openshop_activenpc` reads). Some trade options bypass it and call
// `~openshop(<inv>, <sell>, <buy>, <delta>, "<title>")` directly, often from a
// proc or label reached from the `[opnpcN,<npc>]` block. Example: Zaff.
// ---------------------------------------------------------------------------

export interface ParsedScriptShop {
    npc: string;
    inv: string;
    title: string;
    sell: number;
    buy: number;
    delta: number;
}

type ScriptBlock = { type: string; name: string; body: string };

function loadScriptBlocks(root: string): ScriptBlock[] {
    const out: ScriptBlock[] = [];
    for (const file of filesUnder(root, '.rs2')) {
        let cur: ScriptBlock | null = null;
        const lines: string[] = [];
        const flush = (): void => {
            if (cur) {
                cur.body = lines.join('\n');
                out.push(cur);
                lines.length = 0;
            }
        };
        for (const raw of readFileSync(file, 'utf8').split('\n')) {
            const line = raw.trim();
            const head = /^\[([a-z0-9_]+)\s*,\s*([a-z0-9_]+)\]/.exec(line);
            if (head) {
                flush();
                cur = { type: head[1]!, name: head[2]!, body: '' };
                const rest = line.slice(head[0].length);
                if (rest.trim()) lines.push(rest);
            } else if (cur) {
                lines.push(line);
            }
        }
        flush();
    }
    return out;
}

/** `~openshop(inv, sell, buy, delta, "title")` calls keyed by NPC debugname. */
export function parseScriptShops(scriptsDir: string): ParsedScriptShop[] {
    const blocks = loadScriptBlocks(scriptsDir);
    const procs = new Map<string, string>();
    const labels = new Map<string, string>();
    const npcBodies = new Map<string, string[]>();

    for (const b of blocks) {
        if (b.type === 'proc') {
            procs.set(b.name, b.body);
        } else if (b.type === 'label') {
            labels.set(b.name, b.body);
        } else if (b.type.startsWith('opnpc')) {
            const bodies = npcBodies.get(b.name);
            if (bodies) bodies.push(b.body);
            else npcBodies.set(b.name, [b.body]);
        }
    }

    const callRe = /~openshop\s*\(\s*([a-z0-9_]+)\s*,\s*(-?\d+)\s*,\s*(-?\d+)\s*,\s*(-?\d+)\s*,\s*"([^"]*)"/g;
    const procRe = /~([a-z0-9_]+)/g;
    const labelRe = /@([a-z0-9_]+)/g;
    const out: ParsedScriptShop[] = [];

    const walk = (body: string, npc: string, seen: Set<string>, found: ParsedScriptShop[]): void => {
        for (const m of body.matchAll(callRe)) {
            found.push({
                npc,
                inv: m[1]!,
                sell: Number(m[2]),
                buy: Number(m[3]),
                delta: Number(m[4]),
                title: m[5]!
            });
        }
        for (const m of body.matchAll(procRe)) {
            const name = m[1]!;
            if (name === 'openshop') continue; // the call itself was handled above
            const key = `proc:${name}`;
            if (seen.has(key)) continue;
            const proc = procs.get(name);
            if (proc === undefined) continue;
            seen.add(key);
            walk(proc, npc, seen, found);
        }
        for (const m of body.matchAll(labelRe)) {
            const key = `label:${m[1]}`;
            if (seen.has(key)) continue;
            const label = labels.get(m[1]!);
            if (label === undefined) continue;
            seen.add(key);
            walk(label, npc, seen, found);
        }
    };

    for (const [npc, bodies] of npcBodies) {
        const seen = new Set<string>();
        const found: ParsedScriptShop[] = [];
        for (const body of bodies) walk(body, npc, seen, found);
        out.push(...found);
    }
    return out;
}

/**
 * Build the NPC-id-keyed store map.
 * Only shops (and NPCs) with at least one item whose default stock `baseline > 0`
 * are included — empty-stock shops are not represented on the map.
 */
export function buildStores(scriptsDir: string, NpcType: AnyConfig, ObjType: AnyConfig): Record<number, { name: string; shops: any[] }> {
    const keepers = filesUnder(scriptsDir, '.npc').flatMap(f => parseNpcKeepers(readFileSync(f, 'utf8')));
    const invs = filesUnder(scriptsDir, '.inv').flatMap(f => parseInvShops(readFileSync(f, 'utf8')));
    const objs: Record<string, ParsedObj> = {};
    for (const f of filesUnder(scriptsDir, '.obj')) Object.assign(objs, parseObjDefs(readFileSync(f, 'utf8')));

    const shopByInv: Record<string, any> = {};
    for (const inv of invs) {
        const items = inv.stock
            .filter(s => s.baseline > 0)
            .map(s => {
                const o = objs[s.obj] ?? { name: s.obj, cost: 1 };
                return { obj: s.obj, name: o.name, baseline: s.baseline, cost: o.cost, restockTicks: s.restockTicks };
            });
        if (items.length === 0) continue;
        const owners = keepers.filter(k => k.ownedShops.includes(inv.inv));
        if (owners.length === 0) continue;
        const first = owners[0]!;
        shopByInv[inv.inv] = {
            inv: inv.inv,
            title: first.title || inv.inv,
            sell: first.sell,
            buy: first.buy,
            delta: first.delta,
            items,
            keepers: owners.map(o => o.name)
        };
    }

    const stores: Record<number, { name: string; shops: any[] }> = {};
    for (const inv of Object.keys(shopByInv)) {
        const shop = shopByInv[inv];
        for (const owner of keepers.filter(k => k.ownedShops.includes(inv))) {
            const id = NpcType.getId(owner.npc);
            if (id < 0) continue;
            const rec = (stores[id] ??= { name: owner.name, shops: [] });
            if (!rec.shops.some(sh => sh.inv === inv)) rec.shops.push(shop);
        }
    }

    // Script-opened shops (no `owned_shop` param): e.g. Zaff's trade option
    // calls ~openshop(staffshop/memberstaffshop, ...). Join those inventories
    // the same way and merge them into the NPC's store record.
    const invByName = new Map(invs.map(i => [i.inv, i]));
    const shopFor = (
        invName: string,
        title: string,
        sell: number,
        buy: number,
        delta: number,
        owners: string[]
    ): any | null => {
        const inv = invByName.get(invName);
        if (!inv) return null;
        const items = inv.stock
            .filter(s => s.baseline > 0)
            .map(s => {
                const o = objs[s.obj] ?? { name: s.obj, cost: 1 };
                return { obj: s.obj, name: o.name, baseline: s.baseline, cost: o.cost, restockTicks: s.restockTicks };
            });
        if (items.length === 0) return null;
        return { inv: invName, title: title || invName, sell, buy, delta, items, keepers: owners };
    };

    const scriptByNpc = new Map<string, ParsedScriptShop[]>();
    for (const s of parseScriptShops(scriptsDir)) {
        const list = scriptByNpc.get(s.npc);
        if (list) list.push(s);
        else scriptByNpc.set(s.npc, [s]);
    }
    for (const [npc, opens] of scriptByNpc) {
        const id = NpcType.getId(npc);
        if (id < 0) continue;
        // Member/free variants share a title (memberstaffshop vs staffshop);
        // keep the richest stock for that title.
        const byTitle = new Map<string, any>();
        for (const s of opens) {
            const shop = shopFor(s.inv, s.title, s.sell, s.buy, s.delta, [npc]);
            if (!shop) continue;
            const prev = byTitle.get(shop.title);
            if (!prev || shop.items.length > prev.items.length) byTitle.set(shop.title, shop);
        }
        if (byTitle.size === 0) continue;
        const rec = (stores[id] ??= { name: NpcType.get(id)?.name ?? npc, shops: [] });
        for (const shop of byTitle.values()) {
            if (!rec.shops.some(sh => sh.inv === shop.inv)) rec.shops.push(shop);
        }
    }

    return stores;
}
