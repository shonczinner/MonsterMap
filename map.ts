/**
 * MonsterMap — all three worldmap areas at once from baked PNGs.
 *
 * Usage: bun map.ts [--out DIR]
 *
 * Requires (all from bun lib/maps/bake.ts + bun gen.ts):
 *   out/maps/{surface,dungeon,extra}.png + layout.json
 *   out/data/monsters.json  itemspawns.json  resources.json
 *   out/data/locationnames.json  minimapicons.json
 *
 * Builds out/monstermap.html — a side panel + canvas that stacks the three
 * baked area PNGs vertically (no ocean gaps) and plots every point of interest
 * with a fixed color per category. Each category has an on/off toggle; a search
 * box builds a dropdown of matching element names and flashes those dots.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { loadConfig } from './lib/config.ts';
import { CATEGORY_ORDER, CATEGORY_LABELS, CATEGORY_COLORS } from './lib/colors.ts';

// Browser-side helper source, inlined into the page <script> (no bundler).
const clusteringSrc = readFileSync(join(import.meta.dir, 'lib/mapClustering.ts'), 'utf8');

const config = loadConfig();
const dataDir = config.dataDir;
const mapsDir = config.mapsDir;
const needed = [
    join(dataDir, 'monsters.json'),
    join(dataDir, 'itemspawns.json'),
    join(dataDir, 'resources.json'),
    join(dataDir, 'locationnames.json'),
    join(dataDir, 'minimapicons.json'),
    join(mapsDir, 'layout.json')
];
for (const p of needed) {
    if (!existsSync(p)) {
        throw new Error(`${p} missing — run bun gen.ts then bun lib/maps/bake.ts`);
    }
}

type AreaLayout = {
    name: string;
    ai: number;
    originX: number;
    originZ: number;
    w: number;
    h: number;
    png: string;
    wPx: number;
    hPx: number;
    tileX0: number;
    tileZTop: number;
    tileX1: number;
    tileZBot: number;
};

const monsters = JSON.parse(readFileSync(join(dataDir, 'monsters.json'), 'utf8'));
const dropsData = JSON.parse(readFileSync(join(dataDir, 'drops.json'), 'utf8'));
const storesData = JSON.parse(readFileSync(join(dataDir, 'stores.json'), 'utf8'));
const items = JSON.parse(readFileSync(join(dataDir, 'itemspawns.json'), 'utf8'));
const res = JSON.parse(readFileSync(join(dataDir, 'resources.json'), 'utf8'));
const locs = JSON.parse(readFileSync(join(dataDir, 'locationnames.json'), 'utf8'));
const icons = JSON.parse(readFileSync(join(dataDir, 'minimapicons.json'), 'utf8'));
const layout = JSON.parse(readFileSync(join(mapsDir, 'layout.json'), 'utf8')) as AreaLayout[];

// --- build a unified point list (dots) + place labels (text)
const points: any[] = [];
for (const s of monsters.spawns) {
    const m = monsters.monsters[s.id];
    if (!m) continue;
    const st = storesData.stores[s.id];
    points.push({ x: s.x, z: s.z, level: s.level, cat: st ? 'shop' : 'monster', name: m.name, sub: 'lvl ' + m.level, id: s.id, drops: dropsData.drops[s.id], shop: st, hasShop: !!st });
}
for (const s of items.spawns) {
    points.push({ x: s.x, z: s.z, level: s.level, cat: 'item', name: s.name, sub: 'x' + s.count, id: s.id });
}
for (const s of res.spawns) {
    if (s.kind === 'mining') {
        points.push({ x: s.x, z: s.z, level: s.level, cat: 'mining', name: s.group || s.name, sub: s.reqLevel ? 'rock lvl ' + s.reqLevel : 'rock', id: s.id });
    } else if (s.kind === 'woodcut') {
        points.push({ x: s.x, z: s.z, level: s.level, cat: 'woodcut', name: s.group || s.name, sub: s.reqLevel ? 'tree lvl ' + s.reqLevel : 'tree', id: s.id });
    } else if (s.kind === 'fishing') {
        points.push({ x: s.x, z: s.z, level: s.level, cat: 'fish', name: 'Fishing spot', sub: s.fish && s.fish.length ? s.fish.join(', ') : (s.category || ''), id: s.id });
    } else if (s.kind === 'flax') {
        points.push({ x: s.x, z: s.z, level: s.level, cat: 'flax', name: s.name, sub: '', id: s.id });
    }
}
// coords already claimed by the monster / fishing layers — those NPCs also
// carry a minimap icon, so skip the duplicate "Map icon" dot that would paint
// on top of (and hide) the monster/fish colour.
const claimed = new Set<string>();
for (const s of monsters.spawns) claimed.add(s.x + '|' + s.z);
for (const s of res.spawns) if (s.kind === 'fishing') claimed.add(s.x + '|' + s.z);
for (const s of icons.locations) {
    if (s.kind === 'npc' && claimed.has(s.x + '|' + s.z)) continue;
    points.push({ x: s.x, z: s.z, level: s.level, cat: 'poi', name: s.icon || s.name, sub: s.name, id: s.id });
}
const labels = locs.places.map((p: any) => ({ x: p.x, z: p.z, level: 0, cat: 'place', name: p.name, lines: p.lines, type: p.type }));

// only what sits inside a baked area's trimmed tiles is visible
const inArea = (x: number, z: number): boolean =>
    layout.some(a => x >= a.tileX0 && x < a.tileX1 && z >= a.tileZBot && z <= a.tileZTop);
const pts = points.filter(p => inArea(p.x, p.z));
const lbls = labels.filter(p => inArea(p.x, p.z));
if (pts.length === 0 && lbls.length === 0) {
    throw new Error('no points overlap the baked area tiles');
}

// stacking
const stack = layout.map(a => ({ ...a }));
const stackHeight = stack.reduce((n, a) => n + a.hPx, 0);
const stackWidth = Math.max(...stack.map(a => a.wPx));
let acc = 0;
for (const a of stack) {
    a['yOff'] = acc;
    acc += a.hPx;
}
type StackArea = AreaLayout & { yOff: number };

// distinct names for the search dropdown (incl. the fish each fishing spot yields,
// and each shop's title so stores are searchable by name)
const nameSet = new Set<string>();
for (const p of pts) {
  nameSet.add(p.name);
  if (p.cat === 'fish' && p.sub) {
    for (const f of p.sub.split(',')) { const t = f.trim(); if (t) nameSet.add(t); }
  }
  if (p.shop) {
    for (const sh of p.shop.shops) {
      if (sh.title) nameSet.add(sh.title);
      for (const it of sh.items) if (it.name) nameSet.add(it.name);
    }
  }
  if (p.drops) for (const dn of p.drops) if (dn) nameSet.add(dn);
}
for (const l of lbls) nameSet.add(l.name);
const ALL_NAMES = [...nameSet].sort((a, b) => a.localeCompare(b));

const cats = CATEGORY_ORDER.map(k => ({ key: k, label: CATEGORY_LABELS[k], color: CATEGORY_COLORS[k] }));
const colorOf: Record<string, string> = {};
for (const k of CATEGORY_ORDER) colorOf[k] = CATEGORY_COLORS[k];

const html = render({ pts, lbls, stack, stackWidth, stackHeight, cats, colorOf, allNames: ALL_NAMES });
writeFileSync(join(config.outDir, 'monstermap.html'), html);
console.log(`wrote ${join(config.outDir, 'monstermap.html')} (${pts.length} dots, ${lbls.length} labels, ${stack.length} areas)`);

function render(payload: {
    pts: any[];
    lbls: any[];
    stack: StackArea[];
    stackWidth: number;
    stackHeight: number;
    cats: { key: string; label: string; color: string }[];
    colorOf: Record<string, string>;
    allNames: string[];
}): string {
    const json = JSON.stringify(payload);
    const tpl = readFileSync(join(import.meta.dir, "template.html"), "utf8");
    return tpl.split("__MM_DATA__").join(json).split("__MM_CLUSTERING__").join(clusteringSrc);
}
