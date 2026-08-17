/**
 * Spawn decoding for MonsterMap.
 *
 * Reads maps-server.zip and decodes the `n{mapX}_{mapZ}` entries.
 *
 * Format (mirrors GameMap.loadNpcs/unpackCoord):
 *   repeat until file end:
 *     coord : u16 big-endian
 *     count : u8
 *     ids   : count * u16 big-endian
 *   coord bits: level=(c>>12)&3, x=(c>>6)&0x3f, z=c&0x3f
 *   absoluteX = (mapX<<6) + x        absoluteZ = (mapZ<<6) + z
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { unzipSync } from 'fflate';

export type Spawn = {
    x: number;
    z: number;
    level: number;
    id: number;
    mapX: number;
    mapZ: number;
};

export type ItemSpawn = {
    x: number;
    z: number;
    level: number;
    /** ObjType id of the ground item. */
    id: number;
    /** stack count at this tile. */
    count: number;
    mapX: number;
    mapZ: number;
};

export type LocSpawn = {
    x: number;
    z: number;
    level: number;
    /** LocType id of the game object. */
    id: number;
    shape: number;
    angle: number;
    mapX: number;
    mapZ: number;
};

export type MapData = {
    spawns: Spawn[];
    itemSpawns: ItemSpawn[];
    locSpawns: LocSpawn[];
    land: Set<string>;
};

export type MapBounds = {
    minX: number;
    maxX: number;
    minZ: number;
    maxZ: number;
};

export function unpackCoord(packed: number): { x: number; z: number; level: number } {
    return {
        x: (packed >> 6) & 0x3f,
        z: packed & 0x3f,
        level: (packed >> 12) & 0x3
    };
}

export function loadSpawns(zipPath: string): { spawns: Spawn[]; land: Set<string> } {
    const land = new Set<string>();
    const spawns: Spawn[] = [];

    const entries = unzipSync(readFileSync(zipPath));
    const keys = Object.keys(entries).sort();

    for (const key of keys) {
        // land coverage map squares (m{mapX}_{mapZ})
        const m = /^m(\d+)_(\d+)$/.exec(key);
        if (m) {
            const mx = Number(m[1]);
            const mz = Number(m[2]);
            land.add(`${mx}_${mz}`);
            continue;
        }

        const n = /^n(\d+)_(\d+)$/.exec(key);
        if (!n) {
            continue;
        }
        const mapX = Number(n[1]);
        const mapZ = Number(n[2]);
        const baseX = mapX << 6;
        const baseZ = mapZ << 6;
        const data = entries[key]!;
        let pos = 0;

        while (pos < data.length) {
            const coord = (data[pos]! << 8) | data[pos + 1]!;
            pos += 2;
            const count = data[pos++]!;
            const { x, z, level } = unpackCoord(coord);
            for (let i = 0; i < count; i++) {
                const id = (data[pos]! << 8) | data[pos + 1]!;
                pos += 2;
                spawns.push({ x: baseX + x, z: baseZ + z, level, id, mapX, mapZ });
            }
        }
    }

    return { spawns, land };
}

export function boundsOf(spawns: Spawn[]): MapBounds {
    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (const s of spawns) {
        if (s.x < minX) minX = s.x;
        if (s.x > maxX) maxX = s.x;
        if (s.z < minZ) minZ = s.z;
        if (s.z > maxZ) maxZ = s.z;
    }
    return { minX, maxX, minZ, maxZ };
}

/**
 * Smart integer (gsmarts) read, mirroring `Packet.gsmarts`: a single byte when
 * the next byte < 0x80, otherwise a big-endian u16 minus 0x8000.
 */
function gsmarts(data: Uint8Array, pos: { v: number }): number {
    if (data[pos.v]! < 0x80) {
        return data[pos.v++]!;
    }
    const v = (data[pos.v]! << 8) | data[pos.v + 1]!;
    pos.v += 2;
    return v - 0x8000;
}

/**
 * Decode every mapsquare family from `maps-server.zip` in one pass.
 *
 *   n{mapX}_{mapZ}  NPC spawns        (see loadSpawns)
 *   o{mapX}_{mapZ}  ground-item spawns
 *   l{mapX}_{mapZ}  loc (game-object) spawns, gsmarts delta-encoded
 *
 * `o{}` format (mirrors GameMap.loadObjs):
 *   coord u16, count u8, count × (objId u16, stackCount u8)
 * `l{}` format (mirrors GameMap.loadLocations):
 *   locId = -1
 *   while (locIdOffset = gsmarts()) != 0:
 *     locId += locIdOffset
 *     coord = 0
 *     while (coordOffset = gsmarts()) != 0:
 *       coord += coordOffset - 1
 *       unpack coord -> x,z,level
 *       info = g1()              ( (shape << 2) | angle )
 *     ...
 */
export function loadMaps(zipPath: string): MapData {
    const land = new Set<string>();
    const spawns: Spawn[] = [];
    const itemSpawns: ItemSpawn[] = [];
    const locSpawns: LocSpawn[] = [];

    const entries = unzipSync(readFileSync(zipPath));
    const keys = Object.keys(entries).sort();

    for (const key of keys) {
        const m = /^m(\d+)_(\d+)$/.exec(key);
        if (m) {
            land.add(`${m[1]}_${m[2]}`);
            continue;
        }

        const base = /^([nol])(\d+)_(\d+)$/.exec(key);
        if (!base) {
            continue;
        }
        const family = base[1];
        const mapX = Number(base[2]);
        const mapZ = Number(base[3]);
        const baseX = mapX << 6;
        const baseZ = mapZ << 6;
        const data = entries[key]!;

        if (family === 'n') {
            let pos = 0;
            while (pos < data.length) {
                const coord = (data[pos]! << 8) | data[pos + 1]!;
                pos += 2;
                const count = data[pos++]!;
                const { x, z, level } = unpackCoord(coord);
                for (let i = 0; i < count; i++) {
                    const id = (data[pos]! << 8) | data[pos + 1]!;
                    pos += 2;
                    spawns.push({ x: baseX + x, z: baseZ + z, level, id, mapX, mapZ });
                }
            }
        } else if (family === 'o') {
            let pos = 0;
            while (pos < data.length) {
                const coord = (data[pos]! << 8) | data[pos + 1]!;
                pos += 2;
                const count = data[pos++]!;
                const { x, z, level } = unpackCoord(coord);
                for (let i = 0; i < count; i++) {
                    const id = (data[pos]! << 8) | data[pos + 1]!;
                    pos += 2;
                    const stackCount = data[pos++]!;
                    itemSpawns.push({ x: baseX + x, z: baseZ + z, level, id, count: stackCount, mapX, mapZ });
                }
            }
        } else if (family === 'l') {
            const pos = { v: 0 };
            let locId = -1;
            let locIdOffset = gsmarts(data, pos);
            while (locIdOffset !== 0) {
                locId += locIdOffset;
                let coord = 0;
                let coordOffset = gsmarts(data, pos);
                while (coordOffset !== 0) {
                    coord += coordOffset - 1;
                    const { x, z, level } = unpackCoord(coord);
                    const info = data[pos.v++]!;
                    const shape = info >> 2;
                    const angle = info & 0x3;
                    locSpawns.push({
                        x: baseX + x,
                        z: baseZ + z,
                        level,
                        id: locId,
                        shape,
                        angle,
                        mapX,
                        mapZ
                    });
                    coordOffset = gsmarts(data, pos);
                }
                locIdOffset = gsmarts(data, pos);
            }
        }
    }

    return { spawns, itemSpawns, locSpawns, land };
}