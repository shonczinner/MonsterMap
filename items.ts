/**
 * ItemDebug — dump all obj debug names + display info from the engine cache,
 * then build a filterable `out/items.html` list page.
 *
 * Usage: bun items.ts [--out DIR]
 *
 * Reads (from the engine, read-only):
 *   obj.dat (server jag)   names / debug names / stackable / members / etc
 * Writes:
 *   out/data/items.tsv     one row per item (feeds the list page)
 *   out/items.html         filterable table (per-column substring + min/max range
 *                          filters, sortable) built by lib/listpage.ts
 *
 * Ported from the standalone ItemDebug/ folder so item data is generated in
 * this repo alongside the map and monster list.
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { loadConfig } from './lib/config.ts';
import { buildListPage } from './lib/listpage.ts';

const config = loadConfig();

const { default: ObjType } = await import(
    pathToFileURL(join(config.engineDir, 'src/cache/config/ObjType.ts')).href
);
ObjType.load(join(config.engineDir, 'data/pack'));

// combat bonus param IDs (from combat.param)
const PARAM_IDS: Record<string, { id: number; def?: number }> = {
    stabattack: { id: 101 }, slashattack: { id: 102 }, crushattack: { id: 103 }, magicattack: { id: 104 }, rangeattack: { id: 105 },
    stabdefence: { id: 106 }, slashdefence: { id: 107 }, crushdefence: { id: 108 }, magicdefence: { id: 109 }, rangedefence: { id: 110 },
    strengthbonus: { id: 111 }, attackbonus: { id: 112 }, rangebonus: { id: 114 }, attackrate: { id: 116 }
};

type ItemRecord = {
    id: number;
    debug: string;
    name: string;
    stackable: string;
    members: string;
    noted: number;
    dummy: number;
    weight: number;
    value: number;
    lendable: string;
    tradeable: string;
    examine: string;
} & Record<string, number | string>;

const items: ItemRecord[] = [];
for (let id = 0; id < ObjType.count; id++) {
    const obj = ObjType.get(id);
    if (!obj) continue;
    if (!obj.debugname) continue;
    const rec: ItemRecord = {
        id,
        debug: obj.debugname,
        name: obj.name ?? '',
        stackable: obj.stackable ? 'yes' : 'no',
        members: obj.members ? 'yes' : 'no',
        noted: obj.certtemplate ?? -1,
        dummy: obj.dummyitem ?? -1,
        weight: obj.weight ?? 0,
        value: obj.value ?? 0,
        lendable: obj.lendable ? 'yes' : 'no',
        tradeable: obj.tradeable === undefined ? 'yes' : obj.tradeable ? 'yes' : 'no',
        examine: (obj.examine ?? '').replace(/[\t\n\r]+/g, ' ')
    };
    for (const [key, { id, def }] of Object.entries(PARAM_IDS)) {
        const v = obj.params.get(id);
        rec[key] = v !== undefined ? v : (def ?? '');
    }
    // apply attackrate default (4) only for wieldable weapons (wearpos 3 = weapon slot)
    if (rec.attackrate === '' && obj.wearpos === 3) {
        rec.attackrate = 4;
    }
    items.push(rec);
}
items.sort((a, b) => a.id - b.id);

const bonusCols = Object.keys(PARAM_IDS);
const header = ['id', 'debug', 'name', 'stackable', 'members', 'noted', 'dummy', 'weight', 'value', 'lendable', 'tradeable', 'examine', ...bonusCols];
const tsv = [header.join('\t'), ...items.map((it) =>
    header.map(c => String(it[c] ?? '')).join('\t')
)].join('\n') + '\n';
writeFileSync(join(config.dataDir, 'items.tsv'), tsv);

buildListPage({
    tsvPath: join(config.dataDir, 'items.tsv'),
    templatePath: join(import.meta.dir, 'template_list.html'),
    outPath: join(config.outDir, 'items.html'),
    navFile: 'items.html',
    noun: 'items',
    title: 'Items — MonsterMap'
});
