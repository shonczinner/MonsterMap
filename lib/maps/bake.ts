/**
 * Bake the three worldmap-area PNGs headlessly.
 *
 * Wraps lib/maps/bakeSource.ts (which imports `#/...` from rs2b0t's scope):
 * rewrites those aliases to absolute source paths, `bun build --target=node`,
 * then runs the bundle with JAG/OUT in the environment.
 *
 * Nothing in rs2b0t is modified.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { loadConfig } from '../config.ts';

function main(): void {
    const config = loadConfig();
    if (!existsSync(config.worldmapJag)) {
        throw new Error(`worldmap.jag missing: ${config.worldmapJag}`);
    }
    const { mapsDir, buildDir } = config;
    mkdirSync(buildDir, { recursive: true });
    mkdirSync(mapsDir, { recursive: true });

    const src = readFileSync(join(import.meta.dirname, 'bakeSource.ts'), 'utf8');
    const root = join(config.clientDir, 'src').replace(/\\/g, '/');
    const rewritten = src.replace(/(['"])#\/([^'"]+\.js)\1/g, `'${root}/$2'`);
    // domShim is imported relatively; stage a copy beside the entry.
    writeFileSync(join(buildDir, 'domShim.ts'), readFileSync(join(import.meta.dirname, 'domShim.ts'), 'utf8'));

    const entry = join(buildDir, '.bake-entry.ts');
    writeFileSync(entry, rewritten);

    const bundleOut = join(buildDir, '.bake.cjs').replace(/\\/g, '/');
    const cmd = ['bun', 'build', '--target=node', '--outfile=' + bundleOut, entry];
    execFileSync(cmd[0], cmd.slice(1), { stdio: 'inherit' });

    const run = ['bun', bundleOut];
    execFileSync(run[0], run.slice(1), {
        stdio: 'inherit',
        env: {
            ...process.env,
            JAG: config.worldmapJag,
            OUT: mapsDir
        }
    });
    console.log(`baked -> ${join(mapsDir, '{surface,dungeon,extra}.png')} + layout.json`);
}

if (import.meta.main) {
    main();
}