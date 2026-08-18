/**
 * Shared list-page builder.
 *
 * Reads a TSV (emitted by a gen step), classifies each column as text or
 * numeric (numeric only if every non-empty value parses as a number), drops
 * the `excludes` columns, and writes a self-contained, filterable HTML table
 * using `template_list.html`. Both `list.ts` (monsters) and `items.ts` (items)
 * call this so the two pages stay consistent.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { navHtml } from './pages.ts';

export type ListPageOpts = {
    /** Source TSV (tab-separated, header row first). */
    tsvPath: string;
    /** Template to fill (must contain __MM_DATA__ / __MM_NAV__ / __MM_TITLE__). */
    templatePath: string;
    /** Output HTML path. */
    outPath: string;
    /** File name of this page (for the active nav link). */
    navFile: string;
    /** Columns to drop from the table. */
    excludes?: string[];
    /** Noun used in the result count, e.g. "monsters" / "items". */
    noun?: string;
    /** Page <title>. */
    title?: string;
    /** Drop rows identical across every displayed column (keeps first). */
    dedupe?: boolean;
};

export function buildListPage(opts: ListPageOpts): void {
    const { tsvPath, templatePath, outPath, navFile, excludes = [], noun = 'rows', title = 'MonsterMap', dedupe = false } = opts;
    if (!existsSync(tsvPath)) {
        throw new Error(`${tsvPath} missing — run the matching gen step first`);
    }

    const EXCLUDE = new Set(excludes);
    const raw = readFileSync(tsvPath, 'utf8').replace(/\r\n/g, '\n').replace(/\n$/, '');
    const lines = raw.split('\n');
    const header = lines[0]!.split('\t');
    const cols = header.filter((c) => !EXCLUDE.has(c));

    const records: Record<string, string>[] = [];
    for (let i = 1; i < lines.length; i++) {
        const line = lines[i]!;
        if (!line) continue;
        const cells = line.split('\t');
        const rec: Record<string, string> = {};
        for (let c = 0; c < header.length; c++) {
            const key = header[c]!;
            if (EXCLUDE.has(key)) continue;
            rec[key] = cells[c] ?? '';
        }
        records.push(rec);
    }

    // collapse rows identical across every displayed column (e.g. the same
    // monster listed once per spawn point) — keeps the first occurrence.
    if (dedupe) {
        const seen = new Set<string>();
        const out: Record<string, string>[] = [];
        for (const r of records) {
            const key = JSON.stringify(cols.map((c) => r[c]));
            if (seen.has(key)) continue;
            seen.add(key);
            out.push(r);
        }
        records.length = 0;
        for (const r of out) records.push(r);
    }

    const numeric = new Set<string>();
    for (const key of cols) {
        let seen = false, allNum = true;
        for (const r of records) {
            const v = r[key];
            if (v === '' || v == null) continue;
            seen = true;
            if (isNaN(Number(v))) { allNum = false; break; }
        }
        // a column with no non-empty values (or any non-numeric value) is text
        if (seen && allNum) numeric.add(key);
    }

    const columns = cols.map((key) => ({ key, label: key, num: numeric.has(key) }));
    const payload = { columns, rows: records, noun };
    const json = JSON.stringify(payload);

    const tpl = readFileSync(templatePath, 'utf8');
    const html = tpl
        .split('__MM_DATA__').join(json)
        .split('__MM_NAV__').join(navHtml(navFile))
        .split('__MM_TITLE__').join(title);

    writeFileSync(outPath, html);
    console.log(`wrote ${outPath} (${records.length} ${noun}, ${columns.length} columns)`);
}
