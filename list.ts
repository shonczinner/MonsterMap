/**
 * MonsterMap — monster list page.
 *
 * Usage: bun list.ts [--out DIR]
 *
 * Reads the TSV emitted by gen.ts (out/data/monsters.tsv) and emits a
 * filterable `out/monsters.html` via the shared list-page builder. Spawn
 * coordinate columns (absX/absZ) are dropped because they're already plotted on
 * the map and just clutter the table.
 */
import { join } from 'node:path';

import { loadConfig } from './lib/config.ts';
import { buildListPage } from './lib/listpage.ts';

const config = loadConfig();
buildListPage({
    tsvPath: join(config.dataDir, 'monsters.tsv'),
    templatePath: join(import.meta.dir, 'template_list.html'),
    outPath: join(config.outDir, 'monsters.html'),
    navFile: 'monsters.html',
    excludes: ['absX', 'absZ'],
    noun: 'monsters',
    title: 'Monsters — MonsterMap',
    dedupe: true
});
