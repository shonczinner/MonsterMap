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
        const data = entries[key];
        let pos = 0;

        while (pos < data.length) {
            const coord = (data[pos] << 8) | data[pos + 1];
            pos += 2;
            const count = data[pos++];
            const { x, z, level } = unpackCoord(coord);
            for (let i = 0; i < count; i++) {
                const id = (data[pos] << 8) | data[pos + 1];
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