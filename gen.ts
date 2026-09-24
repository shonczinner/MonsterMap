/**
 * MonsterMap — generate monster / item-spawn / resource tables from binary
 * spawns + config cache + content scripts.
 *
 * Usage: bun gen.ts [--engine DIR] [--content DIR] [--out DIR]
 *
 * Reads:
 *   maps-server.zip        spawn coordinates (binary n/o/l families)
 *   npc/loc/obj .dat       names / stats / levels (engine config cache)
 *   content scripts        drop tables (.rs2/.npc), skill resource tables
 * Writes:
 *   out/monsters.tsv/.json     NPCs (fishing spots excluded)
 *   out/itemspawns.tsv/.json   ground-item spawns
 *   out/resources.tsv/.json    mining rocks, woodcut trees, flax, fishing spots
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { loadConfig } from './lib/config.ts';
import { loadMaps, boundsOf } from './lib/tiles.ts';
import { DropResolver } from './lib/drops.ts';
import { buildStores } from './lib/shops.ts';
import {
    parseMiningRocks,
    parseWoodcutTrees,
    parseFishingNpcCategories,
    parseFishingFish,
    loadBlocks,
    dataValues
} from './lib/resources.ts';
import { parseLabels } from './lib/labels.ts';
import { WORLDMAP_KEY_NAMES, iconName, iconNameForLabel } from './lib/icons.ts';

const config = loadConfig();
const maps = loadMaps(config.mapsServerZip);
const bounds = boundsOf(maps.spawns);

// --- load engine config modules (they self-resolve #/ aliases via engine package.json)
const { default: NpcType } = await import(pathToFileURL(join(config.engineDir, 'src/cache/config/NpcType.ts')).href);
const { default: ObjType } = await import(pathToFileURL(join(config.engineDir, 'src/cache/config/ObjType.ts')).href);
const { default: LocType } = await import(pathToFileURL(join(config.engineDir, 'src/cache/config/LocType.ts')).href);

const dataPack = join(config.engineDir, 'data/pack');
NpcType.load(dataPack);
ObjType.load(dataPack);
LocType.load(dataPack);

const resolveObjDisplay = (token: string): string | null => {
    const id = ObjType.getId(token);
    if (id === -1 || !ObjType.get(id)) {
        return null;
    }
    const name = ObjType.get(id)!.name;
    return name ? name : token;
};

const drops = new DropResolver(config.dropScriptsDir, resolveObjDisplay);

// Multi-form NPCs whose loot form never appears in maps-server.zip: plot it
// offset from its base form so the map/list show both phases (with the form
// that actually has the drop table). Purely presentational — Server is untouched.
const PHASE_FORM_SPAWNS: { baseDebug: string; formDebug: string; dx: number; dz: number }[] = [
    // ground KQ (id 1158) morphs into flyingqueen (1160) on first "death";
    // only flyingqueen has [ai_queue3,...] loot. Offset 4 tiles east.
    { baseDebug: 'kalphite_queen', formDebug: 'kalphite_flyingqueen', dx: 4, dz: 0 }
];
{
    const idByDebug = new Map<string, number>();
    for (let id = 0; id < NpcType.count; id++) {
        const t = NpcType.get(id);
        if (t?.debugname && !idByDebug.has(t.debugname)) idByDebug.set(t.debugname, id);
    }
    for (const rule of PHASE_FORM_SPAWNS) {
        const baseId = idByDebug.get(rule.baseDebug);
        const formId = idByDebug.get(rule.formDebug);
        if (baseId === undefined || formId === undefined) continue;
        const baseSpawns = maps.spawns.filter(s => s.id === baseId);
        for (const s of baseSpawns) {
            maps.spawns.push({ ...s, id: formId, x: s.x + rule.dx, z: s.z + rule.dz });
        }
    }
}

// --- resource classification tables (from content skill scripts)
const miningRocks = parseMiningRocks(config.contentDir);
const woodcutTrees = parseWoodcutTrees(config.contentDir);
const fishingCategories = parseFishingNpcCategories(config.contentDir);
const fishingFish = parseFishingFish(config.contentDir, resolveObjDisplay);

const isFishingSpot = (id: number): boolean => {
    const type = NpcType.get(id);
    return !!type && type.name === 'Fishing spot';
};

type RunecraftMeta = {
    runeType: number;
    name: string;
    level: number;
    rune: string;
    talisman: string;
    members: boolean;
};

type RunecraftLocDef = {
    runeType: number;
    kind: 'ruins' | 'altar';
};

const runecraftMeta = new Map<number, RunecraftMeta>();
for (const block of loadBlocks(join(config.contentDir, 'scripts/skill_runecraft/configs/runecraft.dbrow'))) {
    if (dataValues(block, 'table')[0] !== 'runecraft_table') {
        continue;
    }
    let runeType: number | null = null;
    let name = '';
    let level = 0;
    let rune = '';
    let talisman = '';
    let members = false;
    for (const entry of dataValues(block, 'data')) {
        const comma = entry.indexOf(',');
        if (comma < 0) {
            continue;
        }
        const field = entry.slice(0, comma).trim();
        const value = entry.slice(comma + 1).trim();
        if (field === 'type') runeType = Number(value);
        else if (field === 'name') name = value;
        else if (field === 'level') level = Number(value);
        else if (field === 'rune') rune = value;
        else if (field === 'talisman') talisman = value;
        else if (field === 'members') members = value === '1' || value === 'true';
    }
    if (runeType !== null && Number.isFinite(runeType) && name) {
        runecraftMeta.set(runeType, { runeType, name, level, rune, talisman, members });
    }
}

const runecraftLocDefs = new Map<string, RunecraftLocDef>();
for (const block of loadBlocks(join(config.contentDir, 'scripts/skill_runecraft/configs/runecraft.loc'))) {
    const category = dataValues(block, 'category')[0];
    if (category !== 'rc_ruins' && category !== 'rc_altar') {
        continue;
    }
    const param = dataValues(block, 'param').find(value => value.startsWith('rune_type,'));
    if (!param) {
        continue;
    }
    const runeType = Number(param.slice(param.indexOf(',') + 1));
    if (!Number.isFinite(runeType) || !runecraftMeta.has(runeType)) {
        continue;
    }
    runecraftLocDefs.set(block.name, { runeType, kind: category === 'rc_altar' ? 'altar' : 'ruins' });
}

const runecraftSpawns: any[] = [];
for (const spawn of maps.locSpawns) {
    const type = LocType.get(spawn.id);
    const definition = type?.debugname ? runecraftLocDefs.get(type.debugname) : undefined;
    if (!type || !definition) {
        continue;
    }
    const meta = runecraftMeta.get(definition.runeType);
    if (!meta) {
        continue;
    }
    runecraftSpawns.push({
        kind: definition.kind,
        runeType: meta.runeType,
        rune: resolveObjDisplay(meta.rune) ?? `${meta.name} rune`,
        reqLevel: meta.level,
        members: meta.members,
        talisman: meta.talisman ? resolveObjDisplay(meta.talisman) : '',
        x: spawn.x,
        z: spawn.z,
        level: spawn.level,
        id: spawn.id,
        debug: type.debugname,
        locName: type.name ?? type.debugname ?? `loc_${spawn.id}`,
        name: `${meta.name} ${definition.kind === 'altar' ? 'rune altar' : 'temple ruins'}`
    });
}
runecraftSpawns.sort((a, b) => a.runeType - b.runeType || a.name.localeCompare(b.name) || a.x - b.x || a.z - b.z);

// =====================================================================
// monsters (everything except fishing spots)
// =====================================================================
// combat bonus param IDs and their defaults (from combat.param)
const PARAM = {
    stabattack: 101, slashattack: 102, crushattack: 103, magicattack: 104, rangeattack: 105,
    stabdefence: 106, slashdefence: 107, crushdefence: 108, magicdefence: 109, rangedefence: 110,
    strengthbonus: 111, attackbonus: 112, attackrate: { id: 116, def: 4 }
} as const;

function extractBonuses(type: any): Record<string, number> {
    const out: Record<string, number> = {};
    for (const [key, val] of Object.entries(PARAM)) {
        const id = typeof val === 'number' ? val : val.id;
        const def = typeof val === 'number' ? undefined : val.def;
        const v = type.params.get(id);
        out[key] = v !== undefined ? v : (def ?? 0);
    }
    return out;
}

const stats = { spawned: 0, distinct: 0, dropped: 0, distinctIds: 0 };
const monsterById = new Map<number, any>();
const spawnCountById = new Map<number, number>();

for (const spawn of maps.spawns) {
    if (isFishingSpot(spawn.id)) {
        continue; // routed to resources below
    }
    const type = NpcType.get(spawn.id);
    if (!type || !type.name) {
        if (!type?.debugname) {
            continue; // no resolvable identity
        }
    }
    if (!monsterById.has(spawn.id)) {
        const name = type.name ?? type.debugname;
        const dropList = drops.dropsFor(type.debugname ?? '?');
        if (dropList.length > 0) {
            stats.dropped++;
        }
        monsterById.set(spawn.id, {
            id: spawn.id,
            name,
            debug: type.debugname,
            level: type.vislevel,
            stats: [...type.stats],
            bonuses: extractBonuses(type),
            members: type.members,
            size: type.size,
            attackrange: type.attackrange,
            wanderrange: type.wanderrange,
            drops: dropList,
            spawns: []
        });
    }
    monsterById.get(spawn.id)!.spawns.push({ x: spawn.x, z: spawn.z, level: spawn.level });
    spawnCountById.set(spawn.id, (spawnCountById.get(spawn.id) ?? 0) + 1);
    stats.spawned++;
}

const monsterRecords: any[] = [];
for (let id = 0; id < NpcType.count; id++) {
    const type = NpcType.get(id);
    if (!type) {
        continue;
    }
    if (type.name === 'Fishing spot') {
        continue;
    }
    const rec = monsterById.get(id);
    if (rec) {
        rec.spawns.sort((a: any, b: any) => a.z - b.z || a.x - b.x || a.level - b.level);
        monsterRecords.push(rec);
        continue;
    }
    const dropList = type.name || type.debugname ? drops.dropsFor(type.debugname ?? '?') : [];
    if (dropList.length > 0) {
        stats.dropped++;
    }
    monsterRecords.push({
        id,
        name: type.name ?? type.debugname ?? `npc_${id}`,
        debug: type.debugname,
        level: type.vislevel,
        stats: [...type.stats],
        bonuses: extractBonuses(type),
        members: type.members,
        size: type.size,
        attackrange: type.attackrange,
        wanderrange: type.wanderrange,
        drops: dropList,
        spawns: []
    });
}
monsterRecords.sort((a, b) => a.id - b.id);
stats.distinctIds = monsterById.size;

// =====================================================================
// item spawns (o{} ground items)
// =====================================================================
const itemSpawns = maps.itemSpawns.map(s => {
    const type = ObjType.get(s.id);
    return {
        x: s.x,
        z: s.z,
        level: s.level,
        id: s.id,
        name: type?.name ?? `obj_${s.id}`,
        count: s.count,
        mapX: s.mapX,
        mapZ: s.mapZ
    };
});

// =====================================================================
// resources (l{} locs classified + fishing spots from n{})
// =====================================================================
type ResourceSpawn = any;
const resourceSpawns: ResourceSpawn[] = [];

let miningCount = 0;
let woodcutCount = 0;
let flaxCount = 0;
for (const s of maps.locSpawns) {
    const type = LocType.get(s.id);
    if (!type) {
        continue;
    }
    const debug = type.debugname;
    const name = type.name ?? debug ?? `loc_${s.id}`;
    if (debug && miningRocks.has(debug)) {
        const r = miningRocks.get(debug)!;
        resourceSpawns.push({ kind: 'mining', x: s.x, z: s.z, level: s.level, id: s.id, name, group: resolveObjDisplay(r.output) || r.ore, reqLevel: r.level, output: r.output });
        miningCount++;
    } else if (debug && woodcutTrees.has(debug)) {
        const t = woodcutTrees.get(debug)!;
        resourceSpawns.push({ kind: 'woodcut', x: s.x, z: s.z, level: s.level, id: s.id, name, group: resolveObjDisplay(t.product) || t.product, reqLevel: t.level });
        woodcutCount++;
    } else if (debug === 'flax') {
        resourceSpawns.push({ kind: 'flax', x: s.x, z: s.z, level: s.level, id: s.id, name, group: 'flax' });
        flaxCount++;
    }
}

let fishingCount = 0;
for (const spawn of maps.spawns) {
    if (!isFishingSpot(spawn.id)) {
        continue;
    }
    const type = NpcType.get(spawn.id);
    const debug = type?.debugname ?? `npc_${spawn.id}`;
    const category = fishingCategories.get(debug) ?? '';
    const key = debug.split('_').pop() ?? debug;
    const fish = fishingFish.get(key) ?? [];
    resourceSpawns.push({
        kind: 'fishing',
        x: spawn.x,
        z: spawn.z,
        level: spawn.level,
        id: spawn.id,
        name: type?.name ?? 'Fishing spot',
        group: key,
        category,
        fish
    });
    fishingCount++;
}

// =====================================================================
// location names (cities / areas / POIs) — from content/maps/labels.txt
// =====================================================================
const places = parseLabels(config.contentDir);

// =====================================================================
// minimap icons — legend + per-spawn points of interest
// =====================================================================
const iconLocations: any[] = [];
for (const s of maps.locSpawns) {
    const type = LocType.get(s.id);
    if (!type || type.mapfunction < 0) {
        continue;
    }
    iconLocations.push({
        kind: 'loc',
        mapfunction: type.mapfunction,
        icon: iconName(type.mapfunction),
        name: type.name ?? type.debugname ?? `loc_${s.id}`,
        id: s.id,
        x: s.x,
        z: s.z,
        level: s.level
    });
}
for (const spawn of maps.spawns) {
    const type = NpcType.get(spawn.id);
    if (!type || !type.minimap) {
        continue;
    }
    iconLocations.push({
        kind: 'npc',
        mapfunction: -1,
        icon: iconNameForLabel(type.name) ?? type.name ?? 'Fishing spot',
        name: type.name ?? 'Fishing spot',
        id: spawn.id,
        x: spawn.x,
        z: spawn.z,
        level: spawn.level
    });
}

// =====================================================================
// outputs
// =====================================================================
const dataDir = config.dataDir;
mkdirSync(dataDir, { recursive: true });

function byX<T extends { x: number; z: number }>(items: T[]): Record<string, Record<string, T[]>> {
    const out: Record<string, Record<string, T[]>> = {};
    for (const it of items) {
        const xk = String(it.x);
        const zk = String(it.z);
        (out[xk] ??= {})[zk] ??= [];
        out[xk][zk].push(it);
    }
    return out;
}

// ---- monsters
const tsvHeader = ['absX', 'absZ', 'level', 'id', 'name', 'debug', 'vislevel', 'att', 'def', 'str', 'hp', 'rng', 'mage', 'members', 'size', 'attackrange',
    'stabatt', 'slashatt', 'crushatt', 'magatt', 'rngatt',
    'stabdef', 'slashdef', 'crushdef', 'magdef', 'rngdef',
    'strbonus', 'attbonus', 'attackrate'];
const tsvRows = maps.spawns
    .filter(s => !isFishingSpot(s.id))
    .map(spawn => {
        const rec = monsterById.get(spawn.id);
        const [att, def, str, hp, rng, mage] = rec?.stats ?? [0, 0, 0, 0, 0, 0];
        const b = rec?.bonuses ?? {};
        return [
            spawn.x, spawn.z, spawn.level, spawn.id,
            rec?.name ?? spawn.id, rec?.debug ?? '', rec?.level ?? '',
            att, def, str, hp, rng, mage,
            rec?.members ?? false, rec?.size ?? 1, rec?.attackrange ?? 0,
            b.stabattack ?? '', b.slashattack ?? '', b.crushattack ?? '', b.magicattack ?? '', b.rangeattack ?? '',
            b.stabdefence ?? '', b.slashdefence ?? '', b.crushdefence ?? '', b.magicdefence ?? '', b.rangedefence ?? '',
            b.strengthbonus ?? '', b.attackbonus ?? '', b.attackrate ?? ''
        ].join('\t');
    });
const tsv = [tsvHeader.join('\t'), ...tsvRows].join('\n') + '\n';
writeFileSync(join(dataDir, 'monsters.tsv'), tsv);

const monstersMeta = {
    revisionTime: new Date().toISOString(),
    engine: config.engineDir,
    content: config.contentDir,
    bounds,
    land: [...maps.land].sort(),
    spawnRecords: stats.spawned,
    distinctIds: stats.distinctIds,
    configs: monsterRecords.length
};
const monstersJson: Record<number, any> = {};
const dropsJson: Record<number, any> = {};
for (const m of monsterRecords) {
    const rest = { ...m };
    delete rest.drops;
    monstersJson[m.id] = rest;
    if (m.drops && m.drops.length) dropsJson[m.id] = m.drops;
}
const monstersOut = {
    generation: monstersMeta,
    spawns: maps.spawns.filter(s => !isFishingSpot(s.id)).map(s => ({ x: s.x, z: s.z, level: s.level, id: s.id })),
    monsters: monstersJson
};
writeFileSync(join(dataDir, 'monsters.json'), JSON.stringify(monstersOut, null, 2));
writeFileSync(join(dataDir, 'drops.json'), JSON.stringify({
    generation: monstersMeta,
    drops: dropsJson
}, null, 2));

// ---- stores (NPC -> shop, keyed by NPC id; only shops with default stock > 0)
const storesMap = buildStores(config.dropScriptsDir, NpcType, ObjType);
writeFileSync(join(dataDir, 'stores.json'), JSON.stringify({
    generation: monstersMeta,
    note: 'keyed by NPC id; only shops/items with default stock (baseline) > 0 are included',
    stores: storesMap
}, null, 2));

// ---- item spawns
const itemTsvHeader = ['absX', 'absZ', 'level', 'id', 'name', 'count'];
const itemTsv = [itemTsvHeader.join('\t'), ...itemSpawns.map(s => [s.x, s.z, s.level, s.id, s.name, s.count].join('\t'))].join('\n') + '\n';
writeFileSync(join(dataDir, 'itemspawns.tsv'), itemTsv);
writeFileSync(join(dataDir, 'itemspawns.json'), JSON.stringify({
    generation: {
        revisionTime: new Date().toISOString(),
        engine: config.engineDir,
        content: config.contentDir,
        bounds,
        spawnRecords: itemSpawns.length
    },
    spawns: itemSpawns,
    byX: byX(itemSpawns)
}, null, 2));

// ---- resources
const resourceTsvHeader = ['kind', 'group', 'reqLevel', 'absX', 'absZ', 'level', 'id', 'name', 'fish'];
const resourceTsv = [resourceTsvHeader.join('\t'), ...resourceSpawns.map(s => [
    s.kind, s.group, s.reqLevel ?? '', s.x, s.z, s.level, s.id, s.name, (s.fish ?? []).join(' | ')
].join('\t'))].join('\n') + '\n';
writeFileSync(join(dataDir, 'resources.tsv'), resourceTsv);
writeFileSync(join(dataDir, 'resources.json'), JSON.stringify({
    generation: {
        revisionTime: new Date().toISOString(),
        engine: config.engineDir,
        content: config.contentDir,
        bounds,
        mining: miningCount,
        woodcut: woodcutCount,
        flax: flaxCount,
        fishing: fishingCount,
        total: resourceSpawns.length
    },
    spawns: resourceSpawns,
    byX: byX(resourceSpawns)
}, null, 2));

const runecraftTsvHeader = ['kind', 'rune', 'runeType', 'reqLevel', 'members', 'talisman', 'absX', 'absZ', 'level', 'id', 'debug', 'locName', 'name'];
const runecraftTsv = [runecraftTsvHeader.join('\t'), ...runecraftSpawns.map(s => [
    s.kind, s.rune, s.runeType, s.reqLevel, s.members, s.talisman, s.x, s.z, s.level, s.id, s.debug, s.locName, s.name
].join('\t'))].join('\n') + '\n';
writeFileSync(join(dataDir, 'runecrafting.tsv'), runecraftTsv);
const runecraftRuinsCount = runecraftSpawns.filter(s => s.kind === 'ruins').length;
const runecraftAltarCount = runecraftSpawns.length - runecraftRuinsCount;
writeFileSync(join(dataDir, 'runecrafting.json'), JSON.stringify({
    generation: {
        revisionTime: new Date().toISOString(),
        engine: config.engineDir,
        content: config.contentDir,
        source: 'content/scripts/skill_runecraft/configs/runecraft.{loc,dbrow}',
        bounds,
        ruins: runecraftRuinsCount,
        altars: runecraftAltarCount,
        total: runecraftSpawns.length
    },
    spawns: runecraftSpawns,
    byX: byX(runecraftSpawns)
}, null, 2));

// ---- location names
const placeTsvHeader = ['name', 'type', 'absX', 'absZ'];
const placeTsv = [placeTsvHeader.join('\t'), ...places.map(p => [p.name, p.type, p.x, p.z].join('\t'))].join('\n') + '\n';
writeFileSync(join(dataDir, 'locationnames.tsv'), placeTsv);
writeFileSync(join(dataDir, 'locationnames.json'), JSON.stringify({
    generation: {
        revisionTime: new Date().toISOString(),
        content: config.contentDir,
        source: 'content/maps/labels.txt',
        count: places.length
    },
    places
}, null, 2));

// ---- minimap icons
const iconTsvHeader = ['kind', 'mapfunction', 'icon', 'name', 'id', 'absX', 'absZ', 'level'];
const iconTsv = [iconTsvHeader.join('\t'), ...iconLocations.map(s => [
    s.kind, s.mapfunction, s.icon, s.name, s.id, s.x, s.z, s.level
].join('\t'))].join('\n') + '\n';
writeFileSync(join(dataDir, 'minimapicons.tsv'), iconTsv);
writeFileSync(join(dataDir, 'minimapicons.json'), JSON.stringify({
    generation: {
        revisionTime: new Date().toISOString(),
        engine: config.engineDir,
        content: config.contentDir,
        iconCount: iconLocations.length
    },
    icons: WORLDMAP_KEY_NAMES.map((name, i) => ({ mapfunction: i, name })),
    locations: iconLocations
}, null, 2));

console.log(`monsters: spawns=${stats.spawned} distinct=${stats.distinctIds} configs=${monsterRecords.length} withDrops=${stats.dropped}`);
console.log(`items:    ${itemSpawns.length}`);
console.log(`resources: mining=${miningCount} woodcut=${woodcutCount} flax=${flaxCount} fishing=${fishingCount} total=${resourceSpawns.length}`);
console.log(`runecraft: ruins=${runecraftRuinsCount} altars=${runecraftAltarCount} total=${runecraftSpawns.length}`);
console.log(`places:   ${places.length}  minimap icons: ${iconLocations.length} (legend ${WORLDMAP_KEY_NAMES.length})`);
console.log(`bounds: ${bounds.minX},${bounds.minZ} .. ${bounds.maxX},${bounds.maxZ}`);
console.log(`wrote monsters/itemspawns/resources/runecrafting/locationnames/minimapicons .tsv + .json to ${dataDir}`);
