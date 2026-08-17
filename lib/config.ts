/**
 * Config loader for MonsterMap.
 *
 * Reads .env (loaded by bun automatically) — all paths are fully expanded
 * there from the base dirs. Optional CLI flags override a path.
 *
 * Env vars:
 *   ENGINE_DIR / CONTENT_DIR / CLIENT_DIR   base dirs
 *   MAPS_SERVER_ZIP, WORLDMAP_JAG
 *   DROP_SCRIPTS_DIR, OUT_DIR
 *
 * Flags (any position):
 *   --engine <dir>    --content <dir>    --client <dir>    --out <dir>
 *   --maps-server <zip>
 */
import { existsSync, readFileSync } from 'node:fs';
import { join, isAbsolute, resolve } from 'node:path';

export type Config = {
    engineDir: string;
    contentDir: string;
    clientDir: string;
    outDir: string;
    /** out/maps — baked area PNGs + layout.json (from lib/maps/bake.ts). */
    mapsDir: string;
    /** out/data — generated monster/spawn data (from gen.ts). */
    dataDir: string;
    /** out/build — transient build artifacts (bundle/bake intermediates). */
    buildDir: string;
    mapsServerZip: string;
    worldmapJag: string;
    dropScriptsDir: string;
};

function flagValue(args: string[], name: string): string | null {
    const i = args.indexOf(name);
    if (i === -1 || i + 1 >= args.length) {
        return null;
    }
    return args[i + 1] ?? null;
}

function abs(p: string): string {
    return isAbsolute(p) ? p : resolve(process.cwd(), p);
}

function readEnvFile(): Record<string, string> {
    const envPath = join(process.cwd(), '.env');
    const result: Record<string, string> = {};
    if (existsSync(envPath)) {
        const content = readFileSync(envPath, 'utf8');
        for (const line of content.split('\n')) {
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith('#')) continue;
            const eq = trimmed.indexOf('=');
            if (eq > 0) {
                const key = trimmed.slice(0, eq).trim();
                let val = trimmed.slice(eq + 1).trim();
                if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
                    val = val.slice(1, -1);
                }
                result[key] = val;
            }
        }
    }
    return result;
}

function expandResult(
    env: Record<string, string | undefined>,
    kv: Record<string, string | undefined>
): Record<string, string> {
    // Expand ${BASE} references against the flat map, resolving in key order.
    const expanded: Record<string, string> = {};
    const get = (k: string): string => expanded[k] ?? env[k] ?? '';
    for (const [k, v] of Object.entries({ ...env, ...kv })) {
        const val = v ?? '';
        expanded[k] = val.replace(/\$\{([A-Z0-9_]+)\}/g, (_m, name: string) => get(name));
    }
    return expanded;
}

export function loadConfig(): Config {
    const args = process.argv.slice(2);
    const rawEnv = { ...process.env, ...readEnvFile() };
    const cwd = process.cwd();

    const flag = (name: string, key: string): string | null =>
        flagValue(args, name) ?? rawEnv[key] ?? null;

    const engineDir = abs(flag('--engine', 'ENGINE_DIR') ?? join(cwd, '../Server/engine'));
    const contentDir = abs(flag('--content', 'CONTENT_DIR') ?? join(cwd, '../Server/content'));
    const clientDir = abs(flag('--client', 'CLIENT_DIR') ?? join(cwd, '..', 'rs2b0t'));

    const env = expandResult(rawEnv, {
        ENGINE_DIR: engineDir,
        CONTENT_DIR: contentDir,
        CLIENT_DIR: clientDir
    });

    const path = (key: string): string =>
        abs(env[key] ?? join(engineDir, key.toLowerCase().replace(/_/g, '/')));

    const mapsServerZip = abs(flagValue(args, '--maps-server') ?? env.MAPS_SERVER_ZIP ?? join(engineDir, 'data/pack/.cache/maps-server.zip'));
    const worldmapJag = abs(env.WORLDMAP_JAG ?? join(engineDir, 'data/pack/mapview/worldmap.jag'));
    const dropScriptsDir = abs(env.DROP_SCRIPTS_DIR ?? join(contentDir, 'scripts'));
    const outDir = abs(flag('--out', 'OUT_DIR') ?? env.OUT_DIR ?? join(cwd, 'out'));
    const mapsDir = env.MAPS_DIR ?? join(outDir, 'maps');
    const dataDir = env.DATA_DIR ?? join(outDir, 'data');
    const buildDir = env.BUILD_DIR ?? join(outDir, 'build');

    const required: string[] = [
        mapsServerZip,
        worldmapJag,
        dropScriptsDir
    ];
    for (const p of required) {
        if (!existsSync(p)) {
            throw new Error(`Missing required path (check .env / flags): ${p}`);
        }
    }

    return {
        engineDir,
        contentDir,
        clientDir,
        outDir,
        mapsDir,
        dataDir,
        buildDir,
        mapsServerZip,
        worldmapJag,
        dropScriptsDir
    };
}