/**
 * Bake surface/dungeon/extra maps into three PNGs + layout.json.
 *
 * Runs the REAL rs2b0t MapView headless (via lib/maps/domShim.ts) once per area,
 * renders the full area to a PixMap, trims transparent/void borders using a
 * bounding box, and encodes each as an RGBA PNG (pure Node zlib). Also emits
 * layout.json with, per area, the PNG path and the world-tile->pixel mapping so
 * the page can stack the three PNGs and plot monster dots in world space.
 *
 * Entrypoint (baked to a self-contained node script by lib/maps/bake.ts):
 *   env JAG=worldmap.jag OUT=outdir → writes outdir/maps/{surface,dungeon,extra}.png
 *   and outdir/maps/layout.json
 *
 * Nothing in rs2b0t is modified.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';

import './domShim.js';

import { MapView } from '#/mapview/MapView.js';
import JagFile from '#/io/JagFile.js';
import PixMap from '#/graphics/PixMap.js';

type AreaDef = { name: string; ai: number; originX: number; originZ: number; w: number; h: number };

const AREAS: AreaDef[] = [
    { name: 'surface', ai: 0, originX: 32 << 6, originZ: 44 << 6, w: 25 << 6, h: 19 << 6 },
    { name: 'dungeon', ai: 1, originX: 32 << 6, originZ: 144 << 6, w: 25 << 6, h: 19 << 6 },
    { name: 'extra', ai: 2, originX: 28 << 6, originZ: 65 << 6, w: 21 << 6, h: 15 << 6 }
];

export type BakeArea = AreaDef & {
    png: string;
    /** Cropped canvas size in pixels (1 px = 1 world tile). */
    wPx: number;
    hPx: number;
    /** World tile of the top-left cropped pixel: maps screen pixel -> world tile. */
    tileX0: number;
    tileZTop: number;
    /** World tile just past the bottom-right cropped pixel (exclusive). */
    tileX1: number;
    tileZBot: number;
};

class BakeMapView extends MapView {
    override async run(): Promise<void> {
        // GameShell calls run() from the constructor; maininit is driven per-area in bakeAll.
        while (!this.initDone) {
            await new Promise(r => setTimeout(r, 1));
        }
    }
    override async drawProgress(): Promise<void> {}
    override async loadWorldmap() {
        if (!this.worldmap) {
            const jag = process.env.JAG;
            if (!jag) {
                throw new Error('JAG env not set');
            }
            this.worldmap = new JagFile(new Uint8Array(readFileSync(jag)));
        }
        return this.worldmap;
    }
    protected override resize(width: number, height: number): void {
        this.drawArea = new PixMap(width, height);
    }

    initDone = false;

    /** worldmap.jag carries fewer mapscene/mapfunction sprites than MapView
        indexes (56/57 here); pad gaps with the last good sprite. Instance-only. */
    padSpriteArrays(): void {
        const pad = (arr: Array<Pix8Like | undefined>) => {
            for (let i = 0; i < 255; i++) {
                if (arr[i]) continue;
                for (let j = i - 1; j >= 0; j--) {
                    if (arr[j]) {
                        arr[i] = arr[j];
                        break;
                    }
                }
            }
        };
        pad(this.mapscene as Array<Pix8Like | undefined>);
        pad(this.mapfunction as Array<Pix8Like | undefined>);
    }
}

type Pix8Like = { data: Int32Array; wi: number; hi: number; xof: number; yof: number };

export async function bakeAll(): Promise<{ files: string[]; layout: BakeArea[] }> {
    const jagPath = process.env.JAG;
    if (!jagPath) {
        throw new Error('JAG env not set');
    }
    const outDir = process.env.OUT ?? 'out';
    mkdirSync(outDir, { recursive: true });
    const dir = path => join(outDir, path);

    const view = new BakeMapView();

    MapView.shouldDrawLabels = false;
    MapView.shouldDrawMapfunctions = false;
    MapView.shouldDrawBorders = false;
    MapView.shouldDrawNpcs = false;
    MapView.shouldDrawItems = false;
    MapView.shouldDrawMultimap = false;
    MapView.shouldDrawFreemap = false;

    const layout: BakeArea[] = [];
    const files: string[] = [];

    for (const area of AREAS) {
        view.mapArea = area.ai;
        view.mapOriginX = area.originX;
        view.mapOriginZ = area.originZ;
        view.mapWidth = area.w;
        view.mapHeight = area.h;
        view.zoom = 1;
        view.targetZoom = 1;

        await view.maininit();
        view.initDone = true;
        view.padSpriteArrays();

        // full-area render, 1 px per tile, north-up: screen row 0 = tileZ (originZ + h)
        const pw = area.w;
        const ph = area.h;
        const pix: PixMap = new PixMap(pw, ph);
        pix.setPixels();
        view.renderWorldMap(0, 0, area.w, area.h, 0, 0, pw, ph);
        const px = pix.data;

        // bounding-box crop of non-transparent pixels (0 = void/sea)
        let minX = pw;
        let minY = ph;
        let maxX = -1;
        let maxY = -1;
        for (let y = 0; y < ph; y++) {
            const row = y * pw;
            for (let x = 0; x < pw; x++) {
                if ((px[row + x] >>> 0) !== 0) {
                    if (x < minX) minX = x;
                    if (x > maxX) maxX = x;
                    if (y < minY) minY = y;
                    if (y > maxY) maxY = y;
                }
            }
        }
        if (maxX < 0) {
            throw new Error(`area ${area.name} rendered empty`);
        }
        const cw = maxX - minX + 1;
        const ch = maxY - minY + 1;
        const crop = new Int32Array(cw * ch);
        for (let y = 0; y < ch; y++) {
            const srcRow = (y + minY) * pw;
            for (let x = 0; x < cw; x++) {
                crop[y * cw + x] = px[srcRow + (x + minX)];
            }
        }

        const rgba = pix2dToRgba(crop);
        const name = `${area.name}.png`;
        writeFileSync(dir(name), encodePngRgba(rgba, cw, ch));
        files.push(name);

        layout.push({
            name: area.name,
            ai: area.ai,
            originX: area.originX,
            originZ: area.originZ,
            w: area.w,
            h: area.h,
            png: name,
            wPx: cw,
            hPx: ch,
            tileX0: area.originX + minX,
            tileZTop: area.originZ + area.h - minY,
            tileX1: area.originX + maxX + 1,
            tileZBot: area.originZ + area.h - maxY - 1
        });
    }

    writeFileSync(join(outDir, 'layout.json'), JSON.stringify(layout, null, 2) + '\n');
    files.push('layout.json');

    return { files, layout };
}

/** Convert 0x00RRGGBB pixels (0 = transparent) to RGBA. */
function pix2dToRgba(pixels: Int32Array): Uint8Array {
    const rgba = new Uint8Array(pixels.length * 4);
    for (let i = 0; i < pixels.length; i++) {
        const p = pixels[i] >>> 0;
        if (p === 0) continue;
        const o = i * 4;
        rgba[o] = (p >> 16) & 0xff;
        rgba[o + 1] = (p >> 8) & 0xff;
        rgba[o + 2] = p & 0xff;
        rgba[o + 3] = 0xff;
    }
    return rgba;
}

/** Minimal RGBA PNG encoder (filter none, Node zlib) — mirrors rs2b0t's tools/map/encodePng. */
function crc32(buf: Uint8Array): number {
    let c = 0xffffffff;
    for (let i = 0; i < buf.length; i++) {
        c ^= buf[i];
        for (let k = 0; k < 8; k++) {
            c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1;
        }
    }
    return ~c >>> 0;
}
function chunk(type: string, data: Uint8Array): Uint8Array {
    const typeBytes = new TextEncoder().encode(type);
    const len = new Uint8Array(4);
    new DataView(len.buffer).setUint32(0, data.length);
    const crcIn = new Uint8Array(typeBytes.length + data.length);
    crcIn.set(typeBytes, 0);
    crcIn.set(data, typeBytes.length);
    const crc = new Uint8Array(4);
    new DataView(crc.buffer).setUint32(0, crc32(crcIn));
    const out = new Uint8Array(4 + typeBytes.length + data.length + 4);
    out.set(len, 0);
    out.set(typeBytes, 4);
    out.set(data, 4 + typeBytes.length);
    out.set(crc, 4 + typeBytes.length + data.length);
    return out;
}
function encodePngRgba(rgba: Uint8Array, width: number, height: number): Uint8Array {
    if (rgba.length !== width * height * 4) {
        throw new Error(`rgba length ${rgba.length} != ${width}*${height}*4`);
    }
    const stride = width * 4 + 1;
    const raw = new Uint8Array(stride * height);
    for (let y = 0; y < height; y++) {
        const row = y * stride;
        raw[row] = 0;
        raw.set(rgba.subarray(y * width * 4, (y + 1) * width * 4), row + 1);
    }
    const ihdr = new Uint8Array(13);
    const dv = new DataView(ihdr.buffer);
    dv.setUint32(0, width);
    dv.setUint32(4, height);
    ihdr[8] = 8;
    ihdr[9] = 6;
    const sig = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
    const parts = [sig, chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', new Uint8Array(0))];
    let total = 0;
    for (const p of parts) total += p.length;
    const out = new Uint8Array(total);
    let o = 0;
    for (const p of parts) {
        out.set(p, o);
        o += p.length;
    }
    return out;
}

if (import.meta.main) {
    const { files, layout } = await bakeAll();
    console.log('baked files:');
    for (const f of files) console.log('  ', f);
    console.log('layout:', layout.map(a => `${a.name} ${a.wPx}x${a.hPx}`).join(', '));
}