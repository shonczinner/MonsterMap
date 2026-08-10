/**
 * MonsterMap — generate the monster table from binary spawns + config cache +
 * content drop tables.
 *
 * Usage: bun gen.ts [--engine DIR] [--content DIR] [--out DIR]
 *
 * Reads:
 *   maps-server.zip      spawn coordinates (binary)
 *   npc.dat (server+client jag)   names / stats / level
 *   content scripts      drop tables (.rs2 / .npc)
 * Writes:
 *   out/monsters.tsv     one row per spawn
 *   out/monsters.json    spawns[] + monsters[] (all configs)
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { loadConfig } from './lib/config.ts';
import { loadSpawns, boundsOf } from './lib/tiles.ts';
import { DropResolver } from './lib/drops.ts';

const config = loadConfig();
const files = loadSpawns(config.mapsServerZip);
const bounds = boundsOf(files.spawns);

// --- load engine config modules (they self-resolve #/ aliases via engine package.json)
const { default: NpcType } = await import(pathToFileURL(join(config.engineDir, 'src/cache/config/NpcType.ts')).href);
const { default: ObjType } = await import(pathToFileURL(join(config.engineDir, 'src/cache/config/ObjType.ts')).href);

const dataPack = join(config.engineDir, 'data/pack');
NpcType.load(dataPack);
ObjType.load(dataPack);

const resolveObjDisplay = (token: string): string | null => {
    const id = ObjType.getId(token);
    if (id === -1 || !ObjType.get(id)) {
        return null;
    }
    const name = ObjType.get(id)!.name;
    return name ? name : token;
};

const drops = new DropResolver(config.dropScriptsDir, resolveObjDisplay);

const stats = { spawned: 0, distinct: 0, dropped: 0 };
const monsterById = new Map<number, any>();
const spawnCountById = new Map<number, number>();

for (const spawn of files.spawns) {
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

// all configs, including dynamic-only (empty spawns)
const monsterRecords: any[] = [];
for (let id = 0; id < NpcType.count; id++) {
    const type = NpcType.get(id);
    if (!type) {
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

// ---- outputs
const dataDir = config.dataDir;
mkdirSync(dataDir, { recursive: true });

const tsvHeader = ['absX', 'absZ', 'level', 'id', 'name', 'debug', 'vislevel', 'att', 'def', 'str', 'hp', 'rng', 'mage', 'members', 'size', 'attackrange', 'drops'];
const tsvRows = files.spawns.map(spawn => {
    const rec = monsterById.get(spawn.id);
    const [att, def, str, hp, rng, mage] = rec?.stats ?? [0, 0, 0, 0, 0, 0];
    return [
        spawn.x, spawn.z, spawn.level, spawn.id,
        rec?.name ?? spawn.id, rec?.debug ?? '', rec?.level ?? '',
        att, def, str, hp, rng, mage,
        rec?.members ?? false, rec?.size ?? 1, rec?.attackrange ?? 0,
        (rec?.drops ?? []).join(' | ')
    ].join('\t');
});
const tsv = [tsvHeader.join('\t'), ...tsvRows].join('\n') + '\n';
writeFileSync(join(dataDir, 'monsters.tsv'), tsv);

const monstersJson = monsterRecords.reduce(
    (acc, m) => {
        acc[m.id] = m;
        return acc;
    },
    {} as Record<number, any>
);
const json = {
    generation: {
        revisionTime: new Date().toISOString(),
        engine: config.engineDir,
        content: config.contentDir,
        bounds,
        land: [...files.land].sort(),
        spawnRecords: files.spawns.length,
        distinctIds: stats.distinctIds,
        configs: monsterRecords.length
    },
    spawns: files.spawns.map(s => ({ x: s.x, z: s.z, level: s.level, id: s.id })),
    monsters: monstersJson
};
writeFileSync(join(dataDir, 'monsters.json'), JSON.stringify(json, null, 2));

console.log(`spawns: ${stats.spawned}  distinct: ${stats.distinctIds}  configs: ${monsterRecords.length}  withDrops: ${stats.dropped}`);
console.log(`bounds: ${bounds.minX},${bounds.minZ} .. ${bounds.maxX},${bounds.maxZ}`);
console.log(`wrote ${join(dataDir, 'monsters.tsv')} and ${join(dataDir, 'monsters.json')}`);