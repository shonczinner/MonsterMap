/**
 * Parser for the world-map place-name labels.
 *
 * Source: `Server/content/maps/labels.txt` — one label per line, `=Name,x,z,type`.
 *   Name  — label text; a `/` splits it into a two-line label
 *   x, z  — world tile coordinates (absX, absZ), same space as spawn coords
 *   type  — 1 = town/city, 2 = region/island, 0 = minor landmark / POI
 *
 * `Worldmap.ts` packs this into `worldmap.jag → labels.dat`.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export type PlaceLabel = {
    name: string;
    lines: string[];
    x: number;
    z: number;
    type: number;
};

export function parseLabels(contentDir: string): PlaceLabel[] {
    const path = join(contentDir, 'maps/labels.txt');
    if (!existsSync(path)) {
        return [];
    }
    const out: PlaceLabel[] = [];
    for (const raw of readFileSync(path, 'utf8').split('\n')) {
        const line = raw.trim();
        if (!line.startsWith('=')) {
            continue;
        }
        const parts = line.slice(1).split(',');
        if (parts.length < 4) {
            continue;
        }
        const name = parts[0].trim();
        const x = Number(parts[1]);
        const z = Number(parts[2]);
        const type = Number(parts[3]);
        if (!name || Number.isNaN(x) || Number.isNaN(z)) {
            continue;
        }
        out.push({ name, lines: name.split('/'), x, z, type });
    }
    return out;
}
